# Tournament mode P0.1 manual QA report

**Date:** 2026-06-01  
**Builds on:** P0 runtime stabilization (`docs/tournament-mode-runtime-stabilization-report.md`)  
**Method:** Code-path audit + automated server/client tests + one targeted P0.1 UI guard. Full browser sign-off still required by a human (see checklist at end).

---

## Validation commands (all pass)

```bash
npm run build --prefix server
npm test --prefix server -- tournament scheduledTournament registerRoomSessionHandlers.tournament tournamentCompletion tournamentExit
npm run build --prefix client
npx ts-node --esm src/tournament/tournamentPostgamePolicy.behaviorTests.ts
npx ts-node --esm src/tournament/tournamentBracketDisplay.behaviorTests.ts
```

| Command | Result |
|---------|--------|
| Server build | Pass |
| Server tournament tests | **103 passed** |
| Client build | Pass |
| Client behavior tests | Pass |

---

## Checklist verification

| # | Requirement | Verification | Status |
|---|-------------|--------------|--------|
| 1 | Lobby countdown does not show completed **future** rounds | **Server:** bot SF/Final no longer simulate before `scheduled_start` + prior round complete (`engine.ts` gates). **Client P0.1:** `isBracketMatchCompletedForDisplay` hides SF/Final `completed` styling during `bracket_lobby` even if API is stale. | **Code + tests** — **human confirm in browser** |
| 2 | Bot-heavy bracket does not complete R2/final before human progresses | `engine.test.ts`: SF not completed before QFs done; bot QFs wait until `scheduled_start`; `canAutoSimulateBotOnlyMatch` requires previous round complete. | **Automated** — human confirm on bot-heavy lobby |
| 3 | Human match plays to 30 | Rooms use `winningScore: tournament.win_target` (30) in `matchDispatch.ts`; game engine ends at config. | **Code** — human play one match |
| 4 | Game-over overlay appears and stays until user action | `shouldDeferTournamentMatchFinalize` on `tournament:match_completed`; no `consumed` on `liveGameOver`; `TournamentGameOverOverlay` via `shouldShowTournamentGameOverOverlay`. | **Automated policy tests** — human confirm overlay |
| 5 | No forced jump before overlay | Deferred finalize while `appMode === 'multiplayer'` && `attachedMatchId === matchId`; bracket refresh only. | **Automated policy tests** — human confirm no flash to bracket |
| 6 | Score target displays 30 | `LiveMatchScreen` receives `winTarget={state?.config?.winningScore ?? 60}` in `App.tsx`. | **Code** — human open score track at 30 |
| 7 | Draw animation matches private MP | Same `LiveMatchScreen` + `useRoomSocketSync` `game:draw_animation` + `drawPulseIndex`; no tournament branch disabling draws. | **Code** — human compare draw in MP vs tournament |
| 8 | Last move at 30 no abnormal freeze/lag | Hand-over suppressed when `gameOver`; no immediate `finalize` on socket complete; confetti/sounds same as MP. Residual lag = hand-over timing + network (not tournament-only teardown). | **Code** — human feel test |
| 9 | After overlay, bracket/next match correct | `navigateAfterTournamentMatch` → `openBracket` + `refresh` + terminal marks; `finalize` on non-live paths. | **Code** — human click through bracket |

---

## P0.1 regression fix applied

**Issue (checklist #1):** Bracket lobby could still **render** semifinal/final as completed if API returned premature bot results (or during countdown), even after server gating.

**Fix:**

- `client/src/tournament/tournamentBracketDisplay.ts` — `isBracketMatchCompletedForDisplay`
- `TournamentBracketScreen.tsx` — use helper for match cards + champion column during `bracket_lobby`

Does not change server truth or gameplay—display-only during lobby countdown.

---

## Files changed (P0.1 only)

| File | Change |
|------|--------|
| `client/src/tournament/tournamentBracketDisplay.ts` | New display helper |
| `client/src/tournament/tournamentBracketDisplay.behaviorTests.ts` | Tests |
| `client/src/tournament/TournamentBracketScreen.tsx` | Lobby SF/Final/champion display guard |
| `docs/tournament-mode-p0-manual-qa-report.md` | This report |

---

## Root causes (recap from P0, confirmed still addressed)

| Symptom | Fix still in place |
|---------|-------------------|
| Modal skipped / instant bracket | Defer finalize + no consumed-on-gameOver |
| R2 done before start | Server bot simulation gates + lobby display mask |
| HUD wrong target | `winTarget` from `state.config.winningScore` |
| Same board path | `LiveMatchScreen` for tournament attach |

---

## Manual browser QA script (required sign-off)

Use `npm run dev` (client) + server with scheduled tournament seed, or staging.

1. **Lobby / bot-heavy bracket**  
   - Register for tournament with mostly bots.  
   - Open bracket lobby during countdown to `scheduled_start`.  
   - **Expect:** SF/Final cards not styled as completed; no champion name; bot QFs may be waiting (not all completed until start).

2. **Start + play to 30**  
   - Attach when match is ready.  
   - **Expect:** Score race track target **30**; tile spacing same as private MP.  
   - Draw from boneyard: flying tile / pulse like private MP.

3. **Game over**  
   - Win or lose at 30.  
   - **Expect:** `TournamentGameOverOverlay` (not instant bracket); no freeze then hard jump.  
   - Wait 2–3s—should remain on overlay.

4. **Leave overlay**  
   - Tap **View Bracket**.  
   - **Expect:** Bracket reflects completed match; next-round assignment sane; attach works if you have a ready match.

5. **Regression spot-check private MP**  
   - One private room draw + game-over—unchanged.

Record pass/fail per step in the table below.

---

## Human sign-off

| Step | Pass | Notes |
|------|------|-------|
| 1 Lobby / bot bracket | ☐ | |
| 2 Play to 30 | ☐ | |
| 3 Game-over overlay | ☐ | |
| 4 After overlay | ☐ | |
| 5 Private MP spot-check | ☐ | |

**Signed off by:** _______________ **Date:** _______________

---

## Deferred to P1 (not failures—out of scope)

- Bracket/hub visual redesign and information architecture  
- Tournament route code-splitting  
- Staged bot simulation UX (one QF at a time as human progresses)  
- Dedicated Playwright e2e for tournament flow  
- Draw animation investigation only if step 2 fails in browser (likely server emit / ref timing, not tournament skin)

---

## Definition of done

| Criterion | Status |
|-----------|--------|
| Automated validation green | **Yes** |
| P0 runtime logic verified in code/tests | **Yes** |
| P0.1 lobby display guard | **Shipped** |
| Browser checklist executed by human | **Pending sign-off** |
| Clear P1 separation | **Yes** |
