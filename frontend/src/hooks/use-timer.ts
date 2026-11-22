'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { qk } from '@/lib/query-keys';
import { timerApi } from '@/services';

/**
 * The active timer.
 *
 * Elapsed time is NOT counted by the browser. The server returns the elapsed seconds at the moment
 * it answered (computed from persisted timestamps); between responses the UI only adds the time that
 * passed on this device's monotonic clock since that answer arrived. A refresh, a closed tab or a
 * second device therefore always shows the correct figure: the next response replaces the estimate.
 */
export function useTimer() {
  const query = useQuery({
    queryKey: qk.timer,
    queryFn: timerApi.active,
    refetchInterval: 60_000, // re-anchor to the server once a minute
    refetchOnWindowFocus: 'always',
    staleTime: 0,
  });
  const data = query.data;
  const running = data?.session?.status === 'RUNNING';

  // A new server answer starts a new monotonic baseline.
  const baseline = useMemo(() => performance.now(), [query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedSec = data ? data.elapsedSec + (running ? Math.max(0, (performance.now() - baseline) / 1000) : 0) : 0;
  return { ...query, timer: data, session: data?.session ?? null, running, paused: data?.session?.status === 'PAUSED', elapsedSec };
}
