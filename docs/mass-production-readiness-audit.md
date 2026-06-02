# Mass Production Readiness Audit

Date: 2026-06-02  
Scope: full-platform production-readiness audit for Racehorse Dominoes.  
Policy: audit only. No code changes, no UI redesign, no opportunistic patches.

## Executive Verdict

Racehorse Dominoes is **not ready for broad public launch** yet. It is **close to a controlled beta** if live-room expectations are scoped honestly and if manual smoke gates are enforced before inviting users.

The platform has strong recent stabilization in the right places: server game invariants, per-room action locking, hand masking, Daily Fritz dedupe, Daily Puzzle Ladder set-version binding, tournament auth, bracket idempotency, and tournament recovery tests. The automated server suite is healthy: `npm test --prefix server` passed **39 files / 335 tests** during this audit. Client and server production builds also passed.

The remaining launch risk is not "does the game basically work." The risk is **mass-production behavior under restarts, abuse, scale, observability gaps, and browser/mobile edge cases**. Live multiplayer rooms are still process-local. There is no durable live room state for private or quick-match games. Some result flows still trust client-submitted scores or move summaries. There is no platform analytics layer, no rate limiting, no operational monitoring plan checked into the repo, and no browser E2E release suite.

Recommended release posture:

| Release stage | Verdict | Conditions |
|---|---:|---|
| Internal dev | Ready | Current test/build gates are enough. |
| Friends-and-family beta | Mostly ready | Run manual smoke, disclose that live games can be lost on deploy/restart, keep traffic small. |
| Public beta | Risky | Must add rate limits, monitoring, socket smoke gate, deploy/restart playbook, and at least one browser E2E pass. |
| Large public launch | Not production-ready | Requires durable room strategy or graceful restart policy, analytics, stronger anti-spoofing, DB uniqueness/idempotency migrations, monitoring, rollback, and mobile QA. |

## Evidence Reviewed

- Client app structure: `client/src/App.tsx`, `LiveMatchScreen`, `useLiveMatchSession`, `useTournamentMatchSession`, `BotMatchScreen`, Daily Fritz, Daily Puzzle Ladder, Learn, Ghost, friends/social, matchmaking, tournament, ranking/profile.
- Server structure: `server/src/index.ts`, `rooms.ts`, `multiplayer/*`, `scheduledTournament/*`, `matchmaking/*`, `dailyFritz.ts`, `dailyPuzzle.ts`, `ghost/service.ts`, `social/routes.ts`, ranking and stats services.
- Supabase SQL: core schema, Daily Fritz, Daily Puzzle Ladder, Ghost, friends/social, matchmaking, scheduled tournament migrations.
- Existing stabilization reports: Fritz P0, Daily Puzzle Ladder, private multiplayer P0/P1, tournament P0, architecture extraction reports, difficulty product pass.
- Verification run during this audit:
  - `npm test --prefix server`: pass, 39 files / 335 tests.
  - `npm run build --prefix server`: pass.
  - `npm run build --prefix client`: pass, with warnings about unresolved `ghost-art.webp` / `nobrainer-art.webp` runtime asset references and large chunks.

## 1. Core Gameplay Readiness

