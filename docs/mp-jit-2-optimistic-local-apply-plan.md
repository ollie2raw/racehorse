# MP-JIT-2 — optimistic local apply for multiplayer MOVE / DRAW / PASS

**Status: SHIPPED 2026-09-07** — MOVE + PASS optimistic; DRAW immediate visual
placeholder only. The rest of this doc is the original plan; deviations are
noted inline.

## Steps 2–4 (2026-09-07 follow-up)

- **Step 2 — continued-turn legal moves + immediate lock release.** A
  scoring/double play that keeps the turn (no forced draw) previously blanked
  `legalMoves` for ~1 RTT *and* held `pendingUiAction === 'play'` /
  `pendingActionRef`, so `isGameplayActionBlocked()` and the view model's
  `boardLegalMoves` both kept the player frozen until the ack.
  `computeOptimisticPlayState` now returns `{ nextState, nextLegalMoves,
  nextCanDraw, turnRetained }`; for a retained turn it computes
  `getLegalMoves(next, you)` locally, **and `usePlayAction` releases the pending
  lock immediately** (`setPendingUiAction` clear + `setPendingActionRefDiag(false)`)
  so the next tile is playable with no wait. The in-flight emit still
  commits/rolls back by `requestId`. A chained second play while the first is
  still in flight falls back to the plain server path (the single-in-flight
  `optimisticActionRef` guard) — it goes optimistic again as soon as the first
  reconciles, which is fast. A turn that passed still yields `[]` and keeps the
  normal lock-until-ack.
- **Step 3 — optimistic PASS.** `computeOptimisticPassState` mirrors MOVE (no
  hidden information; the engine validates and hands the turn off
  deterministically). `usePassAction` gets the same optimistic-apply /
  rollback-on-`!ok` / commit-on-`ok` wiring. Blocked-hand results (`handOver`)
  are deferred to the server. Snapshot/rollback machinery in
  `useLiveMatchSession` is now generic (`runOptimisticAction`), shared by play
  and pass.
- **Step 4 — DRAW: immediate visual placeholder only.**
  - **Shipped:** on DRAW click, one face-down placeholder tile
    (`{ low: -1, high: -1 }`) is appended to the displayed hand
    (`setDrawStepMyHand`) with the incoming-tile pulse (`setDrawPulseIndex`),
    so the player sees "a tile is coming" on the same tick instead of a bare
    pending state. `HandView.renderTile` renders a negative-pip tile as
    `<DominoTile faceDown disabled>`. Cleared by the hook only on the error
    paths; the success path is cleared by the authoritative `state:update` /
    `game:draw_animation` exactly as before — **no new rollback state, no
    engine prediction.**
  - **Deferred:** predicting the drawn tile(s) (the boneyard is genuinely
    hidden — `{-1,-1}` placeholders), and any change to the per-tile
    flight/step animation from the boneyard (that remains driven by
    `game:draw_animation`). A multi-draw chain still shows one placeholder
    until the real steps arrive.

## v1 scope (what shipped — MOVE core)

- **`client/src/match/session/actions/optimisticPlay.ts`** — pure
  `computeOptimisticPlayState(state, you, tile, position)`: runs
  `@racehorse/game-core`'s `applyMove` on the masked live `GameState`. The
  masked state carries only a 2-field `config`, so it is merged over
  `DEFAULT_CONFIG` (the missing fields — `deadTileCount` etc. — only affect the
  reconcile-only forced-draw path). Returns `null` (→ plain server round-trip,
  unchanged behaviour) when: not the actor's turn, hand/game over on input, the
  engine rejects the move, **the result is terminal** (`handOver`/`gameOver` —
  those drive hand-reveal / game-over UI and are latency-insensitive, mirroring
  MP-JIT-1's server carve-out), or **a forced draw is pending** (scoring/double
  play needing draws the client cannot predict — the masked boneyard is
  length-correct but `{-1,-1}` placeholders).
