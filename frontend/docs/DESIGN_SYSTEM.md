# TIMEFLOW — Design System

Tokens live in `src/styles/design-tokens.css` (the single source of truth) and are mapped to Tailwind utilities in `src/app/globals.css` (`@theme inline`). No component hard-codes a colour, radius or shadow.

## 1. Direction

A premium enterprise-SaaS feel in the spirit of the reference (a dark analytics workspace with a neon-lime accent): near-black, slightly green-tinted surfaces separated by low-contrast hairlines; one energetic lime accent used **strategically** — the primary action, the active navigation item, progress, and the single most important figure on a screen; orange and violet only as secondary data series. Dark only (`color-scheme: dark`).

The reference was used for atmosphere, density and hierarchy only. The logo mark, layouts, copy and components are original; nothing is copied from it or from the Spacefill site named in the brief.

What was deliberately **not** done: gradient-heavy cards, oversized cards, decorative animation, every component green. The only gradient is the sidebar's coach card; lime fills are limited to primary buttons and key numbers.

## 2. Colour

| Token | Value | Use |
|---|---|---|
| `--background` | `#090c09` | Page |
| `--sidebar` | `#0b100b` | Sidebar, auth side panel |
| `--surface` / `--surface-2` / `--surface-elevated` | `#0f140f` / `#141b14` / `#1a231a` | Cards / inputs & hovers / menus, tooltips, selected tabs |
| `--border` / `--border-strong` | `#212b21` / `#2e3b2e` | Hairlines / controls |
| `--primary` | `#b5f34d` | Primary action, active state, key metric, progress |
| `--primary-hover` / `-pressed` / `-soft` / `-ring` | `#a2df3f` / `#8fc834` / 10 % / 45 % | States, tinted fills, focus ring |
| `--primary-foreground` | `#13200a` | Text on lime (contrast ≥ 12:1) |
| `--text-primary` / `-secondary` / `-muted` | `#f1f6ee` / `#a3b09f` / `#6f7d6c` | Text hierarchy |
| `--success` / `--warning` / `--danger` / `--info` | `#54d68b` / `#f2bd55` / `#f16d70` / `#4cc9f0` | Semantic (each with a 12 % `-soft` tint) |
| `--series-1…6` | lime, `#ff6a2b`, `#7c5cff`, `#4cc9f0`, `#f2bd55`, `#f472b6` | Charts and category chips |
| `--state-*` | tracked / planned / free / buffer / unknown / conflict | Availability strip and timeline |

Tokens refined from the brief's starting palette: surfaces are darker and less olive to match the reference's near-black canvas; the lime is unchanged; secondary series (orange, violet) were added because a single hue cannot carry multi-series charts.

**Colour is never the only signal.** Overdue = icon + word "Overdue"; blocked = icon + "Blocked"; conflicts = icon + text; confidence = a label ("High confidence"), not just a colour; chart series have text alternatives and legends.

## 3. Typography

Inter Variable (self-hosted via `@fontsource-variable/inter`, so no network font request). Scale: 12 / 13 / 15 (body) / 17 / 20 / 26 / 34 px. Page titles 26 px / 600 with tight tracking. Numbers use `tabular-nums` (`.tabular`) so columns and live counters never jitter. Uppercase micro-labels (11 px, 0.08 em) only for navigation groups.

## 4. Shape, spacing, elevation, motion

* Radii: 8 (controls) / 12 / 16 / 20 (cards). Spacing: a 4 px scale.
* Elevation is hairlines first (`border`), shadow only for overlays (`--shadow-lg`). Primary buttons get a faint lime glow (`--glow-primary`).
* Motion: 120–280 ms, `cubic-bezier(.22,1,.36,1)`, used for state change only (hover, progress width, sidebar collapse). Charts do not animate. `prefers-reduced-motion` disables all animation globally.

## 5. Components