| Mode | Classification | Why |
|---|---:|---|
| Play vs Fritz | Mostly ready | Core local bot play is stable enough after hand-transition guards. Default tier and difficulty copy are improved. Remaining risk is `BotMatchScreen.tsx` complexity, browser-only state/timer paths, no E2E PVF smoke in CI, and CPU/perf on older devices. |
| Daily Fritz | Mostly ready | Server now binds verified attempts, completion hashes, set/game order, abandon, and replay behavior. Client has record/complete in-flight dedupe. Still relies on client-produced final scores/move logs for completion hash inputs, needs stronger anti-abuse validation and manual daily smoke before public beta. |
| Daily Puzzle Ladder | Risky | Set-version binding and finalize recovery are strong. Major remaining issue: server trusts client `rawScore`, `movesUsed`, `elapsedSeconds`, `submittedLine`, and `clientResult` more than a public competitive mode should. Good for beta; not safe for high-stakes leaderboards. |
| Learn | Mostly ready | Learn is mostly local/content-driven and low security risk. Product risk is quality/readability/completion flow, not platform correctness. Guided authoring/localStorage/admin-ish paths should be hidden or gated for public launch. |
| Ghost | Risky | Start endpoint requires auth, but `/api/ghost/complete` accepts `userId`, `matchId`, score, opponent, and move logs without the same visible auth guard in `server/src/index.ts`. This is a public-result spoofing risk until completion is tied to verified auth and server validation. |
| Private multiplayer | Mostly ready | P0 hardening is good: per-room action lock, tile invariant assertions, hand masking tests, private create/join/start/move smoke coverage. Remaining launch blocker for broad public: rooms are in-memory and lost on deploy/restart; live state is not durable. |
| Quick match / matchmaking | Risky | Queue service exists and creates reserved rooms. It appears socket identity is payload-based for queue join rather than strongly auth-derived, and queue/online state is process-local. Good prototype/beta feature, not mass-scale production-ready. |
| Tournaments | Risky | Strongest recent server test coverage. Auth spoofing for register/withdraw was fixed; bracket idempotency and game-over fallback exist. Remaining risks: scheduler has no DB lease for multi-instance, live rooms are in-memory, no browser tournament smoke in CI, legacy tournament stack still present behind flag, and concurrent bracket generation/race edges remain. |
| Friends/social/challenges | Risky | Authenticated REST routes exist for social data and friend requests. Abuse controls are thin: no rate limits, no invite throttling, presence/friend socket flows are light, and friend challenge delivery depends on live sockets. Suitable for beta with low traffic. |
| Leaderboards/stats/profile | Risky | Rankings and stats are present with tests for some dedupe/rating paths. Risks remain around duplicate ranked game inserts, N+1 leaderboard queries, read paths that scan large profile/match sets, and result spoofing from modes that feed leaderboards. |
| Share/result flows | Mostly ready | Daily Fritz and Daily Puzzle share-card modules exist. Main risk is accuracy/idempotency when completion flows partially fail and whether public text reflects verified results only. Needs manual mobile/share QA. |

## 2. Critical Correctness Risks

### Highest-risk correctness areas

| Risk | Current state | Severity |
|---|---|---:|
| Live rooms lost after deploy/restart | Private, quick-match, and tournament game rooms live in process memory. Tournament recovery can recreate some assigned/in-progress rooms from DB metadata, but full live board state is not durable. | P0 for broad launch |
| Duplicate ranked game rows | Existing docs call out `ranked_games` duplicate insert risk. `matches` table has a metadata-room idempotency check, but ranked rows need DB uniqueness/idempotency. | P0/P1 |
| Client-trusted Daily Puzzle scoring | Server calculates awarded points from client-submitted `rawScore` and stored best possible score. Public leaderboards can be spoofed unless server validates puzzle solutions. | P0 for competitive launch |
| Ghost completion spoofing | Completion endpoint appears unauthenticated relative to `userId`; score and move log are client-supplied. | P0 |
| Quick-match identity spoofing | `queue:join` accepts `payload.userId`/`username`; no clear token-derived identity on that event. | P0/P1 |
| Deploy/restart mid-game | Server emits `server:shutdown`, but clients cannot preserve live room state without durable snapshots. | P0 for public launch |
| Orphan rooms/tournaments | Room cleanup timers exist; scheduled tournament stale cancellation exists. Multi-instance scheduler/worker races remain without a lease. | P1 |
| Stuck modals / reveal transitions | Recent Fritz guards reduce risk, but `BotMatchScreen` still has many timers and refs across PVF, Daily Fritz, Learn, and guided flows. | P1 |
| Wrong winner / stale game-over | Tournament fallback and room match IDs reduce risk. Private/ranked duplicate persist still needs DB idempotency. | P1 |
| Hidden hand exposure | Server masking tests are strong for multiplayer; spectator masking exists. Continue gating every new payload path through masking. | Mostly mitigated |
| Reload/reconnect | Private reconnect has grace/rejoin paths. Tournament attach recovery is tested at server level. Browser refresh smoke is still manual. | P1 |

