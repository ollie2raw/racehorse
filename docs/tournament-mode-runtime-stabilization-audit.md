# Tournament mode runtime stabilization audit

**Date:** 2026-06-01  
**Scope:** Scheduled tournament live play, postgame flow, bot simulation, bracket state. No Daily Fritz/Puzzle/PvF/private MP changes unless shared.

---

## 1. Live match rendering: tournament vs private multiplayer

| Layer | Private multiplayer | Tournament (in match) |
|-------|---------------------|-------------------------|
| App mode | `multiplayer` | **`multiplayer`** after attach (`useTournamentMatchSession`) |
| Screen | `LiveMatchScreen` | **Same** `LiveMatchScreen` |
| Layout | `MatchLiveLayout` → `InGameBoardShell` | **Same** |
| Board / hand | `Board`, `HandView`, `TileRack` | **Same props** from `App.tsx` |
| Draw animation | `useRoomSocketSync` `game:draw_animation` → `flyingTiles`, `drawPulseIndex` | **Same** (no tournament branch) |
| Win target HUD | Was hardcoded **60** on `LiveMatchScreen` | Server room uses **`win_target` 30** → HUD mismatch |

**Root cause (tiles / spacing “different”):** Not a separate tournament board—likely **score track showing 60 vs game ending at 30**, plus **TournamentMatchHud** always visible in center during tournament context. Same `handTileSize` / `handCompactStacked` rules apply.

**P0 fix applied:** Pass `winTarget={state?.config?.winningScore ?? 60}` into `LiveMatchScreen`.

---

## 2. Draw animations

Same socket pipeline as private MP. Tournament does not disable `game:draw_animation`.

If draws appear missing, causes are likely: missing server emit, null `boneyardRef`/`handAreaRef`, or client race—not a tournament-only renderer.

---

## 3. Game over at 30 / modal / freeze

### Server

- Rooms created with `winningScore: tournament.win_target` (30).
- `applyTournamentGameOverFromRoom` → `applyMatchResult` (idempotent on `status === 'completed'`).

### Client (pre-fix issues)

| Issue | Mechanism |
|-------|-----------|
| **Modal hidden** | `liveGameOver` effect added `matchId` to `consumedTournamentGameOverMatchIdsRef` immediately → overlay guard returned `null`. |
| **Skip to bracket** | `tournament:match_completed` called `finalizeTournamentMatchSession` while still in live match → `resetMultiplayerRoomState`, `setAppMode('tournament')`. |
| **Lag / freeze feel** | Race: `hand:ended` 1400ms delay vs immediate `gameOver`; finalize + bracket refresh while overlay never shown. |

**P0 fixes applied:**

- Do **not** add to `consumed` on `liveGameOver` (only mark terminal for recovery).
- **Defer** `finalizeTournamentMatchSession` on `tournament:match_completed` when `appMode === 'multiplayer'` and `attachedMatchId === matchId`.
- Extract `shouldDeferTournamentMatchFinalize` / `shouldShowTournamentGameOverOverlay` for tests.

User dismissal via overlay → `navigateAfterTournamentMatch` → then consumed + leave room.

---

## 4. Bot simulation timing (server)

### Previous behavior

- `generateBracket()` loop: **instant** `resolveBotOnlyMatch` for all bot-only pairs at registration close (~2 min before `scheduled_start`).
- `applyMatchResult` advancement: chained bot-only SF/Final could **complete round 2+ during bracket lobby**.
- Bracket API showed completed matches while UI still counted down to start.

### Intended product behavior

- Bot-only **quarterfinals**: resolve at **`scheduled_start`**, not at bracket generation.
- Bot-only **semifinal/final**: resolve only when **previous round fully complete** and tournament has started.

**P0 fixes applied (`engine.ts`):**

- Removed post-`generateBracket` bot auto-resolve loop.
- `canAutoSimulateBotOnlyMatch`: requires `scheduled_start` passed + prior round complete (round > 1).
- `resolveWaitingBotOnlyQuarterfinals` called from `dispatchScheduledStartMatches`.

---

## 5. Bracket UI (deferred P1)

`TournamentBracketScreen` / hub: structural/visual polish deferred. Runtime fixes ensure **data** is not ahead of human progression.

---

## 6. Socket events (scheduled tournament)

**Inbound:** `tournament:register`, `withdraw`, `get_bracket`, `tournament:attach_assigned_match`

**Outbound:** `registration_open`, `registration_updated`, `bracket_generated`, `match_ready`, `match_updated`, `match_completed`, `round_completed`, `completed`, `cancelled`

**Room:** standard `state:update`, `game:draw_animation`, `hand:ended`, `gameOver` persistence path

---

## 7. REST

`GET /api/tournaments/:id/bracket`, `GET /api/tournaments/me`, `POST register`, `GET result`, etc. (`scheduledTournament/routes.ts`)

`/me` hides `activeAssignedMatch` until `scheduled_start` for dispatchable matches.

---

## 8. Key client files

| File | Role |
|------|------|
| `App.tsx` | Wires `useTournamentMatchSession`, `LiveMatchScreen`, lazy tournament hub/bracket |
| `useTournamentMatchSession.ts` | Attach, finalize, postgame, socket `match_completed` |
| `useTournament.ts` | REST + socket; refreshes bracket on `match_completed` |
| `LiveMatchScreen.tsx` | Shared live UI + `TournamentGameOverOverlay` |
| `useLiveMatchSession.ts` | Hand reveal, draw pulse, play/draw/pass |
| `useRoomSocketSync.ts` | Draw animation events |
| `terminalMatches.ts` | Session terminal match IDs |

---

## 9. Key server files

| File | Role |
|------|------|
| `scheduledTournament/engine.ts` | Bracket, `applyMatchResult`, bot simulation gates |
| `matchDispatch.ts` | Room dispatch, `winningScore` |
| `scheduler.ts` | Open/close registration, `dispatchScheduledStartMatches` |
| `registerRoomSessionHandlers.ts` | Attach, forfeit → `applyMatchResult` |
| `index.ts` | `applyTournamentGameOverFromRoom` on game over |

---

## 10. P0 vs P1

| P0 (this pass) | P1 (later) |
|----------------|------------|
| Game-over overlay + defer finalize | Bracket visual redesign |
| Bot simulation gating | Lazy-load tournament hub/bracket |
| Win target 30 on HUD | Tile spacing audit with design |
| Tests for above | Staged bot sim tied to human round completion UX copy |