`src/components/ui` — primitives (shadcn-style, built on Radix where accessibility is hard):
`Button` (primary / secondary / outline / ghost / danger / link; sm–lg, icon; `loading`), `Input`, `Textarea`, `Select` (native, for best keyboard/screen-reader behaviour), `Field` (label + control + hint/error wired by id, errors announced), `Checkbox`, `Switch`, `Card`, `Badge`, `Progress`, `Skeleton`, `Tabs`, `Segmented` (radiogroup), `Dialog` (modal and right drawer), `DropdownMenu`, `Tooltip`.

`src/components/app` — product components:

| Component | Purpose |
|---|---|
| `AppSidebar` / `MobileNav` / `Topbar` | Collapsible navigation (state remembered), mobile drawer, always-visible *current activity* pill with elapsed clock and controls |
| `PageHeader`, `MetricCard`, `DateNavigator`, `SearchInput`, `FilterChips`, `DataTable`, `Pagination` | Screen scaffolding; `MetricCard` shows a delta only when a real previous value exists |
| `EmptyState`, `LoadingState`, `SkeletonCard`, `ErrorState`, `QueryBoundary` | The loading → error → empty → content lifecycle; `ErrorState` shows the server message, field details and a reference id |
| `ConfirmationDialog` | Every destructive or hard-to-reverse action |
| `ActivityCard`, `TaskCard`, `RecommendationCard`, `AvailabilityWindowCard`, `ConfidenceBadge` | Domain cards; confidence reasons one hover/focus away; recommendation score breakdown expandable |
| `DayStrip` + `StripLegend` | The whole local day classified (tracked / planned-not-tracked / unknown / committed / buffer / blocked / available); drawn by real elapsed time so a 23/25-hour DST day is truthful |
| `Timeline` | Time-positioned blocks, lane layout for overlaps, conflict markers, free windows, plan-vs-actual gutter, current-time line; drag to move, drag the bottom edge to resize (5-minute snap), click empty time to create; keyboard alternative |
| `TimerControls`, `ElapsedClock` | Pause / resume / stop (stop-and-complete); server-anchored clock |
| Charts (`TrendChart`, `PlannedActualChart`, `CategoryDonut`, `FocusChart`, `HourlyBars`, `UtilisationHeatmap`, `EnergyChart`) | Recharts, code-split with `next/dynamic`, tokens only, each wrapped in a `<figure>` with a text summary |

## 6. Accessibility

* **Keyboard:** everything is reachable and operable; one consistent `:focus-visible` ring (2 px lime, offset 2 px); skip-to-content link; Radix handles focus trapping and `Esc` in dialogs and menus.
* **Timeline without a mouse:** focus a block, `Alt+↑/↓` moves it 15 minutes (`Shift` = 5), adding `Ctrl` resizes; `Enter` opens it. Locked blocks (fixed, completed, recurring) refuse movement.
* **Semantics:** landmarks (`main`, `nav` with labels, `aside`), real `button`/`table`/`checkbox`/`radiogroup` roles, `aria-current` on navigation and steps, `aria-pressed` on toggles, `aria-invalid` + `aria-describedby` on invalid fields, `role="alert"` for errors, `role="status"` for loading and the timer.
* **Contrast:** primary text on surfaces ≥ 15:1; secondary ≥ 7:1; muted text (used for non-essential hints) ≥ 4.5:1; text on lime ≥ 12:1.
* **Motion:** respects `prefers-reduced-motion`.
* **Touch:** controls ≥ 32 px (primary actions 40 px); the timeline block and handles have large hit areas and `touch-action: none` only on movable blocks.

## 7. Responsive behaviour

Desktop is the primary target (sidebar + 1400 px content). Below `lg` (1024 px) the sidebar becomes a drawer opened from the topbar; grids collapse to one column; tables scroll horizontally inside their own container; the timeline scrolls inside its container (the grid item uses `min-w-0` so it never widens the page). An automated mobile run asserts no horizontal page overflow on six screens.

## 8. Adding or changing a token

Edit `design-tokens.css`; if a new utility is needed, map it in the `@theme inline` block of `globals.css`. Do not add one-off hex values in components.
