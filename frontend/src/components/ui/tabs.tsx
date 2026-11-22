'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn('inline-flex h-8 items-center gap-2 rounded-md px-3.5 text-[13px] font-medium text-fg-secondary transition-colors hover:text-fg data-[state=active]:bg-elevated data-[state=active]:text-primary', className)}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

/** Compact single-choice control (period pickers, view toggles). Keyboard: arrow keys via radio semantics. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center rounded-lg border border-border bg-surface p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-md px-3 text-[13px] font-medium transition-colors', o.value === value ? 'bg-elevated text-primary' : 'text-fg-secondary hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn('relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-border-strong bg-surface-elevated transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50', className)} {...props}>
      <SwitchPrimitive.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-fg-secondary transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
