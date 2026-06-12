# Tournament P0 Browser QA Execution Plan

Date: 2026-06-03  
Scope: execution plan only for Tournament P0 browser verification before public beta. No production code changes in this pass.

## Goal

Turn the existing tournament stabilization work into a strict browser QA pass that can answer one question clearly:

Is Tournament safe for controlled public beta on real browsers, with real reload/disconnect/final-move behavior, without mixing in P1 visual polish or architecture refactors?

## Existing Automated Coverage

Current automated checks already cover the known code-level fixes:

```bash
npm test --prefix server -- tournament scheduledTournament registerRoomSessionHandlers.tournament tournamentCompletion tournamentExit
npx ts-node --esm src/tournament/tournamentPostgamePolicy.behaviorTests.ts
npx ts-node --esm src/tournament/tournamentBracketDisplay.behaviorTests.ts
npx ts-node --esm src/tournament/displayNames.behaviorTests.ts
```

Observed status in this pass:

| Check | Result | What it proves |
|---|---|---|
| Server tournament suite | Pass, 19 files / 103 tests | Bot simulation gates, attach flow, recovery, game-over result application, bracket lifecycle, routes/auth |
| `tournamentPostgamePolicy` behavior test | Pass | Overlay should not be consumed too early; finalize deferral rules hold |
| `tournamentBracketDisplay` behavior test | Pass | Future/bot result reveal gating is correct in pure display logic |
| `displayNames` behavior test | Pass | Fritz bot naming stays stable and numbered |

What automation does not prove:

- Real browser rendering of the game-over overlay
- Real draw animation visibility
- Real hand rack spacing perception
- Real reload behavior with browser session state
- Real socket disconnect timing during ready/live/postgame
- Real navigation back to bracket after overlay

## Test Environment

Run the browser pass in the smallest environment that still preserves real tournament behavior:

1. Client dev or staging build with Tournament enabled.
2. Server build matching current scheduled tournament code.
3. One authenticated human account.
4. A second authenticated account is optional but not required for the mostly-bot pass.
5. Browser targets:
   - Chrome desktop
   - Safari desktop if available
   - Mobile/tablet smoke after desktop P0 passes
6. Network tools:
   - Browser devtools reload
   - Browser devtools offline / throttling for slow-network checks if practical

Preferred baseline path:

- Use a mostly-bot tournament with one human entrant.
- This exercises registration, bracket lock, attach, live match, staged reveal, semifinal/final attach, and champion result without requiring a second person.

## Exact Browser QA Matrix