### Lower but real correctness risks

- `hand:ready`, rematch, and leave flows are not under the same action lock as `game:action`; existing mechanisms likely cover common cases, but stress coverage should expand before public beta.
- Daily Fritz abandon uses current Pacific date lookup, so edge cases around midnight/Pacific transition need manual QA.
- Daily Puzzle slot 3 submit and complete are split; recovery exists, but network-failure UX needs slow-network QA.
- Social/profile leaderboards calculate ranks by loading/scanning potentially large row sets in several places.

## 3. Security And Abuse Audit

| Area | Current status | Gap |
|---|---|---|
| API auth | Many competitive endpoints verify Bearer token via Supabase. Tournament register/withdraw fixed. Social REST routes require auth. | Some endpoints remain admin-secret body based; Ghost complete appears unauthenticated; read endpoints expose broad public data to any logged-in user. |
| Socket auth | `presence:identify` can validate token and sets `socket.data.userId`; tournament socket handlers use socket identity. | Queue join and some friend/presence flows need stronger token-derived identity and rate limits. |
| Guest identity | Local guest IDs support private multiplayer/reconnect. | Guest identity is suitable for casual rooms, not ranked/leaderboard/tournament actions. Enforce mode boundaries. |
| Room code guessing | Room codes are short 5-character codes. Spectate and join can reveal room existence. | Add rate limits, longer codes or invite tokens, and join-attempt throttling before public beta. |
| Tournament register/withdraw/result spoofing | Register/withdraw are much improved. Results come from server room game-over paths. | Multi-instance scheduler leases and match result idempotency still required. |
| Hidden hand masking | Dedicated tests prove active opponent/spectator hands are hidden and revealed only after terminal states. | Keep this as a permanent release gate. |
| Leaderboard tampering | Ratings depend on server logs for multiplayer. Daily modes vary. | Daily Puzzle and Ghost are vulnerable to client-submitted result spoofing. Daily Fritz is better but still needs stronger server replay/validation if leaderboard stakes rise. |
| Daily Fritz attempt spoofing | Attempts require auth and verified match IDs; completion hash makes blind duplicate replay harder. | Completion hash is computed from client-provided result fields, so it is an idempotency guard, not full anti-cheat. |
| Daily Puzzle attempt spoofing | Attempt ownership is auth-bound and slot order is enforced. | Raw scoring is client-trusted; must move solution validation server-side. |
| Supabase RLS | SQL enables RLS for core tables and many policies restrict client writes; server uses service key. | Need a migration audit checklist that confirms every applied environment has the same RLS state. |
| Rate limits | None found in Express or Socket.IO handlers. | P0 for public beta: auth endpoints, room join/create, queue join, friend requests, chat/emotes, daily submissions, admin endpoints. |
| Invite/friend abuse | Friend REST auth exists and duplicate pending checks exist. | Add throttles, block/mute/report, per-target request caps, and challenge spam limits. |
| Replay/duplicate submit abuse | Several idempotent branches exist. | Add DB unique constraints for ranked rows, daily slot results, verified match completions, tournament match completion. |

## 4. Deployment And Infrastructure Audit

