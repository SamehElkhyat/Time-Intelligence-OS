'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { eventStreamUrl } from '@/lib/api/client';
import { qk } from '@/lib/query-keys';
import { invalidateTimeData } from './use-mutation-toast';

/**
 * Keeps this tab in step with changes made elsewhere (another tab, another device, background jobs).
 * The stream carries no data — only "something changed" hints — so a missed message is harmless: every
 * query also refetches on focus and on its own interval. If the stream cannot be opened the app simply
 * works without it.
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let timeout: number | undefined;
    const source = new EventSource(eventStreamUrl(), { withCredentials: true });
    const onChange = (e: MessageEvent) => {
      let topic = '';
      try {
        topic = (JSON.parse(e.data) as { topic?: string }).topic ?? '';
      } catch {
        /* ignore malformed hint */
      }
      window.clearTimeout(timeout); // coalesce bursts of events into one refresh
      timeout = window.setTimeout(() => {
        void invalidateTimeData(qc);
        if (topic === 'notifications') {
          void qc.invalidateQueries({ queryKey: qk.unreadCount });
          void qc.invalidateQueries({ queryKey: ['notifications'] });
        }
      }, 250);
    };
    source.addEventListener('change', onChange);
    return () => {
      window.clearTimeout(timeout);
      source.removeEventListener('change', onChange);
      source.close();
    };
  }, [qc]);
}
