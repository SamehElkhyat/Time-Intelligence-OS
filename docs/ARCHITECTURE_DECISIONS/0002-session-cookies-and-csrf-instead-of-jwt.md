# ADR-0002 - Server-side sessions in HttpOnly cookies + CSRF token, not JWT in the browser

**Status:** accepted

**Context.** Requirement: no auth secrets in `localStorage`, multi-device sessions, secure expiry, revocation.

**Decision.** Opaque 256-bit session token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. The database stores only its SHA-256 and one row per device. Non-`GET` requests need an `X-CSRF-Token` equal to `HMAC(SESSION_SECRET, sessionId)`. Idle and absolute expiry are both enforced server-side.

**Why not JWT.** Stateless JWTs cannot be revoked per device without a server-side list (which makes them sessions again), and holding them in JavaScript-readable storage is exactly what the requirements forbid. The extra database read per request is a primary-key lookup.

**Consequences.** (+) Instant revocation (password change, device sign-out). (+) A database leak does not leak usable tokens. (-) State on the server; mitigated by `lastSeenAt` being written at most every 5 minutes.
