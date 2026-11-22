import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildQuery, get, post, setCsrfToken, UNAUTHENTICATED_EVENT } from '@/lib/api/client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCsrfToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('buildQuery', () => {
  it('drops empty values and joins arrays', () => {
    expect(buildQuery({ q: 'a b', status: ['TODO', 'DONE'], empty: '', none: undefined, nil: null, n: 0, flag: false })).toBe('?q=a+b&status=TODO%2CDONE&n=0&flag=false');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('request building', () => {
  it('calls the same-origin /api proxy and always includes credentials', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await get('/tasks', { page: 2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tasks?page=2');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('GET');
  });

  it('sends the CSRF token on state-changing requests only', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, {}))); // a fresh Response per call
    setCsrfToken('tok-123');
    await get('/tasks');
    await post('/tasks', { title: 'x' });
    expect(fetchMock.mock.calls[0]![1].headers['X-CSRF-Token']).toBeUndefined();
    expect(fetchMock.mock.calls[1]![1].headers['X-CSRF-Token']).toBe('tok-123');
    expect(fetchMock.mock.calls[1]![1].headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined for empty responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('error handling', () => {
  it('turns the backend error envelope into an ApiError with a stable code', async () => {
    fetchMock.mockResolvedValue(json(409, { statusCode: 409, code: 'TIMER_STATE_CHANGED', message: 'Changed elsewhere.', requestId: 'req-1' }));
    const err = await get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'TIMER_STATE_CHANGED', message: 'Changed elsewhere.', requestId: 'req-1' });
  });

  it('includes field-level details in the friendly message', async () => {
    fetchMock.mockResolvedValue(json(400, { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: ['title must not be empty'] }));
    const err = (await get('/x').catch((e) => e)) as ApiError;
    expect(err.friendly).toBe('Some fields are invalid. title must not be empty');
  });

  it('survives a non-JSON error page from a proxy', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = (await get('/x').catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN' });
    expect(err.message).toMatch(/502/);
  });

  it('reports network failures as NETWORK_ERROR with a human message', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await get('/x').catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(err.message).toMatch(/Could not reach the server/);
  });

  it('announces an expired session so the app can send the user to sign-in', async () => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, heard);
    fetchMock.mockResolvedValue(json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Please sign in.' }));
    await get('/x').catch(() => undefined);
    window.removeEventListener(UNAUTHENTICATED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('does NOT treat bad credentials as an expired session', async () => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, heard);
    fetchMock.mockResolvedValue(json(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' }));
    await post('/auth/login', {}).catch(() => undefined);
    window.removeEventListener(UNAUTHENTICATED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('CSRF recovery', () => {
  it('refreshes the token once after a CSRF rejection and retries', async () => {
    fetchMock
      .mockResolvedValueOnce(json(403, { statusCode: 403, code: 'CSRF_TOKEN_INVALID', message: 'Could not verify.' }))
      .mockResolvedValueOnce(json(200, { csrfToken: 'fresh-token' })) // GET /auth/session
      .mockResolvedValueOnce(json(201, { id: 'new' })); // retried POST
    setCsrfToken('stale');
    await expect(post('/tasks', {})).resolves.toEqual({ id: 'new' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1].headers['X-CSRF-Token']).toBe('fresh-token');
  });

  it('gives up after one retry instead of looping', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('/auth/session') ? json(200, { csrfToken: 't' }) : json(403, { statusCode: 403, code: 'CSRF_TOKEN_INVALID', message: 'no' })));
    await expect(post('/tasks', {})).rejects.toMatchObject({ code: 'CSRF_TOKEN_INVALID' });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/tasks'))).toHaveLength(2);
  });
});
