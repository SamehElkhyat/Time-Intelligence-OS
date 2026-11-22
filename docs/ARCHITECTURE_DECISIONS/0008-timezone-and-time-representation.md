# ADR-0008 - Time representation and daylight saving

**Status:** accepted

**Decision.** Instants are UTC `timestamptz(3)`. A "day" is the half-open instant range between two local midnights in the user's IANA zone (23/24/25 h). Local dates are `DATE`. Wall-clock times inside a day are integer minutes. Durations are integers. Recurring events store local start + real duration, so they keep their wall-clock time across DST. Non-existent local times move to the first valid instant after the gap; ambiguous ones resolve to the **earlier** occurrence - pinned explicitly in code because the underlying library resolves them to the later one (found by a unit test).

**Consequences.** (+) No "assume 24 hours" bugs; the engines are DST-agnostic. (-) All day-level logic must go through the helpers in `common/time/time.ts`; the UI does the same in `lib/time.ts` and never uses the browser's own zone.
