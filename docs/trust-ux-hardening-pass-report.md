# Trust UX Hardening Pass Report

Date: 2026-06-03  
Scope: production trust gates (not visual polish). Hands-off pass.

## Executive summary

Tournament P0 browser QA remains **blocked on one-time QA auth**. Server-side seeding works with existing `server/.env`. Automated tournament tests and client/server builds are **green**. No confirmed Tournament P0 browser failures were reproduced (auth blocked the harness). This pass added **recovery copy**, **beta honesty labels**, and **attach error humanization** without gameplay or rule changes.

## Update (2026-06-03) — Live QA seed states

Supported CLI seeds (requires `ENABLE_QA_TOURNAMENT_SEED=1` on **running** server for in-memory fixtures):

| State | DB | In-memory on attach |
|-------|-----|---------------------|
| `waiting_room` | registration open | — |
| `bracket_lock` | bracket generated | — |
| `assigned_qf` | match `ready` + room code | fresh room on attach |
| `live_qf` | match `in_progress` + `qa_fixture:live_qf` | scores 12/10 mid-hand |
| `near_30_qf` | match `in_progress` + `qa_fixture:near_30_qf` | scores 29/18 |
| `overlay_qf_win` | match `in_progress` + `qa_fixture:overlay_qf_win` | scores 30/22, `gameOver` |

```bash
npm run build --prefix server
npm run qa:tournament:seed --prefix server -- --state live_qf
npm run qa:tournament:seed --prefix server -- --state near_30_qf
npm run qa:tournament:seed --prefix server -- --state overlay_qf_win
```

Playwright harness (`client/scripts/tournamentP0BrowserQa.mjs`) now exercises TQ-07–11, TQ-22–23, TQ-26, TQ-28 when auth is present. TQ-08 remains **Not Run** (no forced draw automation).

## Gate 0 — Tournament P0 browser QA

### What ran

| Step | Result |
|------|--------|
| Read execution / unblock / results docs | Done |
| `client/scripts/tournamentP0BrowserQa.mjs` present | Yes |
| `server/src/scheduledTournament/qaSeed.ts` + `seedTournamentQa.ts` present | Yes |
| `npm run qa:tournament:seed --prefix server -- --state waiting_room` | **Pass** (Supabase + QA env) |
| `npm run qa:tournament:p0 --prefix client` | **Not run** — no auth |

### QA auth status

- `client/.auth/tournament-qa.json`: **missing**
- `QA_TOURNAMENT_EMAIL` / `QA_TOURNAMENT_PASSWORD`: **not in repo env**
- `server/.env` has: `ENABLE_QA_TOURNAMENT_SEED`, `QA_TOURNAMENT_USER_ID`, `SUPABASE_*`, `QA_ALLOW_NONLOCAL_STAGING`

### TQ matrix status (unchanged from blocked harness)

| Bucket | IDs | Status |
|--------|-----|--------|
| Blocked (no auth) | TQ-01–07, TQ-19–21, TQ-25, TQ-27 | Blocked |
| Harness-ready once auth exists | TQ-07–11, TQ-22–23, TQ-26, TQ-28 via `live_qf`, `near_30_qf`, `overlay_qf_win` | Blocked on auth only |
| Still manual / not seeded | TQ-12–18, TQ-24, TQ-29 | Not run |

**Verdict:** Environment partially unblocked (seed CLI). Browser matrix incomplete until auth.

### One-time user action to unblock browser QA

Choose **one**:

1. Export credentials and run harness:
   ```bash
   export QA_TOURNAMENT_EMAIL='your-qa@email'
   export QA_TOURNAMENT_PASSWORD='your-password'
   npm run build --prefix server
   npm run qa:tournament:p0 --prefix client
   ```
2. Or sign in once in a browser, then save Playwright storage (harness creates `client/.auth/tournament-qa.json` on first successful login).

Prerequisites already satisfied in this workspace: `ENABLE_QA_TOURNAMENT_SEED=1`, `QA_TOURNAMENT_USER_ID`, hosted Supabase + `QA_ALLOW_NONLOCAL_STAGING=1`, local server on `:3001`.

## Gate 1 — Confirmed P0 tournament fixes

