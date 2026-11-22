# ADR-0005 - Analytics reads are computed live; stored snapshots are only a materialisation

**Status:** accepted (revised after an integration test exposed a lost-update race)

**Context.** The first design served finished days from a `DailyAnalytics` snapshot refreshed asynchronously by events. Two defects followed: (1) concurrent handlers could finish out of order and a stale snapshot overwrote a newer one; (2) a read immediately after an edit could return pre-edit numbers (no read-your-writes).

**Decision.** Reads **always compute from source data**. This is cheap because `DayContextService` loads any number of days with a fixed set of queries and the pure metrics function does the rest in memory, with the result cached under the user's data version (invalidated by every write; concurrent identical requests share one computation). Snapshots remain as a background materialisation, written **monotonically by compute-start time** so a slow handler can never overwrite a newer snapshot.

**Consequences.** (+) A correction is visible on the very next read (tested). (+) Correctness never depends on asynchronous jobs. (-) 90-day views recompute on a cache miss (measured about 30 ms p95).
