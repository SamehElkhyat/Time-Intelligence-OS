import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/overlay';

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  return (
    <QueryClientProvider client={client ?? makeClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, opts: RenderOptions & { client?: QueryClient } = {}) {
  const { client, ...rest } = opts;
  return render(ui, { wrapper: ({ children }) => <Providers client={client}>{children}</Providers>, ...rest });
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Route-based fetch stub: pass `{ 'GET /tasks': () => body }`; unknown routes fail loudly. */
export function stubApi(routes: Record<string, (req: { url: string; body?: unknown }) => unknown | Response>) {
  const calls: { key: string; body?: unknown }[] = [];
  const fn = (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '').split('?')[0]!;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) return Promise.resolve(json(500, { statusCode: 500, code: 'TEST_UNROUTED', message: `No stub for ${key}` }));
    const out = handler({ url, body });
    return Promise.resolve(out instanceof Response ? out : json(200, out));
  };
  return { fn, calls };
}
