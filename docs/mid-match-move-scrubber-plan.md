# Mid-Match Move History Scrubber — Plan

Date: 2026-09-08
Status: **Solo scope built** on `feat/mid-match-scrubber-solo` (2026-09-08, not
pushed). PvF / Ghost / Daily Fritz only — multiplayer / tournament and the
reconnect-backfill decision are deliberately out of this pass. See
"Solo build — what shipped" below.
Related: `docs/game-review-chess-parity-implementation-plan.md` (post-game
review oracle — a separate, much larger effort; this feature shares none of
its analysis machinery).

---

## Solo build — what shipped (`feat/mid-match-scrubber-solo`)

5 commits, each scoped to a plan item, `tsc -b` / full client vitest 215-files-
1616 / server vitest 218-1300 / lint 51-of-51 (0 errors) / lint:css /
check:architecture 20-of-20 / check:deps / check:multiplayer-arch /
check:socket-registry / check:bot-match-lazy all green.

| Plan item | Commit | Notes |
| :--- | :--- | :--- |
| Lean scrubber (state) | `useMatchHistoryScrubber` hook | view-only cursor over `replay.moveLog`; `historyBoard` = `derivePostMoveReviewBoard(entry)` (reusable piece 1). No auto-snap on new moves; log-reset / shrink forces live. 13 tests. |
| Lean scrubber (UI) | `MatchHistoryScrubber` control strip | `‹ / ›` + `Move N / M · Hand H` + `Back to live` w/ new-move badge. `rh-scrubber` scoped CSS, Button primitive, 44px targets. **Deviation:** the strip does *not* render its own `<Board>` (plan piece 2/3) — the existing bot board is swapped instead (see below). 6 tests. |
| `viewingIndex` → swap display board | `wire history scrubber into solo BotMatchScreen` | **Plan inaccuracy corrected:** the plan assumed a `boardForDisplay` seam already existed in `bot/createBotMatchViewModel.ts`. It did not — the bot board renders `board={match.board}` directly in `BotMatchBoardStage`. This commit introduces the seam: `assembleBotMatchViewModel` computes `displayBoard` and threads it + `viewingHistory` through the `board` VM to `BotMatchBoardStage`, which renders `<Board>` off `displayBoard` with `containFullBoard` while scrubbing. Still within the ~1d estimate. |
| Lock interaction while viewing | `lock hand + board overlays while viewing history` | hand tray forced `handActive=false` (all tiles disabled), selected tile cleared, ghost overlays + score toast suppressed. **The solo surface has no manual draw/pass buttons** (draw is engine-automatic via `usePlayerNoMoveEffect`) — that half of the plan item is multiplayer-only. Gate logic extracted to pure `resolveHistoryScrubberView` (11 tests). |
| Back-to-live on new move | (folded into the hook) | no auto-snap; `movesBehindLive` drives the pill count. |
| Hand-boundary handling | (folded into hook + UI) | `viewedHandNumber` from `MoveEntry.handNumber`; label shows `· Hand H`. Cross-boundary board changes are per-entry projections — already correct. |
| Edge cases | — | optimistic-rollback = MP-only, skipped. Hand-over overlay occludes the dock and the log persists across hands, so walking back into a finished hand works once the modal is dismissed — no extra handling needed. |
| Tests + 44px reachability | `e2e — solo scrubber steps history + 44px tap targets` | Playwright spec in the default `e2e` gate: drives a PvF first move, asserts dock appears, `‹` measures ≥44×44, step-back shows `Move N / M`, hand disabled, `Back to live` restores `Live`. |

**Gating:** the scrubber is enabled only when NOT guided / authoring / journey /
lesson-layout / pre-game-draw / game-over — i.e. genuine solo play in the three
in-scope modes.

**No hidden multiplayer coupling** was found in the solo surfaces:
`BotMatchScreen` (PvF / Ghost / Daily Fritz) is fully separate from
`multiplayer/`; `ReplayRecorder` already logs both players; the projection +
`<Board>` are pure client. The only surprise was the missing display-board seam
(above), which was in-estimate to add.

---

## Feature

A chess.com-style move-history scrubber usable **during** a live match:
`<` / `>` to step through the current game's moves (yours and the opponent's),
view-only, with no effect on live game state, and a "back to live" affordance
when a new move lands while you're looking at history.

---

## Verdict: fork GameReviewer's reusable pieces — do **not** parameterize it

`analyzer/GameReviewer.tsx` is the existing post-game scrubber. It looks ~80%
of this feature, but that "80%" is the *concept + CSS + one board helper*, not
liftable component code. Real reusable surface is ~25–30%.

Why not parameterize (`mode: 'post-game' | 'live'`):

- **GameReviewer's cursor walks `AnalyzedMove[]`, which is your moves only.**
  `moveAnalyzer.ts` filters `entry.player === 'you'` before analysis
  (`analyzeHandMoves`, and the top-level `analyzedMoves` is a `flatMap` over
  hands — still your moves). GameReviewer literally cannot show opponent turns.
  This feature needs both players. Core data-shape mismatch, not cosmetic.
- **Its input is `GameAnalysis | null`.** Producing that runs
  `analyzeMoveLogDeferred` — bot engine per move, `requestIdleCallback` with a
  4s timeout, lazy-imported. Not something to run mid-match every turn; the
  alternative (feed a stub `GameAnalysis` with fake ratings) is a lie to the
  type.
- `hands` segmentation, `selectedHand`, the `useEffect` cursor-init (lines
  77–89) all branch hard on `analysis`.
- GameReviewer is load-bearing for the post-game coaching flow + the
  pivotal-review wizard, with their own expectations. Bolting a second consumer
  with different data semantics *and* a different lifecycle (mutating log,
  "back to live") onto it is a risky refactor for little gain.

