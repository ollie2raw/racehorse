# D4 — `server/src/rooms.ts` + `server/src/generatePuzzles.ts` decomposition scoping

**Status:** investigation only, no code changed. Produced 2026-09-10.
**Source:** `REFACTOR_OPPORTUNITIES.md` §3 D4.

These are two unrelated files bundled under one D-number because both are big
server modules. They have **opposite** risk/urgency profiles and should be
decided separately.

---

# Part A — `server/src/generatePuzzles.ts` (1786 lines)

## A1. What is in it

A single-purpose **offline generator** for the curated daily-puzzle pool. Run
from `seedPuzzlePool.ts` (invoked by `.github/workflows/gen-puzzles.yml`, every
6h) and `dailyPuzzle.ts`. Clean linear pipeline, ~45 small functions:

| Band | Lines | Contents |
|---|---|---|
| CLI + IO | 91–129 | `parseCliArgs`, date formatting |
| Determinism utils | 140–177 | `hashString`, `mulberry32` PRNG, `randInt`, `yieldEventLoop` |
| **Board primitives** | 165–420 | `cloneBoard`, `isDouble`, `tileMatchesEnd`, `createSpinnerBoard`, `placeMainLineTile`, `placeBranchTile`, `getOpenEnds`, … — a **reimplementation of `@racehorse/game-core` board geometry** |
| Board construction | 449–558 | `getBoardPipProfile`, `buildBoard` (seeded board layouts by date) |
| Search / sim | 559–784 | `createSearchState`, `makeSimState`, `evaluateSimMove`, `pickTacticalMove`, `findScoringPath` — a minimax-ish scorer for puzzle difficulty |
| Puzzle builders | 695–913 | `buildMidHandPuzzleState`, `buildSetupMidHandPuzzleState` |
| **Public API (4 exports)** | 915–1786 | `createHighScorePuzzle`, `generateSetupAndStrikePuzzle`, `computeBestPossiblePuzzleScore`, `validateSetupAndStrikeGeneratedPuzzle` |

## A2. Why it grew this way

It is a generator that got two puzzle *types* (high-score, setup-and-strike),
each needing its own board-construction + scoring + validation path, and it
carries its own geometry primitives rather than importing game-core because it
predates the `@racehorse/game-core` package extraction and nobody has paid the
consolidation cost on an off-request-path script.

## A3. Decomposition + risk

**Low blast radius** — 3 non-test callers, none on the request path; a bug
shows up as a bad puzzle in the next 6-hourly pool run, caught by
`validateSetupAndStrikeGeneratedPuzzle` and the pool-seeding checks, not by a
player mid-game.

Natural split: `generatePuzzles/prng.ts`, `generatePuzzles/boardGeometry.ts`,
`generatePuzzles/search.ts`, `generatePuzzles/highScorePuzzle.ts`,
`generatePuzzles/setupAndStrikePuzzle.ts`, `index.ts` re-exports the 4.

**The real question is whether `boardGeometry.ts` should be deleted, not
extracted** — it is the D3 / `HARDENING_PLAN.md` §7 GC-3 seam (a second
implementation of shared board math). If game-core's geometry can serve the
generator, this file loses ~250 lines and a drift risk. That is a
game-correctness question owned by the hardening plan, not a cleanup —
**do not fold it into a D4 pass.**

**Recommendation:** low priority. Worth a half-day tidy *only* when someone is
already in this file adding a third puzzle type. The geometry-dedup half is
HARDENING_PLAN GC-3's call, separately.

---

# Part B — `server/src/rooms.ts` (1437 lines, 25 exports, 56 commits)

## B1. What is in it

The **multiplayer room lifecycle core** and the server's largest hand-written
module. It owns the in-memory room store and every state transition a live
match goes through.

