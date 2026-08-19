# `fix/fritz-score-toast-sticky` Audit (vs name)

## 1) What this branch actually is (scope)

Despite the name, `fix/fritz-score-toast-sticky` is **not** limited to UI “score toast stickiness”.
It bundles a much wider set of work, including:

- **Daily Fritz verifier hardening**: adds protocol-2 “official Fritz recovery” logic so resumed clients can safely persist an omitted Fritz turn before replaying the player’s next submitted action.
- **Fritz Challenge “transactional authority” backend**: introduces a new server route module (`server/src/http/routes/fritzChallenges.ts`) and a command-based authority/store pattern for verified hands/games.
- **New Fritz Challenge database primitives + canonical telemetry**: multiple Supabase migrations add revisioned attempt operations, immutability triggers, verified hand/game receipts, an outbox, and analytics event projection.
- **Daily Puzzle schema widening**: changes slot-domain constraints so the system can publish five-slot, equal-value puzzles.
- **Game-core review contract + replay corpus**: `@racehorse/game-core` is updated to support the newer review contract/fixture corpus used by the above verification flows.

So the “toast sticky” part is either a tiny subset or a side-effect/label, while the branch’s real center of gravity is **verification + authority + related schema changes**.

## 2) Supabase migrations included (every file)

The branch includes **exactly three** migration SQL files:

### `supabase/migrations/2026-08-02_fritz_challenge_authority_primitives.sql`

Plain-English summary:

- Adds **revisioning** columns to `public.fritz_challenge_attempts` (`revision`, plus an `authority_schema_version`) so attempt state transitions can be made safely and idempotently.
- Adds an index for active attempts by `(id, revision)`.
- Adds **immutability enforcement triggers**:
  - Prevents the published “fairness contract” of a Fritz challenge from being silently changed after creation.
  - Prevents hands in `public.fritz_challenge_hands` from being modified after creation.
- Creates multiple new “authority” tables:
  - `public.fritz_challenge_attempt_operations`: idempotent command ledger for authority commands (start, accept verified hand, record verified game, finalize attempt), including request digests and conflict handling.
  - `public.fritz_challenge_verified_hands`: stores per-hand verified receipts (scores, transcript digest, verifier version, receipt json).
  - `public.fritz_challenge_verified_games`: stores per-game verified receipts (score/result digest, action counts, hands played, etc.).
  - `public.fritz_challenge_outbox`: an outbox for authority events to be delivered/projected later.
- Adds SQL functions that implement the authority model:
  - `public.start_fritz_challenge_attempt_command(...)`: serializes attempt start and creates the initial attempt + outbox event.
  - `public.commit_fritz_challenge_attempt_command(...)`: applies revisioned state transitions, inserts verified receipts when provided, and writes/ensures outbox delivery.
- Enables RLS on new tables and explicitly denies client access (service role performs authority actions).

### `supabase/migrations/2026-08-02_fritz_challenge_canonical_telemetry.sql`

Plain-English summary:

- Introduces `public.fritz_challenge_events`, a canonical event table intended for analytics.
- Adds an `analytics_projected_at` timestamp column to `public.fritz_challenge_outbox` so projection can be observed.
- Adds a projection function `public.project_fritz_challenge_outbox_event()`:
  - Reads outbox rows and creates/updates the corresponding analytics event rows.
  - Copies a normalized `revision`, `gameNumber`, `handIndex`, etc. out of the JSON payload.
  - Uses an idempotency key so retries do not duplicate events.
- Creates two analytic views:
  - `public.fritz_challenge_funnel_metrics` (counts by `challenge_id` + `event_type`).
  - `public.fritz_challenge_failure_metrics` (counts by failure/recovery/verifier code/status).
- Enables RLS for the event/metrics surfaces (client access remains restricted).

### `supabase/migrations/2026-08-06_daily_puzzle_five_slot_ladder.sql`

Plain-English summary:

- Updates constraints so the daily puzzle ladder can safely use **slot indices 1 through 5**:
  - `public.daily_puzzles.slot_index` now checks `between 1 and 5`
  - `public.daily_puzzle_attempts.current_slot_index` now checks `between 1 and 5`
  - `public.daily_puzzle_slot_results.slot_index` now checks `between 1 and 5`
- Drops and re-adds constraints so the widening is deterministic; existing rows remain intact, only future/validated data expands to include slot 4 and 5.

## 3) Verifier logic changes (and where)

Changed verifier-related files:

- `server/src/dailyFritzVerifier.ts`
  - Adds a dedicated helper (`applyOmittedOfficialFritzTurn`) used when replaying transcripts for resumed/protocol-2 clients.
  - Specifically recovers **exactly one** omitted “official Fritz turn” when the verifier detects that the authoritative state expects Fritz but the transcript’s next action is attributed to `player`.
  - Improves `wrong_actor` error reporting to include action/state sequence details.
- `server/src/dailyFritzVerifier.test.ts`
  - Updates/extends tests around the updated recovery + error behavior (minor diff size).

## 4) Challenge authority route changes (and where)

Changed challenge-authority-related files:

- `server/src/http/routes/fritzChallenges.ts`
  - New route module implementing the Fritz Challenge API surface (the authoritative/verified flow).
  - Uses the transactional authority command pattern by wiring server handlers to:
    - `startFritzChallengeAttemptCommand(...)`
    - `commitFritzChallengeAttemptCommand(...)`
  - Includes centralized error mapping for both Fritz Challenge and Daily Fritz verification errors.
  - Produces API views for challenge + attempt state, including revision/current pointers.
- `server/src/http/routes/dailyFritz.ts`
  - Small integration change (diff is small, but present) to align daily Fritz verification behavior/protocol handling with the updated verifier logic.
- `server/src/http/routes/fritzChallenges.lifecycle.test.ts`
  - Adds/updates lifecycle tests for challenge/attempt correctness.
- `server/src/http/routes/fritzChallenges.test.ts`
  - Adds/updates tests around verified set completion.

## 5) Is the branch based on current `main`? How divergent?

Computed from git:

- `git merge-base main fix/fritz-score-toast-sticky` => `74c5bc6d5c14b03ef83770f6a4730eb61a79b017`
- Commit divergence (`git rev-list --left-right --count main...fix/fritz-score-toast-sticky`) => **206** commits only-on-`main` vs **23** commits only-on-`fix/fritz-score-toast-sticky`.

Practical conflict-risk assessment:

- The branch diverges by **~23 unique commits**, and it touches multiple major systems (verifier, authority routes, client review plumbing, plus Supabase migrations).
- However, relative to `feat/daily-fritz-platform-phase1`, there is **no file overlap** in the changed file sets (intersection count = 0). That strongly suggests that **merging into the current `main` (after the phase1 merge) is unlikely to require major manual conflict resolution**.

## 6) Recommendation

Recommendation: **needs my explicit review of the migrations first** (and ideally splitting).

Rationale:

- The migrations add new tables/functions/triggers and revisioned authority command processing. That is the highest-risk area (schema + function semantics).
- The branch also includes verifier recovery logic and new challenge routes, so review should be done in layers:
  - Verify migration correctness and rollout approach first.
  - Then confirm server routes/command wiring matches those primitives.
  - Finally, verify client behavior and end-to-end verification flows.

If you want to merge confidently with less risk, splitting this branch into (at least) two PRs would help:

1. **Supabase schema/functions migrations** (authority primitives + telemetry + daily puzzle five-slot constraints).
2. **Server route + verifier recovery integration** that uses those primitives.

