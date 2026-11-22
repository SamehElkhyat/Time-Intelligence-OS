'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { qk } from '@/lib/query-keys';
import { timerApi } from '@/services';
import { useApiMutation } from './use-mutation-toast';

/**
 * Timer commands shared by the topbar, dashboard and time-tracking screen. Every command sends the
 * session version it was issued against, so a stale tab gets a clear "changed elsewhere" message
 * and refreshes instead of acting on outdated state.
 */
export function useTimerActions(version?: number) {
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: qk.timer }), [qc]);
  const onError = () => void refresh();

  const start = useApiMutation({
    mutationFn: (body: { activityId?: string; title?: string; categoryId?: string }) => timerApi.start(body),
    onError,
    successMessage: (r) => (r.switchedFromSessionId ? 'Switched activity — the previous timer was stopped.' : 'Timer started'),
  });
  const pause = useApiMutation({ mutationFn: () => timerApi.pause(version), onError, successMessage: 'Timer paused' });
  const resume = useApiMutation({ mutationFn: () => timerApi.resume(version), onError, successMessage: 'Timer resumed' });
  const stop = useApiMutation({
    mutationFn: (opts: { complete?: boolean } = {}) => timerApi.stop({ complete: opts.complete, expectedVersion: version }),
    onError,
    successMessage: (r) => (r.session ? 'Timer stopped' : 'Timer stopped'),
  });
  return { start, pause, resume, stop };
}
