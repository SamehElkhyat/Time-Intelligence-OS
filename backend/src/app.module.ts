import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AllExceptionsFilter } from './common/http/errors';
import { ConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AiCoachModule } from './modules/ai-coach/ai-coach.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProductivityModule } from './modules/productivity/productivity.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { UsersModule } from './modules/users/users.module';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      // Express 5 route syntax (a bare '*' is deprecated and logs a warning at startup).
      forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Never log credentials or session material.
        redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        customProps: (req) => ({ requestId: req.id }),
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health') },
        transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } } : undefined,
      },
    }),
    // Default: RATE_LIMIT_PER_MINUTE (600) per address. Credential and AI endpoints set tighter limits.
    // Keyed by address, never by cookie: a client-chosen key would let an attacker mint fresh buckets.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
      // Test runs register many accounts from one address; they bypass the limiter unless a test
      // opts in with X-Test-Throttle (the header is ignored outside NODE_ENV=test).
      skipIf: (ctx) => env.NODE_ENV === 'test' && !ctx.switchToHttp().getRequest().headers['x-test-throttle'],
    }),
    InfrastructureModule,
    UsersModule,
    NotificationsModule,
    AuthModule,
    TimeTrackingModule,
    ActivitiesModule,
    AvailabilityModule,
    TasksModule,
    SchedulingModule,
    RecommendationsModule,
    AnalyticsModule,
    ProductivityModule,
    AiCoachModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
