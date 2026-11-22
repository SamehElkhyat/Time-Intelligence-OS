# ADR-0004 - Transactional outbox, BullMQ workers, and an inline fallback

**Status:** accepted

**Context.** State changes must trigger follow-up work (availability and analytics refresh, reminders, recurring-task generation, realtime hints) without ever emitting an event for a change that rolled back, and without losing events if the process dies after commit.

**Decision.** Events are inserted into `OutboxEvent` **in the same transaction** as the change. A relay claims unpublished rows with `FOR UPDATE SKIP LOCKED` and enqueues them (job id = event id). Subscribers are recorded in `ProcessedEvent(eventId, handler)` so redelivery is idempotent. BullMQ provides retries/backoff and delayed jobs. When `REDIS_URL` is unset (local development, tests) the queue runs jobs in-process with the same retry semantics.

**Consequences.** (+) At-least-once delivery with effectively-once handlers. (+) The whole system runs with Postgres alone for development and tests. (-) Handlers must be idempotent (enforced by `ProcessedEvent` and by natural keys such as the notification `dedupeKey`).
