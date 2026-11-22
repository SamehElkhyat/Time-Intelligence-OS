# TIMEFLOW — API Contracts

The API is documented by an OpenAPI 3 document that is **generated from the code** (NestJS decorators + DTOs), never written by hand:

* Live: `GET /api/docs` (Swagger UI) and `GET /api/openapi.json` on a running backend.
* Committed: `backend/docs/openapi.json` (regenerate with `cd backend && pnpm openapi:generate`; works without a database).
* Frontend types: `cd frontend && pnpm api:types` → `src/types/api.gen.ts`. CI regenerates both and fails on any difference, so the contract cannot drift silently.

Base path: `/api`. All bodies are JSON. 96 operations across 80 paths.

## 1. Authentication and CSRF

| | |
|---|---|
| Session | `POST /api/auth/register` or `/login` sets the cookie `tf_session` — opaque 256-bit random token, `HttpOnly`, `SameSite=Lax`, `Secure` in production. Only its SHA-256 is stored server-side. |
| CSRF | The register/login/`GET /auth/session` response body contains `csrfToken`. Send it as `X-CSRF-Token` on **every** non-`GET` request. Keep it in memory (never `localStorage`). |
| Public routes | `register`, `login`, `password/forgot`, `password/reset`, `email/verify`, `health/*`. Everything else requires a session. |
| Identity | Always the session user. No endpoint accepts a user id; one account can never address another's data (cross-user access returns `404`). |

## 2. Conventions

* **Time.** Instants are ISO-8601 UTC (`2026-03-02T07:00:00.000Z`). Calendar days are `YYYY-MM-DD` interpreted in the user's IANA timezone (`/users/me/preferences`). A day range is returned by the API where it matters (`availability/day.range`) because it can be 23 or 25 hours long.
* **Durations** are integers: `…Sec` (seconds) or `…Minutes`/`…Min`.
* **Pagination.** `?page=1&pageSize=25` (max 200). Responses: `{ items: [...], meta: { page, pageSize, total, totalPages } }`.
* **Filtering.** List endpoints take `q` (case-insensitive search), `status` (comma separated), `from`/`to`, `sort`, `order`.
* **Unknown properties are rejected** (`400`), so typos never pass silently.
* **Nullable means "not measurable".** Metrics that cannot be computed (no plan, nothing tracked, too little history) are `null`, never `0`.
* **Request ids.** Every response carries `X-Request-Id`; errors repeat it as `requestId`.

## 3. Errors

Every failure uses one envelope:

```json
{ "statusCode": 409, "code": "TIMER_STATE_CHANGED", "message": "…human readable…", "details": ["…"], "requestId": "…" }
```

