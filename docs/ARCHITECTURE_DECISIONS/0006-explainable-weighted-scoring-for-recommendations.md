# ADR-0006 - Explainable weighted scoring for recommendations

**Status:** accepted

**Decision.** `score = 100 x sum(w_i * f_i)` with nine named factors in [0,1] and weights that sum to 1. The response returns every factor with its weight, points and a note, and the reasons are generated from the same numbers - an explanation cannot drift from the ranking. Unknown inputs are neutral (0.5), never assumed. Confidence is a separate number describing how well the *inputs* support the result. Duration estimates are corrected by the user's own history only with enough samples.

**Alternatives rejected.** A learned model (not enough per-user data; opaque); a plain priority sort (ignores time, energy, deadlines).

**Consequences.** (+) Auditable, testable, deterministic. (-) Weights are judgement-based; they are exposed so they can later be personalised from accept/dismiss data.
