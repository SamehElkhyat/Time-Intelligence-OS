# ADR-0009 - Timer persistence: segments, row lock, partial unique indexes

**Status:** accepted

**Decision.** A session is a set of segments (pause closes one, resume opens one). Elapsed time is always derived from persisted timestamps. Every timer command runs in a transaction that first locks the user row (`SELECT ... FOR UPDATE`), serialising concurrent commands; two partial unique indexes (one active session per user, one open segment per session) are the database-level backstop. `expectedVersion` detects stale tabs. Corrections and deletions write full before/after to the append-only audit log. Forgotten timers are closed by a delayed job at the 12-hour mark.

**Alternatives rejected.** Counting ticks in the browser (breaks on refresh, close, sleep); optimistic concurrency only (races between tabs produce duplicate sessions).

**Consequences.** (+) Refresh, closed tab and second device are correct by construction (tested, including racing starts and the abandoned-timer path). (-) A command costs a transaction with a row lock - negligible for per-user serial traffic.
