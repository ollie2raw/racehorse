# Production Observability And Release Runbook

Date: 2026-06-02

Scope: production visibility, readiness checks, beta release operations, incident response, and analytics planning for Racehorse Dominoes. This pass does not change gameplay, UI, rating math, durable-room architecture, Redis, or `ranked_games` source-column behavior.

## Executive Summary

Racehorse is safer for a controlled public beta after this pass, but production observability is still incomplete. The server now exposes a real readiness endpoint, includes release metadata in health responses, and logs process-level unhandled rejections and uncaught exceptions. The remaining beta requirement is external configuration: error tracking, uptime checks, dashboards, alert owners, and a release discipline that treats live-room restarts as disruptive.

Current posture:

| Area | Status | Beta verdict |
|---|---:|---|
| Server liveness | `/health` and `/ping` exist with release metadata | Ready |
| Server readiness | `/ready` checks required env and Supabase reachability | Mostly ready |
| Error tracking | No Sentry/Logtail/etc. integration found | Needs config before public beta |
| Analytics | No product analytics sink found | Plan only |
| Live-game deploy safety | In-memory rooms can be lost on restart | Must disclose/gate |
| Release runbook | Added in this document | Ready for controlled beta |

## 1. Current Logging Audit

### Server Startup Logs

Current server startup logs include the listening URL, ranking cron startup, Daily Fritz warmup scheduling, Daily Puzzle warmup scheduling, and Render/self-ping failures when `SERVER_URL` is configured. Startup logs are useful but not structured. They should include release/version consistently; `/health`, `/ping`, and `/ready` now expose release metadata.

### Socket Connect/Disconnect Logs

Socket logs cover connect, disconnect, transport upgrade, presence, room events, tournament events, matchmaking, and Fritz disconnect-loss handling. This is useful for local debugging but noisy in production because it emits raw socket IDs and sometimes user IDs/room codes. Before broad launch, replace raw identifiers with privacy-safe hashes or short correlation IDs.

### Room/Game Action Logs

Private multiplayer and live rooms log create/join/start/action/ready/leave/abandon, hand-end, rematch, tournament room linkage, and game-over persistence failures. These logs are important because live rooms are process-local. Missing: structured per-room lifecycle log format, release tag, route/event name field, and explicit action latency metrics.

### Daily Fritz Logs

Daily Fritz logs start, next hand, record-game, complete, abandon, warmup, skipped startup warmups, and cleanup of pending bot matches. Current logging is operationally useful. Risk: some local/verified Fritz logs include user IDs, local match IDs, pending match objects, or room codes. Keep these out of production logs or redact them.

### Daily Puzzle Logs

Daily Puzzle logs today/start/submit/complete, slot recovery/finalization, warmups, and validation errors. Logging is helpful after the server-side validation work. Missing: aggregation of submit failures by reason, Supabase timeout rate, and completion funnel events.

### Tournament Logs

Scheduled tournaments log register/withdraw, attach, no-show, dispatch, stale cleanup, match completion, recovery, and bracket advancement. The logs support debugging but should be converted to structured events with tournament ID, match ID, room code hash, and release version. Scheduler lease/multi-instance status is not observable yet because no durable lease is implemented.

### Supabase Timeout/Error Logs

`supabaseFetch` has timeout handling and many route-level catches log failures. `/ready` now performs a 3 second Supabase probe and logs readiness failures. Missing: central Supabase error metrics by table/route, timeout alerts, and dashboard panels for 5xx/timeout rate.

### Client Console/Debug Logs

The client already has `client/src/debug/globalErrors.ts` for global `window.error` and `unhandledrejection` logging. There are also mode-level console/debug logs in board, Daily Puzzle, Fritz, socket, and tournament flows. These are useful in development but insufficient for production because they do not ship to an error-tracking sink.

### Noisy Or Sensitive Logs To Reduce

| Source | Risk | Recommendation |
|---|---|---|
| Raw socket IDs/user IDs/room codes | PII-adjacent correlation data | Hash or shorten in production logs |
| Fritz pending match/debug objects | Can expose internal match linkage | Log only match status and safe IDs |
| Full Supabase error text | May include table/filter details | Keep server-side only; never expose secrets |
| Client board/layout debug logs | Noise and performance cost | Gate behind development/debug flag |
| Room/tournament high-frequency events | Log volume spike during beta | Sample or structure by event type |

No evidence was found that Supabase service keys, admin secrets, cron secrets, or bearer tokens are intentionally logged. Keep that as a release-gate requirement.

## 2. Error Tracking Plan

Use Sentry, Logtail, Datadog, or equivalent before public beta. Sentry is the most practical first choice because it can cover server and browser errors with release tags.

Recommended beta setup:

