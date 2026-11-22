import { create } from 'zustand';

/**
 * UI-only state (layout and view preferences). Server data lives in TanStack Query, never here.
 * Nothing sensitive is persisted: only harmless layout choices go to localStorage.
 */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  /** Timeline zoom in pixels per hour. */
  timelineScale: number;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setTimelineScale: (pxPerHour: number) => void;
  hydrate: () => void;
}

const KEY = 'tf:ui';

const read = (): Partial<Pick<UiState, 'sidebarCollapsed' | 'timelineScale'>> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiState>;
  } catch {
    return {};
  }
};
const write = (state: Pick<UiState, 'sidebarCollapsed' | 'timelineScale'>): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage can be blocked; the UI works without it */
  }
};

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  timelineScale: 72,
  toggleSidebar: () => {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
    write({ sidebarCollapsed: get().sidebarCollapsed, timelineScale: get().timelineScale });
  },
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setTimelineScale: (timelineScale) => {
    set({ timelineScale });
    write({ sidebarCollapsed: get().sidebarCollapsed, timelineScale });
  },
  hydrate: () => {
    const saved = read();
    set({ sidebarCollapsed: saved.sidebarCollapsed ?? false, timelineScale: saved.timelineScale ?? 72 });
  },
}));