- **`useLiveMatchSession.ts`** — `applyOptimisticPlay(tile, position, requestId)`:
  snapshots `{state, legalMoves, canDraw}`, `setState(next)` + `setLegalMoves([])`
  + `setCanDraw(false)`, returns a `rollback()` closure that restores the
  snapshot **only if `stateRef.current` is still the optimistic object**
  (reference equality — an authoritative `state:update` that already superseded
  it wins). `commitOptimisticPlay(requestId)` clears the snapshot on ack-ok. An
  effect clears a stale snapshot whenever `state` changes to anything other than
  the optimistic object. The watermark (`maxSequenceRef` in `useRoomSocketSync`)
  is never touched.
- **`usePlayAction.ts`** — calls `applyOptimisticPlay` right after move
  validation; `flashLastPlayed` fires immediately on the optimistic path;
  `rollback()` on `!resp.ok` (before the existing uncertain/error handling) and
  in the `catch`; `commitOptimisticPlay` on `resp.ok`.
- Tests: `optimisticPlay.test.ts` (5 — legal apply / not-your-turn / terminal /
  engine-reject / no-mutation); `useLiveMatchActions.test.ts` MP-JIT-2 block (3 —
  happy-path commit-no-rollback, rejected rollback, uncertain rollback+resync).

**Known v1 limitation:** a scoring/double play that keeps the turn without a
forced draw is optimistically applied but `legalMoves` is blanked, so the actor
sees a brief (~1 RTT) "wait" before the authoritative update restores their
continued-turn moves. Acceptable; a follow-up can recompute
`getLegalMoves(next, you)` locally.

---

## Original plan

**(kept for reference; superseded where v1 deviates)**
Follows MP-JIT-1 (`docs/mp-live-move-persist-latency.md`). MP-JIT-1 removed the
DB write from the broadcast critical path (median mid-hand `game:action` ack
~140ms → ~1ms local, ~48ms against Render). One socket round-trip of dead time
remains: after you click a tile it sits in your hand with only a pending
spinner until the authoritative `state:update` frame lands. MP-JIT-2 closes that
by predicting the move locally with the same engine the server runs, then
reconciling.

---

## 1. Where the optimistic apply happens

### The client already holds everything it needs

`client/src/types.ts`'s `GameState` is **structurally identical** to
`@racehorse/game-core`'s (enforced by the GC-3a comment at the top of that
file). The live-match client holds a full `GameState` in
`match/session/useLiveMatchSession.ts` (`const [state, setState]`, mirrored to
`stateRef`), and the masked state the server sends the actor includes the
actor's own hand, the full board, the boneyard length, whose turn it is, and
`legalMoves` / `canDraw`. So — unlike the Daily Fritz path, which runs the
engine over a *different* state shape (`BotMatchState`) via
`modules/match/runtime/gameCoreAdapter.ts`'s `toCoreGameState` /
`fromCoreGameState` adapters — the MP client can call the engine **directly** on
the state it already has.

### The functions to call

The same ones the server's `rooms.ts` `act()` uses, imported straight from
`@racehorse/game-core`:

- `getLegalMoves(state, seatId)` — already effectively available (the server
  ships `legalMoves` in `state:update`; use the engine call as the source of
  truth for the optimistic apply so client and server agree by construction).
- `applyMove(state, seatId, { type: 'play', tile, position })` → returns
  `{ state, forcedDraw }`.
- `applyMove(state, seatId, { type: 'pass' })`.
- there is no client-predictable `draw` — see §1.4.

These are pure functions over `GameState`. No React, no adapter.

### Integration points (three action hooks, one shared helper)

Add one helper, `applyOptimisticGameAction(...)`, in
`match/session/actions/` and call it from the three existing hooks
**immediately after the block/validation checks pass and before
`emitGameAction`**:

| Hook | Today | With MP-JIT-2 |
|---|---|---|
| `usePlayAction.ts` | `emitGameAction({type:'MOVE'})` → wait for `state:update` | `applyOptimisticGameAction({kind:'play', tile, position})` **then** `emitGameAction` |
| `usePassAction.ts` | `emitGameAction({type:'PASS'})` → wait | `applyOptimisticGameAction({kind:'pass'})` then emit |
| `useDrawAction.ts` | `emitGameAction({type:'DRAW'})` → wait | optimistic **lock only** (no tile prediction) then emit — see §1.4 |

