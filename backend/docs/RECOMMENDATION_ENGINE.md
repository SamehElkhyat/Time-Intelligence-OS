# TIMEFLOW — Recommendation Engine

Source: `src/modules/recommendations/domain/scoring.ts` (pure), orchestrated by `recommendations.service.ts`.
Tests: `tests/unit/recommendations.spec.ts` (24 cases), plus `tests/integration/intelligence.spec.ts`.

The engine ranks open tasks against the user's **real** free windows. It does not simply pick the highest priority; it explains why a task was recommended, and why others were not.

## 1. Pipeline

```
open tasks ─▶ filter (actionable? unblocked? not already scheduled? fits the limit?)
           ─▶ adjust the estimate from the user's own history
           ─▶ for each viable window: score the task there
           ─▶ keep the task's best window
           ─▶ rank (deterministic tie-breaks) ─▶ top N + explanations + exclusions
```

## 2. Filtering (each exclusion is reported with a reason)

| Code | Rule |
|---|---|
| `NOT_ACTIONABLE` | Status is not `TODO` or `IN_PROGRESS` (backlog/completed/cancelled) |
| `BLOCKED` | A dependency is not completed — the reason names it |
| `ALREADY_SCHEDULED` | A future work block already exists |
| `TOO_LONG_FOR_LIMIT` | Longer than the "I only have N minutes" the user stated |
| `NO_WINDOW` | No free window is long enough — the reason states the longest one |

## 3. Scoring

`score = round(100 × Σ weight_i × factor_i)`, every `factor_i ∈ [0,1]`. The weights sum to 1 (asserted by a unit test), so scores are comparable and bounded.

| Factor | Weight | How it is computed |
|---|---|---|
| `urgency` | 0.26 | No deadline → 0.30. Overdue or due before it can finish → 1.0. Otherwise `exp(−slack / 48h)` where slack = time to deadline − estimated duration (≈ 0.61 at 24 h, ≈ 0.37 at 48 h), floored at 0.05 |
| `priority` | 0.22 | `(priority − 1) / 3` over LOW…URGENT |
| `fit` | 0.14 | `0.4 + 0.6 × (duration ÷ window length)` — snugly fitting beats wasting a long window |
| `energy` | 0.14 | `levelMatch(userEnergy, required)` |
| `focus` | 0.08 | `levelMatch(userFocus, required)` |
| `timeOfDay` | 0.06 | 1 if it matches the preferred part of day, 0 if not, 0.5 if no preference |
| `history` | 0.04 | Share of planned blocks the user completes in that part of the day (needs ≥ 5 samples, else neutral 0.5) |
| `momentum` | 0.03 | 1 when the task is already `IN_PROGRESS` |
| `leverage` | 0.03 | `min(1, unblockedTasks / 2)` — finishing it unblocks others |

`levelMatch(level, required)`: **unknown → 0.5** (neutral, never assumed). Spare capacity scores `max(0.6, 1 − 0.1 × surplus)` (slightly wasteful, so demanding work is kept for demanding moments); a shortfall costs **35% per missing step**.

### Where the user state comes from
For a window that starts now: the user's most recent energy check-in (valid for 3 h), else the hour's expectation from their history, else their declared focus window, else **unknown**. For later windows: the hourly expectation. A request may override energy/focus explicitly.

### History-adjusted duration
`predictDurationSec` multiplies the estimate by the **median actual/estimate ratio** of the user's completed work in the same category — only with ≥ 3 samples, ignoring differences under 10 %, clamped to 0.5×–2.5×, rounded to whole minutes. The adjusted duration is also used to decide whether the task *fits*.

### "I have N minutes"
An explicit statement overrides the configured active hours but never a real commitment: planned blocks, an active timer, buffers and user-blocked time still cut the window. Time outside the offered windows is trusted at confidence 60 and flagged `usedDeclaredTime`.

## 4. Explanations

Reasons are generated **from the same numbers that produced the score**, strongest contribution first, and only for statements the numbers support (e.g. "its moderate energy demand matches how you feel" appears only when the energy factor ≥ 0.9 *and* energy is known). Example:

> Recommended because it needs about 25 minutes and fits your free window 21:55–22:35, it has high priority, it is due in 20 hours, its moderate energy demand matches how you feel, and finishing it unblocks 1 other task.

The API also returns the full `breakdown[]` (factor, value, weight, points, note), so the UI can show exactly how the score was built.

## 5. Confidence (separate from score)

`confidence` says how well the **inputs** support the recommendation — a high-scoring task can still have low confidence.

```
100
 − 20  energy at that time unknown   (or − 8 if it is a forecast / a later window)
 − 7   no history for this category's duration
 − 5   not enough history for this time of day
 − 0.4 × (100 − windowConfidence)     # inherits uncertainty from the availability engine
clamped to 5…100
```

## 6. Determinism and ranking

Ties break by: score ↓, deadline ↑ (none last), priority ↓, age ↑, id. The same input in any order produces the same ranking (tested).

## 7. Lifecycle

`POST /recommendations/generate` stores the batch (`GENERATED`) and expires the previous one. **Accept** schedules the task as a work block in the suggested window (re-validated against fixed commitments; rejected if the suggestion is older than 30 minutes). **Dismiss** records the decision. `POST /recommendations/next` reuses a batch younger than 5 minutes; when today has no free window it looks ahead up to two days instead of returning nothing.

## 8. Limits and honesty

Weights are chosen by judgement, not learned. They are exposed in the response so they can be inspected, and are the natural parameters to personalise once enough accept/dismiss data exists. The engine never claims a task is "best" without the breakdown to back it.
