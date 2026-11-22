# ADR-0007 - AI coach: provider abstraction, tool-only data access, human confirmation, honest demo mode

**Status:** accepted

**Decision.**
* A `CoachProvider` interface with two implementations: Anthropic (manual tool loop, server-side refusal fallbacks, capped output and iterations) and a **deterministic demo engine** used when no key is configured. Demo replies are flagged `isDemo` everywhere and never presented as model output; a real-provider failure is an error, never silently simulated.
* The model never touches the database. It calls a fixed registry of authorized, read-only tools bound to the session user, with strict argument schemas and size-capped results. Every call is audited.
* Schedule changes are *proposals* (`AIPendingAction`, 30-minute expiry); only an authenticated user request confirms them, through the normal validation path.
* Cost awareness: rolling 24 h message cap, per-minute throttle, token and estimated-cost accounting per reply.

**Consequences.** (+) The blast radius of a misbehaving or prompt-injected model is "ask for read-only summaries and propose something the user can decline". (-) The live provider path was type-checked but not exercised without an API key (see `docs/IMPLEMENTATION_STATUS.md`).
