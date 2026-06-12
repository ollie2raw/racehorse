# Daily Loop Trust UX Audit

## Executive Verdict

Daily Fritz had a confirmed P0 trust bug: the client could reopen the same deterministic hand while resetting the visible game score to `0-0`, producing an invalid resume state that looked legitimate. That bug came from partial local resume, not from Racehorse scoring rules.

Daily Puzzle is materially safer today. Its slot progression, validation, duplicate handling, and leaderboard posture are server-driven. The main remaining trust risk is still the split `submit-slot` -> `complete` finalization path on slot 3, but the existing stabilization tests are passing and no new P0 was confirmed in this pass.

### Verdict

- Daily Fritz before patch: `P0 launch blocker`
- Daily Fritz after patch: `beta-acceptable with remaining P1 resume/recovery work`
- Daily Puzzle in this pass: `beta-acceptable with follow-up hardening still warranted`

## Daily Fritz Bug Reproduction

### Scenario `DF-P0-01`

1. Start Daily Fritz.
2. Play far enough to change the live game score away from `0-0`.
3. Leave the mode or navigate away before the Daily Fritz client snapshot is durably written.
4. Return later and resume today's set.
5. The server reissues the same deterministic hand via `run_date + current_game_number + current_hand_index`.
6. The client may reopen that hand with a fresh `BotMatchState`, causing the score to show `0-0`.

### Expected

If the same hand resumes, the score, board, racks, boneyard, turn, and move history must resume from the same state.

### Observed

The client could reopen the same hand/deal while showing reset scores, which invalidates gameplay trust and daily result integrity.

### Classification

`P0 Trust / Gameplay Integrity`

## Daily Fritz State Model

### Identity

- Today's daily set is identified by `run_date`.
- The player attempt is identified by `daily_fritz_attempts.id` (`attempt_id` on the client).
- Game 1 / 2 / 3 are identified by `current_game_number` plus the set result payload.
- Each deterministic hand is identified by:
  - `run_date`
  - `current_game_number`
  - `current_hand_index`

### Server-persisted state

Server persistence lives in `daily_fritz_attempts` and stores:

- attempt `id`
- `run_date`
- `user_id`
- `status`
- `current_hand_index`
- `verified_match_id`
- final `result` / `set_result`
- final scoring fields after completion

The server does **not** persist the full in-progress hand state. It does not store:

- current board
- current live game score
- current racks
- boneyard order
- current turn
- move log

### Client-persisted state

`BotMatchScreen` keeps the full in-progress Daily Fritz snapshot:

- `attemptId`
- `currentHandIndex`
- `match` (`BotMatchState`)
- `movesUsed`
- `moveLog`

This snapshot is keyed by:

- `racehorse:daily-fritz:v2:${attempt_id}:game:${current_game_number}`

### Deterministic state

The server can regenerate a hand from:

- `run_date`
- `current_game_number`
- `current_hand_index`

That guarantees the same deal, but not the same live match state inside a partially played hand.

### Before patch

- Daily Fritz snapshot writes were stored in `sessionStorage`.
- Writes were debounced.
- `pagehide` flushed pending state.
- Normal React unmount/navigation cleared the timer without flushing.

That created the trust bug: the client could lose the exact score/board snapshot while the server still resumed the same deterministic hand index.

### After patch

- The in-progress Daily Fritz snapshot is durably written to `localStorage`.
- Pending writes are flushed on normal effect cleanup as well as `pagehide`.
- Old `sessionStorage` snapshots migrate forward automatically.
- If the client tries to resume a started hand without a recoverable exact snapshot, the resume is blocked and converted into an explicit recovery flow instead of a fake continuation.

## Daily Fritz State Flow Diagram

```text
Start Daily Fritz
-> GET /api/daily-fritz/today
-> UI shows none / started / completed state

Begin Game 1
-> POST /api/daily-fritz/start
-> server returns attempt_id, verified_match_id, current_hand_index, current_game_number, first_hand
-> BotMatchScreen opens
-> local client persists full in-progress snapshot

Mid-hand reload / leave
-> client writes snapshot to localStorage

Resume
-> POST /api/daily-fritz/start
-> if exact local snapshot exists for attempt_id + game + hand_index:
   -> restore full BotMatchState
-> else if resume would be unsafe:
   -> block fake resume
   -> show recovery-required state
   -> allow explicit restart of today's set

Hand end
-> POST /api/daily-fritz/next-hand
-> server advances current_hand_index
-> client applies next deterministic hand

Game end
-> POST /api/daily-fritz/record-game
-> server updates set_result
-> client shows between-game or final overlay

Game 2 / Game 3
-> POST /api/daily-fritz/start
-> server returns new current_game_number and first hand for that game
-> client resumes fresh game or between-game continuation

Set end
-> POST /api/daily-fritz/complete
-> completion hash verified
-> attempt status -> completed
-> verified match finalized

Leaderboard update
-> /api/daily-fritz/leaderboard/:date reads completed attempts only
```