| Area | Status | Readiness |
|---|---|---:|
| Render server deployment | Client has `KNOWN_PRODUCTION_GAME_SERVER_URL = https://racehorse.onrender.com`; server exposes `/health` and `/ping`. | Mostly ready for single instance |
| Vercel/client deployment | `VITE_SERVER_URL` is supported with production fallback for known Vercel domain. | Mostly ready, but env must be explicit |
| Supabase dependency | Central to auth, persistence, ranking, tournaments, daily modes, social. Server uses service key. | Mostly ready, needs ops checklist |
| Environment variables | Important vars include `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `CLIENT_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_SERVER_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `DAILY_PUZZLE_CRON_SECRET`, startup warmup flags. | Risky without env audit |
| Cold start behavior | Daily warmups are optional and skipped by default. `/home/daily-summary` has timeout fallback. | Mostly ready |
| Server restarts/deploys | Shutdown event notifies sockets. Live rooms are still lost. | Not production-ready for live games |
| In-memory room loss | Explicit process-local rooms, queue, reconnect seats, timers. | P0 broad-launch blocker |
| Tournament scheduler safety | Stale cleanup and recovery exist; no DB lease/multi-worker lock seen. | Risky |
| Database migrations | Many SQL files exist, including forward migrations. | Needs applied-migrations inventory and rollback scripts |
| Backups | No backup/restore playbook found. | P0 for broader launch |
| Logging | Extensive console logging. | Needs structured logs, sampling, and production PII/token discipline |
| Monitoring | No Sentry/Datadog/Logtail/Uptime config found in repo. | P0 public beta |
| Uptime checks | `/health` and `/ping`; server self-pings when `SERVER_URL` set. | Basic only |
| Rollback plan | No documented release rollback plan found. | P0 public beta |

## 5. Performance And Scale Audit

### Build findings

`npm run build --prefix client` passed, but Vite reported:

- Unresolved runtime asset references:
  - `../assets/home/ghost-art.webp`
  - `../assets/home/nobrainer-art.webp`
- Very large chunks:
  - Main JS chunk around **1,946 kB minified / 241 kB gzip**.
  - `vendor-charts` around **397 kB minified / 116 kB gzip**.
  - Large image assets include `newnewladderfinal` around **5.6 MB** and `ghostblue` around **3.6 MB**.
- Main CSS around **445 kB minified / 75 kB gzip**.

### Scale risks

| Area | Risk |
|---|---|
| First load | Main app chunk and CSS are too large for mass public traffic and older devices. Further code splitting is needed, especially charts/social/stats/admin/guided authoring. |
| Board rendering | Board has debug paths and complex layout projection; prior reports call out duplicate layout computation. Needs browser performance profile. |
| Mobile/older devices | No automated mobile/browser QA gate found. Large images and `BotMatchScreen` CPU paths are risk. |
| Socket payloads | `state:update` sends masked full state plus counts/meta. Payload trimming is a known P1 item. |
| App render paths | `App.tsx` is reduced but still ~3.5k lines; prop surfaces to `LiveMatchScreen` are large. |
| BotMatchScreen | ~8k lines and owns PVF, Daily Fritz, Learn/guided paths, timers, audio, and UI. This is a product-risk hotspot. |
| API response times | Supabase helper has timeout. Some endpoints do broad scans or N+1 profile/registration fetches. |
| Tournament scheduler load | Current scale is small. Multi-instance and high-frequency tournaments need leases and batching. |
| Multiplayer concurrency | Per-room action lock is strong. Process-local rooms limit horizontal scaling. |
| Memory leaks/timers/listeners | Many timers/listeners exist across rooms, reconnect, bots, tournament, client screens. Needs long-session smoke. |
| Long-session stability | No soak test found. Add 60-90 minute local session or Playwright/socket soak before public beta. |

## 6. UX And Retention Audit