`applyOptimisticGameAction`:

1. Snapshots the current authoritative state:
   `preOptimisticRef.current = { state: stateRef.current, sequence: stateRef.current.sequence, requestId }`.
2. Runs the engine: `const { state: next } = applyMove(stateRef.current, you, move)`.
3. `setState(next)` + `stateRef.current = next` — the board updates this tick.
4. Sets `optimisticActive.current = { requestId, baseSequence, predictedState: next }`.
5. **Does NOT touch `maxSequenceRef`** (the authoritative watermark in
   `useRoomSocketSync`). The optimistic state is a speculative overlay; the
   watermark stays at the last *authoritative* sequence so resync/regression
   logic is unchanged (§3).
6. Fires `flashLastPlayed(move.tile)` / `appendMultiplayerMove(...)` **exactly
   where the hooks do today** — those move from the `resp.ok` branch to right
   after the optimistic apply, so they are not double-fired on the reconciling
   `state:update` (guard on `requestId`).

### 1.4 DRAW and forced-draw are reconcile-only (predict the lock, not the tiles)

The boneyard tile identities are hidden from the client (fairness). So:

- **Explicit DRAW** (`useDrawAction`): optimistic apply = disable the actor's
  input + show the existing "drawing…" affordance immediately; the drawn tiles
  and any resulting board state come from the authoritative `state:update` /
  `game:draw_animation` as they do today. No `applyMove`-based prediction.
- **A MOVE that scores or is a double** keeps the turn and may seed a forced
  draw. Optimistic apply covers the *placement + score* (fully predictable);
  the forced-draw tiles are shown as face-down placeholders (count is known
  from `getDrawableBoneyardCount`) and reconciled on the broadcast. `applyMove`
  already returns `forcedDraw` metadata — use its `steps.length` for the
  placeholder count, nothing more.

This keeps MP-JIT-2 to "predict what the client can legitimately know."

---

## 2. Reject → visual rollback, end to end

### When the server rejects

After MP-JIT-1, a mid-hand `game:action` almost never comes back `ok: false`.
The remaining cases:

- **`error: 'It is not your turn.'` / stale board** — a watermark race: the
  client acted on `state:update` N but the server had already moved to N+1.
- **`error: 'That tile cannot be played there.'`** — client/server legal-move
  disagreement. Should be impossible with the shared engine; if it ever
  happens it's a real bug and must surface, not be swallowed.
- **`uncertain: true`** — only on the terminal/shutdown sync-persist path now
  (MP-JIT-1 §carve-outs). Rare.

### The rollback

`applyOptimisticGameAction` returns a `rollback()` closure. The three hooks call
it in the `!resp.ok` branch (replacing today's `setActionError(...)` /
`markUncertainAndResync(...)` calls — see §3 for how they compose):

`rollback()`:
1. If `stateRef.current` is still the `predictedState` for this `requestId`
   (no authoritative `state:update` has superseded it yet):
   `setState(preOptimisticRef.current.state)` — restores the pre-click state.
   The tile animates **hand ← board** (the reverse of the place animation),
   ~120ms, the design-system motion spec (`transform 120ms cubic-bezier(0.2,0,0,1)`,
   no bounce). The board's existing tile-transition handles this if the tile's
   identity/key is stable across the two `setState`s — verify in implementation.
2. If an authoritative `state:update` **has** already been applied (the
   optimistic state was replaced by real server truth): do nothing to `state` —
   the board already shows truth. Just clear `optimisticActive`.
3. `clearSelectedTile()`, `setPendingUiAction(null)`.
4. For a hard rejection (not `uncertain`): `showToast(resp.error, 2500)` — a
   brief "That move didn't go through" style message. For `uncertain`: no toast
   (MP-JIT-1 already made this near-impossible; if it happens, the resync in §3
   covers it silently).
