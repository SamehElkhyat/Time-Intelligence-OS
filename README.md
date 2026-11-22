# TIMEFLOW — Time Intelligence OS

TIMEFLOW understands how you spend your time, finds when you are **genuinely** available, and recommends what to do next — with every number measured and every recommendation explained.

It is not a to-do list, a calendar or a stopwatch. It combines time tracking, scheduling, availability detection, energy-aware planning, productivity analytics, an explainable recommendation engine and an AI time coach.

> **Honest by design.** Time with no plan and no tracking is shown as *unknown* — never as free and never as wasted. Rest and leisure are never labelled waste. Predictions state their sample size and confidence. Metrics that cannot be measured are `—`, not `0`.

## Repository layout

Two independent applications that talk only through a documented REST API.

```
timeflow/
├── backend/            NestJS + Prisma + PostgreSQL + Redis/BullMQ   (own package.json, tsconfig, tests)
├── frontend/           Next.js (App Router) + Tailwind + TanStack Query (own package.json, tsconfig, tests)
├── infrastructure/     Dockerfiles, Postgres init
├── docs/               Architecture, API contract, status, decision records
├── docker-compose.yml  Postgres + Redis (default); `--profile apps` also runs both apps
└── .github/workflows/  CI
```

The frontend never imports backend code and never touches the database. Its API types are **generated** from the backend's OpenAPI document (`backend/docs/openapi.json` → `frontend/src/types/api.gen.ts`).

## Quick start

Prerequisites: Node ≥ 20.9, pnpm, Docker.

```bash
# 1. Infrastructure (Postgres on :5433, Redis on :6380 — offset so they never clash with local installs)
docker compose up -d postgres redis

# 2. Backend  → http://localhost:4000  (Swagger UI at /api/docs)
cd backend
cp .env.example .env            # then set SESSION_SECRET (see the file for a one-liner)
pnpm install
pnpm prisma:deploy              # apply migrations
pnpm db:seed                    # optional: demo data (see below)
pnpm start:dev

# 3. Frontend → http://localhost:3000   (in a second terminal)
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

The two apps run, build and test independently:

| | Backend | Frontend |
|---|---|---|
| Dev | `pnpm start:dev` | `pnpm dev` |
| Build | `pnpm build` | `pnpm build` |
| Type-check | `pnpm typecheck` | `pnpm typecheck` |
| Unit tests | `pnpm test:unit` | `pnpm test` |
| Integration / E2E | `pnpm test:integration` | `pnpm test:e2e` |

### Demo data

`pnpm db:seed` (in `backend/`) creates one clearly marked demo account — six weeks of tracked history with realistic imperfections, tasks with dependencies and a recurring task, recurring commitments, and energy check-ins.

- Email `demo@timeflow.app` · Password `demo-timeflow-2026`
- Flagged `isDemo` in the database and labelled in the UI. It is never mixed with real accounts: `pnpm db:seed:reset` deletes and rebuilds **only** that account and refuses to touch any other.

### Everything in containers

```bash
docker compose --profile apps up --build     # Postgres, Redis, backend, frontend
```

This runs the production builds over plain `http://localhost`, using `ALLOW_INSECURE_COOKIES=true` (see `docs/ARCHITECTURE.md`). Behind HTTPS, set `COOKIE_SECURE=true` and a real `SESSION_SECRET`.

### Deployment checklist: "I sign in but stay on the login page"

The session lives in an HttpOnly cookie, so login only works if the browser keeps it:

* **Serve the site over HTTPS** and set `COOKIE_SECURE=true`. A `Secure` cookie sent over plain `http://` (any host except `localhost`) is silently discarded by the browser. For a plain-http demo set `COOKIE_SECURE=false` and `ALLOW_INSECURE_COOKIES=true` instead.
* **Keep the API same-origin.** Leave `NEXT_PUBLIC_API_URL` empty so the browser calls `/api/*` on the frontend's own domain, and set `API_INTERNAL_URL` to the backend's internal address **at frontend build time** (Next bakes the rewrite target into the build). Pointing the browser straight at a different domain makes the cookie third-party, and `SameSite=Lax` blocks it.
* Set `FRONTEND_ORIGIN` on the backend to the public site URL.
* **Only if the browser must call the API on a different site** (for example two separate `onrender.com` services with `NEXT_PUBLIC_API_URL` set): set `COOKIE_SAMESITE=none` together with `COOKIE_SECURE=true`. The default is `lax`; the backend refuses `none` without `Secure`, because browsers discard such a cookie. In this mode the cookie belongs to the API's host, so the frontend's route guard stands down and the app itself validates the session. Safari and some Chrome configurations block third-party cookies entirely, so prefer the same-origin setup.

The login page now checks that the cookie was actually kept and shows this explanation instead of silently returning to the form.

## The AI Time Coach

With `ANTHROPIC_API_KEY` set on the backend, the coach uses a real model and reads your data **only** through authorized, read-only tools. Without a key it runs a deterministic rule-based engine that is **clearly labelled "Demo mode"** in the API (`isDemo`, `mode: "demo"`) and the UI — it never pretends to be a language model. Schedule changes are only ever *proposals* that you confirm. Details: `backend/docs/SECURITY.md`.

## Documentation

| | |
|---|---|
| `docs/ARCHITECTURE.md` | System design, module map, data flow, time handling |
| `docs/API_CONTRACTS.md` | Conventions, error codes, endpoint catalogue |
| `docs/IMPLEMENTATION_STATUS.md` | What is built, verified, measured — and what is not |
| `docs/ARCHITECTURE_DECISIONS/` | Why things are the way they are |
| `backend/docs/DATABASE_DESIGN.md` | Schema, ERD, constraints |
| `backend/docs/AVAILABILITY_ALGORITHM.md` | The availability engine |
| `backend/docs/RECOMMENDATION_ENGINE.md` | Scoring, weights, explanations |
| `backend/docs/SECURITY.md` | Threat model and controls |
| `backend/docs/TESTING.md` | What is tested and how |
| `frontend/docs/DESIGN_SYSTEM.md` | Tokens, components, accessibility |
| `frontend/docs/FRONTEND_ARCHITECTURE.md` | Frontend structure and state |

## Tests

| Suite | Count | Run |
|---|---|---|
| Backend unit (engines, time, timer, cache) | 147 | `cd backend && pnpm test:unit` |
| Backend integration (HTTP + real PostgreSQL) | 60 | `cd backend && pnpm test:integration` |
| Frontend unit/component | 106 | `cd frontend && pnpm test` |
| End-to-end (Playwright: full journey, auth/security, mobile) | 7 | `cd frontend && pnpm test:e2e` (backend must be running) |

Integration tests use a disposable `timeflow_test` database and refuse to run against any database whose name does not contain "test".
