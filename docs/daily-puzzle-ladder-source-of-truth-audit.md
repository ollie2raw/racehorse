# Daily Puzzle Ladder Source-of-Truth Audit

Date: 2026-05-31  
Scope: Read-only audit of current Daily Puzzle Ladder loop (no logic changes)

> **Update 2026-08-20 — mostly accurate again, with two carve-outs.**
>
> Between 2026-08-06 (`a4f9693`) and 2026-08-20 the ladder published **five**
> slots, so every "3 slots" statement below was wrong for that window. The
> ladder is back to three slots (`DAILY_PUZZLE_SLOT_COUNT = 3`) and those
> statements hold again for new days. Still needs work:
>
> 1. **Archive days are not covered here.** Days published between 2026-08-06
>    and 2026-08-20 have five slots, and attempts bound to those set versions
>    resolve, submit, and finalize at *five*, not three. The count-based gates
>    take the attempt's own ladder length; `MAX_DAILY_PUZZLE_SLOT_COUNT = 5` is
>    the upper bound, and the database check constraints remain `between 1 and 5`.
> 2. **§4 is stale on file layout** (unrelated to slot count): the endpoints
>    listed as "All in `server/src/index.ts`" now live in
>    `server/src/http/routes/dailyPuzzle.ts` with storage in
>    `server/src/http/stores/dailyPuzzleStore.ts`.
>
> `master_chain_score` is the final rung of the attempt's own ladder — slot 3 on
> new days, slot 5 on the archived five-slot days.

## 1) Main Files Involved

- Client
  - `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` (entry router: ladder vs legacy single-puzzle)
  - `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` (primary ladder loop UI + runtime + submit/finalize)
  - `client/src/dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx` (ladder leaderboard UI/filter/share)
  - `client/src/dailyPuzzle/api.ts` (HTTP client for ladder endpoints, plus legacy puzzle APIs)
  - `client/src/dailyPuzzle/types.ts` (ladder API contracts and domain types)
  - `client/src/dailyPuzzle/streakStorage.ts` (client local streak for display/share)
  - `client/src/dailyPuzzle/presentation.ts` (slot label mapping P1/P2/P3)
  - `client/src/dailyPuzzle/ladderShareCard.ts` (share payload formatting)
  - `client/src/App.tsx` (mode routing to `DailyPuzzleScreen`)
- Server
  - `server/src/index.ts` (all ladder API endpoints + DB I/O + warmup wiring)
  - `server/src/dailyPuzzle.ts` (normalization, readiness checks, scoring, leaderboard sorting)
  - `server/src/seedDailyPuzzleLadder.ts` (3-slot generation/upsert + warmup tooling)
  - `server/src/social/activityWriter.ts` (post-complete social activity writes)
- Database / schema
  - `supabase/daily_puzzle_ladder_v1.sql` (current ladder schema and RLS)
  - `supabase/daily_puzzle_v2.sql`, `supabase/daily_puzzle.sql` (legacy evolution context)

## 2) Current Intended User Loop

For "today" only:

1. Client opens Daily screen (`appMode === daily`).
2. `DailyPuzzleScreen` calls `GET /api/daily-puzzle/today`.
3. If server says ladder ready (`legacySinglePuzzleDay === false` and 3 slots), UI routes into `DailyPuzzleLadderScreen`.
4. User presses **Start/Resume Daily Ladder**.
5. Client calls `POST /api/daily-puzzle/start`.
6. Server returns existing or new attempt + active slot.
7. Client launches slot runtime with the slot board/hand.
8. On solve/fail, client calls `POST /api/daily-puzzle/submit-slot`.
9. If slot 1/2: server returns next slot; client shows slot result overlay and can launch next.
10. If slot 3: server returns `ladderCompleted=true`; client immediately calls `POST /api/daily-puzzle/complete`.
11. Complete response returns leaderboard rank/preview; client shows final overlay and unlocks review/practice mode.

Post-completion:

- Scored run is locked (one scored attempt per user/date).
- Practice runs are local-only (no slot submission).
- Leaderboard view can be opened from hub/final overlay.

## 3) Actual State Machine / Lifecycle

### 3.1 Entry routing state (client)

In `DailyPuzzleScreen`:

- `entryMode = checking` -> call `/today`
- transitions:
  - `ladder` when server returns 3-slot ladder day
  - `ladderPending` when ladder not fully publish-ready
  - `ladderCheckError` when `/today` fails
  - `legacy` for non-today date archive or non-ladder mode

Only `entryMode === ladder` renders `DailyPuzzleLadderScreen`.

### 3.2 Ladder runtime state (client)

In `DailyPuzzleLadderScreen`:

- Hub state:
  - `today`, `attempt`, `activeSlot=null`, `runtimeState=null`
- On start:
  - `handleStartScored()` -> `/start` -> sets `attempt` and launches `activeSlot`
