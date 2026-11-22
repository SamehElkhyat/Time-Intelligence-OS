'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, UNAUTHENTICATED_EVENT } from '@/lib/api/client';
import { qk } from '@/lib/query-keys';
import { authApi } from '@/services';
import type { Preference, User } from '@/types';
import { ErrorState, LoadingState } from '@/components/app/states';

interface AuthValue {
  user: User;
  preference: Preference;
  /** The user's IANA timezone. Every date in the UI is interpreted in it. */
  tz: string;
  use24h: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthGate>');
  return v;
}

/**
 * Loads the session once and gates the authenticated app on it. The session response also carries
 * the CSRF token, which the API client keeps in memory.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: qk.session, queryFn: authApi.session, staleTime: 5 * 60_000, retry: false });

  const leave = useCallback(() => {
    qc.clear();
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [pathname, qc, router]);

  // Any 401 anywhere in the app (expired or revoked session) ends up here.
  useEffect(() => {
    window.addEventListener(UNAUTHENTICATED_EVENT, leave);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, leave);
  }, [leave]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      qc.clear();
      router.replace('/login');
    }
  }, [qc, router]);

  const data = session.data;
  const value = useMemo<AuthValue | null>(
    () => (data ? { user: data.user, preference: data.preference, tz: data.preference.timezone, use24h: data.preference.use24HourClock, signOut } : null),
    [data, signOut],
  );

  if (session.isError && session.error instanceof ApiError && session.error.status === 401) {
    // The unauthenticated event redirects; render nothing meanwhile.
    return null;
  }
  if (session.isError) return <ErrorState className="m-8" title="Could not load your account" error={session.error} onRetry={() => session.refetch()} />;
  if (!value) return <LoadingState fullScreen label="Loading your day…" />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
