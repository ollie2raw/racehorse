# Tournament launch QA matrix (Phase 3E)

What to check before and during the controlled rollout of Tournament Mode
(Fritz Cup + Live Events). Each row says what is proven automatically, where,
and what still needs a person on a real backend / device.

**Automated layers**

| Layer | Command | Covers |
|---|---|---|
| Client unit / component | `npx vitest run` (client) | Hub, banner, HUD clock, bracket, result, history, analytics, join policy, display names |
| Phone layout (harness + fixtures) | `VITE_ENABLE_TOURNAMENTS=true npx playwright test e2e/tournament-hub-mobile.spec.ts e2e/tournament-play-mobile.spec.ts --project=chromium` | Hub portrait, bracket / result / post-match portrait, HUD pieces |
| Real-app journeys | `TOURNAMENT_E2E=1 npx playwright test` (client) | The real app against the e2e-only fake tournament backend (`client/e2e/tournament-backend/`): Fritz Cup and Live Event journeys, foreground recovery, Fritz Cup switch, landscape HUD (native + mobile web) |
| Server | `npx vitest run` (server); `scripts/tournament-db-verify.sh` | Routes, engine, dispatch, rooms, turn clock, recovery, restart, multi-instance lease; database rules against real PostgreSQL |

The real-app journeys cannot use the real tournament engine (it persists
through Supabase, and tests never touch a real Supabase project), so the
manual rows below are the only full-stack proof. Run them on the **dev**
project (`docs/ops/dev-supabase-project.md`) before production.

## Feature flags

| Flag | Where | Off | On | Automated |
|---|---|---|---|---|
| `VITE_ENABLE_TOURNAMENTS` | client build | No Tournament tab; routes land on the Hub's "unavailable" state; no fetch, no socket | Tournament tab + Hub | `tournamentsFeature.test.ts`, Hub tests |
| `TOURNAMENTS_ENABLED` | server | Hub: "Tournaments are unavailable right now"; `/history` empty | Live Events | Hub tests; server `tournamentsDisabled.test.ts` |
| `FRITZ_CUP_ENABLED` | server | No Fritz Cup card, no Fritz Cup copy (Hub, History empty state, Welcome); an active cup stays reachable; Live Events work | Fritz Cup card + copy, no client rebuild | Hub / History / Welcome tests; journey "Fritz Cup switch" |

Manual: flip `FRITZ_CUP_ENABLED` on a running dev server and confirm the card
appears after the app returns to the foreground — no new build.

## Live Event

| State | Expect | Automated | Manual |
|---|---|---|---|
| Before registration | "Registration opens in …"; no Register | Hub tests | ✓ |
| Open | Local time ("Today · 8:00 PM"), "N registered · Fritz fills open seats", Register | Hub tests; journey | ✓ |
| Registered | Stays on the Hub; "Registered" chip; Withdraw while open | Hub tests; journey | ✓ |
| Full (8 humans) | "8 registered · Full"; no Register; no Fritz-fill claim | Hub tests; journey | rare in practice |
| Closed | "Registration closed" + start countdown; no negative countdown | Hub tests | ✓ |
| Ready | Hub card + app-wide banner "Your Quarterfinal is ready" with Join; **never auto-joined** | Hub / banner tests; journey | ✓ |
| In progress | Resume; restore on reconnect / foreground if already joined | lifecycle tests; journey | ✓ |
| Advanced | Post-match "You won → Advanced to the Semifinal"; "Join Semifinal" by tap | overlay tests | ✓ |
| Eliminated | "Eliminated in the Quarterfinal · Lost to …"; History row | journey | ✓ |
| Champion | Result "Tournament Champion"; History "Champion · Won" | Fritz journey | ✓ |
| Cancelled | "This event was cancelled"; no countdown, no Join / Register; banner gone | Hub tests; journey | ✓ |
| Errors | Closed / full / overlap (names the other event in local time) / network — on the card | Hub tests; journey | ✓ |

## Fritz Cup

| Case | Expect | Automated | Manual |
|---|---|---|---|
| Create | Play → Starting → Building → the Quarterfinal joins (the Play tap) | journey | ✓ |
| Cooldown / daily limit | "You just started a Cup. Try again in Ns." / "That's today's Fritz Cup limit." | copy tests | ✓ (dev limits) |
| Overlap | "You're entered in a Live Event at 8:00 PM…" | copy tests | ✓ |
| QF / SF / F | Fritz, Elite Fritz, Master Fritz (chip "Fritz"); each later round **by tap** | journey; join policy tests | ✓ |
| Lose | Eliminated; no Semifinal offered; History "Quarterfinal", champion Master Fritz | journey | ✓ |
| Champion | Result + History | journey | ✓ |
| Restart / resume | Server restart mid-cup; the player resumes the in-progress match | server `tournamentRestartMidMatch.test.ts`, `tournamentCrashRecovery.test.ts` | ✓ (dev) |

## Turn clock (tournament rooms)

| Case | Expect | Automated | Manual |
|---|---|---|---|
| Normal turn | "Your turn · 45s" / "Opponent's turn · 45s" (human); Fritz turns untimed ("Elite Fritz is thinking") | clock tests; landscape journey | ✓ |
| First miss | "1 missed turn" | clock tests | ✓ (wait 45 s) |
| Second miss | "2 missed turns · one more will forfeit the match" (highlighted) | clock tests; landscape journey | ✓ |
| Third miss | Server forfeits (missed turns); "Eliminated · Match ended after missed turns" | server `tournamentTurnClock.test.ts`; copy tests | ✓ |
| Expiry | "Resolving turn…"; no local action; state resync if no update | clock tests | ✓ |
| Reconnect | Countdown resumes from the server deadline (no fresh 45 s) | clock tests | ✓ |
| Next hand | "Next hand in 18s"; no miss warning | clock tests | ✓ |
| Disconnect | "Opponent disconnected. The match continues on the turn clock." (no 30 s) | copy tests | ✓ |

## Multi-instance / restart

Covered by the server suite and the Phase 2 ops notes — not repeated here:
orchestrator lease (`orchestratorLease.test.ts`, `docs/ops/tournament-phase2-rollout.md`
"What the lease does and does not do"), restart mid-match and crash recovery
(server tests above), database rules (`scripts/tournament-db-verify.sh`).

## Device sizes

| Surface | Sizes | Automated |
|---|---|---|
| Hub (portrait) | 390×844, 320×640 | `tournament-hub-mobile.spec.ts` |
| Bracket / result / post-match / history (portrait) | 390×844, 320×640 | `tournament-play-mobile.spec.ts`, History tests |
| Match (landscape; portrait asks to rotate) | 844×390, 667×375 — native app and mobile web | `tournament-e2e-landscape-hud.spec.ts` (real app) |

Manual: one physical iPhone (native build) and one Android browser, a full
Fritz Cup each.

## Rollout

Follow `docs/ops/tournament-phase2-rollout.md` (steps 1–11; Fritz Cup last).
Phase 3 client = step 9. Before step 11, run the Fritz Cup rows above on dev.

## Analytics (PostHog)

Check once per event on dev with a PostHog key: `tournament_hub_viewed`,
`fritz_cup_tapped` / `created` / `create_failed`, `live_event_register_tapped`
/ `registered` / `registration_failed`, `tournament_match_ready` / `joined`,
`tournament_eliminated` / `champion`; `game_opened` / `game_completed` carry
`tournament: true` in tournament rooms. No usernames or ids in properties.
