# Private Match Chess.com Reliability Track — Slice 1

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

## Explicit non-goals (still below 9.5)

- Multi-instance / shared Redis rooms (process-local Map remains)
- Ranked queue / tournament certification
- Full rematch UI E2E through second hand (server unit covered; Playwright rematch deferred)
- Dedicated analytics warehouse (logs/breadcrumbs only in this slice)

## Next slices

1. Rematch + archive Playwright vertical with low winning-score private config
2. Persist receipts in dedicated table if live-shell size becomes a concern
3. Production dashboards/alerts on `mp.authority` + recovery SLOs
4. Multi-instance affinity decision