| Area | Verdict | Notes |
|---|---:|---|
| First-time onboarding | Risky | Username/auth onboarding exists, but the best first action across daily/PVF/learn is not proven by analytics. |
| Older-player readability | Risky | Visual direction is premium, but mobile/older eyes need explicit contrast/font QA. Avoid tiny HUD text. |
| Learn flow quality | Mostly ready | Learn content and guided modules exist. Need completion metrics and public hiding of authoring/debug. |
| Difficulty ladder | Mostly ready | Play vs Fritz defaults to Standard; Daily Fritz Classic remains Elite with practice hint. |
| Loss/skunk experience | Mostly ready | Skunk source and practice hint exist. Need retention analytics after losses. |
| Post-game next step | Risky | Different modes have different result overlays. Needs consistent "play again / review / share / next daily" QA. |
| Daily loop clarity | Mostly ready | Home daily summary and daily cards exist. Needs failure/loading copy for Supabase downtime. |
| Empty states | Risky | Friends, tournaments, leaderboards, matchmaking need better empty/loading/error QA. |
| Loading states | Mostly ready | Screen loaders exist; some cold start copy should say "Waking up game server" per deployment guide. |
| Error states | Risky | Many socket/API errors return technical strings; public copy needs polish. |
| Reconnect states | Mostly ready technically | Needs browser refresh/reconnect QA and copy cleanup. |
| Mobile friendliness | Risky | Build passes, but no automated mobile viewport QA. |
| Share/invite clarity | Mostly ready | Share modules and private room invite flows exist; need mobile clipboard/share testing. |
| Tournament status clarity | Risky | Tournament attach/recovery is complex. Manual smoke is required before beta. |

## 7. Analytics And Observability Audit

### Currently logged/tracked

The repo has extensive console logs for:

- Server startup, health, ping, socket connect/disconnect, transport upgrade.
- Daily Fritz today/start/next-hand/record/complete/abandon server events.
- Daily Puzzle today/start/submit/complete and ladder warmup.
- Room create/join/start/action/ready/abandon, hand ended, draw audit.
- Matchmaking queue join/leave/match/timeout.
- Tournament registration, attach, dispatch, recovery, no-show, game-over, completion.
- Ranking cron and real-time rating update failures.
- Social activity writers and presence helpers have server tests.

This is **logging**, not product analytics. There is no clear analytics event sink, user funnel schema, alerting, dashboard, or privacy/retention policy in repo.

### Missing analytics events

| Event | Status |
|---|---:|
| Account creation / guest start | Missing as product analytics |
| First game start | Missing |
| First game complete | Missing |
| Daily Fritz start/complete/win/skunk | Partially logged/server activity, not analytics |
| Daily Puzzle slot completion | Partially persisted, not analytics |
| Play vs Fritz tier chosen | Stored locally, not analytics |
| Multiplayer create/join/start/complete/abandon | Logged/persisted partly, not analytics |
| Tournament register/attach/complete/no-show | Logged/persisted partly, not analytics |
| Reconnect failures | Logged in places, not aggregated |
| API errors | Console only |
| Socket disconnects | Console only |
| Churn after loss | Missing |
| Return next day | Missing |

### Observability release gate

Before public beta, add:

- Server error tracking with request route, socket event, user mode, room code hash, tournament id, and release version.
- Client error tracking for render errors, unhandled promise rejections, socket disconnects, reconnect failures, daily submit failures.
- Product analytics with privacy-safe IDs.
- Dashboards for active rooms, games completed, daily completions, tournament attach failures, API 5xx, Supabase timeout rate, socket disconnect rate.
- Alert thresholds and an owner/runbook for each alert.

## 8. Testing And QA Audit

### Current automated tests

Server vitest coverage is strong in these areas:

- Game engine invariants, scoring/open ends, Racehorse-specific rules.
- Daily Fritz skunk behavior.
- Daily Puzzle generation/stabilization.
- Multiplayer hand masking, private room handlers, room gameplay lock, bot seating, abandon/tournament handlers.
- Matchmaking queue/pairing.
- Scheduled tournament engine, bracket, persistence, recovery, routes, auth, attach guard, completion, no-show, human+bot flow.
- Social activity/presence/rival helpers.
- Ranking Fritz rating and stats dedupe.
- Supabase utility timeout/error behavior.

