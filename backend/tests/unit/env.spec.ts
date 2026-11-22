import { loadEnv, resetEnvCache } from '../../src/config/env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', SESSION_SECRET: 'x'.repeat(40) };
const load = (extra: Record<string, string> = {}) => {
  resetEnvCache();
  const saved = { ...process.env };
  for (const k of ['COOKIE_SECURE', 'COOKIE_SAMESITE', 'ALLOW_INSECURE_COOKIES']) delete process.env[k];
  process.env.NODE_ENV = 'test'; // never read the developer's .env file
  Object.assign(process.env, base, extra);
  try {
    return loadEnv();
  } finally {
    process.env = saved;
    resetEnvCache();
  }
};

describe('cookie configuration', () => {
  it('defaults to SameSite=lax', () => {
    expect(load().COOKIE_SAMESITE).toBe('lax');
  });
  it('allows SameSite=none together with Secure (cross-site deployments)', () => {
    expect(load({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }).COOKIE_SAMESITE).toBe('none');
  });
  it('refuses SameSite=none without Secure, which browsers would silently discard', () => {
    expect(() => load({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(/requires COOKIE_SECURE=true/);
  });
  it('refuses an unknown value', () => {
    expect(() => load({ COOKIE_SAMESITE: 'sometimes' })).toThrow(/COOKIE_SAMESITE/);
  });
});