- In-slot runtime:
  - `status: IN_PROGRESS -> SOLVED|FAILED` based on puzzle-type-specific checks
- Slot completion path:
  - `completeSlot()`:
    - practice mode: local overlay only
    - scored mode: `/submit-slot`
    - if `ladderCompleted`: then `/complete`
    - else show slot overlay with next-slot action
- Exit back to hub:
  - `exitPlayToHub()` clears active runtime and overlays

### 3.3 Server attempt state machine

`daily_puzzle_attempts.status` is `started | completed`.

- Start:
  - if no attempt row: create `started`, `current_slot_index=1`, `puzzles_completed=0`
  - else return existing
- Submit slot:
  - validates ownership/date/order/slot identity
  - persists slot result row (unique per attempt+slot)
  - updates attempt aggregate:
    - `puzzles_completed += 1`
    - `total_score += awarded_points`
    - `master_chain_score` set on slot 3
    - `current_slot_index = min(3, slot+1)`
  - returns `ladderCompleted` when 3 slots exist
- Complete:
  - requires 3 slot results
  - if already completed => replayed=true
  - else marks attempt completed, sets `review_unlocked=true`, stamps `completed_at`, stores `result.final`

## 4) API Endpoints Involved

All in `server/src/index.ts`:

- `GET /api/daily-puzzle/today`
  - Loads slots via `listDailyPuzzleSlotsForDateWithAutoSeed(runDate)`
  - Picks ready ladder set via `findReadyDailyPuzzleLadderSlots`
  - Returns: run date, setVersion, slots, attempt snapshot, leaderboard preview, `legacySinglePuzzleDay`
- `POST /api/daily-puzzle/start`
  - Auth required
  - Creates or reuses attempt
  - Returns active slot and practice mode
- `POST /api/daily-puzzle/submit-slot`
  - Auth required
  - Validates attempt/date/order/slot
  - Idempotent replay branch if slot already submitted
  - Persists slot result + updates attempt aggregate
- `POST /api/daily-puzzle/complete`
  - Auth required
  - Finalizes attempt when 3 slots present
  - Returns rank + leaderboard preview
- `GET /api/daily-puzzle/leaderboard`
  - Returns ranked rows for date
- Warmup/seeding:
  - `GET/POST /api/cron/daily-puzzle-ladder-warm` (authorized)

## 5) Database Tables / Fields Involved

Primary tables (from `daily_puzzle_ladder_v1.sql`):

- `daily_puzzles`
  - Key ladder fields: `puzzle_date`, `slot_index`, `slot_title`, `tier`, `slot_max_points`, `objective_type`, `objective_payload`, `set_version`, `published`
  - uniqueness: `(puzzle_date, slot_index, set_version)`
- `daily_puzzle_attempts`
  - one per user/date: unique `(puzzle_date, user_id)`
  - lifecycle fields: `status`, `set_version`, `current_slot_index`, `puzzles_completed`, `total_score`, `master_chain_score`, `review_unlocked`, `result`, timestamps
- `daily_puzzle_slot_results`
  - one per attempt/slot: unique `(attempt_id, slot_index)`
  - scoring fields: `raw_score`, `awarded_points`, `best_possible_score`, `slot_max_points`, `solved`, `perfect`, `moves_used`, `elapsed_seconds`, `submitted_line`, `result`

Secondary/related:

- `activity_feed` via `writePuzzleActivity` (on successful `/complete`, non-replayed)
- Legacy compatibility read path:
  - `daily_puzzle_completions` queried only for home summary fallback history

## 6) Timers / Effects / Refs / Local Storage / Session

### Client ladder screen (`DailyPuzzleLadderScreen`)

- Refs:
  - `startTimeRef` (elapsed seconds for submission)
  - `runningScoreRef` (one_turn_high_score accumulation)
  - `moveTraceRef` (submitted move trace payload)
  - `lastPlayedTimerRef` (tile highlight timeout)
- Timers:
  - tile flash reset (`setTimeout` 2200ms)
  - share toast reset (`setTimeout` 2000ms)
- Effects:
  - hand tile sizing on resize
  - no persistent runtime resume mechanism
- Storage:
  - none in ladder screen (attempt persistence is server-side only)

### Daily entry (`DailyPuzzleScreen`)

- Ladder check effect on mount/date change -> `/today`
- Non-ladder legacy mode still uses localStorage progress/cache/streak paths

## 7) Known Fragile Spots / Suspicious Logic

1. **Set version drift risk (high)**
   - Attempts store `setVersion`, but submit path resolves slots from current "ready" ladder and does not enforce `attempt.setVersion`.
   - If a new set version is published during the same date, an in-flight attempt can fail slot lookup (`id` mismatch) and become hard to continue.

2. **Finalize split across two calls (medium-high)**
   - Slot 3 submission and run finalization are separate endpoints.
   - If `/submit-slot` succeeds but `/complete` fails, attempt remains `started` with 3 results.
   - User may need to re-enter and trigger completion again; UX path is not explicit.

