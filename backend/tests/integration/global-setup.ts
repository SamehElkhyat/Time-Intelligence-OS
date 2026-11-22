import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

/**
 * Ensures the disposable test database exists and is migrated.
 * Refuses to run against anything that is not clearly a test database.
 */
export default async function globalSetup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://timeflow:timeflow_dev_password@localhost:5433/timeflow_test?schema=public';
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against "${dbName}": the database name must contain "test".`);
  }

  // Create the database through the server's maintenance database if it does not exist yet.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = '${dbName.replace(/'/g, "''")}') AS exists`);
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