The **sidebar** (`sidebarCopy`, `praiseCopy`, `showGhostTile`, `evidence`,
`consequenceByMoveNumber`) is genuinely bolted-on and would parameterize
cleanly — but that's the cheap 25%, not the reason to share the file.

## The 3 concretely reusable pieces

1. **`derivePostMoveReviewBoard(entry)`** — `client/src/analyzer/reviewBoardState.ts`.
   Already standalone. Turns a logged pre-action board (`MoveEntry.boardRenderState`)
   into the post-action board via `simulatePlacement` (exported from
   `@racehorse/game-core`). Reuse directly, per `MoveEntry`, for both players'
   entries. `draw`/`pass` entries return the pre-board unchanged (correct).
2. **`GameReviewer.css` — the `gr-board-*` and `gr-move-nav` classes.** The
   board frame + `<` label `>` nav layout. Share as-is (or lift into a shared
   stylesheet). Skip the `gr-sidebar` / `gr-coaching` / `gr-move-list` classes.
3. **The 6-prop view-only `<Board>` config:**
   ```tsx
   <Board
     board={/* derived historical BoardState */}
     legalMoves={[]}
     selectedTile={null}
     onPositionClick={() => {}}
     fitMode="guided"
     containFullBoard
   />
   ```
   `components/Board.tsx` is fully prop-driven; this config is view-only with
   auto-fit and no interaction. Already used verbatim in GameReviewer.

Everything else is new: a ~80–120-line component whose input is
`readonly MoveEntry[]` (both players) + the live `moveLog.length`, owning
`viewingIndex: number | null` and the "back to live" logic.

## Data foundation (already in place)

- `applyMove` / `applyGameCommand` (`packages/game-core`) are pure; `GameState`
  is deeply `readonly`. But `GameState` retains **no** move log.
- Per-move history with full board snapshots **does** exist on every live
  surface:
  - **PvF / Ghost / Daily Fritz** (BotMatchScreen): `modules/replay/ReplayRecorder.ts`
    (`useReplayRecorder` in `bot/useBotMatchScreenController.ts`) — `MoveEntry[]`,
    each with `boardRenderState`. Accumulates across all hands; resumable
    matches persist `moveLog`.
  - **Multiplayer / Tournament** (LiveMatchScreen): `multiplayer/MultiplayerGameShell.tsx`
    `multiplayerMoveLog: MoveEntry[]`, logs **both** players
    (`appendMultiplayerMove({ player: 'opponent', … })`), resets on game
    start / rematch. Opponent entries carry `boardRenderState`, tile, action;
    `handBefore`/`validMoves` are empty (fine — scrubber doesn't need them).
- `<Board>` renders any `BoardState` view-only (see reusable piece 3).
- Board display is already decoupled from raw state behind a view-model on both
  surfaces: `boardForDisplay` in
  `match/session/viewModel/useLiveMatchViewModel.ts` and the equivalent in
  `bot/createBotMatchViewModel.ts`. The `viewingIndex` swap lands there.

## Open decision: multiplayer reconnect gap

`multiplayerMoveLog` is in-memory in `MultiplayerGameShell`, reset on game
start, **not rehydrated on reconnect**. A player who reconnects mid-game gets a
scrubber that only reaches back to the reconnect point.

Options (pick before building the MP surface):
- **A. Accept it** — "history starts from where you reconnected." Cheapest.
- **B. Backfill from `room_match_logs`** (server has the data) — needs a
  server read path + client rehydration into `MoveEntry` shape. Meaningfully
  more work, drags in server changes.

Solo (PvF/Ghost/DF) has no equivalent gap — its log is persisted and rebuilt
on resume.

## Estimate

| Scope | Estimate |
| :--- | :--- |
| **Solo-first** (PvF / Ghost / Daily Fritz only) | **~2–3 days** |
| **Both surfaces** (+ multiplayer / tournament) | **~4–6 days** |

Solo-first is cheaper and lower-risk: persisted log, no reconnect gap, no
optimistic-move-rollback races, no hand-over-overlay interaction.

### Work breakdown (both surfaces)

| Piece | Where | Est. |
| :--- | :--- | :--- |
| Lean scrubber component (board + `< >` + move dots + "back to live" pill) | new component; reuse pieces 1–3 above | 0.5–1 d |
| `viewingIndex` state → swap `boardForDisplay` for `derivePostMoveReviewBoard(moveLog[i])` | `bot/createBotMatchViewModel.ts`, `match/session/viewModel/useLiveMatchViewModel.ts` | 1 d |
| Lock interaction while viewing history (hand-tray drag, draw/pass buttons — outside `<Board>`) | match-screen controllers | 0.5 d |
| "Back to live" when `moveLog` grows mid-view (auto-snap vs. count pill) | scrubber + view-models | 0.5 d |
| Hand-boundary handling (game = multiple hands; `MoveEntry.handNumber` exists) | scrubber | 0.25 d |
| Edge cases: optimistic-move rollback, hand-over overlay, reconnect (see open decision) | mostly MP | 0.5–1 d |
| Tests + the mobile reachability gate requires the `< >` controls ≥ 44px | — | 0.5 d |

## Other risks (not blockers)

- **Pre-action snapshot contract:** move logs store the board *before* the
  action; "board after move N" always goes through `derivePostMoveReviewBoard`
  → `simulatePlacement`. GameReviewer already depends on this, but branch/hub
  placements through `simulatePlacement` deserve a spot-check.
- **`<Board>` camera** auto-refits on each board change (has a
  `lastResetSignatureRef`); rapid scrubbing = rapid refits. GameReviewer does
  this today without issue.