5. **No** `fetchGameState` for the common "not your turn" case — the next
   authoritative `state:update` (which is already in flight, since the server
   advanced) will arrive within a frame or two and reconcile. `fetchGameState`
   is reserved for the genuine-desync path (§3).

### The happy path has *no* visible rollback

Legal move → optimistic `applyMove` produces state X → the server runs the
identical `applyMove` → broadcasts state X → `projectStateUpdate` → `setState(X)`.
X === X, so React's `setState` with a deep-equal-enough object is a no-op
render (or a single, invisible reconcile). The tile never snaps.

---

## 3. Composition with the existing resync / watermark machinery

**Reuse, do not duplicate.** The relevant existing pieces:

- `useRoomSocketSync.ts` → `projectStateUpdate` → `applyStateUpdateProjection`:
  the authoritative apply. `maxSequenceRef` is the watermark;
  `evaluateSequenceWatermark` rejects regressions/stale updates and triggers
  `fetchGameState`.
- `markUncertainAndResync(requestId, error)` in `useLiveMatchActions.ts` →
  `fetchGameState('game_action_uncertain')` — the full authoritative refetch,
  same call reconnect uses.
- `logicalGameplayActionRef` — already tracks the in-flight logical action and
  its `uncertain` flag; `shouldClearLogicalActionForState` clears it when a
  matching state arrives.

### How the optimistic overlay sits on top

1. **The watermark is authoritative-only.** Optimistic apply never advances
   `maxSequenceRef`. So when the reconciling `state:update` arrives at sequence
   N+1, `evaluateSequenceWatermark(N, N+1)` accepts it normally and
   `applyStateUpdateProjection` calls `setState(authoritativeState)` — which
   *replaces* the optimistic state. If they match: invisible. If they differ
   (mispredict — should not happen with the shared engine, but e.g. an
   interleaved opponent action): the board corrects to truth in one render.
   This is the reconcile, and it is **the existing code path**, unchanged.

2. **`optimisticActive` is cleared** whenever an authoritative `state:update`
   with `sequence > baseSequence` is applied for that `requestId`'s room/hand —
   hook a check into `applyStateUpdateProjection` (or a `useEffect` on
   `state.sequence`) that clears `optimisticActive` and `preOptimisticRef`.
   Mirror `shouldClearLogicalActionForState`'s trigger set
   (`state.sequence`, `state.handNumber`, `state.gameOver`, `state.handOver`).

3. **Genuine desync** (an authoritative `state:update` that is a *regression*,
   or `fetchGameState` returns a state that contradicts the optimistic apply):
   the existing `evaluateSequenceWatermark` → `fetchGameState` path already
   handles this. The only addition: before applying the refetched state, clear
   `optimisticActive` / `preOptimisticRef` so a stale rollback can't fire
   afterward. `markUncertainAndResync` stays exactly as-is for the `uncertain`
   ack; `rollback()` just runs first to restore the pre-optimistic board so the
   resync isn't visually applied *on top of* a speculative state.

4. **`appendMultiplayerMove` / `flashLastPlayed` dedupe.** Both currently fire
   in the `resp.ok` branch. Moving them to the optimistic apply means the
   reconciling `state:update` must not re-fire them. Guard: track
   `lastFlashedRequestId` / `lastAppendedRequestId`; the `state:update` handler
   already knows the sequence, and the hook knows its `requestId` — skip if
   already done for this logical action.

Net new state: `preOptimisticRef`, `optimisticActive`, two "already did
flash/append" request-id guards. No new resync/refetch/watermark logic.

---

## 4. Test plan

All in `client/`, vitest + the existing MP session test harness
(`useLiveMatchActions.test.ts`, `useLiveMatchSession` tests,
`useRoomSocketSync` behavior tests).

### 4.1 Legal-move happy path — no visible correction (REQUIRED)

- Given an authoritative `GameState` at sequence N, actor's turn, a legal
  `play` in `legalMoves`.
- Act via `usePlayAction`. Assert **synchronously** (before any `state:update`):
  `stateRef.current` has the tile on the board, removed from the actor's hand,
  turn advanced, `sequence === N+1`; `flashLastPlayed` called once.
