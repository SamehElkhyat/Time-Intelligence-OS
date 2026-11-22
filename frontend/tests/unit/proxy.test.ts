import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadProxy(apiUrl: string | undefined) {
  vi.resetModules();
  if (apiUrl === undefined) vi.stubEnv('NEXT_PUBLIC_API_URL', '');
  else vi.stubEnv('NEXT_PUBLIC_API_URL', apiUrl);
  return (await import('@/proxy')).proxy;
}
const req = (path: string, cookie?: string) =>
  new NextRequest(`http://app.test${path}`, cookie ? { headers: { cookie } } : undefined);
const location = (res: Response) => res.headers.get('location');

afterEach(() => vi.unstubAllEnvs());

describe('route guard (same-origin API: the cookie is visible to this server)', () => {
  it('sends anonymous visitors to sign-in and remembers where they were going', async () => {
    const proxy = await loadProxy(undefined);
    expect(location(proxy(req('/tasks?x=1')))).toBe('http://app.test/login?next=%2Ftasks%3Fx%3D1');
  });
  it('lets public pages through when anonymous', async () => {
    const proxy = await loadProxy(undefined);
    expect(location(proxy(req('/login')))).toBeNull();
  });
  it('lets signed-in users through and keeps them off the login page', async () => {
    const proxy = await loadProxy(undefined);
    expect(location(proxy(req('/tasks', 'tf_session=abc')))).toBeNull();
    expect(location(proxy(req('/login', 'tf_session=abc')))).toBe('http://app.test/');
  });
});

describe('route guard (cross-origin API: the cookie belongs to the API host)', () => {
  it('never redirects on a cookie it cannot see; the app shell validates the session instead', async () => {
    const proxy = await loadProxy('https://api.example.com/api');
    expect(location(proxy(req('/tasks')))).toBeNull();
    expect(location(proxy(req('/login')))).toBeNull();
  });
});
