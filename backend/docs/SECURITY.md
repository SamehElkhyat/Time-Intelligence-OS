# TIMEFLOW — Security

This describes what is implemented and tested. Where something is **not** done it says so (§10).

## 1. Threat model (summary)

Assets: users' schedules, tracked time and task content (personal data), session tokens, passwords, the AI provider key.
Actors considered: unauthenticated internet clients; authenticated users probing other users' data; malicious web pages attacking a signed-in browser; leaked database or logs; prompt-injection through user-authored text reaching the AI; a compromised or misbehaving AI model.

## 2. Authentication and sessions

| Control | Implementation |
|---|---|
| Password hashing | **Argon2id**, memory 19 MiB, time cost 2, parallelism 1 (OWASP minimum profile). Cheap parameters only under `NODE_ENV=test`. Length 10–128, no composition rules (length beats rules). |
| Timing | Login verifies against a dummy hash when the email does not exist; unknown email and wrong password return the **same** code and message. |
| Session token | 256-bit random, delivered as an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie. The database stores only its **SHA-256**, so a database leak yields no usable session. |
| Lifetime | Absolute expiry (`SESSION_TTL_DAYS`, 30) **and** idle timeout (`SESSION_IDLE_TIMEOUT_HOURS`, 168). Each device is its own row; revocable individually or all-others. Changing the password revokes every other session; a password reset revokes all. |
| No secrets in the browser | The cookie is invisible to JavaScript; the CSRF token is held in memory only. An E2E test asserts nothing session-like is in `localStorage`/`sessionStorage`/`document.cookie`. |
| Reset / verify tokens | 256-bit random, hash-only storage, **single use enforced atomically** (`updateMany … usedAt IS NULL`), expiry (1 h reset, 48 h verify). `forgot` always answers `202` — it cannot be used to enumerate accounts. |
| Email delivery | **No provider is configured.** Outside production the link is logged for local testing; in production it is *not sent* and a warning is logged. See §10. |

## 3. CSRF

Cookies are `SameSite=Lax`, which already blocks cross-site `POST`s. On top of that every non-`GET` request must carry `X-CSRF-Token = HMAC-SHA256(SESSION_SECRET, "csrf:" + sessionId)` (constant-time compared). The token is bound to the session, returned with the session payload, and never stored client-side beyond memory. Tests: missing and wrong token → `403 CSRF_TOKEN_INVALID`; the client transparently refreshes the token once after a rejection.

## 4. Authorization

* Identity always comes from the session, never from request input. No endpoint accepts a user id.
* Every query is scoped by `userId`; cross-user access answers `404` (not `403`) so resource existence is not disclosed. Covered by tests for activities, tasks (including `dependsOnIds` pointing at another user's task), conversations, proposals, notifications and time entries.
* Global `SessionGuard`; routes are private unless explicitly `@Public()`.

## 5. Input validation and output safety

* Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`: unknown fields are rejected, types coerced explicitly, lengths bounded.
* Prisma parameterises all queries; the only raw SQL (`FOR UPDATE`, `FOR UPDATE SKIP LOCKED`, advisory lock, `SELECT 1`) uses tagged templates with bound parameters.
* Errors go through one filter: stack traces, SQL and Prisma messages are logged, **never returned**. `500`s return a generic message and a `requestId`.
* The frontend renders all user text through React (escaped) — no `dangerouslySetInnerHTML`; coach replies render as plain pre-wrapped text.
* Open-redirect protection on `?next=` (only same-site relative paths, tested).
* Security headers: Helmet on the API; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` on the frontend.

## 6. Rate limiting and abuse controls

Per client address (never keyed by a client-supplied cookie, which would let an attacker mint buckets): 600 req/min default (`RATE_LIMIT_PER_MINUTE`); 10/min on register, login, password change/reset and email verify; 5/min on `forgot`; 3/min on `resend`; 12/min on coach messages plus a rolling-24 h message cap. Tested, including that the limiter returns the standard error envelope.

## 7. CORS

Allowed origins come from `FRONTEND_ORIGIN` only, with credentials. A preflight from any other origin receives no `Access-Control-Allow-Origin` (tested). In the default deployment the browser uses the same-origin `/api` proxy, so CORS is not even exercised.

## 8. AI coach security

| Risk | Control |
|---|---|
| Arbitrary data access | The model has **no** database access. It can only call a fixed registry of 9 tools. Each tool runs for the authenticated user (the model never supplies a user id), validates arguments with a strict zod schema (unknown keys rejected), returns size-capped JSON, and cannot take SQL, table names or free-form queries. Tests: `run_sql` and `user_id` arguments are rejected; user B's coach cannot see or schedule user A's task. |
| Unwanted changes | Only `propose_schedule_task` writes, and it writes a **proposal** (`AIPendingAction`, 30 min expiry). Nothing changes until the user calls `POST /ai-coach/actions/:id/confirm`, which re-runs the normal task-scheduling validation. Tested: proposing changes nothing; non-owners get `404`; confirm is single-use and retryable if the slot was taken. |
| Prompt injection | Tool results are treated as data: the system prompt says so, task titles etc. are returned as JSON values, and the model has no tool that can exfiltrate or mutate beyond the confirmed proposal. |
| Cost / abuse | Rolling 24 h message cap, per-minute throttle, max 6 tool iterations per message, capped output tokens, input ≤ 2000 chars, estimated cost recorded per reply (`costMicroUsd`). |
| Auditability | Every tool call (`actor=ai-coach`, input, ok, duration) and every message (provider, model, tokens, cost) is in `AuditLog`; confirmations/rejections too. |
| Honesty | With no key the deterministic engine runs and every reply is flagged `isDemo` / `provider: "demo"` / `model: null`, with a persistent notice in the UI. A real-provider failure is returned as an error — it is **never** silently replaced by simulated output. |

## 9. Secrets and configuration

* `.env` files are git-ignored; only `.env.example` (no real values) is committed. The frontend has no secrets (only `NEXT_PUBLIC_*`, and none are required).
* The process **refuses to start** with an invalid configuration (`SESSION_SECRET` < 32 chars, missing `DATABASE_URL`, …) and, in production, without `COOKIE_SECURE=true` (unless the explicit local-demo override `ALLOW_INSECURE_COOKIES=true`).
* Logs redact `Cookie`, `Authorization`, `X-CSRF-Token`, `Set-Cookie`. Emails in production logs are masked.
* Containers run as an unprivileged user; images contain no `.env`.

## 10. Known gaps and limitations (be aware)

1. **No email provider.** Password-reset and verification links are not delivered in production until a provider is wired into `MailerService`. The token lifecycle is complete and tested.
2. **No MFA / account deletion / export endpoint** yet.
3. **No account lockout** beyond rate limiting (limits are per address; distributed attackers are out of scope here).
4. **CSP** is not set on the frontend (Next.js requires nonce plumbing for inline scripts); the other headers are. Adding a nonce-based CSP is a recommended hardening step.
5. The real Anthropic code path could not be exercised end-to-end in this environment (no API key). It is a thin loop over the same tool registry that the demo engine uses and that the integration tests cover, but it has been type-checked, not run against the live API. Treat the first live run as needing a smoke test.
6. `pnpm audit` runs in CI as non-blocking.
