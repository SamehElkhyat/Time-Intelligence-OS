/**
 * Writes the OpenAPI document to docs/openapi.json without a database or Redis.
 * The frontend generates its typed client from this file (see frontend `pnpm api:types`).
 */
process.env.TIMEFLOW_SKIP_DB_CONNECT = '1';
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
process.env.SESSION_SECRET ??= 'openapi-generation-only-secret-0000000000000000';
process.env.REDIS_URL = '';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument, configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app, loadEnv());
  const doc = buildSwaggerDocument(app);
  const out = resolve(process.cwd(), 'docs/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
  process.exit(0);
}

void main();
