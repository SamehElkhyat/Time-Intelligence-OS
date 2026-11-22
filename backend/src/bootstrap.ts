import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { Env } from './config/env';

/** Shared by main.ts, the OpenAPI export script and the integration tests. */
export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());

  const origins = env.FRONTEND_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // unknown properties are stripped…
      forbidNonWhitelisted: true, // …and rejected, so typos never pass silently
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
}

export function buildSwaggerDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('TIMEFLOW API')
    .setDescription(
      'Time intelligence engine. Authentication uses an HttpOnly session cookie; state-changing requests must send the CSRF token returned by POST /auth/login, POST /auth/register or GET /auth/session in the X-CSRF-Token header.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('tf_session')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication, env: Env): void {
  if (env.NODE_ENV === 'production' && !env.SWAGGER_ENABLED) return;
  if (!env.SWAGGER_ENABLED) return;
  SwaggerModule.setup('api/docs', app, buildSwaggerDocument(app), { jsonDocumentUrl: 'api/openapi.json' });
}

export function useLogger(app: INestApplication): void {
  app.useLogger(app.get(Logger));
}
