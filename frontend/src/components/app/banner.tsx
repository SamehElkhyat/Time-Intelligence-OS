import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  info: 'border-info/25 bg-info-soft text-info',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  primary: 'border-primary/25 bg-primary-soft text-primary',
  danger: 'border-danger/25 bg-danger-soft text-danger',
};

export function Banner({ tone = 'info', children, href, linkLabel, className }: { tone?: keyof typeof TONES; children: ReactNode; href?: string; linkLabel?: string; className?: string }) {
  return (
    <div role="note" className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-[13px]', TONES[tone], className)}>
      <span>{children}</span>
      {href && (
        <Link href={href} className="font-semibold underline underline-offset-2">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}