**Module state (the reason it's a single module):**
```
const rooms = new Map<RoomCode, Room>();                    // the room store
const nextHandStartsByRoom = new Map<RoomCode, Promise<Room>>();  // per-room hand-start single-flight
+ registerLiveRoomPersistHook singleton
```

**Exports, by concern:**

| Concern | Exports | Lines |
|---|---|---|
| Types | `Room`, `RoomConfig`, `RoomCode`, `LeadTracker`, `DrawAnimationStep`, `ActResult`, `RoomLifecycleSnapshot`, `RoomGameplaySnapshot`, `ActionPayload` | 40–200 |
| Persist-hook plumbing | `registerLiveRoomPersistHook`, `resetLiveRoomPersistHookForTests`, `isRoomLifecyclePersistUncertainError`, `HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE` | 189–221 |
| **Snapshot / rollback** (commit-safety: take a snapshot, mutate, persist, roll back on failure) | `captureRoomLifecycleSnapshot`, `captureRoomGameplaySnapshot`, `rollbackRoomLifecycleCommit`, `rollbackRoomGameplayCommit` | 222–425 |
| Room CRUD | `createRoom`, `createReservedRoom`, `joinRoom`, `peekRoom`, `getRoom`, `deleteRoom`, `getRoomRuntimeStats`, `resetRoomRuntimeForTests` | 426–583 |
| Forfeit / abandon guards | `isTournamentForfeitApplyBlocking`, `assertRoomNotAbandonedOrForfeitBlocked` (internal) | 552–587 |
| Pre-game draw | `isPregameDrawEligible`, `createPreGameDrawShellMatch`, `initiatePregameDrawOrStart(Unlocked)` | 709–772 |
| Game start | `startGame(Unlocked)` | 773–864 |
| Hand progression | `nextHand`, `readyForNextHand` | 865–1083 |
| **`act`** — the central gameplay mutation (place / draw / pass), lock-serialized, snapshot-guarded, resolves forced draws + auto-pass, appends resolution events, Ghost move-log | `act` (+ internal `actUnlocked`, `resolveDrawUntilPlayableAtomically`, `resolveForcedDrawAtomically`, `commitResolvedGameState`) | 1101–1406 |
| Query helpers | `getRoomLegalMoves`, `getRoomCanDraw`, `getRoomOpenEnds`, `getRoomMatchEventMeta`, `getRoomMatchEventSnapshot` | 1407–1435 |
| Ghost internals | `serializeGhostBoardState`, `appendGhostMove`, `appendGhostDrawSteps`, `currentGhostTurn` | 331–416 |

## B2. Why it grew this way

`rooms.ts` is early (initial-commit lineage). The additions that grew it are
all real hardening, mostly from `HARDENING_PLAN.md` System 2:

- the snapshot/rollback layer (commit-safety for the "mutate in memory, then
  persist to PostgREST, roll back if the write is uncertain" pattern —
  `HAND_LIFECYCLE_PERSIST_RETRY_MESSAGE`, `isRoomLifecyclePersistUncertainError`);
- the `Unlocked` / locked pairs (`startGameUnlocked` / `startGame`,
  `actUnlocked` / `act`, `initiatePregameDrawOrStartUnlocked` / …) — every
  public mutation is a thin lock-acquire wrapper around an `*Unlocked` core, so
  the single-instance in-memory lock (`HARDENING_PLAN.md` §2.1.1) serialises
  concurrent socket events for one room;
- forfeit-apply blocking guards (tournament integrity, System 1);
- the atomic forced-draw / draw-until-playable resolution (game-correctness).

It is **cohesive** — every export operates on a `Room` from the one `Map` — but
it mixes four separable layers: the store, the commit-safety machinery, the
lifecycle state machine, and the `act` gameplay engine.

## B3. Decomposition (high level)

| New module | Takes | Keeps in `rooms.ts` |
|---|---|---|
| `rooms/store.ts` | the `rooms` Map, `createRoom`/`createReservedRoom`/`joinRoom`/`peekRoom`/`getRoom`/`deleteRoom`/`getRoomRuntimeStats`, the persist-hook singleton | — |
| `rooms/commitSafety.ts` | the 4 snapshot/rollback fns + `RoomLifecycleSnapshot`/`RoomGameplaySnapshot` types + `isRoomLifecyclePersistUncertainError` | — |
| `rooms/lifecycle.ts` | pre-game draw, `startGame(Unlocked)`, `nextHand`, `readyForNextHand`, `nextHandStartsByRoom` single-flight | — |
| `rooms/act.ts` | `act`/`actUnlocked`, the two atomic-draw resolvers, `commitResolvedGameState`, `appendResolutionEvents`, `ActResult`/`ActionPayload` | — |
| `rooms/ghostMoveLog.ts` | the 4 Ghost helpers | — |
| `rooms.ts` (stays, ~150 lines) | `Room`/`RoomConfig`/`RoomCode` types, the query helpers, a barrel re-export so the 36 consumers don't all change imports at once | |

The `Room` type and the `rooms` Map are the shared spine — everything imports
one or both. The split is by *verb* (store it / snapshot it / transition it /
act on it), and the lock wrappers stay co-located with their `*Unlocked` cores.

## B4. What could break — **high blast radius**

- **36 consumers** across `multiplayer/`, `scheduledTournament/`,
  `matchmaking/`, `spectator/`, `realtime/`, `social/`, `shared/`. Every one
  imports from `rooms`. A barrel re-export keeps the imports stable through the
  move, but the moment `rooms.ts` stops re-exporting a symbol, something
  breaks — and `check:multiplayer-arch` / `check:multiplayer-cycles` will fail
  if the new module graph introduces a cycle (the `multiplayer/` dir is
  CLAUDE.md-protected and has its own dependency-boundary check).
- **`CLAUDE.md`: `client/src/multiplayer/` is "socket lifecycle code; do not
  restructure."** `rooms.ts` is server-side so not literally covered, but it is
  the server counterpart of that protection and is referenced from the
  protected client dir's contracts (`contractsDriftTypes.ts`).
- **The lock discipline is invisible in the types.** `act` vs `actUnlocked` —
  if a future edit calls the `Unlocked` core from a new site without the lock,
  concurrent socket events for one room interleave a read-verify-commit
  (`HARDENING_PLAN.md` §2.1). Splitting the pair across module boundaries makes
  that mistake easier. Any decomposition PR must keep every `*Unlocked` export
  either non-exported or clearly marked, and ideally add an
  `INV`-style architecture check that `*Unlocked` is only called from within
  its own module.
- **Snapshot/rollback correctness.** `rollbackRoomGameplayCommit` restores a
  `GameState` into the live `Room` object by reference. Moving it must preserve
  that it mutates the *same* object the store holds, not a copy.
- **Server has no `max-lines` enforcement** (`--max-warnings 9999`) — there is
  **no ratchet** forcing this and no CI signal if a split regresses file size.
  The only safety net is the full server vitest (`~1200 tests`) + the
  multiplayer arch/cycle checks + the MP private-authority soak.
- **`HARDENING_PLAN.md` System 2 is "Closed (Tiers A–E)"** against the *current*
  structure. A restructure invalidates the "audited as written" status for the
  moved code until re-reviewed.

## B5. Realistic step sequence (if approved)

1. **Pre-req — an architecture check for the lock discipline.** An
   `INV`-style rule in `check:architecture` (or `check:multiplayer-arch`) that
   `*Unlocked` functions are not imported across module boundaries. Without
   this, the split *removes* a safety property (co-location) without replacing
   it.
2. **PR 1 — `rooms/store.ts` + `rooms/ghostMoveLog.ts`.** The two leaf
   concerns with the fewest cross-references. `rooms.ts` re-exports. Full server
   bar + MP soak.
3. **PR 2 — `rooms/commitSafety.ts`.** Snapshot/rollback. Self-contained;
   the `persistence.test.ts` family covers it.
4. **PR 3 — `rooms/lifecycle.ts`.** Start / nextHand / readyForNextHand +
   single-flight. Bigger; `readyForNextHand` is 160 lines of state machine.
5. **PR 4 — `rooms/act.ts`.** The gameplay engine. Last, alone, with a human
   watching, MP soak green before and after, and step-1's lock check enforcing.
6. Each PR: full server vitest + `tsc -b` + `check:multiplayer-{arch,cycles}` +
   `check:socket-registry` + the MP private-authority soak (2 waves).

**Estimated:** step 1 ~1 day, PRs 1–3 ~1 day each, PR 4 ~2 days with review.
**~1 week**, PR 4 being genuinely load-bearing.

**Recommendation for the go/no-go:** `generatePuzzles.ts` (Part A) is a
low-value low-risk tidy — defer indefinitely, do it opportunistically.
`rooms.ts` (Part B) is real debt but it is the multiplayer spine and
`HARDENING_PLAN.md` System 2 just certified it as-is; a restructure has high
blast radius, no CI ratchet forcing it, and its main payoff is legibility not
correctness. **Lower priority than D5.** If done, PRs 1–3 are safe-ish; PR 4
(`act.ts`) should only happen with explicit sign-off and the MP soak watched.
