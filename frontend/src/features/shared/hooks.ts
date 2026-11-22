'use client';

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { taskApi, userApi } from '@/services';

export function useCategories() {
  return useQuery({ queryKey: qk.categories, queryFn: userApi.categories, staleTime: 10 * 60_000 });
}

/** Open tasks, for dependency pickers. */
export function useOpenTasks(enabled = true) {
  return useQuery({
    queryKey: qk.tasks({ status: ['TODO', 'IN_PROGRESS', 'BACKLOG'], pageSize: 100, picker: true }),
    queryFn: () => taskApi.list({ status: ['TODO', 'IN_PROGRESS', 'BACKLOG'], pageSize: 100, sort: 'title' }),
    enabled,
  });
}

export const levelLabel = (l: string): string => ({ VERY_LOW: 'Very low', LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', VERY_HIGH: 'Very high' })[l] ?? l;
