import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, makeClient, Providers, stubApi } from './test-utils';

const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    user: { id: 'u', email: 'a@b.co', displayName: 'Ana Maria', emailVerified: true, isDemo: false, createdAt: '2026-01-01T00:00:00.000Z' },
    preference: {},
    tz: 'UTC',
    use24h: true,
    signOut: vi.fn(),
  }),
}));

import { DashboardView } from '@/features/dashboard/dashboard-view';
import LoginPage from '@/app/(auth)/login/page';

const noTimer = { session: null, serverTime: '2026-03-02T09:00:00.000Z', elapsedSec: 0, expectedTotalSec: null };
const metrics = (over: object = {}) => ({
  plannedSec: 7200, trackedSec: 3600, availableSec: 5400, highConfidenceAvailableSec: 3600, plannedActivities: 2, completedActivities: 1, pendingTasks: 4, overdueTasks: 1,
  completedTasksToday: 1, productivityScore: 72, scoreBreakdown: [{ key: 'focus', label: 'Focus goal', value: 0.5, weight: 1, explanation: 'x' }],
  productiveSec: 3000, focusSec: 1800, focusGoalSec: 14400, breakSec: 600, leakageSec: 300, unknownSec: 0, plannedUntrackedSec: 0, deepWorkSessions: 1, conflictCount: 0, ...over,
});
const dashboard = (over: object = {}, m: object = {}) => ({
  date: '2026-03-02', timezone: 'UTC', now: '2026-03-02T09:00:00.000Z', isToday: true, isEmptyAccount: false, metrics: metrics(m), timer: noTimer, upcoming: [], windows: [], categoryBreakdown: [], hourly: [], ...over,
});
const dayAvailability = {
  date: '2026-03-02', timezone: 'UTC', range: { start: '2026-03-02T00:00:00.000Z', end: '2026-03-03T00:00:00.000Z' }, now: '2026-03-02T09:00:00.000Z', isToday: true, activeHours: [], hasExplicitAvailability: true,
  windows: [], conflicts: [], strip: [], blocks: [], summary: {},
};

beforeEach(() => {
  replace.mockClear();
  vi.stubGlobal('EventSource', undefined);
});
afterEach(() => vi.unstubAllGlobals());

const mount = () => render(<Providers client={makeClient()}><DashboardView /></Providers>);
const baseRoutes = (dash: () => unknown | Response) => ({
  'GET /analytics/dashboard': dash,
  'GET /availability/day': () => dayAvailability,
  'GET /time-tracking/active': () => noTimer,
  'POST /recommendations/next': () => ({ recommendation: null, emptyReason: 'You have no open tasks. Add a task to get a recommendation.' }),
  'GET /notifications/unread-count': () => ({ count: 0 }),
});

describe('Dashboard states', () => {
  it('shows skeletons while loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
    mount();
    expect(screen.getAllByRole('status', { name: 'Loading' }).length).toBeGreaterThan(0);
  });

  it('shows an honest empty state for a brand-new account (no fake numbers)', async () => {
    const api = stubApi(baseRoutes(() => dashboard({ isEmptyAccount: true })));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount();
    expect(await screen.findByText(/Your day starts empty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plan an activity/ })).toBeInTheDocument();
    expect(screen.queryByText('Smart availability')).not.toBeInTheDocument();
  });

  it('shows an error with a retry that refetches', async () => {
    let fail = true;
    const api = stubApi(baseRoutes(() => (fail ? json(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Database unavailable.' }) : dashboard())));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Smart availability')).toBeInTheDocument();
  });

  it('renders measured metrics, with availability as the prominent figure', async () => {
    const api = stubApi(baseRoutes(() => dashboard()));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount();
    expect(await screen.findByText('1h 30m')).toBeInTheDocument(); // bookable today: 5400 s
    expect(screen.getByText('bookable today')).toBeInTheDocument();
    expect(screen.getByText('1h of it with high confidence')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument(); // productivity score
    expect(screen.getByText('Right now')).toBeInTheDocument();
  });

  it('says there is no score — rather than 0 — when nothing was tracked', async () => {
    const api = stubApi(baseRoutes(() => dashboard({}, { productivityScore: null, scoreBreakdown: [], trackedSec: 0 })));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount();
    expect(await screen.findByText(/No score yet/)).toBeInTheDocument();
  });

  it('explains unknown time instead of calling it free', async () => {
    const api = stubApi(baseRoutes(() => dashboard({}, { availableSec: 0, highConfidenceAvailableSec: 0, unknownSec: 7200 })));
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mount();
    expect(await screen.findByText(/treated as unknown, not free/)).toBeInTheDocument();
    expect(screen.getByText(/neither free nor wasted/)).toBeInTheDocument();
  });
});

describe('Login form', () => {
  it('validates before sending anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Providers><LoginPage /></Providers>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message on bad credentials and keeps the user on the form', async () => {
    const api = stubApi({ 'POST /auth/login': () => json(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const user = userEvent.setup();
    render(<Providers><LoginPage /></Providers>);
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]!.body).toEqual({ email: 'ana@example.com', password: 'wrong-password' });
  });

  const sessionPayload = {
    user: { id: 'u', email: 'ana@example.com', displayName: 'Ana', emailVerified: true, isDemo: false, createdAt: '2026-01-01T00:00:00.000Z' },
    preference: { timezone: 'UTC', use24HourClock: true },
    csrfToken: 'csrf',
  };
  const signIn = async () => {
    const user = userEvent.setup();
    render(<Providers><LoginPage /></Providers>);
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('goes to the dashboard once the session cookie is confirmed', async () => {
    const api = stubApi({ 'POST /auth/login': () => sessionPayload, 'GET /auth/session': () => sessionPayload });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await signIn();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('explains it instead of silently bouncing when the browser did not keep the session cookie', async () => {
    // Login succeeds, but the cookie was dropped (e.g. Secure cookie over plain http), so the next call is anonymous.
    const api = stubApi({
      'POST /auth/login': () => sessionPayload,
      'GET /auth/session': () => json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in to continue.' }),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await signIn();
    expect(await screen.findByText(/did not keep the session cookie/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('marks invalid fields for assistive technology', async () => {
    render(<Providers><LoginPage /></Providers>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Enter your email address');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email address');
  });
});