Clients branch on `code`, never on `message`. `details` carries field-level problems for validation errors.

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_PLANNED_RANGE`, `INVALID_CATEGORY`, `INVALID_TASK`, `INVALID_DEPENDENCY`, `INVALID_STATUS`, `INVALID_RANGE`, `INVALID_MONTH`, `INVALID_TIME_ENTRY`, `INVALID_ACTIVE_HOURS`, `INVALID_FOCUS_WINDOW`, `INVALID_AVAILABILITY`, `INVALID_RECURRENCE`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` (password change), `NOT_AN_OCCURRENCE`, `DATE_IN_PAST`, `PLAN_BLOCKS_OVERLAP`, `PLAN_DUPLICATE_TASK`, `UNSUPPORTED_ACTION` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` (login — identical for unknown email and wrong password) |
| 403 | `CSRF_TOKEN_INVALID` |
| 404 | `NOT_FOUND` (also returned for another user's resource) |
| 409 | `EMAIL_IN_USE`, `TIMER_ALREADY_ACTIVE`, `TIMER_STATE_CHANGED`, `INVALID_TIMER_TRANSITION`, `NO_ACTIVE_TIMER`, `TIMER_STILL_ACTIVE`, `TIME_ENTRY_OVERLAP`, `ACTIVITY_NOT_TRACKABLE`, `ACTIVITY_CANCELLED`, `TASK_BLOCKED`, `TASK_COMPLETED`, `TASK_CANCELLED`, `TASK_NOT_SCHEDULABLE`, `SCHEDULE_CONFLICT`, `OCCURRENCE_REMOVED`, `RECOMMENDATION_RESOLVED`, `RECOMMENDATION_EXPIRED`, `PROPOSAL_RESOLVED`, `PROPOSAL_EXPIRED`, `REFERENCE_CONFLICT`, `CONFLICT` |
| 422 | `DEPENDENCY_CYCLE` (`details[0]` shows the loop, e.g. `A → C → B → A`) |
| 429 | `RATE_LIMITED`, `AI_LIMIT_REACHED`, `AI_PROVIDER_BUSY` |
| 500 / 502 | `INTERNAL_ERROR` (details are logged, never returned), `AI_PROVIDER_ERROR`, `AI_PROVIDER_AUTH` |

## 4. Rate limits (per client address)

| Scope | Limit |
|---|---|
| Default | 600 requests / minute (`RATE_LIMIT_PER_MINUTE`) |
| `register`, `login`, `password/change`, `password/reset`, `email/verify` | 10 / minute |
| `password/forgot` | 5 / minute (always answers `202`; cannot be used to probe for accounts) |
| `email/resend` | 3 / minute |
| `ai-coach/messages` | 12 / minute, plus a daily message limit (`AI_DAILY_MESSAGE_LIMIT`, default 40 per rolling 24 h) |

## 5. Idempotency and concurrency

* `POST /time-tracking/start` for the activity that is already being tracked is a no-op; starting a different one atomically switches. Timer commands accept `expectedVersion` (from `session.version`) and answer `409 TIMER_STATE_CHANGED` when another tab or device acted first.
* `POST /schedule/events/:id/materialise` is idempotent per `(event, date)`.
* Recommendations, proposals and password-reset / verification tokens are single-use; re-use answers `409`/`400`.
* Event handlers and notifications are de-duplicated server-side, so retried jobs never produce duplicates.

## 6. Real-time

`GET /api/events/stream` — Server-Sent Events. Events: `change` with `{ "topic": "timer|schedule|tasks|availability|recommendations|analytics|notifications", "event": "activity.started" }` and a 25 s `ping`. Messages carry no user data; clients refetch through the normal API. Authenticated by the session cookie.

## 7. Domain semantics worth knowing

* **Planned vs. tracked.** `Activity` has `plannedStart/plannedEnd` (intent) and `actualDurationSec` (sum of tracked sessions). A scheduled activity is not proof it happened; analytics count only tracked time.
* **Availability classification.** `strip[].state` is one of `TRACKED`, `PLANNED_UNTRACKED`, `UNKNOWN` (past) and `BUSY`, `BUFFER`, `BLOCKED`, `FREE`, `FRAGMENT` (future), plus `OUTSIDE_HOURS`. `windows[]` are only `FREE`, each with `confidence: HIGH|MEDIUM|LOW`, a 0–100 `confidenceScore` and the `factors` that lowered it.
* **Recommendations** return `score`, `confidence`, `reasons[]`, `summary`, and a `breakdown[]` of every factor with its weight and contribution, plus `excluded[]` — tasks that were considered and why they were ruled out.
* **AI coach.** Replies from the deterministic engine carry `isDemo: true`, `provider: "demo"`, `model: null`. Schedule changes are returned as `pendingActions` and only applied by `POST /ai-coach/actions/:id/confirm`.

## 8. Endpoint catalogue

Generated from `backend/docs/openapi.json`.

### activities

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/activities` | List, filter and search activities |
| `POST` | `/api/api/activities` | Create an activity |
| `GET` | `/api/api/activities/{id}` |  |
| `PATCH` | `/api/api/activities/{id}` | Edit an activity |
| `DELETE` | `/api/api/activities/{id}` | Remove an activity from the plan (tracked history is preserved) |
| `POST` | `/api/api/activities/{id}/reschedule` | Move an activity to a new time (used by timeline drag and drop) |
| `POST` | `/api/api/activities/{id}/duplicate` | Duplicate an activity (plan only — tracked time is not copied) |
| `POST` | `/api/api/activities/{id}/complete` | Mark as completed (stops its timer if running) |
| `POST` | `/api/api/activities/{id}/skip` |  |
| `POST` | `/api/api/activities/{id}/cancel` |  |
| `POST` | `/api/api/activities/{id}/reopen` |  |

