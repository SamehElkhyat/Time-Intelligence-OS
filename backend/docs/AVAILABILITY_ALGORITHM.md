# TIMEFLOW — Availability Algorithm

Source: `src/modules/availability/domain/availability-engine.ts`, `recurrence.ts`, `src/common/time/intervals.ts`.
Tests: `tests/unit/availability-engine.spec.ts`, `intervals.spec.ts`, `recurrence.spec.ts`, `time.spec.ts`, plus HTTP-level tests in `tests/integration/core.spec.ts`.

## 1. Principles

1. **Pure and deterministic.** The engine never reads a clock or a database. The caller resolves everything timezone-dependent (the local day's instant range, active hours, recurring occurrences) into absolute instants first; the engine is therefore DST-agnostic. Same input → same output, regardless of input order.
2. **Free is not "not busy".** The engine separates what is *known* from what is *assumed*.
3. **Confidence is explicit** and always explainable.
4. **Half-open intervals** `[start, end)` in integer milliseconds. Touching intervals do not overlap.

## 2. Interval algebra (`intervals.ts`)

| Operation | Complexity | Notes |
|---|---|---|
| `mergeIntervals` | O(n log n) | Sort, then sweep. Merges overlapping **and** touching intervals; drops empty/inverted ones. |
| `subtractIntervals(base, cuts)` | O((n+m) log(n+m)) | The interval difference — the core of "free = active − busy". |
| `intersectIntervals` | O((n+m) log(n+m)) | Two-pointer sweep over merged inputs. |
| `findOverlaps` | O(n log n + k) | Sweep with an active list; `k` = number of overlapping pairs. |
| `clip`, `coveredMs`, `pad`, `splitAt`, `findEarliestSlot` | — | Utilities (buffers, hour bucketing, slot search on a grid). |

Property tested: `covered(base) = covered(base − cuts) + covered(base ∩ cuts)`; merge is idempotent; results are sorted and disjoint.

## 3. Inputs

```
range            the local day as [start, end)            (23h / 24h / 25h)
now              the reference instant
activeHours      when the user can be scheduled            (declared weekly rules, else defaults)
blocked          user-declared unavailable time (e.g. lunch)
planned[]        activities + recurring occurrences (fixed / movable / commitment / done)
tracked[]        measured segments
activeTimer      what is being tracked right now, with elapsed and expected total
bufferMs, minSlotMs
daysAhead        how far in the future the day is
overrunRatioByCategory   learned from the user's history (only statistically reliable entries)
```

## 4. Algorithm

Let `past = [range.start, now]`, `future = [now, range.end]`.

**Past — what do we know?**
```
tracked          = merge(clip(tracked, past))
plannedPast      = merge(clip(planned, past))
plannedUntracked = plannedPast − tracked           # planned, but no evidence it happened
unknown          = activeHours∩past − tracked − plannedPast
```
`unknown` is **never** counted as free.

**Future — what is occupied?**
```
busy     = merge( plannedFuture(not done)  ∪  activeTimerHold )
buffers  = pad(fixed ∪ commitment items, ±bufferMs) − busy       # kept clear around meetings
blocked  = userBlocked − busy − buffers
freeAll  = activeHours∩future − busy − buffers − blocked
windows  = { w ∈ freeAll : |w| ≥ minSlotMs }
fragments= { w ∈ freeAll : |w| <  minSlotMs }
```
**Active timer.** A running timer occupies `now … now + (expectedTotal − elapsed)`; with no known end it holds 15 minutes and lowers the confidence of nearby windows. A paused timer does not block time but warns.

**Conflicts.** `findOverlaps` over non-done planned blocks. `HARD` when both sides are fixed commitments, otherwise `SOFT`. Overlapped time counts once in `plannedSec`.

**Classification strip.** Every instant of the local day gets exactly one state: `TRACKED`, `PLANNED_UNTRACKED`, `UNKNOWN`, `BUSY`, `BUFFER`, `BLOCKED`, `FREE`, `FRAGMENT`, or `OUTSIDE_HOURS` (the remainder). Tested invariant: the strip tiles the day with no gap or overlap — on a 23-hour DST day too.

## 5. Confidence

Each offered window starts at 100 and loses points for specific, stated reasons:

| Factor (`code`) | Penalty | When |
|---|---|---|
| `DEFAULT_HOURS` | 10 | Based on default active hours, not hours the user declared for that weekday |
| `NOTHING_PLANNED` | 20 | The day has no plan and no tracking — unplanned time is not confirmed availability |
| `FAR_AHEAD` | 10 / 15 | 3–6 days / 7+ days ahead |
| `TIMER_PAUSED` | 15 | A paused timer may resume within the hour |
| `TIMER_OPEN_ENDED` | 35 | Tracking something with no known end, close to this window |
| `TIMER_MAY_OVERRUN` | 10 | The window starts exactly when the tracked activity is expected to end |
| `PRECEDING_OVERRUNS` | 15 | The category right before it habitually runs ≥ 20% long (from the user's own history, ≥ 3 samples) |
| `ADJACENT_CONFLICT` | 10 | Sits next to overlapping commitments |

`score = max(0, 100 − Σ penalties)` → `HIGH` ≥ 80, `MEDIUM` ≥ 55, otherwise `LOW`. The API returns the score, the level, and the `factors[]` messages, so the UI can show exactly why.

## 6. Recurrence and DST (`recurrence.ts`)

* `occurrenceDates(rule, from, to)` works on calendar dates only (daily/weekly with weekdays/monthly with day clamping, `interval`, `until`, `count`, exception dates). `count` limits the whole series (counted before exclusions, as RFC 5545). Windows far in the future jump ahead instead of iterating from the start.
* `expandOccurrences` converts each date + wall-clock start to an instant **in the user's zone**; duration is real elapsed time. An occurrence that begins the previous evening and crosses midnight into the range is included.
* Non-existent local times (spring-forward gap) → first valid instant after the gap. Ambiguous (fall-back overlap) → the earlier occurrence. Both tested.
* Occurrences already **materialised** as activities (unique `(scheduleEventId, occurrenceDate)`) are removed from the virtual set so nothing is counted twice.

## 7. Worked example

User declares 08:00–18:00 and plans: 09:00–10:00 Work, 10:00–10:30 Meeting, 11:00–12:00 Learning (buffer 0).

```
windows → 08:00–09:00, 10:30–11:00 (30 min, after "Meeting", before "Learning"), 12:00–18:00
```
Now suppose it is 12:00 and only the Work block was tracked. The engine reports `trackedSec = 1h`, `plannedUntrackedSec = 1h30m` (Meeting + Learning: planned, no evidence), `unknownSec = 1h30m` (08–09, 10:30–11:00), and offers only `12:00–18:00` as free. The earlier gap is *not* free — it is unknown.

## 8. Complexity and limits

Per day: O(n log n) in the number of blocks. Ranges are capped at 31 days per request; a day with hundreds of blocks computes in well under a millisecond (see measurements in `docs/IMPLEMENTATION_STATUS.md`).
