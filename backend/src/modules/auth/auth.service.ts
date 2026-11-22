import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthTokenType, Session, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthUser } from '@/common/http/decorators';
import { DomainError } from '@/common/http/errors';
import { isValidTimezone, MS_PER_HOUR } from '@/common/time/time';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { isUniqueViolation, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { toPreferenceDto, toUserDto, UsersService } from '../users/users.service';
import { DeviceSessionDto, RegisterDto, SessionDto } from './auth.dto';
import { MailerService } from './mailer.service';

export const SESSION_COOKIE = 'tf_session';
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const RESET_TOKEN_TTL_MS = MS_PER_HOUR;
const VERIFY_TOKEN_TTL_MS = 48 * MS_PER_HOUR;

interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthenticatedSession {
  user: AuthUser;
  session: Session;
}

/**
 * Session-based authentication.
 *
 *  - Passwords: Argon2id (OWASP parameters), never logged or returned.
 *  - Sessions: 256-bit random token in an HttpOnly cookie; the database stores only its SHA-256,
 *    so a database leak does not yield usable session tokens. Each device has its own row and
 *    can be revoked individually. Absolute expiry + idle timeout.
 *  - CSRF: token = HMAC(SESSION_SECRET, sessionId). It is returned in the session payload and
 *    must be echoed in X-CSRF-Token for every state-changing request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly hashOptions: argon2.HashOptions & { raw?: false };
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.hashOptions =
      env.NODE_ENV === 'test'
        ? { type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 } // fast, tests only
        : { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
  }

  // ── primitives ─────────────────────────────────────────────────────────────

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, this.hashOptions);
  }

  csrfTokenFor(sessionId: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET).update(`csrf:${sessionId}`).digest('base64url');
  }

  verifyCsrf(sessionId: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.csrfTokenFor(sessionId));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async createSession(userId: string, meta: RequestMeta): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: this.sha256(token),
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
        ipAddress: meta.ip,
        expiresAt: new Date(Date.now() + this.env.SESSION_TTL_DAYS * 24 * MS_PER_HOUR),
      },
    });
    return { token, session };
  }

  private async buildSessionDto(user: User, sessionId: string): Promise<SessionDto> {
    const pref = await this.users.preference(user.id);
    return { user: toUserDto(user), preference: toPreferenceDto(pref), csrfToken: this.csrfTokenFor(sessionId) };
  }

  // ── registration & login ───────────────────────────────────────────────────

  async register(dto: RegisterDto, meta: RequestMeta): Promise<{ token: string; body: SessionDto }> {
    const passwordHash = await this.hashPassword(dto.password);
    const timezone = dto.timezone && isValidTimezone(dto.timezone) ? dto.timezone : 'UTC';
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: dto.email, passwordHash, displayName: dto.displayName.trim() },
        });
        await this.users.provisionDefaults(tx, created.id, timezone, dto.locale);
        await this.audit.record({ userId: created.id, action: 'auth.register', entityType: 'User', entityId: created.id, ipAddress: meta.ip }, tx);
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw DomainError.conflict('EMAIL_IN_USE', 'An account with this email already exists.');
      }
      throw err;
    }
    await this.issueToken(user, 'EMAIL_VERIFICATION');
    const { token, session } = await this.createSession(user.id, meta);
    return { token, body: await this.buildSessionDto(user, session.id) };
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<{ token: string; body: SessionDto }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Verify against a dummy hash when the account does not exist so timing does not reveal it.
    this.dummyHash ??= await this.hashPassword('timeflow-dummy-password');
    const ok = await argon2.verify(user?.passwordHash ?? this.dummyHash, password).catch(() => false);
    if (!user || !ok) {
      await this.audit.record({ userId: user?.id ?? null, action: 'auth.login.failed', entityType: 'User', entityId: user?.id, ipAddress: meta.ip });
      throw DomainError.unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    const { token, session } = await this.createSession(user.id, meta);
    await this.audit.record({ userId: user.id, action: 'auth.login', entityType: 'Session', entityId: session.id, ipAddress: meta.ip });
    return { token, body: await this.buildSessionDto(user, session.id) };
  }

  /** Resolve a cookie token to a live session, enforcing expiry, revocation and idle timeout. */
  async authenticate(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (!token || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.sha256(token) },
      include: { user: { select: { id: true, email: true, isDemo: true } } },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (session.lastSeenAt.getTime() + this.env.SESSION_IDLE_TIMEOUT_HOURS * MS_PER_HOUR <= now) return null;
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      void this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
    }
    return {
      session,
      user: { id: session.user.id, sessionId: session.id, email: session.user.email, isDemo: session.user.isDemo },
    };
  }

  async currentSession(user: AuthUser): Promise<SessionDto> {
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row) throw DomainError.unauthorized('UNAUTHENTICATED', 'Please sign in again.');
    return this.buildSessionDto(row, user.sessionId);
  }

  async logout(user: AuthUser): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: user.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'auth.logout', entityType: 'Session', entityId: user.sessionId });
  }

  // ── devices ────────────────────────────────────────────────────────────────

  async listSessions(user: AuthUser): Promise<DeviceSessionDto[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw DomainError.notFound('Session');
    await this.audit.record({ userId: user.id, action: 'auth.session.revoked', entityType: 'Session', entityId: sessionId });
    return res.count;
  }

  async revokeOtherSessions(user: AuthUser): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ userId: user.id, action: 'auth.sessions.revoked-others', entityType: 'User', entityId: user.id, metadata: { count: res.count } });
    return res.count;
  }

  // ── passwords ──────────────────────────────────────────────────────────────

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row || !(await argon2.verify(row.passwordHash, currentPassword).catch(() => false))) {
      throw DomainError.badRequest('INVALID_CREDENTIALS', 'Your current password is incorrect.');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // A password change signs out every other device.
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } }, data: { revokedAt: new Date() } });
      await this.audit.record({ userId: user.id, action: 'auth.password.changed', entityType: 'User', entityId: user.id }, tx);
    });
  }

  private async issueToken(user: User, type: AuthTokenType): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({ where: { userId: user.id, type, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.authToken.create({
        data: {
          userId: user.id,
          type,
          tokenHash: this.sha256(token),
          expiresAt: new Date(Date.now() + (type === 'PASSWORD_RESET' ? RESET_TOKEN_TTL_MS : VERIFY_TOKEN_TTL_MS)),
        },
      }),
    ]);
    const origin = this.env.FRONTEND_ORIGIN.split(',')[0]!.trim();
    if (type === 'PASSWORD_RESET') {
      await this.mailer.send(user.email, 'Reset your TIMEFLOW password', `${origin}/reset-password?token=${token}`);
    } else {
      await this.mailer.send(user.email, 'Verify your TIMEFLOW email', `${origin}/verify-email?token=${token}`);
    }
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to probe for accounts. */
  async requestPasswordReset(email: string, ip: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.audit.record({ userId: user?.id ?? null, action: 'auth.password.reset-requested', entityType: 'User', entityId: user?.id, ipAddress: ip });
    if (!user) return;
    await this.issueToken(user, 'PASSWORD_RESET');
  }

  private async consumeToken(token: string, type: AuthTokenType): Promise<string> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: this.sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw DomainError.badRequest('INVALID_TOKEN', 'This link is invalid or has expired. Please request a new one.');
    }
    // Single use, enforced atomically.
    const claimed = await this.prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) {
      throw DomainError.badRequest('INVALID_TOKEN', 'This link has already been used.');
    }
    return row.userId;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.consumeToken(token, 'PASSWORD_RESET');
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ userId, action: 'auth.password.reset', entityType: 'User', entityId: userId }, tx);
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeToken(token, 'EMAIL_VERIFICATION');
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({ userId, action: 'auth.email.verified', entityType: 'User', entityId: userId });
  }

  async resendVerification(user: AuthUser): Promise<void> {
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row || row.emailVerifiedAt) return;
    await this.issueToken(row, 'EMAIL_VERIFICATION');
  }
}