### ai-coach

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/ai-coach/status` | Coach mode (live or demo), model, daily limit and usage |
| `POST` | `/api/api/ai-coach/messages` | Ask the coach |
| `GET` | `/api/api/ai-coach/conversations` |  |
| `GET` | `/api/api/ai-coach/conversations/{id}` |  |
| `DELETE` | `/api/api/ai-coach/conversations/{id}` |  |
| `POST` | `/api/api/ai-coach/actions/{id}/confirm` | Confirm a proposed schedule change. Only this call modifies the schedule. |
| `POST` | `/api/api/ai-coach/actions/{id}/reject` |  |

### analytics

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/analytics/dashboard` | Daily command center: every metric is computed from stored plans and tracked time |
| `GET` | `/api/api/analytics/daily` | Daily analytics rows for a date range |
| `GET` | `/api/api/analytics/summary` | Aggregated analytics: totals, category distribution, planned vs actual, heatmap |
| `GET` | `/api/api/analytics/reports/weekly` | Weekly report with comparison to the previous week |
| `GET` | `/api/api/analytics/reports/monthly` | Monthly report with comparison to the previous month |

### auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/api/auth/register` | Create an account and start a session |
| `POST` | `/api/api/auth/login` | Sign in. Sets the HttpOnly session cookie. |
| `POST` | `/api/api/auth/logout` | Revoke the current session |
| `GET` | `/api/api/auth/session` | Current session: user, preferences and CSRF token |
| `GET` | `/api/api/auth/sessions` | Devices currently signed in |
| `POST` | `/api/api/auth/sessions/revoke-others` | Sign out every other device |
| `DELETE` | `/api/api/auth/sessions/{id}` | Sign out one device |
| `POST` | `/api/api/auth/password/change` | Change password (signs out other devices) |
| `POST` | `/api/api/auth/password/forgot` | Request a password reset link. Always returns 202. |
| `POST` | `/api/api/auth/password/reset` | Set a new password using a reset token (signs out all devices) |
| `POST` | `/api/api/auth/email/verify` | Confirm an email address using a verification token |
| `POST` | `/api/api/auth/email/resend` | Send a new verification link |

### availability

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/availability/day` | Smart availability for one local day |
| `GET` | `/api/api/availability/range` | Per-day availability summaries (max 31 days) |
| `GET` | `/api/api/availability/conflicts` | Overlapping commitments in a date range |
| `GET` | `/api/api/availability/slots` | Free slots that fit a given duration over the next days |

### health

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/health/live` | Liveness: the process is running |
| `GET` | `/api/api/health/ready` | Readiness: database (required), Redis (optional) and job queue statistics |

### notifications

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/notifications` | In-app notifications |
| `GET` | `/api/api/notifications/unread-count` |  |
| `POST` | `/api/api/notifications/read-all` |  |
| `POST` | `/api/api/notifications/{id}/read` |  |
| `GET` | `/api/api/events/stream` | Realtime change stream (text/event-stream) |

### productivity

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/productivity/leakage` | Time leakage insights |
| `GET` | `/api/api/productivity/patterns` | Personal productivity patterns and a forecast for today |