| Concern | Recommendation |
|---|---|
| Server errors | Add server SDK around Express and process-level failures; tag `release`, `route`, `socket_event`, `mode`, and `node_env` |
| Client errors | Add browser SDK around global errors and React render errors; tag `release`, `screen`, and `mode` |
| Unhandled promise rejections | Process-level logging added server-side; ship these to the error sink when configured |
| Uncaught exceptions | Process-level logging added server-side; alert immediately |
| Socket errors | Wrap high-risk socket handlers with event name and privacy-safe room/user identifiers |
| Supabase timeouts | Capture table/operation, timeout ms, route/event, and release; alert on sustained spikes |
| Release tagging | Use `RELEASE_VERSION` or platform git SHA env; `/health`, `/ping`, `/ready` expose the active value |
| Privacy-safe IDs | Hash user IDs, room codes, socket IDs, and tournament IDs before external analytics/error tools |

Implementation deferred: no Sentry SDK was added in this pass to avoid dependency/config churn without DSNs and alert owners.

## 3. Health And Readiness Checks

Existing:

- `/health`: liveness endpoint.
- `/ping`: lightweight status endpoint used by self-ping when `SERVER_URL` is set.

Implemented in this pass:

- `/health` now returns `ok`, `release`, `nodeEnv`, and `uptimeSeconds`.
- `/ping` now returns `status` and `release`.
- `/ready` returns 200 only when required env vars are present and Supabase is reachable within 3 seconds.
- `/ready` returns runtime status without exposing env values or secrets.
- `/ready` response includes process uptime, connected socket count, room count, games in progress, required/recommended env presence, and Supabase latency.

Readiness semantics:

| Check | Required for 200 | Notes |
|---|---:|---|
| Server process alive | Yes | Implied by endpoint response |
| `SUPABASE_URL` present | Yes | Boolean only, value hidden |
| `SUPABASE_SERVICE_KEY` present | Yes | Boolean only, value hidden |
| Supabase reachable | Yes | Uses a low-limit profile query with 3s timeout |
| Recommended env present | No | Reported for operator visibility |
| Scheduler status | No | Not implemented yet; future scheduler heartbeat needed |

## 4. Release Runbook

### Pre-Deploy Checklist

- Confirm scope: no gameplay/rating/UI behavior changes unless explicitly intended.
- Confirm `git status` and identify unrelated local changes before release.
- Run `npm run build --prefix server`.
- Run `npm test --prefix server`.
- Run `npm run build --prefix client`.
- Run socket smoke if available: `npm run test:smoke:sockets`.
- Check `/health` and `/ready` locally or in staging.
- Review known unresolved client build warnings and decide whether they block this release.
- Document live-room limitation in release notes if deploying while users may be playing.

### Env Var Checklist

Server required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Server recommended:

- `ADMIN_SECRET`
- `CLIENT_URL`
- `CORS_ALLOWED_ORIGINS`
- `DAILY_PUZZLE_CRON_SECRET`
- `SERVER_URL`
- `RELEASE_VERSION` if platform git SHA is unavailable

Client required/recommended:

