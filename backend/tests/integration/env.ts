// Runs before any module is imported in each integration test file.
// Integration tests never touch the development database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://timeflow:timeflow_dev_password@localhost:5433/timeflow_test?schema=public';
process.env.REDIS_URL = ''; // in-process queue and cache: deterministic and no external dependency
process.env.SESSION_SECRET = 'integration-test-secret-0123456789abcdef0123456789';
process.env.ANTHROPIC_API_KEY = ''; // the AI coach always runs in demo mode under test
process.env.COOKIE_SECURE = 'false';
process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
process.env.SWAGGER_ENABLED = 'false';
