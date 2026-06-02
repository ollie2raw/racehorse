# Tournament mode runtime stabilization report

**Date:** 2026-06-01  
**Pass:** P0 runtime fixes (audit: `docs/tournament-mode-runtime-stabilization-audit.md`)

---

## Root causes found

| Symptom | Root cause |
|---------|------------|
| Game-over modal missing / skip to bracket | `liveGameOver` added match to `consumedTournamentGameOverMatchIdsRef` immediately; `tournament:match_completed` called `finalizeTournamentMatchSession` while still in `appMode === 'multiplayer'`, tearing down `LiveMatchScreen` before overlay rendered. |
| Freeze / lag at score 30 | Same race: server completion + client finalize vs hand-over / `gameOver` state; UI never settled on postgame overlay. |
| Score track / “wrong” end feel | `LiveMatchScreen` used default `winTarget={60}` while tournament rooms use **30**. |
| Round 2 complete before start | `generateBracket()` instantly resolved all bot-only matches and chained SF/Final bot simulations during **bracket lobby** (before `scheduled_start`). |
| Tiles “different” | No separate tournament board—shared `LiveMatchScreen`; HUD/target mismatch and tournament HUD overlay were the main perceptual deltas. |
| Draw animations “missing” | Same pipeline as private MP; no tournament-specific disable found. |

---

## Files changed

| File | Change |
|------|--------|
| `server/src/scheduledTournament/engine.ts` | Gate bot simulation on `scheduled_start` + prior round complete; remove bracket-gen bot loop; `resolveWaitingBotOnlyQuarterfinals` at scheduled start |
| `server/src/scheduledTournament/engine.test.ts` | Updated/added tests for bot timing and bracket lobby |
| `server/src/scheduledTournament/engine.gameOver.test.ts` | Idempotent `applyMatchResult` test |
| `client/src/match/session/useTournamentMatchSession.ts` | Defer finalize on `match_completed` during live match; stop consuming overlay on `liveGameOver` |
| `client/src/tournament/tournamentPostgamePolicy.ts` | **New** — pure postgame defer/show helpers |
| `client/src/tournament/tournamentPostgamePolicy.behaviorTests.ts` | **New** — client behavior tests |
| `client/src/match/LiveMatchScreen.tsx` | Use `shouldShowTournamentGameOverOverlay` |
| `client/src/App.tsx` | `winTarget={state?.config?.winningScore ?? 60}` on `LiveMatchScreen` |
| `docs/tournament-mode-runtime-stabilization-audit.md` | **New** audit |
| `docs/tournament-mode-runtime-stabilization-report.md` | **New** report |

---

## What was fixed (P0)

1. **Tournament game-over overlay** shows and stays until the player chooses bracket/result/hub.
2. **`tournament:match_completed`** no longer resets the live room while the player is still in the attached match.
3. **Win target HUD** matches server `winningScore` (30) for tournament live play.
4. **Bot-vs-bot QFs** no longer auto-complete at bracket generation; they resolve at **`scheduled_start`**.
5. **Bot-vs-bot SF/Final** no longer simulate until the **previous round is fully complete** and the tournament has started.

---

## Deferred (P1)

- Bracket / hub visual and structural redesign
- Lazy-load tournament hub/bracket chunks
- Optional: simulate bot QFs one-by-one as human finishes (current: all bot QFs at start, not chained into SF until QFs complete)
- Draw animation investigation if still missing after manual QA (server emit / ref timing)

---

## Tests added/updated

| Suite | Coverage |
|-------|----------|
| `server/.../engine.test.ts` | Bot QFs waiting in lobby; resolve at start; SF not completed before QFs done |
| `server/.../engine.gameOver.test.ts` | Double `applyMatchResult` idempotent |
| `client/.../tournamentPostgamePolicy.behaviorTests.ts` | Defer finalize + overlay consumed gating |

Run client behavior test:

```bash
npx ts-node --esm src/tournament/tournamentPostgamePolicy.behaviorTests.ts
```

---

## Build / test results

```bash
npm run build --prefix server          # pass
npm test --prefix server -- tournament scheduledTournament registerRoomSessionHandlers.tournament tournamentCompletion tournamentExit  # 103 passed
npm run build --prefix client          # pass
```

---

## Manual QA checklist

- [ ] Register / join tournament; bracket lobby countdown — **no completed SF/Final** from bot chains before start
- [ ] At start, attach to human QF; play to **30** — **Tournament game-over overlay** appears (not instant bracket jump)
- [ ] Overlay buttons → bracket — smooth transition, no double navigation flash
- [ ] Score race track shows **30** target in tournament match
- [ ] Draw from boneyard shows pulse/fly animation (same as private MP)
- [ ] Win bot-heavy bracket: round 2 bracket cells not “done” while you are still in round 1
- [ ] Complete match → bracket updates; next match attach works

---

## Definition of done status

| Criterion | Status |
|-----------|--------|
| Game-over flow not fighting live match | **Fixed** (client defer + overlay gating) |
| Bot simulations not pre-completing future rounds before start | **Fixed** (server gates) |
| Runtime correct enough for P1 bracket polish | **Ready for QA sign-off** |
| Automated tests | **Added/updated** |
