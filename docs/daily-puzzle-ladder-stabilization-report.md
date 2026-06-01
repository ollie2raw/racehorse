# Daily Puzzle Ladder stabilization report

## What changed

### setVersion binding (server)

- Added `listDailyPuzzleSlotsForDateAndVersion(runDate, setVersion)` to load published slots for a specific ladder set.
- `/api/daily-puzzle/start`, `/api/daily-puzzle/submit-slot`, and active-slot resolution now use **`attempt.setVersion`**, not the latest ready set for the day.
- New helpers in `server/src/dailyPuzzle.ts`:
  - `findLadderSlotsForAttemptSet` — playable triple for one set version
  - `resolveActiveSlotForAttempt` — resume next unsubmitted slot (or review slot when completed)
  - `isDailyPuzzleAttemptFinalizeReady` — three slot results but `status === 'started'`

### Finalize recovery (server + client)

- `/api/daily-puzzle/today` and `/api/daily-puzzle/start` expose `finalizeReady` when an attempt has three slot results but is not completed.
- `/api/daily-puzzle/today` returns `attemptSlots` (the attempt’s set version) so practice/review boards stay correct after a newer set is published.
- `/api/daily-puzzle/complete` remains idempotent (`replayed: true` when already completed).
- Client hub auto-calls finalize once on re-entry when `finalizeReady`, shows **Finalize Run**, and retries finalize if slot 3 submit succeeds but `/complete` fails.

## Why it was needed

1. **setVersion drift** — In-flight attempts stored `set_version` at create time, but submit/start validated puzzles against the **current** ready ladder. Publishing a new set mid-run could reject valid submits or resume the wrong slot.
2. **Slot 3 / complete split** — Slot results could persist while `/complete` failed, leaving `status: started` with three results and no review/leaderboard unlock.

## Files changed

| File | Change |
|------|--------|
| `server/src/dailyPuzzle.ts` | Version-bound ladder helpers, finalize-ready detection, active-slot resolver |
| `server/src/index.ts` | Version-scoped slot loading; start/submit/today wired to attempt `setVersion`; `finalizeReady` flags |
| `server/src/dailyPuzzleLadderStabilization.test.ts` | Targeted unit tests |
| `client/src/dailyPuzzle/types.ts` | Optional `finalizeReady`; nullable `nextAvailableSlotIndex` on start |
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | Auto/manual finalize, improved error recovery after slot 3 |
| `docs/daily-puzzle-ladder-stabilization-report.md` | This report |

## Tests added

`server/src/dailyPuzzleLadderStabilization.test.ts` (maps to required cases):

| Required case | Test |
|---------------|------|
| 1. Submit against set A when set B exists | `keeps submit validation on attempt setVersion when a newer ready set exists` |
| 2. Slot 3 scored, complete failed → finalize on re-entry | `marks finalize-ready when three slot results exist but status is still started` (+ client auto/manual finalize) |
| 3. Duplicate submit-slot idempotent | `keeps duplicate submit idempotent at the attempt snapshot level` (+ server `replayed: true` branch) |
| 4. Duplicate complete idempotent | `treats duplicate complete as idempotent via completed status` (+ server `replayed: true`) |
| 5. Completed run unlocks review/practice | `unlocks review mode after a completed run` (+ `attemptSlots` on `/today`) |

Also: `resumes the next unsubmitted slot for an in-flight attempt` (start/resume binding).

Run: `npm test --prefix server -- dailyPuzzleLadderStabilization`

## Remaining risks

- **DB uniqueness** — Duplicate slot rows still depend on DB constraints and the existing idempotent submit branch; no new unique index was added.
- **Orphan set versions** — If all three puzzles for an attempt’s `set_version` are unpublished/removed, submit returns 409; there is no migration to a newer set.
- **Client raw scores** — Server still trusts client `rawScore` for awarded points (unchanged; out of scope).
- **Auto-finalize UX** — Hub auto-finalizes once on load; a network failure still requires tapping **Finalize Run**.

## Manual QA checklist

- [ ] Start ladder on set A; publish set B (staging); finish slot 2 on A — submit succeeds, active slot is A’s slot 3.
- [ ] Complete all three slots; kill network before `/complete`; reload hub — run finalizes or **Finalize Run** completes and unlocks review.
- [ ] Tap **Finalize Run** twice — second call is idempotent, no duplicate leaderboard side effects.
- [ ] Re-submit same slot — same `awardedPoints`, `replayed: true`, no extra rows.
- [ ] After completed run — **Practice Mode** opens slots; review path works when `reviewUnlocked`.
- [ ] Leaderboard rank appears after successful finalize.
