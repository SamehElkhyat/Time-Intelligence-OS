'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ── Dialog ───────────────────────────────────────────────────────────────────
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side = 'center',
  ...props
}: Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & { title: string; description?: string; side?: 'center' | 'right' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex max-h-[90dvh] flex-col border border-border-strong bg-surface shadow-[var(--shadow-lg)] focus:outline-none',
          side === 'center'
            ? 'left-1/2 top-1/2 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl'
            : 'right-0 top-0 h-dvh max-h-none w-full max-w-md rounded-l-xl',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={cn('mt-0.5 text-[13px] text-fg-secondary', !description && 'sr-only')}>{description ?? title}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close aria-label="Close" className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ── Dropdown menu ────────────────────────────────────────────────────────────
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, align = 'end', ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn('z-50 min-w-48 overflow-hidden rounded-lg border border-border-strong bg-elevated p-1 shadow-[var(--shadow-lg)]', className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50', danger ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-fg', className)}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className }: { className?: string }) => <DropdownPrimitive.Separator className={cn('my-1 h-px bg-border', className)} />;

// ── Tooltip ──────────────────────────────────────────────────────────────────
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md border border-border-strong bg-elevated px-2.5 py-1.5 text-xs text-fg shadow-[var(--shadow-md)]">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
