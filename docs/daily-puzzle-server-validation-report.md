# Daily Puzzle Server Validation Report

Date: 2026-06-02  
Source docs: `docs/mass-production-readiness-audit.md`, `docs/p0-security-abuse-stabilization-plan.md`  
Scope: Daily Puzzle Ladder submit/complete scoring authority only. No UI redesign, puzzle rule changes, Daily Fritz, multiplayer, tournament, or Fritz AI changes.

## Executive Verdict

Daily Puzzle Ladder scoring is no longer blindly client-trusted for the normal slot submit path.

`/api/daily-puzzle/submit-slot` still accepts the same payload shape for compatibility, but leaderboard-impacting fields are now derived by replaying `submittedLine` through the server game engine against the slot's stored starting board and starting hand.

This is a meaningful public-beta hardening step. It rejects impossible/duplicate/illegal tile lines and ignores forged high client scores. It is not yet a full high-stakes anti-cheat system because timing is not server-authoritative and the server does not yet persist a full per-move proof transcript beyond the canonicalized submitted line.

## Flow Audit

### `/api/daily-puzzle/start`

Current posture:

- Requires authenticated user.
- Resolves the requested run date.
- Loads/publishes Daily Puzzle slots for that date.
- Creates or replays an attempt for the authenticated user.
- Binds the attempt to the ready slot `setVersion`.
- Returns the active slot from the attempt's bound version.

Assessment: mostly sound for attempt ownership, date binding, set-version binding, and active-slot recovery.

### `/api/daily-puzzle/submit-slot`

Before this pass:

- Required authenticated user.
- Loaded attempt by `attemptId` and authenticated user.
- Verified `puzzleDate` matches attempt.
- Rejected already completed attempts.
- Kept duplicate submit idempotent by returning the existing slot result.
- Enforced slot order through `attempt.currentSlotIndex`.
- Loaded slots for the attempt's `setVersion`.
- Required `puzzleId` to match the active slot in the attempt's version.
- Trusted client `rawScore`, `movesUsed`, `elapsedSeconds`, `submittedLine`, and `clientResult` for slot-result persistence.
- Derived `awardedPoints`, `solved`, and `perfect` from client `rawScore`.

After this pass:

- Existing ownership, date, order, set-version, and duplicate-submit behavior remains.
- `submittedLine` is replayed on the server from stored `startingBoard` and `startingHand`.
- Submitted tiles must exist in the starting hand.
- Submitted tiles cannot be used more times than they exist in the starting hand.
- Every placement must be a legal server-engine play against canonical open ends.
- The submitted line cannot continue after the player's turn ends.
- `rawScore` is recomputed from server state.
- `movesUsed` is recomputed from accepted placements.
- `solved` and `perfect` are server-derived.
- `elapsedSeconds` is clamped to `0..86400` and remains UX/telemetry only.
- Client `rawScore`, `movesUsed`, `clientResult`, and elapsed timing are not used as competitive scoring authority.

### `/api/daily-puzzle/complete`

Current posture:

- Requires authenticated user.
- Loads attempt by authenticated user.
- Verifies date matches attempt.
- Requires three slot results before completion.
- Is idempotent for already completed attempts.
- Builds leaderboard from persisted attempt totals.

Assessment: completion is only as trustworthy as persisted slot results. This pass improves that dependency by making new slot results server-scored.

## Server Source Of Truth

Implemented in `server/src/dailyPuzzleSubmissionValidation.ts`:

- Rebuilds a one-player puzzle `GameState` from the stored slot board and hand.
- Uses server `getLegalMoves` and `applyMove` to validate and replay each submitted placement.
- Canonicalizes the stored submitted line with server-derived `pointsAwarded` and `totalScore`.
- Recomputes `rawScore` from the server player's score.
- Recomputes `movesUsed` from accepted placements.
- Derives `solved` and `perfect`.
- Clamps `elapsedSeconds`.

Client fields now treated as UX-only for scoring:

- `rawScore`
- `movesUsed`
- `clientResult`
- client solved/perfect status
- `elapsedSeconds`

## Tests Added

Added `server/src/dailyPuzzleSubmissionValidation.test.ts`:

- Fake high `rawScore` is ignored and server score is recomputed.
- Illegal tile not in starting hand is rejected.
- Duplicate tile use is rejected.
- Legal submitted line scores correctly through the server engine.
- Illegal placement using a real hand tile is rejected.
- `elapsedSeconds` is bounded and does not affect score authority.

Existing `server/src/dailyPuzzleLadderStabilization.test.ts` continues to cover:

- Attempt `setVersion` binding.
- Slot 3 finalize-ready recovery.
- Duplicate complete idempotency.
- Duplicate submit snapshot idempotency.
- Next-slot resume behavior.

## Remaining Anti-Cheat Gaps

Remaining public-beta risks:

- Server timing is not authoritative. `elapsedSeconds` is bounded but still client-reported.
- Duplicate/idempotency guarantees still depend partly on application logic; database uniqueness constraints should be audited for slot results and attempts.
- The server does not yet persist a full replay proof object with starting state hash, move hashes, and validation version.
- Puzzle objective handling is currently score replay based. If future objectives become more complex than score/max-move/turn-flow, add objective-specific server validators.
- Historical leaderboard rows submitted before this change may contain client-trusted scores unless backfilled or invalidated.
- Multi-instance deployments would still need shared rate limits and database-level idempotency.

## Public Leaderboard Readiness

Daily Puzzle is now safer for a controlled public beta leaderboard because obvious score spoofing through `rawScore`, impossible tiles, duplicate tiles, and illegal placements is blocked or ignored for new submissions.

It is not yet appropriate for high-stakes prizes or adversarial public competition until server timing, DB constraints, historical row posture, replay proofing, and operational monitoring are completed.

## Recommended Next Prompt

```text
Proceed with a Daily Puzzle leaderboard integrity hardening pass.

Do not change UI or puzzle rules. Add database-level/idempotency safeguards and a historical-row audit plan for Daily Puzzle slot results and attempts. Verify unique constraints for attempt/user/date, slot result attempt/slot, and completion finalization. Add tests or migration notes proving duplicate submit/complete cannot create duplicate leaderboard points even under retry/concurrency.
```
