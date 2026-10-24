# Ghost mixed-version compatibility (pre-contract NEW)

## Problem
The approved rollout deploys NEW before `2026-10-13_ghost_user_match_uniqueness.sql` (Ghost contract). Until then the
legacy global `ghost_games_match_id_unique` still exists. Multiplayer completion writes one Ghost row per account seat
under the same `matchId`; the SECOND account hit `23505` on that constraint inside `complete_ghost_rating_v2`, which
aborted the whole completion (foreground and terminal recovery alike). It reproduced against the owned PostgreSQL
instance with the two-account RPC sequence (seat A ok, seat B `ghost_games_match_id_unique`).

## Design
* Core multiplayer completion (ranked rows, Glicko, matches, archive, activity, room finalization) never depends on a
  Ghost side effect succeeding for the second seat.
* `complete_ghost_rating_v2` (replaced by `2026-10-15_ghost_precontract_deferral.sql`) catches ONLY a `unique_violation`
  whose constraint is exactly `ghost_games_match_id_unique` AND where another user already holds the match's row. In the
  same transaction it inserts the seat into `ghost_deferred_completions` (PK `(user_id, match_id)`, stores scores,
  move log, mode, opponent rating, apply flag) and returns `{"status":"deferred_legacy_match_uniqueness"}`. Every other
  error is re-raised unchanged (invalid input, `ghost_match_conflict`, a different constraint, network, auth).
* `completeGhostGame` surfaces `ghostDeferred: true` (no style/profile reads). The solo `/api/ghost/complete` route treats
  it as unreachable and throws rather than store a non-result.
* Durable owner: `ghost_deferred_completions`. The seat's move log exists nowhere else once the room finalizes, so the
  existing sources were not sufficient (the live room row is deleted when the core completion is logged, and a rematch
  overwrites it). Created in the same transaction as the deferral, so completed seats + deferred seats always equal the
  expected authenticated Ghost seats.
* Drain (`server/src/ghost/deferredGhostCompletion.ts`): boot +30 s then every 15 min, process-lifecycle owned, single
  flight. One GET per sweep; if rows exist it replays the first through the same idempotent RPC. While the constraint
  exists that returns the typed deferral again and the sweep stops: 2 requests per interval, no row touched, no attempt
  burned, no catalog polling. After the contract each replay completes (receipt per `(user, match)`), rebuilds the style
  profile, and deletes the row. Deterministic RPC rejections (400/409/422) count; 10 attempts quarantine the row (kept,
  visible). Infrastructure errors, a closed rating gate and process shutdown stop the sweep without spending attempts.
* BRIDGE: the migration adds a table and replaces a NEW-only RPC. BRIDGE does not call it; its legacy writers are still
  fenced (`ghost_legacy_writer_fenced`) and its `on_conflict=match_id` arbiter still resolves pre-contract.

## Rollout
Apply as expand step 6 (after the Ghost expand, before NEW). After the Ghost contract, drain deferred seats to zero and
verify no `(user_id, match_id)` duplicates (queries in `docs/ops/senior-audit-rating-rush-cutover.md`, Step 8.3).
