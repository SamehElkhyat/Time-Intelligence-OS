import type { ReactNode } from 'react';
import { Logo } from '@/components/app/logo';
import { Clock, Sparkles, TrendingUp } from 'lucide-react';

const POINTS = [
  { icon: Clock, title: 'Real availability', text: 'Free time with an honest confidence level — missing data is never counted as free.' },
  { icon: Sparkles, title: 'Explained recommendations', text: 'See exactly why a task fits the time you have right now.' },
  { icon: TrendingUp, title: 'Measured, not guessed', text: 'Every number comes from your plans and tracked sessions.' },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-[420px] rounded-full bg-primary/10 blur-3xl" />
        <Logo />
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-fg">
            Know where your time goes.<br />
            <span className="text-primary">Decide what&apos;s next.</span>
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface text-primary">
                  <p.icon className="size-[18px]" aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-medium text-fg">{p.title}</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-fg-secondary">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-fg-muted">Time Intelligence OS</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