Client coverage:

- Script-style behavior tests for bot heuristics, tier difficulty, hand lifecycle, and open-end geometry.
- Production build catches TypeScript/Vite issues.
- Socket smoke script exists and prior report says 16/16 pass on live local server, but it was not rerun during this audit.

### Missing coverage

- Browser E2E for PVF, Daily Fritz, Daily Puzzle Ladder, private multiplayer, quick match, tournaments, friends, leaderboards, and share flows.
- Mobile viewport visual/interaction QA.
- Slow network/offline/retry QA.
- Deploy/restart/reconnect QA.
- Long-session soak/stress tests.
- Rate-limit/security abuse tests.
- Supabase migration verification tests against a staging DB.
- Accessibility/readability tests.

### Recommended release-gate suite

Minimum beta gate:

1. `npm run build --prefix server`
2. `npm test --prefix server`
3. `npm run build --prefix client`
4. `npm run test:hand-lifecycle --prefix client`
5. `npm run test:open-ends --prefix client`
6. Fresh local server + `npm run test:smoke:sockets --prefix client`
7. Manual PVF smoke: start, play legal move, draw/pass, hand end, next hand, game over, rematch.
8. Manual Daily Fritz smoke: start, complete game 1, between-game overlay, complete/lose/win set, leaderboard/share.
9. Manual Daily Puzzle smoke: start all 3 slots, finalize, reload after slot 3 before complete, review/practice.
10. Manual private multiplayer smoke: two browsers, create/join/start, move, refresh, disconnect, abandon/rematch.
11. Manual tournament smoke: register, attach, play, bracket advance, final/result, refresh before attach and mid-match.
12. Mobile QA on small iPhone-like and tablet viewport.
13. Slow network QA for daily submit/complete and tournament attach.
14. Accessibility/readability pass: focus states, contrast, touch targets, modal escape/close, screen-reader labels for critical buttons.

## 9. Codebase Architecture Audit

| Area | Status | Recommendation |
|---|---|---|
| `App.tsx` | Improved but still ~3,514 lines. Owns routing, global state, multiplayer orchestration, auth, modals, and many callbacks. | Continue extraction after launch blockers: home-only helpers, global chrome hooks, multiplayer prop bundling. |
| `useLiveMatchSession` | Extracted and central to live match behavior. | Keep; add focused tests around reload/reconnect/action errors. |
| `useTournamentMatchSession` | Extracted; complex but localized. | Keep; add browser tournament E2E and reduce dual-listener ambiguity. |
| `LiveMatchScreen` | Presentational shell exists, ~978 lines. | Accept for beta; later split overlay/control tray/HUD subcomponents and memoize carefully. |
| `BotMatchScreen` | Major risk hotspot at ~8,045 lines. Owns bot, Daily Fritz, guided, authoring, audio, timers, overlays. | P1/P3 split into `useBotMatchSession`, `useDailyFritzBotSession`, presentational board shell, and guided-authoring-only modules. |
| `DailyFritzScreen` | ~1,765 lines, better bounded than BotMatch. | Keep; add E2E/manual gates around record/complete/reload. |
| `DailyPuzzleLadderScreen` | ~1,333 lines, bounded. | Keep; move server-side validation first, then refine UX. |
| Server rooms | Single-process in-memory map with action lock and cleanup timers. | P0 broad-launch decision: either document single-instance beta limitation or implement durable snapshots/recovery. |
| `scheduledTournament` | Modular and well-tested. | Add DB lease/idempotency migrations and browser smoke. |
| Legacy tournament code | Still present behind `ENABLE_LEGACY_TOURNAMENTS`. | Remove or keep hard-disabled before public launch. |
| Docs/reports | Many useful reports exist. | Create a concise launch runbook and migration ledger; old reports are too fragmented for ops. |

## 10. Launch Blockers

### P0 Launch Blockers