### recommendations

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/api/recommendations/generate` | Rank open tasks against real availability |
| `GET` | `/api/api/recommendations/latest` | Most recent open batch |
| `POST` | `/api/api/recommendations/next` | Best next action (reuses a batch younger than 5 minutes, otherwise regenerates) |
| `POST` | `/api/api/recommendations/{id}/accept` | Accept: schedule the task into the suggested window |
| `POST` | `/api/api/recommendations/{id}/dismiss` |  |

### scheduling

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/api/energy/logs` | Record current energy and focus |
| `GET` | `/api/api/energy/logs` | Energy check-in history (default: last 14 days) |
| `GET` | `/api/api/energy/overview` | Current state and hour-by-hour expectation built from the user’s own check-ins |
| `GET` | `/api/api/schedule/events` | Recurring commitments |
| `POST` | `/api/api/schedule/events` |  |
| `PATCH` | `/api/api/schedule/events/{id}` |  |
| `DELETE` | `/api/api/schedule/events/{id}` |  |
| `POST` | `/api/api/schedule/events/{id}/skip` | Skip a single occurrence |
| `POST` | `/api/api/schedule/events/{id}/materialise` | Turn one occurrence into a trackable activity (idempotent) |
| `POST` | `/api/api/scheduling/plan` | Propose an energy-aware plan for a day. Nothing is saved. |
| `POST` | `/api/api/scheduling/apply` | Create work blocks from a proposal (each block is re-validated) |

### tasks

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/tasks` | List, filter and search tasks |
| `POST` | `/api/api/tasks` | Create a task (optionally recurring, with subtasks and dependencies) |
| `GET` | `/api/api/tasks/{id}` |  |
| `PATCH` | `/api/api/tasks/{id}` |  |
| `DELETE` | `/api/api/tasks/{id}` |  |
| `POST` | `/api/api/tasks/{id}/complete` | Complete a task. Rejected with TASK_BLOCKED while dependencies are open. |
| `POST` | `/api/api/tasks/{id}/reopen` |  |
| `PUT` | `/api/api/tasks/{id}/dependencies` | Replace the dependencies of a task. Cycles are rejected with DEPENDENCY_CYCLE. |
| `POST` | `/api/api/tasks/{id}/schedule` | Schedule a work block for the task on the calendar |
| `GET` | `/api/api/tasks/{id}/history` | Change history of a task |
| `POST` | `/api/api/tasks/{id}/subtasks` |  |
| `PATCH` | `/api/api/tasks/{id}/subtasks/{subtaskId}` |  |
| `DELETE` | `/api/api/tasks/{id}/subtasks/{subtaskId}` |  |

### time-tracking

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/time-tracking/active` | Active timer with server-computed elapsed time (survives refresh and browser restarts) |
| `POST` | `/api/api/time-tracking/start` | Start (or switch to) a timer. Idempotent for the activity already being tracked. |
| `POST` | `/api/api/time-tracking/pause` | Pause the running timer |
| `POST` | `/api/api/time-tracking/resume` | Resume the paused timer |
| `POST` | `/api/api/time-tracking/stop` | Stop the active timer; optionally complete the activity. Returns the final session. |
| `POST` | `/api/api/time-tracking/manual` | Add a manual time entry (must not overlap tracked time) |
| `GET` | `/api/api/time-tracking/sessions` | Tracking history |
| `GET` | `/api/api/time-tracking/sessions/{id}` | One time entry |
| `PATCH` | `/api/api/time-tracking/sessions/{id}` | Correct a stopped time entry. The previous values are kept in the audit trail. |
| `DELETE` | `/api/api/time-tracking/sessions/{id}` | Delete a stopped time entry (content preserved in the audit trail) |
| `GET` | `/api/api/time-tracking/sessions/{id}/corrections` | Audit trail of a time entry |

### users

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/api/users/me` | Current user profile |
| `PATCH` | `/api/api/users/me` | Update profile |
| `GET` | `/api/api/users/me/preferences` | Timezone, locale, scheduling and notification preferences |
| `PATCH` | `/api/api/users/me/preferences` | Update preferences |
| `POST` | `/api/api/users/me/onboarding/complete` | Mark onboarding as completed |
| `GET` | `/api/api/users/me/availability` | Weekly availability rules declared by the user |
| `PUT` | `/api/api/users/me/availability` | Replace all weekly availability rules |
| `GET` | `/api/api/categories` | Activity categories |