3. **Readiness fallback behavior (medium)**
   - `today` can return `legacySinglePuzzleDay=true` when 3-slot readiness fails (missing metadata, incomplete set, etc.).
   - Depending on deployment timing this can present pending states despite partially seeded rows.

4. **Client objective handling mismatch potential (medium)**
   - Ladder runtime only branches strongly on `puzzleType` with concrete logic tuned to one-turn/high-score and target-score flows.
   - `objectiveType/objectivePayload` are transported but not deeply interpreted client-side.

5. **Score acceptance trust model (medium)**
   - Server accepts client-provided `rawScore`, `movesUsed`, `elapsedSeconds`, `submittedLine` and computes awarded points from slot metadata.
   - No authoritative server replay of move validity in this endpoint.

6. **"Completed" start behavior is somewhat overloaded (low-medium)**
   - `/start` for completed attempt returns an active slot derived from completed slot length and sets practiceMode by `review_unlocked`.
   - Works for practice launch but can feel ambiguous as a "start scored" endpoint.

## 8) Where Loop Can Skip / Double-Submit / Fail Finalize / Show Stale

- **Double-submit protection**
  - Server checks existing slot result by slot index and returns `replayed: true` idempotent response.
  - DB unique `(attempt_id, slot_index)` is hard stop.
- **Can skip slot order?**
  - No; server enforces `slotIndex === attempt.currentSlotIndex`.
- **Can duplicate finalize?**
  - Yes safely; `/complete` returns `replayed=true` if already completed.
- **Can fail to finalize after solving all 3?**
  - Yes if `/complete` request errors after successful slot 3 submit. This is recoverable but fragile UX.
- **Can show stale leaderboard rank immediately?**
  - Possible eventual consistency window: leaderboard preview is read fresh, but user may see slight lag.
- **Can show stale ladder readiness**
  - Yes temporarily during generation/warmup windows (`ladderPending`).
- **Can get stuck on version mismatch**
  - Yes, if active attempt references older set slot IDs but server now selects newer ready set.

## 9) Differences Between Puzzle 1 / 2 / 3 Behavior

Server/data intent:

- P1: `quick_line`, lower slot max points (typically 150)
- P2: `tactical_setup`, medium max points (typically 250)
- P3: `master_chain`, highest max points (typically 400), contributes `master_chain_score`

Client behavior:

- Uses same core runtime engine for all slots.
- Completion UI labels differ by slot index via presentation helpers.
- P3 triggers ladder completion path:
  - `/submit-slot` returns `ladderCompleted=true`
  - client then calls `/complete`

Leaderboard impact:

- `puzzles_completed` + `total_score` + `master_chain_score` (tie-break weight on master chain).

## 10) Manual QA Cases To Run Before Fixing

### Core happy path

1. Start today ladder fresh (no attempt) and complete P1->P2->P3.
2. Verify slot overlays and next-slot transitions.
3. Verify final overlay appears after `/complete`, with rank and breakdown.

### Resume / reload / nav

4. Start P1, leave to home, return, ensure resume starts at correct slot and prior score state intact server-side.
5. Reload during P2 in-progress (before submit) and verify behavior (expected: runtime reset for slot; attempt still at same current slot).
6. Reload after P2 submitted but before tapping next; ensure re-entry resumes at P3.

### Idempotency / duplicate actions

7. Double-click submit path (rapid tile-end + network delay) and confirm only one slot result row.
8. Re-call `/complete` by revisiting completed run and ensure replayed complete behaves safely.

### Failure / pending paths

9. Simulate `/complete` failure after slot 3 submit; verify user can recover (re-enter and complete).
10. Force ladder pending day (not ready metadata) and verify `ladderPending` messaging/refresh behavior.

### Versioning / data consistency

11. Publish a new `set_version` for same date while a user has a started attempt; validate whether they can still submit old-slot IDs.
12. Validate `slot.bestPossibleScore` present/positive for all 3 slots; verify readiness gate.

### Leaderboard / stats / streak

13. Verify leaderboard ordering tie-breakers:
    - puzzles completed desc
    - total score desc
    - master chain score desc
    - completedAt asc
14. Verify activity feed writes on first completion only (not replay).
15. Verify streak display interactions (client local streak vs server-computed streak usage in share/activity).

---

## Recommended Next Stabilization Prompt Focus

If stabilization is next, highest-value first:

1. **Bind attempts to `setVersion` on submit/start** to prevent cross-version slot mismatch.
2. **Harden slot 3 finalize UX** so submit+complete behaves transactionally (or robust retry flow).
3. **Add targeted integration tests** for:
   - started-at-old-version + new-version-published
   - slot3 submit success + complete transient failure + recovery
   - replay/idempotent submit/complete paths.