- Deliver the matching authoritative `state:update` (sequence N+1, identical
  board). Assert: `setState` produces no board diff (spy on render / compare
  serialised board before+after); `flashLastPlayed` / `appendMultiplayerMove`
  **not** called a second time; `optimisticActive` cleared; `maxSequenceRef`
  advanced to N+1 exactly once, by the authoritative apply.

### 4.2 Rejected-move path — clean rollback, no desync, no double-apply (REQUIRED)

- Same setup; `emitGameAction` mock resolves `{ ok: false, error: 'It is not your turn.' }`.
- Assert: `stateRef.current` restored to the pre-click state (tile back in hand,
  turn back, `sequence === N`); selected tile cleared; a toast shown;
  `fetchGameState` **not** called (common race case).
- Then deliver the authoritative `state:update` that reflects what really
  happened (opponent's move, sequence N+1). Assert the board applies it once,
  the actor's earlier tile is **not** also on the board (no double-apply), no
  regression/resync triggered.

### 4.3 PASS — fully predictable (REQUIRED)

- Blocked actor, `legalMoves` contains `{type:'pass'}`. Optimistic apply advances
  the turn + `consecutivePasses`. Reconciling `state:update` matches → no
  correction.

### 4.4 Scoring move → forced-draw placeholder (REQUIRED)

- Legal `play` that scores and leaves the actor able to keep playing after a
  forced draw. Assert optimistic apply shows the placement + score immediately
  and N face-down placeholder tiles (N from `applyMove().forcedDraw.steps.length`).
- Deliver the authoritative `state:update` + `game:draw_animation` with the real
  drawn tiles. Assert the placeholders are replaced by real tiles with no
  "flash to empty then repopulate".

### 4.5 Watermark integrity (REQUIRED)

- Optimistic apply, then deliver an authoritative `state:update` that is a
  **regression** (sequence N-1, e.g. a post-restart rehydrate — MP-JIT-1's
  accepted-risk case). Assert `evaluateSequenceWatermark` still fires the
  existing regression path → `fetchGameState`; `optimisticActive` is cleared
  before the refetched state is applied; no stale `rollback()` runs afterward;
  the board ends on authoritative truth.

### 4.6 Interleaved opponent action (mispredict correction)

- Optimistic apply of the actor's move, but the reconciling `state:update`
  carries a *different* board (server processed an opponent action first).
  Assert the board corrects to server truth in a single render, no crash, no
  duplicated tile.

---

## 5. Explicit non-goals for MP-JIT-2

- **Draw-animation pacing / opponent-move presentation timing** — that is
  MP-JIT-3. MP-JIT-2 does not add or change any `setTimeout`-based pacing.
- **Board subtree `React.memo` / render-count reduction** — MP-JIT-3.
- **Predicting hidden information** — boneyard tile identities stay server-only;
  DRAW and forced-draw tiles are reconcile-only (§1.4).
- **Server-side changes** — none. MP-JIT-1 already did everything needed on the
  server; MP-JIT-2 is purely client prediction + reconcile.
- **`hand:ready` / new-hand / rematch / match-start flows** — untouched.
- **Tournament-match session** (`useTournamentMatchSession.ts`) — out of scope
  for this pass; revisit once the private-room path is proven.
- **A new resync/refetch mechanism** — MP-JIT-2 must reuse
  `fetchGameState` / `evaluateSequenceWatermark` / `markUncertainAndResync`.

---

## 6. Open questions to resolve during implementation

1. Does the board's tile-transition CSS produce a clean reverse animation on a
   `setState` back to the previous state, or does the tile need a stable
   React key + an explicit "returning" class? (Affects §2 rollback feel.)
2. `appendMultiplayerMove`'s telemetry (`buildGameplayMoveTelemetry`) reads
   `stateNow` — confirm it's captured from the **pre**-optimistic state so the
   logged "board ends" / pip deltas match the server's view.
3. Should the optimistic apply be gated behind a flag
   (`MP_OPTIMISTIC_MOVES`) for a staged rollout, given prod's single-instance
   deploy and no canary? Recommend yes for the first ship.
