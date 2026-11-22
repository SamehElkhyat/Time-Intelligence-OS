# TIMEFLOW — Testing

## 1. Layout

```
backend/
  tests/unit/            147 tests, ~2 s, no I/O
  tests/integration/     60 tests, real HTTP (supertest) + real PostgreSQL
  tests/load/            k6 script
  scripts/bench.mjs      real latency measurement (no k6 required)
frontend/
  tests/unit/            time, API client, schemas, layout maths
  tests/components/      timer, timeline, cards/states, dashboard, login   (106 tests with unit/)
  tests/e2e/             Playwright: journey, auth/security, mobile        (7 tests)
```

## 2. Running

```bash
# backend
pnpm test:unit
pnpm test:integration        # needs Postgres (docker compose up -d postgres); uses the disposable timeflow_test DB
pnpm test:cov                # coverage of domain/ and common/time/

# frontend
pnpm test
pnpm test:e2e                # needs the backend running; starts the frontend dev server if it is not already up
```

Integration tests run the real Nest application in-process against a real database (migrated on demand by `global-setup.ts`). They refuse to run unless the database name contains "test". Redis is disabled under test (in-process queue and cache) so the suite is deterministic; BullMQ itself is exercised by the E2E runs and the container stack.

## 3. What the unit tests prove

| Area | Cases |
|---|---|
| Interval algebra | merge (touching/overlapping/contained/idempotent), subtract (holes, spanning, unsorted cuts), intersect, overlap detection, the coverage identity, earliest-slot search on a grid |
| Time & DST | 23 h / 25 h day length; day ranges tile the timeline; same wall-clock time across DST; spring-forward gap → first valid instant; fall-back ambiguity → earlier occurrence; midnight crossing; local date vs UTC date; week start |
| Availability engine | the product example; unknown vs free; planned-untracked; buffers (fixed and commitment-category); blocked time; fragments; conflicts HARD/SOFT; active timer (expected end, open-ended, paused); every confidence factor; strip tiles the whole day including a 23 h day; cross-midnight clipping; determinism under reordering |
| Recurrence | daily/weekly/monthly (day clamping), interval, until, count, exclusions, far-future jump; DST stability; cross-midnight occurrences |
| Timer | transition table (allowed and rejected); elapsed from persisted segments; refresh recovery; clock skew; single flooring; manual-entry validation |
| Recommendations | priority is not everything (deadline beats priority); fit; energy mismatch; time-of-day; overdue; leverage; every exclusion code with its reason; explanation matches inputs; breakdown sums to the score; unknown energy lowers confidence; history-adjusted duration (sample threshold, clamp); determinism and tie-breaks |
| Planner / energy | demanding work in the peak, light work out of it; edge-of-peak blocks are not over-scored; no overlaps; urgent first; after-deadline warning; breaks after long stretches; unknown-energy honesty; determinism; forecast sources (logged / declared / unknown) |
| Metrics / leakage / patterns | no data ⇒ `null` score; productive/rest/leisure separation; focus & deep work; future time never counted; adherence; only *unplanned short* gaps are leakage; rest never waste; estimation accuracy; hourly buckets; weight re-normalisation; every leakage rule and its evidence; pattern sufficiency thresholds and hedged wording; same-weekday forecast |
| Dependency graph | direct/indirect cycles with the path, replacing a task's own edges, topological order |
| Cache | single-flight (8 concurrent → 1 computation), per-user invalidation, failures not cached, writes during computation are not served stale |

## 4. What the integration tests prove

* **Auth & security:** cookie flags; no hash in responses; duplicate email; identical failure for unknown email/wrong password; CSRF missing/wrong; logout revokes; password change signs out other devices; reset tokens work once and revoke sessions; unknown fields rejected; unknown routes use the error envelope; CORS allows only the frontend origin; rate limiting.
* **Activities:** CRUD, tag normalisation, search/filter, range and category validation, **cross-user isolation**, reschedule counting, duplicate-without-tracked-time, soft delete keeping tracked history.
* **Timer:** elapsed derived from stored timestamps (simulated closed browser); paused time excluded; invalid transitions; **concurrent starts never leave two active timers** (also asserted on the open-segment constraint); idempotent restart; switching stops the previous; stale-tab detection; stop-and-complete; overlap and future entries rejected; corrections and deletions audited with before/after.
* **Availability:** the product example through the API (in a non-UTC zone); conflicts; slot search; past untracked time never free (strip tiles the day); malformed dates; event-driven snapshot refresh.
* **Tasks:** subtasks; dependency cycles reported as a path; blocked tasks cannot complete; cross-user dependencies rejected; recurring generation exactly once; scheduling rejects fixed-commitment overlap; status moves to in-progress when tracked; filters.
* **Intelligence:** ranking and explanations over HTTP; accept/dismiss lifecycle; "I have N minutes" semantics; energy honesty; energy-aware plan/apply with re-validation; recurring commitments across a DST change (09:00 Paris is 08:00Z then 07:00Z), skip and idempotent materialise.
* **Analytics:** empty-account honesty; metrics from stored data; **a correction is visible on the very next read** (cache + snapshot); leakage excludes rest; patterns refuse to claim without data.
* **AI coach:** demo labelling; tool authorization boundary (other users' data, unknown tools, unexpected arguments, malformed input); audit entries; proposals confirmable only by the owner and only once; retryable on conflict; daily limit.

## 5. End-to-end journey (Playwright, real servers)

Register → onboarding preferences → create activities (incl. a rejected invalid range) → start a timer, **reload the page, verify the clock is recovered, not restarted**, see it in the topbar on other pages, stop → create tasks → add a recurring commitment → compute tomorrow's availability (windows with explicit confidence) → generate recommendations and see the score breakdown → complete a task → review analytics → dashboard no longer empty. Plus: auth redirects, bad-credential messaging, client-side validation sends no request, cookie is `HttpOnly` and nothing session-like is in web storage, sign-out, device revocation, and a mobile run (no horizontal overflow on six screens; drawer navigation).

## 6. Coverage of the spec's edge cases

| Required case | Where |
|---|---|
| Timezone changes | `time.spec.ts`, `core.spec.ts` (Cairo user), `intelligence.spec.ts` (Paris), frontend `time.test.ts` |
| Midnight boundaries | availability engine (cross-midnight clip), recurrence (evening occurrence into next day), `localDatesInRange` |
| Daylight saving | 23/25 h days, gap/overlap resolution, stable wall-clock recurrence, strip tiling on a 23 h day, timeline draws 23 rows |
| Overlapping activities | `findOverlaps`, HARD/SOFT conflicts, timeline lanes, API conflicts endpoint |
| Interrupted timer sessions | refresh recovery, pause accounting, abandoned-timer auto-stop path, stale-tab detection |
| Concurrent timer operations | racing starts (integration) + row lock + partial unique indexes |

## 7. Performance measurements

See `docs/IMPLEMENTATION_STATUS.md` (measured, with machine and data-volume context). Reproduce with `node scripts/bench.mjs [base] [email] [password] [concurrency] [requests]` or `k6 run tests/load/availability.k6.js`.

## 8. Known gaps

* The k6 script was written but **not executed** (k6 is not installed here); the Node benchmark was used for measurement instead.
* No visual-regression tests; no automated accessibility audit (axe) in CI — keyboard and ARIA behaviour is covered by component tests, not by a full audit.
* BullMQ is covered by E2E/container runs rather than by an isolated unit test.