| Item | User impact | Likely files | Suggested next pass | Blocks launch? |
|---|---|---|---|---:|
| Durable live-room/restart policy | Users can lose live private/quick/tournament games during deploy/restart; rooms cannot scale horizontally. | `server/src/rooms.ts`, `server/src/multiplayer/roomSession.ts`, `server/src/scheduledTournament/recovery.ts`, client recovery hooks | Define single-instance beta policy vs durable room snapshot implementation. Add deploy/restart smoke. | Yes for broad launch |
| Ghost completion auth/spoofing | Users can spoof Ghost results/profile progression if endpoint remains client-trusted. | `server/src/index.ts`, `server/src/ghost/service.ts`, `client/src/ghost/api.ts` | Ghost security pass: require auth, bind start/complete to verified match, idempotency tests. | Yes |
| Daily Puzzle server-side validation | Public leaderboard can be manipulated by submitting fake `rawScore`. | `server/src/index.ts`, `server/src/dailyPuzzle.ts`, `client/src/dailyPuzzle/validator.ts`, worker | Move puzzle validation/scoring server-side; keep client validator as UX only. | Yes for competitive launch |
| Rate limits and abuse controls | Room codes, queue, friend requests, chat, daily submits, admin endpoints can be spammed. | `server/src/index.ts`, `server/src/social/routes.ts`, `server/src/matchmaking/index.ts`, socket handlers | Add Express/Socket rate limits and targeted abuse tests. | Yes for public beta |
| Monitoring/analytics/runbook | Production issues will be invisible until users complain. | new docs/config; client/server error hooks | Observability pass: Sentry/logging/metrics dashboards and alerts. | Yes for public beta |
| DB idempotency constraints | Duplicate ranked rows or completion rows can mis-rank users under race/retry conditions. | Supabase migrations, ranking/stats persistence | Add unique constraints and upsert/idempotency tests. | Yes for broad launch |

### P1 Should Fix Before Public Beta

| Item | User impact | Likely files | Suggested next pass | Blocks launch? |
|---|---|---|---|---:|
| Quick-match auth identity | Users can impersonate queue identity or ratings. | `server/src/matchmaking/index.ts`, client matchmaking hooks | Use socket-authenticated userId only; allow guests only in unranked queue. | Public beta yes |
| Tournament scheduler DB lease | Multi-instance or duplicate scheduler runs can double-advance/cancel. | `server/src/scheduledTournament/scheduler.ts`, migrations | Add DB advisory lock/lease and scheduler ownership tests. | Broad launch yes |
| Browser E2E smoke suite | Regressions in modals/reconnect/UI can pass unit tests. | Playwright or existing scripts | Add minimal E2E for daily, PVF, private, tournament. | Public beta yes |
| Client bundle/code splitting | Slow first load and older-device lag. | `client/vite.config.ts`, route lazy imports, charts/stats/social | Split charts/admin/guided/large mode code; optimize images. | Public beta should |
| Unresolved build assets | Runtime broken images on home/single-player surfaces. | CSS/assets referencing `ghost-art.webp`, `nobrainer-art.webp` | Asset audit and fix references. | Beta should |
| Admin endpoints posture | Body `adminKey` endpoints are easy to probe and need throttles/audit. | daily/puzzle/fritz admin routes | Move to auth role or locked server-only cron secret with rate limit. | Public beta should |
| Mobile/reconnect QA | Touch, modal, and reconnect defects hurt real users. | client screens/hooks | Manual QA matrix with screenshots and bug list. | Public beta should |

### P2 Polish After Beta