- `VITE_SERVER_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never expose service keys, admin secrets, cron secrets, or bearer tokens through health endpoints, client env, logs, screenshots, or docs.

### Migration Checklist

- Confirm pending SQL migrations and target environment.
- Run duplicate/idempotency scan queries before adding uniqueness constraints.
- Verify RLS policies after migration.
- Confirm backup/restore availability before destructive or constraint migrations.
- Apply migrations in staging first.
- Record migration timestamp and rollback notes.

### Manual QA Gates

- Play vs Fritz: start, complete, abandon/reload, result screen.
- Daily Fritz: start, record game, complete, duplicate complete/reload.
- Daily Puzzle: start, submit all slots, complete, duplicate submit, leaderboard.
- Private room: create, join, start, move, reconnect/reload, complete.
- Quick match if enabled: join queue, match, complete/abandon.
- Tournament: register, attach, start match, complete, no-show path if feasible.
- Mobile browser: home, PVF, daily modes, private room.
- Slow network: daily submit and live room reconnect.
- `/health`, `/ping`, `/ready`: verify production responses after deploy.

### Rollback Process

- If client-only deploy is bad, roll back Vercel/client to previous deployment.
- If server deploy is bad, roll back Render/server to previous deployment.
- If migration is involved, stop writes to affected feature before rollback when possible.
- Do not roll back schema blindly if new rows may rely on new columns.
- Announce live-game disruption if server rollback/restart is required.
- After rollback, check `/ready`, run a private room smoke, and inspect error logs.

### Live-Game Deploy Policy

Racehorse live rooms, quick-match queue, reconnect seats, and some tournament room state are in memory. A server restart/deploy can lose active live games. For controlled beta:

- Prefer deploys during low-traffic windows.
- Warn testers before deploys.
- Avoid deploying during scheduled tournaments.
- Treat mid-game room loss as a known beta limitation, not a user bug.
- Do not promise broad-launch live-game reliability until durable rooms/Redis/snapshots exist.

## 5. Incident Response Playbooks

### Server Down

- Check Render/server deployment status.
- Check `/health` and `/ready`.
- Inspect recent deploy and process error logs.
- If new release is implicated, roll back server.
- If port/startup failure occurs, verify env vars and startup logs.

### Supabase Timeout

- Check `/ready` Supabase latency/error.
- Check Supabase status/dashboard.
- Reduce traffic if abuse spike is suspected.
- Pause noncritical admin/cron jobs.
- Communicate daily/tournament risk if writes are delayed.

### Daily Modes Failing

- Check `/ready`.
- Check Daily Fritz/Daily Puzzle logs for auth, validation, idempotency, and Supabase errors.
- Verify today’s seeded Daily Puzzle/Fritz data exists.
- If submissions fail but starts work, preserve attempts and avoid manual score edits unless audited.

### Tournament Attach Failing

- Check scheduled tournament route logs and match dispatch logs.
- Verify registration and match rows in Supabase.
- Check live room creation logs and room runtime stats.
- If server restarted mid-tournament, expect in-memory room loss and use recovery paths where available.

### Multiplayer Rooms Failing

- Check socket connection/disconnect logs and CORS.
- Check `/ready` and `/api/mp-stats`.
- Check room create/join rate-limit logs.
- If deploy occurred, assume process-local room loss.

### Leaderboard Or Rating Duplicate Suspicion

- Freeze the affected leaderboard/rating publish if possible.
- Run duplicate scans from `docs/db-idempotency-uniqueness-audit.md` and `docs/ranked-games-idempotency-discovery.md`.
- Do not delete historical rows without a cleanup plan.
- Prefer app-level idempotency and future DB constraints before public leaderboard stakes increase.

### Bad Deploy Rollback

- Identify whether failure is client, server, or schema.
- Roll back the smallest component first.
- If server rollback restarts live rooms, warn active testers.
- After rollback, verify `/ready`, daily start/submit, private room smoke, and tournament attach if relevant.

### Abuse Or Rate-Limit Spike

- Inspect rate-limit logs by route/event.
- Temporarily tighten room/create/join, queue, friend/challenge, daily submit, admin/cron limits.
- Block abusive IP/user IDs at platform/firewall level if available.
- Preserve logs for forensic review.

## 6. Analytics Event Plan

Do not implement a full analytics system until privacy policy, retention, and event sink are chosen. Use privacy-safe IDs and avoid storing hidden hands, full move logs, tokens, secrets, raw room codes, or exact IPs.

Recommended event schema fields:

- `event_name`
- `release`
- `anonymous_id` or hashed `user_id`
- `session_id`
- `mode`
- `screen`
- `source`
- `timestamp`
- `result`
- `duration_ms`
- `metadata` with strictly allowlisted fields

Recommended events:

| Event | Payload |
|---|---|
| `account_created` | auth provider, guest upgrade flag |
| `guest_started` | entry screen, device class |
| `first_game_started` | mode, opponent type, tier if Fritz |
| `first_game_completed` | mode, won, final score bucket, duration bucket |
| `daily_fritz_started` | date, tier, attempt id hash |
| `daily_fritz_completed` | date, tier, won, skunked, score bucket, duration bucket |
| `daily_fritz_skunk` | date, tier, outcome, source |
| `daily_puzzle_slot_submitted` | date, set version, slot index, solved, perfect, score bucket |
| `daily_puzzle_completed` | date, set version, total score bucket, perfect count |
| `pvf_tier_chosen` | tier, source screen |
| `private_room_created` | room id hash, guest/auth flag |
| `private_room_joined` | room id hash, guest/auth flag |
| `private_room_started` | room id hash, player count |
| `private_room_completed` | room id hash, winner seat, score bucket, duration bucket |
| `private_room_abandoned` | room id hash, reason, elapsed bucket |
| `tournament_registered` | tournament id hash, auth flag |
| `tournament_attached` | tournament id hash, match id hash |
| `tournament_completed` | tournament id hash, placement bucket |
| `tournament_no_show` | tournament id hash, match id hash |
| `reconnect_failed` | mode, room id hash, reason |
| `socket_disconnected` | mode, transport, reason |
| `api_error` | route group, status, error category, release |

## 7. Implementation In This Pass

Implemented:

- `/ready` endpoint with required env presence checks and Supabase reachability check.
- Release/version metadata in `/health` and `/ping`.
- Runtime metadata in `/ready`: uptime, connected sockets, room count, games in progress.
- Server process logging for unhandled rejections and uncaught exceptions.
- This production observability and release runbook.

Deferred:

- Sentry or equivalent SDK integration.
- Client error boundary/reporting sink.
- Structured logging framework.
- Metrics dashboard and alert rules.
- Scheduler heartbeat/lease status in `/ready`.
- Durable room state, Redis, or live-room restart recovery.
- Full product analytics implementation.

## 8. Public Beta Observability Gaps

Remaining blockers before broader public beta:

- Configure external server/client error tracking with release tags.
- Configure uptime checks for `/health` and `/ready`.
- Add dashboard panels for API 5xx, Supabase timeout rate, active rooms, socket disconnect rate, daily completions, and tournament attach failures.
- Gate or reduce production console noise and raw identifier logging.
- Add at least one browser/socket smoke command to the release gate.
- Document active live-room disruption policy in release notes.

Racehorse is acceptable for a controlled beta only if operators monitor logs actively, avoid live-game deploy windows, and treat in-memory room loss as a known limitation.
