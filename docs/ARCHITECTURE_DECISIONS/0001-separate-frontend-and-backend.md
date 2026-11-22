# ADR-0001 - Separate frontend and backend, joined only by a documented API

**Status:** accepted

**Context.** The product must be a real two-tier system: independently buildable, testable and deployable, with business rules in one place. A single Next.js app with server actions would be faster to write but would blur the boundary (database access in UI code, rules duplicated in the client).

**Decision.**
* `backend/` (NestJS) and `frontend/` (Next.js) have their own `package.json`, lockfile, `tsconfig`, tests and Docker image. Neither imports the other.
* The contract is the OpenAPI document generated from the backend; frontend types are generated from it (`pnpm api:types`) and CI fails on drift.
* The browser calls `/api/*` on the **frontend origin**; the Next.js server proxies to the backend (`rewrites`).

**Consequences.**
* (+) The session cookie is first-party: no CORS preflights, `SameSite=Lax` works, no cookie-domain games.
* (+) Business logic cannot leak into UI code; the frontend holds no secrets.
* (-) One extra hop for API calls (negligible locally) and SSE passes through the proxy.
* (-) The proxy destination is baked at frontend build time (`API_INTERNAL_URL`).
* The API remains directly callable (CORS allow-list from `FRONTEND_ORIGIN`) for other clients.
