import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthUser, clientIp, CurrentUser, Public } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import { MS_PER_HOUR } from '@/common/time/time';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';
import {
  ChangePasswordDto,
  DeviceSessionDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  RevokedDto,
  SessionDto,
  VerifyEmailDto,
} from './auth.dto';
import { AuthService, SESSION_COOKIE } from './auth.service';

/** Tight limits on credential endpoints (per IP). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      domain: this.env.COOKIE_DOMAIN,
      maxAge: this.env.SESSION_TTL_DAYS * 24 * MS_PER_HOUR,
    };
  }

  private meta(req: Request) {
    return { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Create an account and start a session' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionDto> {
    const { token, body } = await this.auth.register(dto, this.meta(req));
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return body;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in. Sets the HttpOnly session cookie.' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionDto> {
    const { token, body } = await this.auth.login(dto.email, dto.password, this.meta(req));
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return body;
  }

  @ApiCookieAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<OkDto> {
    await this.auth.logout(user);
    const { maxAge: _maxAge, ...clear } = this.cookieOptions();
    res.clearCookie(SESSION_COOKIE, clear);
    return { ok: true };
  }

  @ApiCookieAuth()
  @Get('session')
  @ApiOperation({ summary: 'Current session: user, preferences and CSRF token' })
  session(@CurrentUser() user: AuthUser): Promise<SessionDto> {
    return this.auth.currentSession(user);
  }

  @ApiCookieAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'Devices currently signed in' })
  sessions(@CurrentUser() user: AuthUser): Promise<DeviceSessionDto[]> {
    return this.auth.listSessions(user);
  }

  @ApiCookieAuth()
  @Post('sessions/revoke-others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out every other device' })
  async revokeOthers(@CurrentUser() user: AuthUser): Promise<RevokedDto> {
    return { revoked: await this.auth.revokeOtherSessions(user) };
  }

  @ApiCookieAuth()
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Sign out one device' })
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<RevokedDto> {
    return { revoked: await this.auth.revokeSession(user, id) };
  }

  @ApiCookieAuth()
  @Throttle(AUTH_THROTTLE)
  @Post('password/change')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change password (signs out other devices)' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<OkDto> {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a password reset link. Always returns 202.' })
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request): Promise<OkDto> {
    await this.auth.requestPasswordReset(dto.email, clientIp(req));
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('password/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password using a reset token (signs out all devices)' })
  async reset(@Body() dto: ResetPasswordDto): Promise<OkDto> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('email/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an email address using a verification token' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<OkDto> {
    await this.auth.verifyEmail(dto.token);
    return { ok: true };
  }

  @ApiCookieAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('email/resend')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a new verification link' })
  async resend(@CurrentUser() user: AuthUser): Promise<OkDto> {
    await this.auth.resendVerification(user);
    return { ok: true };
  }
}
