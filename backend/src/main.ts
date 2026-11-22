import 'reflect-metadata';
import { startTelemetry } from './infrastructure/telemetry';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // Must run before the framework is imported so HTTP/Express/Nest are instrumented.
  await startTelemetry(env);

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { configureApp, setupSwagger, useLogger } = await import('./bootstrap');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  useLogger(app);
  // Behind a reverse proxy the client address comes from X-Forwarded-For.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  configureApp(app, env);
  setupSwagger(app, env);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