| ID | Scenario | Setup | Steps | Expected result | Failure symptoms | Suspected files if it fails | Severity |
|---|---|---|---|---|---|---|---|
| TQ-01 | Mostly-bot tournament from registration to champion | Signed in as one human; upcoming tournament visible; enough empty seats for bot fill | Register for next tournament. Wait through lock/start. Play all assigned matches to champion. | Human sees QF -> SF -> Final progression, attaches correctly each round, target is 30, overlay appears after each win, bracket updates, final result screen/hub state is correct. | Missing attach banner, wrong round routing, bracket stuck, wrong target, no overlay, premature champion state, stale room recovery. | `client/src/tournament/useTournament.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `server/src/scheduledTournament/engine.ts`, `server/src/scheduledTournament/matchDispatch.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts` | P0 |
| TQ-02 | Registration countdown | Signed in; tournament registration open | Open Tournament hub before registration close. Watch countdown through the final minute. | Countdown is stable, does not jump backward, registration state refreshes near close, hub/bracket state transitions cleanly. | Countdown stalls, registration stays open after close, abrupt blank state, stale CTA state. | `client/src/tournament/TournamentHubScreen.tsx`, `client/src/tournament/useTournament.ts`, `server/src/scheduledTournament/routes.ts`, `server/src/scheduledTournament/scheduler.ts` | P1 |
| TQ-03 | Waiting room field fill | Signed in; registered for tournament with open seats | Open bracket/waiting room before close. Watch registered field fill and open seats. | Field count updates, open seats are clear, bot fill expectation is understandable, no broken seat ordering. | Count mismatch, duplicate seat rows, bot seats appear too early, blank field list. | `client/src/tournament/TournamentBracketScreen.tsx`, `client/src/tournament/TournamentHubScreen.tsx`, `server/src/scheduledTournament/routes.ts`, `server/src/scheduledTournament/persistence.ts` | P1 |
| TQ-04 | Bracket lock | Signed in and registered; waiting room open near close | Stay on waiting room through registration close. | Bracket lock state appears cleanly; no stale register/withdraw controls; assigned opponent context appears when appropriate. | Waiting room never transitions, stale controls remain, bracket view missing, wrong phase banner. | `client/src/tournament/useTournament.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/meState.ts`, `server/src/scheduledTournament/routes.ts` | P0 |
| TQ-05 | Projected bracket | Signed in and registered before close | View projected bracket during waiting room and immediately after lock. | Before human finishes a match, future/bot completions are not displayed early; champion remains TBD. | SF/final already completed, champion shown too soon, bot QF completions shown before allowed reveal. | `client/src/tournament/tournamentBracketDisplay.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-06 | Human quarterfinal attach | Signed in; tournament reaches first assigned match | From hub/bracket banner, click Join Match / Start Match. | Attach succeeds once, routes into live match, seat is correct, no duplicate join or stale room. | Button does nothing, attach loops, wrong seat, stale room code, room already complete. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/useTournament.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts`, `server/src/scheduledTournament/matchDispatch.ts` | P0 |
| TQ-07 | Match HUD target 30 | In live tournament match | Check score race track / HUD before and during play. | Win target displays 30, and match ends at 30 consistently. | HUD shows 60, match ends at 30 while HUD says otherwise, or match wrongly continues past 30. | `client/src/App.tsx`, `client/src/match/LiveMatchScreen.tsx`, `server/src/scheduledTournament/matchDispatch.ts` | P0 |
| TQ-08 | Draw animation visibility | In live tournament match with a forced draw opportunity | Trigger a draw from boneyard. Watch hand tray and board area. | Same visible pulse/flying draw behavior as private multiplayer; outcome is understandable. | Nothing visible happens, tile appears silently, animation desync, wrong tray pulse. | `client/src/multiplayer/useRoomSocketSync.ts`, `client/src/match/LiveMatchScreen.tsx`, `server/src/multiplayer/roomSession.ts`, `server/src/rooms.ts` | P0 |
| TQ-09 | Hand rack spacing | In live tournament match with full hand | Inspect rack before and after first draw. Compare against private MP reference if needed. | Rack gap and deck height match shared live-match behavior; tiles are not cramped. | Tiles too tight, tray clipped, hand deck compressed, overlap on shorter viewport. | `client/src/match/LiveMatchScreen.tsx`, `client/src/styles/board/board-hand-dock.css`, `client/src/components/TileRack.tsx` | P1 |
| TQ-10 | Game-over overlay at 30 | Reach score 30 in tournament match | Watch final scoring move through game over. | Tournament game-over overlay appears after the match ends. | Instant jump to bracket, modal never renders, brief flash then teardown, frozen end state. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/tournamentPostgamePolicy.ts`, `client/src/match/LiveMatchScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-11 | Overlay stays until user action | Game-over overlay is visible | Wait 2-3 seconds without clicking. | Overlay remains stable until explicit action. | Overlay disappears on its own, bracket steals focus, auto-navigation occurs. | `client/src/tournament/tournamentPostgamePolicy.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `client/src/match/LiveMatchScreen.tsx` | P0 |
| TQ-12 | Return to bracket after human win | Win QF and click View Bracket | Use overlay action to return to bracket. | Bracket opens cleanly, completed QF is reflected, next round is correct. | Button dead, wrong route, stale live match remains, bracket missing completed result. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/useTournament.ts`, `client/src/tournament/TournamentBracketScreen.tsx` | P0 |
| TQ-13 | Staged reveal after human round 1 win | Win QF in mostly-bot bracket | Return to bracket immediately after QF win. | Other QF results may reveal; SF/final stay pending unless allowed by reveal rules. | SF/final shown complete too early; champion appears early; all bot path resolved visually at once. | `client/src/tournament/tournamentBracketDisplay.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-14 | Human semifinal attach | Human advanced from QF | Join semifinal from bracket banner when ready. | Attach works exactly once, live HUD/target/context correct. | Attach fails only in later rounds, stale prior room, wrong opponent label. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/useTournament.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts` | P0 |
| TQ-15 | Human final attach | Human advanced from SF | Join final when ready. | Final attach works, live match is stable, opponent labeling and stage context are correct. | Final never becomes ready, attach banner missing, wrong stage label. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/TournamentMatchHud.tsx`, `server/src/scheduledTournament/engine.ts`, `server/src/scheduledTournament/matchDispatch.ts` | P0 |
| TQ-16 | Champion result | Human wins final | Finish final and follow postgame/result flow. | Tournament result shows champion/placement cleanly and does not bounce back into live match. | Final overlay loops, result unavailable, stale room recovery on completed match. | `client/src/tournament/TournamentResultScreen.tsx`, `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/terminalMatches.ts`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-17 | Human loses round 1 | Lose QF in mostly-bot bracket | Play until loss at 30. Return to bracket. | Overlay appears, elimination state is clear, full resolved bracket can reveal, no next-match attach prompt. | No overlay, stale attach prompt after loss, bracket still treats user as active, hidden elimination. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/bracketTerminal.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-18 | Human loses semifinal | Advance from QF, then lose SF | Return to bracket after SF loss. | Elimination state is correct; final/champion may reveal; no final attach prompt. | Stuck in active state, final hidden when it should reveal, wrong placement. | `client/src/tournament/bracketTerminal.ts`, `client/src/tournament/tournamentBracketDisplay.ts`, `client/src/match/session/useTournamentMatchSession.ts` | P0 |
| TQ-19 | Reload during lobby | Registered, still on hub before bracket lobby | Reload browser on Tournament hub while registered. | Recovery returns to hub/registered state; no lost registration UI. | User appears unregistered, stale tournament from old event, blank recovery banner. | `client/src/tournament/useTournament.ts`, `client/src/tournament/recoverySignals.ts`, `server/src/scheduledTournament/routes.ts`, `server/src/scheduledTournament/meState.ts` | P1 |
| TQ-20 | Reload during bracket lobby | Registered, bracket locked, not yet in match | Reload while on bracket lobby/countdown. | Bracket lobby recovers correctly; assigned opponent/countdown remain sane; no stale ready/live room. | Returns to plain hub, wrong countdown, future rounds pre-completed, stale active room banner. | `client/src/tournament/useTournament.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/meState.ts`, `server/src/scheduledTournament/recovery.ts` | P0 |
| TQ-21 | Reload during assigned match | Match is ready, attach banner visible but not yet joined | Reload before clicking Join Match. | Recovery still offers correct assigned match join. | Join prompt disappears, wrong room, stale tournament selection. | `client/src/tournament/useTournament.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `server/src/scheduledTournament/persistence.ts`, `server/src/scheduledTournament/meState.ts` | P0 |
| TQ-22 | Reload during live match | In active tournament match | Reload mid-hand. | User recovers into the active match or receives a clear attach/rejoin path; not into a stale terminal room. | Sent to completed room, missing room, wrong seat, game state reset, silent failure. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/useTournament.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts`, `server/src/scheduledTournament/recovery.ts`, `server/src/multiplayer/roomSession.ts` | P0 |
| TQ-23 | Reload while game-over modal is showing | Reach tournament overlay after game end | Reload before clicking View Bracket. | Recovery does not lose terminal state; user can still reach correct bracket/result path; no stale live room loop. | Rejoins ended room, overlay disappears permanently, wrong bracket state, stale active match recovery. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/terminalMatches.ts`, `client/src/tournament/useTournament.ts`, `server/src/scheduledTournament/persistence.ts` | P0 |
| TQ-24 | Reload after returning to bracket | Finish match, return to bracket, then reload | Reload on bracket after completed round. | Bracket reflects completed round correctly and does not reopen prior room. | Old room resumes, stale attach prompt, bracket missing previous completion. | `client/src/tournament/terminalMatches.ts`, `client/src/tournament/useTournament.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `server/src/scheduledTournament/routes.ts` | P0 |
| TQ-25 | Socket disconnect during match-ready | Match ready banner visible or assigned match activeAssignedMatch present | Simulate offline before joining or while countdown is active, then reconnect. | Recovery surfaces rejoin path when connection returns; no premature no-show UI. | Lost assigned match, confusing stale banner, no rejoin after reconnect. | `client/src/tournament/recoverySignals.ts`, `client/src/tournament/useTournament.ts`, `server/src/scheduledTournament/engine.ts`, `server/src/scheduledTournament/meState.ts` | P0 |
| TQ-26 | Socket disconnect during live match | In active tournament match | Simulate offline mid-hand, then reconnect. | User reconnects or reattaches into the same live match if still active; no stale completed-room attach. | Match state lost, wrong seat, attach denied incorrectly, room gone without path forward. | `client/src/multiplayer/useMultiplayerConnection.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `server/src/multiplayer/disconnectGrace.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts`, `server/src/multiplayer/roomSession.ts` | P0 |
| TQ-27 | Slow network during attach | Use network throttling before clicking Join Match | Click Join Match on slow 3G or high-latency profile. | Pending state is visible; attach either succeeds or fails with clear retry path. | Silent button, duplicate clicks, hung pending, wrong eventual room state. | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/multiplayer/registerRoomSessionHandlers.ts` | P1 |
| TQ-28 | Slow network during final move | Throttle network while near score 30 | Play final scoring move under throttling. | Overlay still appears and remains stable; bracket update can lag but must not preempt overlay. | Auto-jump before overlay, frozen final move, missing result, duplicate overlay. | `client/src/tournament/tournamentPostgamePolicy.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `client/src/match/LiveMatchScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 |
| TQ-29 | Fritz bot names stable | Any mostly-bot bracket with visible bots across rounds | Inspect waiting room, bracket, and live opponent labels in QF/SF/Final. | Bots show stable numbered names such as Fritz 1, Elite Fritz 1, Master Fritz 1. | Generic "Fritz" everywhere, unstable renumbering, raw bot token visible. | `client/src/tournament/displayNames.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P1 |

## Execution Order

Run the browser pass in this order:

1. TQ-02 through TQ-06
2. TQ-07 through TQ-13
3. TQ-14 through TQ-18
4. TQ-19 through TQ-29

Reason:

- First prove registration, lock, and attach.
- Then prove the live-match P0 risks.
- Then prove elimination and champion branches.
- Finally prove reload/disconnect/slow-network recovery.

## Focused Patch Plan For Likely Failures Only

This section is intentionally narrow. If a failure is confirmed in browser QA, patch only the smallest tournament-specific surface required.

| Likely failure | Confirming browser symptom | Smallest likely patch surface | Suspected files | Patch scope classification |
|---|---|---|---|---|
| Skipped or disappearing game-over overlay | Final move reaches 30 and app jumps to bracket or overlay vanishes without input | Client postgame state gating only | `client/src/tournament/tournamentPostgamePolicy.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `client/src/match/LiveMatchScreen.tsx` | P0 patch |
| Draw animation not visible | Draw action succeeds but no visible pulse/flying tile appears | Shared live draw event/render path only if tournament reproduces it reliably | `client/src/multiplayer/useRoomSocketSync.ts`, `client/src/match/LiveMatchScreen.tsx`, `server/src/multiplayer/roomSession.ts`, `server/src/rooms.ts` | P0 patch |
| Rack spacing still too tight | Live tournament rack is visibly more cramped than private multiplayer | Shared live hand layout only | `client/src/match/LiveMatchScreen.tsx`, `client/src/styles/board/board-hand-dock.css`, `client/src/components/TileRack.tsx` | P1 patch unless clipping blocks play |
| Bracket reveals future/bot results too early | SF/final or champion appears before allowed human progression | Display gating first, server timing second | `client/src/tournament/tournamentBracketDisplay.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `server/src/scheduledTournament/engine.ts` | P0 patch |
| Bot-only matches complete too early | Bot QF/SF/final complete during lobby or before prior round is legitimately resolved | Server simulation timing only | `server/src/scheduledTournament/engine.ts`, `server/src/scheduledTournament/scheduler.ts`, `server/src/scheduledTournament/matchDispatch.ts` | P0 patch |
| Match target is not 30 | HUD shows 60 or match/end-state disagrees with UI target | Live HUD wiring only | `client/src/App.tsx`, `client/src/match/LiveMatchScreen.tsx`, `server/src/scheduledTournament/matchDispatch.ts` | P0 patch |
| Return-to-bracket is broken | Overlay button does nothing, routes wrong, or leaves stale live room behind | Tournament match finalize/navigation path only | `client/src/match/session/useTournamentMatchSession.ts`, `client/src/tournament/useTournament.ts`, `client/src/tournament/terminalMatches.ts` | P0 patch |
| Reload recovery shows stale/incorrect tournament state | Reload returns user to wrong room, wrong tournament, missing assigned match, or old completed match | Tournament recovery/session state only | `client/src/tournament/useTournament.ts`, `client/src/tournament/recoverySignals.ts`, `client/src/match/session/useTournamentMatchSession.ts`, `server/src/scheduledTournament/recovery.ts`, `server/src/scheduledTournament/meState.ts`, `server/src/multiplayer/registerRoomSessionHandlers.ts` | P0 patch |
| Fritz bot names unstable or generic | Generic "Fritz" appears everywhere or raw ids leak | Display name resolution only | `client/src/tournament/displayNames.ts`, `client/src/tournament/TournamentBracketScreen.tsx`, `client/src/tournament/TournamentHubScreen.tsx` | P1 patch |

Guardrails for any later patch:

- Patch only the failing tournament path.
- Do not rewrite shared room architecture in response to one browser failure.
- Do not touch bot AI or Racehorse rules to "fix" presentation problems.
- Do not mix waiting-room/bracket polish with P0 runtime fixes.

## Minimal Playwright Recommendation

Do not implement this suite in this pass. This is the smallest useful Tournament-only suite after manual QA clarifies selectors and seed setup.

### Suite goal

Catch the four highest-value regressions:

1. `register -> bracket -> attach -> play to 30 -> overlay -> return to bracket`
2. `no future rounds completed before allowed reveal`
3. `reload during live match`
4. `reload during game-over overlay`

### Recommended test file layout

```text
client/e2e/tournament.p0.spec.ts
```

### Recommended tests

| Test id | Flow | Why it matters |
|---|---|---|
| PW-T1 | Register for a mostly-bot tournament, reach assigned QF, attach, force or play to 30, assert overlay visible, click View Bracket, assert QF completed and route is bracket | Proves the main human path and the overlay/return-to-bracket contract |
| PW-T2 | Before human finishes QF, assert no SF/final completed styling and no champion name | Proves staged reveal guard |
| PW-T3 | Reload during an active tournament match, assert recovery returns to the same live match or a valid reattach path | Proves live-match recovery |
| PW-T4 | Reload while game-over overlay is visible, assert no stale room loop and user can reach bracket/result | Proves terminal recovery |

### Harness assumptions

- Use a seeded mostly-bot tournament fixture or an environment where one human registration fills remaining seats with bots.
- Expose stable `data-testid` hooks if current selectors are too brittle.
- Use deterministic tournament schedule fixtures where possible instead of real wall-clock waiting.
- For PW-T1, it is acceptable to drive the server into a near-terminal tournament match state if a direct full-play simulation is too slow, but only after the manual pass establishes the UI contract.

### What this suite should not do

- Do not try to validate waiting-room/bracket visual polish.
- Do not simulate multi-instance durability.
- Do not test Daily Fritz, Ghost, or Private Multiplayer in this suite.
- Do not overbuild a full tournament lab before the four P0 tests are stable.

## Strict Do Not Touch

- No visual P1 waiting room polish
- No broad `App.tsx` refactor
- No server engine rewrite
- No bot AI changes
- No durable room architecture work in this pass
- No Daily Fritz changes
- No Ghost changes
- No Quick Match changes
- No Private Multiplayer changes unless a direct Tournament dependency is proven
- No Learn changes
- No Social / Leaderboards / Share changes
- No `ranked_games` migration

## Output Template For Human QA Run

Use one row per executed scenario:

| Scenario | Browser | Pass/Fail | Notes | Screenshot/Video | Follow-up |
|---|---|---|---|---|---|
| TQ-01 | Chrome |  |  |  |  |

Minimum artifacts to keep for P0 failures:

- One screenshot or short video of the failure
- Console/network note if relevant
- Tournament id or room code if visible
- Exact scenario id from this plan

## Current Verdict Before Browser Pass

No new confirmed Tournament P0 failure was discovered in this planning pass. Existing tournament automation remains green, which means the next pass should focus on real browser proof, not additional source refactoring.

Definition of done for the next pass:

1. Execute the matrix above in a real browser.
2. Mark each scenario pass/fail.
3. If any P0 item fails, map it to the focused patch plan above.
4. Patch only confirmed P0 tournament failures after explicit instruction.