## Daily Puzzle State Model

### Identity

- Today's puzzle ladder is keyed by `runDate`.
- Content version is bound by `setVersion`.
- Player attempt is persisted in `daily_puzzle_attempts`.
- Each slot result is persisted in `daily_puzzle_slot_results`.

### Server-driven progression

Daily Puzzle is substantially more authoritative than Daily Fritz:

- slot order is enforced server-side
- slot validation/replay is server-side
- duplicate slot submit returns existing result cleanly
- solved/perfect scoring is server-derived
- attempt completion is server-side

### Client flow

```text
Load today's ladder
-> GET /api/daily-puzzle/today

Start / resume attempt
-> POST /api/daily-puzzle/start
-> server returns attempt + bound version slots

Finish slot
-> POST /api/daily-puzzle/submit-slot
-> server validates replay and persists slot result
-> client unlocks next slot or marks finalizeReady

Complete ladder
-> POST /api/daily-puzzle/complete
-> server marks attempt completed
-> leaderboard/result should reflect completed server attempt
```

### Trust posture

Strong:

- server-side validation
- duplicate-submit handling
- ordered slot progression
- attempt uniqueness

Remaining risk:

- slot 3 completion still depends on a follow-up finalize call
- reload/failure between `submit-slot` and `complete` remains a trust-sensitive edge

## Findings

### P0

1. **Daily Fritz could reopen the same hand with reset scores.**
   - Root cause: partial client snapshot persistence plus deterministic server hand regeneration.
   - Status: fixed in this pass.

### P1

1. **Daily Fritz cross-device resume is not a true continuation.**
   - The server still cannot reconstruct a live in-progress hand without the local snapshot.
   - This is now handled honestly by blocking unsafe resume and requiring explicit restart, but it is still a UX cost for a hero mode.

2. **Daily Fritz recovery state still needs stronger product copy.**
   - The recovery path is now honest, but it is still operational rather than premium.

3. **Daily Puzzle slot 3 finalization remains a split-step trust surface.**
   - Current tests pass, but the architecture still depends on a second completion request after the third slot result.

### P2

1. **Daily Fritz save/sync messaging is still subtle.**
   - The mode is safer now, but it still does not strongly communicate local resume versus server-recorded progress.

2. **Daily Puzzle pending/finalize language can still be clearer when the final score is not yet fully completed.**

## Fixes Applied

### Daily Fritz

1. **Durable in-progress snapshot persistence**
   - Moved Daily Fritz in-progress state persistence from fragile `sessionStorage` writes to durable `localStorage`.
   - Added migration so old session snapshots still restore once and get upgraded.

2. **Flush on normal navigation**
   - Pending Daily Fritz snapshot writes now flush on effect cleanup, not only on `pagehide`.
   - This closes the exact gap that let a player leave via normal app navigation and lose the latest score/board state.

3. **Unsafe resume guard**
   - When the server says an attempt is started but the client does not have the exact local snapshot required to restore that hand honestly, the app no longer fabricates a valid-looking resume.
   - Instead it shows a recovery-required state and offers an explicit restart path.

4. **Explicit restart recovery**
   - The player can intentionally abandon the unrecoverable started attempt and start today's set again from a clean state.

## Before / After Behavior

### Before

- Same deterministic hand could reopen with `0-0` scores.
- Client state could drift from the server-visible attempt phase.
- Resume looked valid when it was not.

### After

- Same-browser leave/reopen preserves the full local Daily Fritz snapshot much more reliably.
- Old session snapshots are migrated forward.
- If exact state cannot be recovered, the mode no longer pretends the hand is valid.

## QA Matrix

### Daily Fritz

- `DF-01` Start today's set
- `DF-02` Reload immediately after start
- `DF-03` Score points, reload, verify score persists
- `DF-04` Draw, reload, verify boneyard/rack/turn persists
- `DF-05` Reload on Fritz turn
- `DF-06` Reload during hand-end modal
- `DF-07` Reload during game-end modal
- `DF-08` Win Game 1, leave, resume Game 2
- `DF-09` Lose Game 1, leave, resume Game 2
- `DF-10` Game 1 skunk win ends set correctly
- `DF-11` Game 1 skunk loss ends set correctly
- `DF-12` Game 3 skunk metadata only
- `DF-13` Duplicate set completion submit
- `DF-14` Result save failure recovery
- `DF-15` Signed-out behavior
- `DF-16` New day does not resume yesterday's state

### Daily Puzzle

