'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useRealtime } from '@/hooks/use-realtime';
import { useAuth } from '@/providers/auth-provider';
import { useUiStore } from '@/stores/ui-store';
import { Dialog, DialogContent, TooltipProvider } from '@/components/ui/overlay';
import { Banner } from './banner';
import { AppSidebar, MobileNav } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, preference } = useAuth();
  const pathname = usePathname();
  const hydrate = useUiStore((s) => s.hydrate);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobile = useUiStore((s) => s.setMobileNav);
  useRealtime();

  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    setMobile(false);
  }, [pathname, setMobile]);

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {user.isDemo && <Banner tone="info">You are viewing sample demo data. Changes you make here only affect the demo account.</Banner>}
          {!user.emailVerified && !user.isDemo && <Banner tone="warning">Your email address is not verified yet.</Banner>}
          {!preference.onboardingCompleted && !user.isDemo && pathname !== '/onboarding' && (
            <Banner tone="primary" href="/onboarding" linkLabel="Finish setup">
              Tell TimeFlow about your working hours so availability is accurate.
            </Banner>
          )}
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>
      <Dialog open={mobileOpen} onOpenChange={setMobile}>
        <DialogContent title="Navigation" side="right" className="max-w-xs p-0 [&>div:last-child]:p-0">
          <MobileNav onNavigate={() => setMobile(false)} />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