**No confirmed P0 failures** from browser QA (harness did not execute authenticated scenarios).

Code audit (existing stabilization, not changed this pass):

- Game-over deferral: `shouldDeferTournamentMatchFinalize` + `tournament:match_completed` handler in `useTournamentMatchSession.ts`
- Overlay gating: `tournamentPostgamePolicy.ts` + `LiveMatchScreen` consumed-match set
- HUD target: `LiveMatchScreen` uses `state?.config?.winningScore` (tournament rooms set `win_target: 30` server-side)
- Staged bracket: `tournamentBracketDisplay.ts` behavior tests green

**No Gate 1 code patches applied** (nothing newly confirmed broken).

## Gate 2 — Recovery copy (done)

| Area | Change |
|------|--------|
| Tournament attach | New `tournamentAttachMessages.ts`; humanized server error codes; reconnect copy when socket down on manual Join |
| Tournament attach session | `useTournamentMatchSession.ts` uses formatter; triggers reconnect on `socket_not_connected` |
| Quick Match | `MatchmakingScreen.tsx` timeout help text aligned to **~90s** server `timeoutAfterMs` |
| Daily Fritz finalize | Clearer messages for hash mismatch / missing attempt in `DailyFritzScreen.tsx` |

## Gate 3 — Beta honesty labels (done)

| Surface | Copy |
|---------|------|
| Social ranked leaderboard | `LeaderboardScreen.tsx` — "Beta — standings may lag briefly after matches" |
| Daily Fritz leaderboard | `DailyFritzLeaderboardScreen.tsx` — results sync note |
| Stats hero | `StatsScreen.tsx` + `statsScreen.css` — ranked/Ghost lag note |

## Verification

| Command | Result |
|---------|--------|
| `npm test --prefix server -- tournament` | **Pass** — 20 files, 112 tests |
| `npm test --prefix server -- qaSeed` | Run with tournament filter or full suite as needed |
| `npm run build --prefix server` | **Pass** |
| `npm run build --prefix client` | **Pass** |

## Files changed

| File | Why |
|------|-----|
| `client/src/tournament/tournamentAttachMessages.ts` | Human-readable tournament attach errors |
| `client/src/match/session/useTournamentMatchSession.ts` | Wire messages + reconnect feedback on failed join |
| `client/src/matchmaking/MatchmakingScreen.tsx` | Honest 90s queue timeout copy |
| `client/src/social/LeaderboardScreen.tsx` | Beta lag label |
| `client/src/dailyFritz/DailyFritzLeaderboardScreen.tsx` | Beta sync label |
| `client/src/dailyFritz/DailyFritzScreen.tsx` | Finalize failure copy |
| `client/src/stats/StatsScreen.tsx` | Beta stats note |
| `client/src/stats/statsScreen.css` | Style for beta note |
| `server/src/scheduledTournament/qaSeedRoomFixture.ts` | Apply live/near-30/overlay snapshots on attach |
| `server/src/scheduledTournament/qaSeed.ts` | `live_qf`, `near_30_qf`, `overlay_qf_win` seeds |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Hook QA fixture apply on tournament attach |
| `client/scripts/tournamentP0BrowserQa.mjs` | Harness scenarios for new seed states |
| `docs/trust-ux-hardening-pass-report.md` | This report |

## Remaining risks

- Tournament live/overlay TQs unverified in real browser until QA auth exists; seeds and harness are ready.
- Ranked `ranked_games` duplicate-row risk (documented elsewhere) — beta labels do not fix data idempotency.
- Daily Fritz / Ghost leaderboards still client-validated, not full server replay (audit finding).

## Recommended next 3 steps (hands-off continuation)

1. **User:** Drop `QA_TOURNAMENT_EMAIL` / `QA_TOURNAMENT_PASSWORD` once (or save `.auth/tournament-qa.json`), then run `npm run qa:tournament:p0 --prefix client` and update `docs/tournament-p0-browser-qa-results.md` per TQ ID.
2. **User (once):** Provide QA auth, run `npm run qa:tournament:p0 --prefix client` with server running and `ENABLE_QA_TOURNAMENT_SEED=1`.
3. **Agent:** Patch only TQ **Fail** rows from that run; add forced-draw fixture if TQ-08 must be automated.
