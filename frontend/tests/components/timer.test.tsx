import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerControls } from '@/components/app/timer-controls';
import { useTimer } from '@/hooks/use-timer';
import { makeClient, Providers, renderWithProviders, stubApi } from './test-utils';

const session = (over: object = {}) => ({
  id: 's1',
  activityId: 'a1',
  activityTitle: 'Write report',
  category: { id: 'c', key: 'work', name: 'Work', color: '#b5f34d', timeClass: 'PRODUCTIVE' },
  status: 'RUNNING',
  source: 'TIMER',
  startedAt: '2026-03-02T09:00:00.000Z',
  endedAt: null,
  durationSec: 0,
  pauseCount: 0,
  note: null,
  autoStopped: false,
  version: 3,
  segments: [],
  ...over,
});
const active = (elapsedSec: number, over: object = {}) => ({ session: session(over), serverTime: '2026-03-02T09:10:00.000Z', elapsedSec, expectedTotalSec: null });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTimer — elapsed time comes from the server, not from counting ticks', () => {
  it('shows the server value immediately after a refresh and then advances with the local clock', async () => {
    const api = stubApi({ 'GET /time-tracking/active': () => active(600) }); // 10 minutes already tracked
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { result } = renderHook(() => useTimer(), { wrapper: ({ children }) => <Providers client={makeClient()}>{children}</Providers> });

    await waitFor(() => expect(result.current.session).not.toBeNull());
    expect(result.current.running).toBe(true);
    expect(Math.floor(result.current.elapsedSec)).toBe(600); // recovered, not restarted from 0

    // the display then advances with the device's own clock, one repaint per second
    await waitFor(() => expect(result.current.elapsedSec).toBeGreaterThanOrEqual(601), { timeout: 3000 });
    expect(result.current.elapsedSec).toBeLessThan(603);
  });

  it('does not advance while paused', async () => {
    const api = stubApi({ 'GET /time-tracking/active': () => active(120, { status: 'PAUSED' }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { result } = renderHook(() => useTimer(), { wrapper: ({ children }) => <Providers client={makeClient()}>{children}</Providers> });
    await waitFor(() => expect(result.current.paused).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    expect(result.current.elapsedSec).toBe(120); // a paused timer never accrues time
  });

  it('reports no timer when nothing is active', async () => {
    const api = stubApi({ 'GET /time-tracking/active': () => ({ session: null, serverTime: '2026-03-02T09:10:00.000Z', elapsedSec: 0, expectedTotalSec: null }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { result } = renderHook(() => useTimer(), { wrapper: ({ children }) => <Providers client={makeClient()}>{children}</Providers> });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.session).toBeNull();
    expect(result.current.elapsedSec).toBe(0);
  });
});

describe('TimerControls', () => {
  it('renders nothing without an active timer', async () => {
    const api = stubApi({ 'GET /time-tracking/active': () => ({ session: null, serverTime: '2026-03-02T09:10:00.000Z', elapsedSec: 0, expectedTotalSec: null }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = renderWithProviders(<TimerControls />);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it('pauses with the session version so a stale tab is detected, then resumes', async () => {
    let status = 'RUNNING';
    const api = stubApi({
      'GET /time-tracking/active': () => active(30, { status }),
      'POST /time-tracking/pause': () => ((status = 'PAUSED'), active(30, { status })),
      'POST /time-tracking/resume': () => ((status = 'RUNNING'), active(31, { status })),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const user = userEvent.setup();
    renderWithProviders(<TimerControls />);

    await user.click(await screen.findByRole('button', { name: 'Pause timer' }));
    expect(api.calls.find((c) => c.key === 'POST /time-tracking/pause')?.body).toEqual({ expectedVersion: 3 });
    await user.click(await screen.findByRole('button', { name: 'Resume timer' }));
    expect(api.calls.some((c) => c.key === 'POST /time-tracking/resume')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
  });

  it('offers to stop and to stop-and-complete', async () => {
    const api = stubApi({
      'GET /time-tracking/active': () => active(30),
      'POST /time-tracking/stop': () => ({ session: session({ status: 'STOPPED' }), serverTime: '2026-03-02T09:10:00.000Z', elapsedSec: 30, expectedTotalSec: null }),
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const user = userEvent.setup();
    renderWithProviders(<TimerControls />);
    await user.click(await screen.findByRole('button', { name: 'Stop timer options' }));
    await user.click(await screen.findByRole('menuitem', { name: /Stop and mark completed/ }));
    await waitFor(() => expect(api.calls.find((c) => c.key === 'POST /time-tracking/stop')?.body).toMatchObject({ complete: true, expectedVersion: 3 }));
  });
});
