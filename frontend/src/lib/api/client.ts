import type { ApiErrorBody } from '@/types';

/**
 * The single place that talks HTTP to the backend.
 *
 *  - Same-origin `/api` by default (proxied by Next), so the HttpOnly session cookie is first-party.
 *  - The CSRF token lives in memory only (never localStorage) and is attached to every
 *    state-changing request; it is re-read from GET /auth/session after a reload.
 *  - Every failure becomes an `ApiError` with the backend's stable `code`, so UI code branches on
 *    codes instead of message text.
 */
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '') || '/api';

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null): void => {
  csrfToken = token;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];
  readonly requestId?: string;

  constructor(status: number, body: Partial<ApiErrorBody> | null, fallback: string) {
    super(body?.message || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN');
    this.details = body?.details ?? [];
    this.requestId = body?.requestId;
  }

  /** A message suitable for showing to the user, including field-level details when present. */
  get friendly(): string {
    return this.details.length ? `${this.message} ${this.details.join(' ')}` : this.message;
  }
}

export const UNAUTHENTICATED_EVENT = 'tf:unauthenticated';

type QueryValue = string | number | boolean | string[] | null | undefined;
/** Any plain object of query values (interfaces included). */
type Query = object;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query) as [string, QueryValue][]) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function refreshCsrf(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/session`, { credentials: 'include' });
    if (!res.ok) return false;
    csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
    return true;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, null, 'Could not reach the server. Check your connection and try again.');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    /* non-JSON error page from a proxy */
  }

  // A reload (or another tab) may have rotated what we know: refresh the CSRF token once and retry.
  if (res.status === 403 && body?.code === 'CSRF_TOKEN_INVALID' && !retried && (await refreshCsrf())) {
    return api<T>(path, opts, true);
  }
  if (res.status === 401 && body?.code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
  }
  throw new ApiError(res.status, body, `Request failed (${res.status}).`);
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body ?? {} });

/** Server-Sent Events URL (EventSource cannot set headers; the cookie authenticates it). */
export const eventStreamUrl = (): string => `${BASE}/events/stream`;
