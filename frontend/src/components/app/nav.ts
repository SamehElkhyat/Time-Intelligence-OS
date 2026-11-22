import {
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  CalendarRange,
  CheckSquare,
  Clock,
  FileBarChart,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Lightbulb,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Timer,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'My Day', href: '/my-day', icon: Sun },
    ],
  },
  {
    label: 'Time management',
    items: [
      { label: 'Timeline', href: '/timeline', icon: GitBranch },
      { label: 'Activities', href: '/activities', icon: Activity },
      { label: 'Time Tracking', href: '/time-tracking', icon: Timer },
      { label: 'Availability', href: '/availability', icon: Clock },
    ],
  },
  {
    label: 'Task management',
    items: [
      { label: 'Tasks', href: '/tasks', icon: CheckSquare },
      { label: 'Smart Recommendations', href: '/recommendations', icon: Sparkles },
      { label: 'Schedule', href: '/schedule', icon: CalendarRange },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Productivity Analytics', href: '/analytics', icon: BarChart3 },
      { label: 'Insights', href: '/insights', icon: Lightbulb },
      { label: 'Energy', href: '/energy', icon: Zap },
      { label: 'AI Time Coach', href: '/ai-coach', icon: Bot },
    ],
  },
  {
    label: 'Personal',
    items: [
      { label: 'Reports', href: '/reports', icon: FileBarChart },
      { label: 'Preferences', href: '/preferences', icon: SlidersHorizontal },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

export const isActive = (pathname: string, href: string): boolean => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

export { CalendarClock, Gauge };
