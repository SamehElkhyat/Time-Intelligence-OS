# TIMEFLOW — Frontend Architecture

Next.js 16 (App Router, Turbopack), React 19, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind CSS 4, Radix UI, TanStack Query, Zustand, React Hook Form + Zod, Recharts, Luxon, Framer Motion available (not needed — motion is minimal).

## 1. Structure

```
src/
├── app/                     routes (App Router)
│   ├── (auth)/              login, register, forgot/reset password, verify email   — unauthenticated layout
│   └── (app)/               every signed-in screen                                   — AuthGate + AppShell
├── components/
│   ├── ui/                  primitives (button, form, card, overlay, tabs)
│   └── app/                 product components (sidebar, timeline, cards, charts, states…)
├── features/                one folder per screen: view + forms + feature-specific logic
├── hooks/                   use-timer, use-realtime, use-mutation-toast, use-now …
├── lib/                     api client, time helpers, query keys, utils
├── providers/               AppProviders (Query + Toaster), AuthGate
├── services/                one typed function per endpoint, grouped by domain
├── stores/                  Zustand (layout preferences only)
├── styles/                  design-tokens.css
├── types/                   api.gen.ts (generated) + index.ts (named aliases)
└── proxy.ts                 route protection (Next 16 "proxy", formerly middleware)
```

## 2. Server vs. client components

`page.tsx` files are **server components** (static shell, `metadata`, async `params`) that render a client "view". Interactive screens need browser state (queries, forms, timers, drag), so each view is a client component; nothing is fetched on the server, because every request needs the session cookie and the data is per-user and live. Charts are `next/dynamic` with `ssr: false` and a skeleton fallback, so Recharts stays out of the initial bundle of every other route.

## 3. State

| Kind | Tool | Notes |
|---|---|---|
| Server state | TanStack Query | Central key factory (`lib/query-keys.ts`); 15 s stale time; 4xx are not retried; `refetchOnWindowFocus`; selective polling (dashboard, availability, timer) |
| UI state | Zustand | Sidebar collapsed, timeline zoom — persisted to `localStorage` (harmless layout only, wrapped in try/catch) |
| Forms | React Hook Form + Zod | Client validation mirrors the API's rules; the server stays the authority and its field errors are shown |
| Auth | `AuthGate` context | Loads `/auth/session` once (also yields the CSRF token), exposes `user`, `preference`, `tz`, `use24h` |

No fake or computed business numbers exist on the client: every metric shown is returned by the backend. The client only formats (durations, local times in the *user's* timezone — never the browser's).

## 4. The API layer

`lib/api/client.ts` is the only place that calls `fetch`.

* Same-origin `/api` (proxied by Next), `credentials: 'include'`.
* CSRF token held **in memory**, attached to every non-`GET`; on `403 CSRF_TOKEN_INVALID` it refreshes the token from `/auth/session` once and retries.
* Every failure becomes `ApiError { status, code, message, details, requestId }`; `friendly` composes the message with field details. UI code branches on `code`.
* A `401 UNAUTHENTICATED` raises a window event that `AuthGate` turns into "clear caches, go to sign-in" — expiry or revocation anywhere is handled in one place. (Failed *login* is a different code and does not trigger this.)
* Types come from the OpenAPI document; there is no hand-written duplicate of any DTO.

Mutations go through `useApiMutation`: server errors always surface as a toast with the server's own message; on success every time-dependent query family is invalidated (`invalidateTimeData`), so the dashboard, timeline, availability, analytics and recommendations never disagree after a change.

## 5. The timer

`useTimer` never counts ticks. The server returns `elapsedSec` (computed from stored timestamps) with each answer; between answers the hook adds `performance.now()` elapsed since that answer arrived, repainted once a second while running. A new answer (refetch every minute, on focus, after any mutation, or when the realtime stream signals a change from another tab/device) replaces the estimate. A refresh, a closed tab or a second device therefore shows the right value immediately — verified by a component test and an E2E test that reloads the page mid-timer.

Timer commands send the session `version`; a stale tab gets a clear "changed elsewhere" message and refreshes instead of acting on old state.

## 6. Real-time

`useRealtime` opens one `EventSource('/api/events/stream')` for the app shell. It receives small "something changed" hints and, after a 250 ms coalescing delay, invalidates the time-dependent queries. If the stream cannot be opened the app works exactly the same (focus refetch and polling cover it).

## 7. The timeline

* Positions come from **elapsed time since the day's start instant**, not from clock arithmetic, so a 23- or 25-hour DST day is drawn correctly (hour labels are produced from real instants in the user's zone).
* `layoutLanes` puts overlapping blocks side by side (interval colouring per cluster).
* Pointer drag/resize with pointer capture, 5-minute snap, clamped to the day; optimistic update with rollback and the server's reason shown on refusal (e.g. it would overlap a fixed commitment).
* The right edge shows what really happened (tracked vs. planned-untracked); green dashed areas are bookable free windows with their confidence.
* Keyboard alternative and locked-block rules are described in `DESIGN_SYSTEM.md`.

## 8. Routing and protection

`proxy.ts` redirects requests without a `tf_session` cookie to `/login?next=…` and signed-in visitors away from `/login` and `/register`. This is a convenience only: it cannot tell whether the session is still valid. The backend authorises every call, and `AuthGate` re-validates the session when the app loads. `next` targets are restricted to same-site relative paths.

## 9. Performance

* Per-route code splitting by the App Router; charts (and Recharts) load only on the screens that show them.
* Debounced search (300 ms), server-side pagination (≤ 25 per page), `placeholderData` so filters do not flash empty.
* Skeletons shaped like the content they replace to avoid layout shift.
* Chart animations disabled; the clock repaints at 1 Hz only while a timer runs.
* The production build prerenders 26 routes (static shells); there is no client-side data waterfall beyond the necessary parallel queries per screen.

Long lists are paginated rather than virtualised: no screen renders more than a page (≤ 25 rows, or ~100 options in a picker) at once.

## 10. Testing

Vitest + Testing Library (106 tests): time helpers incl. DST, API client (envelope, CSRF recovery, session expiry), every Zod schema, timeline lane/drag maths, timer hook recovery and controls, timeline rendering and keyboard rescheduling, task/state/error components, dashboard loading/empty/error/data states, login form validation. Playwright (7 tests) covers the full user journey, auth/security behaviour and a mobile run against the real backend. See `backend/docs/TESTING.md`.

## 11. Commands

```bash
pnpm dev          # http://localhost:3000   (backend must be reachable at API_INTERNAL_URL)
pnpm build && pnpm start
pnpm typecheck
pnpm test         # unit + component
pnpm test:e2e     # needs the backend running
pnpm api:types    # regenerate src/types/api.gen.ts from ../backend/docs/openapi.json
```
