'use client';

import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';

/** Query families that depend on the user's plan, tracked time or tasks. */
const TIME_DATA = [
  'dashboard', 'timer', 'sessions', 'activities', 'activity', 'availability-day', 'availability-range', 'conflicts', 'slots',
  'next-action', 'recommendations', 'plan', 'analytics-summary', 'weekly-report', 'monthly-report', 'leakage', 'patterns',
  'tasks', 'task', 'task-history', 'schedule-events', 'energy', 'energy-logs', 'conversation',
];

export function invalidateTimeData(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ predicate: (q) => TIME_DATA.includes(String(q.queryKey[0])) });
}

export const errorMessage = (e: unknown): string => (e instanceof ApiError ? e.friendly : e instanceof Error ? e.message : 'Something went wrong.');

/**
 * useMutation with consistent behaviour: failures always surface as a toast (with the server's
 * message), and time-dependent queries are refreshed after success unless disabled.
 */
export function useApiMutation<TData, TVars = void>(
  options: UseMutationOptions<TData, Error, TVars> & { successMessage?: string | ((d: TData) => string); invalidate?: boolean; silentError?: boolean },
) {
  const qc = useQueryClient();
  const { successMessage, invalidate = true, silentError, onSuccess, onError, ...rest } = options;
  return useMutation<TData, Error, TVars>({
    ...rest,
    onSuccess: async (data, vars, ctx, meta) => {
      if (invalidate) await invalidateTimeData(qc);
      if (successMessage) toast.success(typeof successMessage === 'function' ? successMessage(data) : successMessage);
      await onSuccess?.(data, vars, ctx, meta);
    },
    onError: (error, vars, ctx, meta) => {
      if (!silentError) toast.error(errorMessage(error));
      onError?.(error, vars, ctx, meta);
    },
  });
}