| Item | User impact | Likely files | Suggested next pass | Blocks launch? |
|---|---|---|---|---:|
| Learn retention flow | Better onboarding/completion. | `client/src/learn/*` | Learn UX/content pass with analytics. | No |
| Empty/error states | More professional beta feel. | social/tournament/matchmaking/daily screens | Copy/state audit. | No |
| Share card consistency | Better viral loop. | daily share modules, result overlays | Share QA and visual polish. | No |
| Leaderboard query optimization | Faster social/stats at scale. | `server/src/social/routes.ts`, ranking APIs | Add pagination/indexes and reduce broad scans. | No, until scale |
| Post-loss next-step loops | Retention after loss/skunk. | PVF/Daily Fritz overlays/home | Product analytics-driven pass. | No |

### P3 Long-Term Architecture

| Item | User impact | Likely files | Suggested next pass | Blocks launch? |
|---|---|---|---|---:|
| Split `BotMatchScreen` | Lower regression risk and easier feature work. | `client/src/bot/BotMatchScreen.tsx` | Bot session extraction plan. | No |
| Shrink `server/src/index.ts` | Maintainability and safer route ownership. | `server/src/index.ts` | Route modules for daily/league/ranking/admin. | No |
| Durable multiplayer architecture | Horizontal scaling, restarts, replay, moderation. | rooms/session/socket modules, DB/Redis | Snapshot/event-sourced room model or Redis room store. | Strategic |
| Analytics data warehouse | Growth/retention decisions. | new analytics layer | Product analytics architecture. | Strategic |

## 11. Production Release Checklist

### Ready to invite real users

- [ ] `npm run build --prefix server` passes.
- [ ] `npm test --prefix server` passes.
- [ ] `npm run build --prefix client` passes with no unresolved asset warnings.
- [ ] Client behavior tests pass: hand lifecycle, open ends, bot tier checks.
- [ ] Socket smoke passes on a fresh local production server.
- [ ] Manual PVF smoke complete.
- [ ] Manual Daily Fritz smoke complete.
- [ ] Manual Daily Puzzle smoke complete.
- [ ] Manual private multiplayer two-browser smoke complete.
- [ ] Manual tournament smoke complete.
- [ ] Reload/reconnect QA complete for private and tournament matches.
- [ ] Slow network QA complete for daily submit/complete and tournament attach.
- [ ] Mobile QA complete for home, PVF, Daily Fritz, Daily Puzzle, private, tournament.
- [ ] Accessibility/readability QA complete.
- [ ] Supabase migrations applied and verified in staging/prod.
- [ ] Supabase RLS verified for all production tables.
- [ ] Env vars verified in Render and Vercel:
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `CLIENT_URL`, `CORS_ALLOWED_ORIGINS`, `SERVER_URL`, `VITE_SERVER_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, cron secrets.
- [ ] Monitoring enabled for client errors, server errors, API 5xx, socket disconnects, Supabase timeouts.
- [ ] Uptime check enabled for `/health`.
- [ ] Rollback plan documented and tested.
- [ ] Backup/restore plan documented.
- [ ] Known issues documented in release notes.
- [ ] Deploy window policy decided for live games.
- [ ] Rate limits enabled for public endpoints and socket events.

## 12. Recommended Next Prompt

Highest-risk finding: live games are process-local and public-facing competitive result paths still have spoof/idempotency gaps. The best next pass should attack one P0 area, not everything at once.

Use this prompt next:

> Run a P0 Production Launch Blocker pass for Racehorse Dominoes focused only on Ghost completion auth/spoofing and Daily Puzzle server-side scoring validation. Do not redesign UI. First inspect `server/src/index.ts`, `server/src/ghost/service.ts`, `client/src/ghost/api.ts`, `server/src/dailyPuzzle.ts`, `client/src/dailyPuzzle/validator.ts`, and `client/src/dailyPuzzle/validator.worker.ts`. Then implement the smallest safe server-side changes so Ghost completion requires authenticated ownership and Daily Puzzle slot submissions are scored/validated server-side instead of trusting client `rawScore`. Add focused server tests for spoof rejection, duplicate/idempotent submit behavior, and invalid puzzle solution rejection. Run server tests and client/server builds. Report files changed, behavior changed, test results, and remaining risks.