- `DP-01` Load today's ladder
- `DP-02` Solve slot 1, reload, slot 2 available
- `DP-03` Solve slot 2, reload, slot 3 available
- `DP-04` Solve slot 3, final result saved
- `DP-05` Duplicate submit slot
- `DP-06` Reload after submit before ack
- `DP-07` Failed submit recovery
- `DP-08` Completed day reload
- `DP-09` Leaderboard/result pending copy
- `DP-10` Stale `setVersion` / new day behavior

## Tests Added

### Client

- `client/src/dailyFritz/storage.behaviorTests.ts`
  - valid local snapshot loads
  - session fallback snapshot migrates to local storage
  - mismatched hand index cannot resume
  - unsafe Game 1 resume without snapshot is blocked
  - between-game resume remains allowed

### Existing server trust checks rerun

- `dailyFritzSkunk.test.ts`
- `dailyPuzzleLadderStabilization.test.ts`
- `dailyPuzzleSubmissionValidation.test.ts`

## Validation Results

- `npm run test:daily-fritz --prefix client` passed
- `npm test --prefix server -- dailyFritzSkunk dailyPuzzleLadderStabilization dailyPuzzleSubmissionValidation` passed
- `npm run build --prefix client` passed

## Daily Fritz Browser Resume QA (2026-06-04, updated)

Full report: [daily-fritz-browser-resume-qa-report.md](./daily-fritz-browser-resume-qa-report.md)

Harness: `npm run qa:daily-fritz:resume --prefix client`  
QA reset: `ENABLE_QA_DAILY_FRITZ_RESET=1` + `npm run qa:daily-fritz:reset --prefix server` or harness preflight `POST /api/daily-fritz/qa-reset`

| Scenario | Status | Notes |
| --- | --- | --- |
| DF-03 | **Passed** | Scored-hand reload resume preserved 1-0 (preview build, post QA reset) |
| DF-04 | Blocked | Draw-state persistence needs extended gameplay automation |
| DF-05 | Blocked | Fritz-turn reload not reached in this pass |
| DF-06 | Blocked | Hand-end modal timing not in pass |
| DF-07 | Blocked | Game-end modal timing not in pass |
| DF-08 | Blocked | Game 1 win + Game 2 resume not in pass |
| DF-09 | Blocked | Game 1 loss + Game 2 resume not in pass |
| Unsafe resume guard | **Passed** | DF-GUARD: snapshot delete blocks fake resume in browser |
| Recovery copy | **Passed** | DF-COPY: recovery/restart strings on blocked path |
| DF-DATE / stale day | **Passed** | Hub date June 3, 2026 consistent |

**Verdict:** P0 trust surfaces **DF-03 + unsafe-resume guard confirmed in browser** after QA reset unblock. DF-04–DF-09 remain automation-blocked (not product regressions).

### Abandoned attempt UX (2026-06-03)

| Item | Status |
| --- | --- |
| Hub detects `attempt_status: abandoned` | **Fixed** — no Play/Resume CTA; status **Abandoned** / **Set Locked** |
| `/start` 409 `status: abandoned` parsing | **Fixed** — `DailyFritzApiError` + dedicated notice (not generic "Please try again.") |
| Primary copy | "Today's set was already abandoned on this account." |
| Secondary copy | "Come back tomorrow for a fresh Daily Fritz set." |
| QA/dev hint | Shown when `import.meta.env.DEV` or `VITE_DEBUG_DAILY_FRITZ` |
| Browser resume QA on locked abandoned user | **Still blocked without qa-reset**; **unblocked** after `POST /api/daily-fritz/qa-reset` preflight |

## Files Changed

- `client/src/bot/BotMatchScreen.tsx`
- `client/src/dailyFritz/DailyFritzScreen.tsx`
- `client/src/dailyFritz/dailyFritzErrors.ts`
- `client/src/dailyFritz/dailyFritzErrors.behaviorTests.ts`
- `client/src/dailyFritz/api.ts`
- `client/src/dailyFritz/dailyFritz.css`
- `client/src/dailyFritz/storage.ts`
- `client/src/dailyFritz/storage.behaviorTests.ts`
- `client/package.json`

## Remaining Risks

1. **Daily Fritz still lacks authoritative server-side in-progress hand persistence.**
   - The trust bug is fixed for honest resume behavior, but cross-device continuity still depends on future server-side snapshotting if true anywhere-resume is a product requirement.

2. **Daily Puzzle slot-3 finalize remains a two-step completion path.**
   - The current stabilization is good, but this is still the most important Daily Puzzle trust surface to watch.

3. **Daily Fritz recovery UX is correct but not yet premium.**
   - It protects integrity first. The messaging and restart affordance can be polished later.

## Next Patch Recommendation

1. Extend browser resume QA for DF-04–DF-09 with deterministic gameplay seed or longer-play harness segments.
2. If resume works cleanly in-browser, the next most valuable daily-loop patch is Daily Puzzle finalization UX and retry clarity around slot 3.
