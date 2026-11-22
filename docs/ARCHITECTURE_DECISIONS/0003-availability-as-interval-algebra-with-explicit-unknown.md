# ADR-0003 - Availability as interval algebra, with *unknown* as a first-class state

**Status:** accepted

**Context.** "Free time" computed as "not busy" is wrong in practice: it treats every untracked hour in the past as free, inflating availability and corrupting analytics. The brief explicitly forbids classifying missing tracking data as confirmed free time.

**Decision.** A pure engine over half-open integer-millisecond intervals (`merge`, `subtract`, `intersect`, sweep-line overlap detection). Past time is classified `TRACKED` / `PLANNED_UNTRACKED` / `UNKNOWN`; only **future** time inside active hours can be `FREE`. Each free window carries a 0-100 confidence made of named penalties, so the UI can say *why* it is not certain.

**Consequences.** (+) Deterministic, exhaustively testable, DST-agnostic (callers resolve local days to instants). (+) Honest numbers. (-) New users see a lot of "unknown" until they start tracking - an accepted, explicitly explained trade-off (empty states and notes say so).
