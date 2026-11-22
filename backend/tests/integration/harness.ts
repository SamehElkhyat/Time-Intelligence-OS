import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { loadEnv } from '../../src/config/env';
import { OutboxService } from '../../src/infrastructure/events/outbox.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { MailerService } from '../../src/modules/auth/mailer.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  outbox: OutboxService;
  mailer: MailerService;
  userIds: string[];
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  const prisma = app.get(PrismaService);
  const userIds: string[] = [];
  return {
    app,
    prisma,
    outbox: app.get(OutboxService),
    mailer: app.get(MailerService),
    userIds,
    async close() {
      // Cascades remove every row owned by the test users; outbox rows have no FK, so remove them explicitly.
      await prisma.outboxEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.auditLog.deleteMany({ where: { userId: null } });
      await app.close();
    },
  };
}

/** One signed-in browser: keeps the session cookie and echoes the CSRF token like the real frontend. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  csrf = '';
  userId = '';
  email: string;
  password = 'correct horse battery staple';
  categories: Record<string, string> = {};

  constructor(private readonly t: TestApp, label = 'user') {
    this.agent = request.agent(t.app.getHttpServer());
    this.email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
  }

  static async register(t: TestApp, opts: { label?: string; timezone?: string } = {}): Promise<Client> {
    const c = new Client(t, opts.label);
    const res = await c.agent.post('/api/auth/register').send({ email: c.email, password: c.password, displayName: 'Test User', timezone: opts.timezone ?? 'UTC' });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    c.csrf = res.body.csrfToken;
    c.userId = res.body.user.id;
    t.userIds.push(c.userId);
    const cats = await c.get('/api/categories');
    c.categories = Object.fromEntries((cats.body as { key: string; id: string }[]).map((x) => [x.key, x.id]));
    return c;
  }

  get = (path: string) => this.agent.get(path);
  post = (path: string, body: object = {}) => this.agent.post(path).set('X-CSRF-Token', this.csrf).send(body);
  patch = (path: string, body: object = {}) => this.agent.patch(path).set('X-CSRF-Token', this.csrf).send(body);
  put = (path: string, body: object = {}) => this.agent.put(path).set('X-CSRF-Token', this.csrf).send(body);
  del = (path: string, body: object = {}) => this.agent.delete(path).set('X-CSRF-Token', this.csrf).send(body);

  async drain(): Promise<void> {
    await this.t.outbox.drain();
  }
}

export const iso = (ms: number): string => new Date(ms).toISOString();
export const MIN = 60_000;
export const HOUR = 3_600_000;

/** A local date far enough ahead that "now" can never interfere, on a given ISO weekday (1 = Monday). */
export function futureDate(weekday = 1, weeksAhead = 3): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (((d.getUTCDay() + 6) % 7) + 1 !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
