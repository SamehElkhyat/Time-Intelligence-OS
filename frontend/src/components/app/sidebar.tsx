'use client';

import { ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, Sparkles, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { useUiStore } from '@/stores/ui-store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/overlay';
import { Logo } from './logo';
import { isActive, NAV } from './nav';

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
      {NAV.map((group) => (
        <div key={group.label}>
          {!collapsed && <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{group.label}</div>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                    collapsed && 'justify-center px-0',
                    active ? 'bg-primary-soft font-medium text-primary' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {active && !collapsed && <span aria-hidden className="absolute -left-3 h-5 w-[3px] rounded-r-full bg-primary" />}
                  <item.icon className="size-[18px] shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {collapsed && <span className="sr-only">{item.label}</span>}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip content={item.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ collapsed }: { collapsed?: boolean }) {
  const { user, signOut } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" className={cn('flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition-colors hover:border-border-strong', collapsed && 'justify-center p-2')}>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary">{initials(user.displayName)}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{user.displayName}</span>
                <span className="block truncate text-xs text-fg-muted">{user.isDemo ? 'Demo account' : user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon className="size-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onSelect={() => void signOut()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CoachCard() {
  const { user } = useAuth();
  return (
    <Link href="/ai-coach" className="block overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 transition-colors hover:border-primary/50">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Sparkles className="size-4" aria-hidden /> AI Time Coach
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">{user.isDemo ? 'You are exploring sample data. Ask what to do next.' : 'Ask what to do with your next free window.'}</p>
    </Link>
  );
}

/** Desktop sidebar (≥ lg). Collapsible to an icon rail; the choice is remembered. */
export function AppSidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <aside
      aria-label="Sidebar"
      style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex"
    >
      <div className={cn('flex h-16 items-center px-5', collapsed ? 'justify-center px-0' : 'justify-between')}>
        <Link href="/" aria-label="TimeFlow home">
          <Logo collapsed={collapsed} />
        </Link>
        {!collapsed && (
          <button type="button" onClick={toggle} aria-label="Collapse sidebar" className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
            <PanelLeftClose className="size-[18px]" />
          </button>
        )}
      </div>
      <div className="px-3 pb-4">
        <UserCard collapsed={collapsed} />
      </div>
      <NavLinks collapsed={collapsed} />
      <div className="space-y-3 p-3">
        {collapsed ? (
          <button type="button" onClick={toggle} aria-label="Expand sidebar" className="mx-auto grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
            <PanelLeftOpen className="size-[18px]" />
          </button>
        ) : (
          <CoachCard />
        )}
      </div>
    </aside>
  );
}

/** Navigation content reused inside the mobile drawer. */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-4">
        <UserCard />
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="p-3">
        <CoachCard />
      </div>
    </div>
  );
}
