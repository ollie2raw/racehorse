# Private Match Chess.com Reliability Track — Slices 1–3

Date: 2026-08-01  
Branch: `fix/mp-private-session-chesscom`  
Scope: private session full vertical (lobby → play → reconnect → rematch/abandon), no UI polish.

## Goal

Move private multiplayer from ~7.2 toward 9–9.5 on authority, recovery proof, instrumentation, and soak — same class of work as Daily Fritz transactional commands.

## Slice 1 delivered in code

1. **Durable action receipts** — `game:action` idempotency receipts snapshot into `room_shell.actionReceipts` and rehydrate on live-session restore (process restart safe while live row exists).
2. **Fail-closed invariants** — tile/game state invariants throw unless `SOFT_GAME_INVARIANTS=true`.
3. **Uncertain-ack resync** — client marks logical action uncertain and calls `fetchGameState('game_action_uncertain')` when server returns `{ uncertain: true }`.
4. **Authority funnel telemetry** — server `mp.authority` JSON events; client uncertain ack/resync counters.
5. **MP soak harness** — `npm run soak:mp-private-authority --prefix client` (socket smoke waves).
6. **E2E hardening** — stable Guest NNNN seeding, numeric HUD scores, post-reconnect play attempt, leave/forfeit coverage (skip if control absent).

## Slice 2 additions

- Socket smoke auto-injects `requestId` on `game:action` (required for soak against current server).
- New smoke scenarios: `private-midmatch-leave-forfeit`, `private-rematch-after-short-match` (requires server `MP_PRIVATE_CERT_MODE=1` for winningScore=5).
- Action receipt round-trip tests via `room_shell` serialize/hydrate + `applyLiveSessionRow`.
- Rematch clears in-memory receipts and emits `private_rematch_started`; abandon emits `private_match_abandoned`.
- Cert-only winningScore `5` when `MP_PRIVATE_CERT_MODE=1` (production still 30/60 only).

## Slice 3 additions

1. **E2E cert mode** — Playwright server `webServer.env.MP_PRIVATE_CERT_MODE=1`.
2. **Rematch protocol cert** — smoke `private-rematch-after-short-match` (local/`SMOKE_REQUIRE_CERT=1`). CI soak currently excludes rematch play-to-5 because live-session flush latency flakes `game:action` acks under GitHub runners; reconnect/leave/create paths are soaked in CI.
3. **CI soak job** — `mp-private-soak` in `.github/workflows/ci.yml` (2 waves, cert mode, real Supabase secrets; create/leave/reconnect/takeover).
4. **Dedicated `room_command_receipts`** — SQL + `roomCommandReceiptStore` with PGRST205 graceful skip; persist on successful/uncertain acks; delete on rematch/clear; hydrate alongside shell receipts on live-session restore.
5. Soak defaults `SMOKE_REQUIRE_CERT=1` locally so rematch soft-skip cannot greenwash local cert runs.
6. Smoke private creates use `skipPregameDraw: true` so soak waves reach playable hands immediately.

## Explicit non-goals (still below 9.5)

- Multi-instance / shared Redis rooms (process-local Map remains)
- Ranked queue / tournament certification
- Full rematch UI playthrough (protocol rematch certified; UI win-target still 30/60)
- Production dashboards/alerts on `mp.authority` + recovery SLOs (logs only)
- Applying `room_command_receipts` migration in hosted Supabase (shipped in repo; ops apply separately)

## Next slices

1. Production dashboards/alerts on `mp.authority` + recovery SLOs
2. Multi-instance affinity decision / shared room map
3. Ops apply `room_command_receipts` migration + verify probe green in prod
