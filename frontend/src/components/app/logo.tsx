import { cn } from '@/lib/utils';

/** TIMEFLOW mark: a time ring with a flowing arc. Original artwork; uses only brand tokens. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--surface-elevated)" strokeWidth="4" />
      <path d="M16 4a12 12 0 0 1 11.4 8.3" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
      <path d="M27.4 12.3A12 12 0 0 1 8.3 25" fill="none" stroke="var(--primary)" strokeOpacity=".45" strokeWidth="4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.2" fill="var(--primary)" />
    </svg>
  );
}

export function Logo({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!collapsed && <span className="text-[19px] font-semibold tracking-tight text-fg">TimeFlow</span>}
    </span>
  );
}
