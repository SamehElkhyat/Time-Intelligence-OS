import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/app-shell';
import { AuthGate } from '@/providers/auth-provider';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
