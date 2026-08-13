# Multiplayer Phase 1 Critical Remediation Report

Date: 2026-07-09

Baseline reports:

- `MULTIPLAYER_RELIABILITY_AUDIT.md`
- `MULTIPLAYER_CHESS_LEVEL_CERTIFICATION_AUDIT.md`
- `MULTIPLAYER_STATE_INVARIANT_CERTIFICATION.md`

Scope: Critical findings only. High, Medium, and Low findings were not intentionally remediated in this phase.

## Unified Critical Backlog

| # | Issue | Reports | Root cause | Files involved | Risk if left unfixed | Dependencies | Scope |
|---|---|---|---|---|---|---|---|
| C1 | Duplicate-tab / superseded-session ownership | Reliability audit, Chess-level audit, State-invariant audit | The server emitted `room:session:superseded` and disconnected the old socket, but the old client treated supersession as a recovery trigger and could reconnect into a room it no longer owned. | `client/src/multiplayer/recoveryMachine.ts`, `client/src/multiplayer/session/sessionReducer.ts`, `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts` | Two tabs can fight over the same seat; stale UI can continue rendering an active room after ownership moved elsewhere. | None | Architecture-level client state ownership |
| C2 | Disconnect grace keyed by room instead of seat | Reliability audit, Chess-level audit, State-invariant audit | `disconnectGrace.ts` stored grace timers by `roomCode`, so one reconnect or new timer could clear or overwrite another seat's grace period in the same room. | `server/src/multiplayer/disconnectGrace.ts` | Wrong player may be protected or forfeited; a reconnect by one seat can cancel the opponent's pending disconnect resolution. | C1 first reduces ownership ambiguity | Localized server lifetime ownership |
| C3 | MOVE/PASS not replay-safe under lost acknowledgements | Chess-level audit, State-invariant audit, reliability audit idempotency findings | `DRAW` carried a request id, but `MOVE` and `PASS` did not. The server had idempotency infrastructure but could not key replayed MOVE/PASS socket actions. | `client/src/multiplayer/roomTransport.ts`, `client/src/multiplayer/drawAudit.ts`, `client/src/match/session/actions/useLiveMatchActions.ts`, `server/src/multiplayer/registerGameplayActionHandlers.ts` | Lost ack, reconnect, or spam-click can submit the same logical action more than once or return nondeterministic results. | C1/C2 stabilize session and seat ownership first | Architecture-level network contract |
| C4 | Terminal result recovery missing for archived completed/abandoned rooms | Chess-level audit, State-invariant audit; original reliability audit listed related terminal recovery risk below Critical | Saved room recovery failed into a generic unavailable state when the live room was terminal and archived. The client had no archive-aware fallback by room code. | `server/src/multiplayer/roomMatchLogPersistence.ts`, `server/src/http/routes/roomEvents.ts`, `server/src/index.ts`, `client/src/multiplayer/terminalRoomArchiveRecovery.ts`, `client/src/multiplayer/useMultiplayerConnection.ts`, `client/src/multiplayer/useMultiplayerConnectionHostParams.ts`, `client/src/App.tsx` | Refreshing/offline reload after game completion or abandonment can strand the user behind stale room recovery without explaining the terminal result. | C3 first ensures terminal action submission is replay-safe | Architecture-level recovery/persistence bridge |

## Implementation Order

1. **C1 duplicate-tab ownership**: authority fixes first. Recovery and reconnect behavior must know when this tab no longer owns the session.
2. **C2 per-seat disconnect grace**: cleanup/lifetime timers depend on clear seat ownership.
3. **C3 MOVE/PASS request IDs**: action replay safety comes after ownership is deterministic.
4. **C4 terminal archive recovery**: terminal recovery depends on stable action handling and clear recovery semantics.

## Remediations

### C1 Duplicate-tab / superseded-session ownership

Why it occurs: `SESSION_SUPERSEDED` previously sent the recovery machine toward reconnecting, while the socket handler did not fully clear active room UI state.

Invariant violated: a superseded session must not recover or keep acting as the owner of a seat.

Fix applied:

- `client/src/multiplayer/recoveryMachine.ts`: `SESSION_SUPERSEDED` now disables recovery, clears target room, clears terminal room storage for the normalized room code, and does not emit a connect effect.
- `client/src/multiplayer/session/sessionReducer.ts`: `ROOM_SESSION_SUPERSEDED` clears room context and returns to connected-without-room state.
- `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts`: superseded event now prevents auto-rejoin, clears reconnect refs, clears joined room/game UI state, clears local saved room, and dispatches terminal superseded recovery state.

Regression coverage:

- `client/src/multiplayer/recoveryMachine.behaviorTests.ts`: asserts supersession disables recovery and does not reconnect.
- `client/src/multiplayer/session/sessionReducer.test.ts`: asserts room context is cleared on supersession.

Remaining risk: this prevents stale-tab auto-recovery, but duplicate-tab user experience still needs broader product treatment in High-tier work, such as explicit old-tab messaging across all routes.

### C2 Per-seat disconnect grace

Why it occurs: the grace timer map was keyed only by room, so a room could only have one grace timer regardless of which seat disconnected.

Invariant violated: disconnect grace is owned by a seat, not by the room as a whole.

Fix applied:

- `server/src/multiplayer/disconnectGrace.ts`: grace timers are now keyed by `(roomCode, playerSeatId)`.
- Rejoining clears only that player's grace timer.
- Room-wide cleanup still clears all grace timers for the room.
- Added `hasActiveDisconnectGraceForSeat` for focused regression coverage.

Regression coverage:

- `server/src/multiplayer/disconnectGrace.test.ts`: added a two-seat timer test proving that reconnecting seat A does not clear seat B's active grace timer and that seat B still expires.

Remaining risk: this fixes timer ownership. It does not add full chaos coverage for server restart during disconnect grace; that remains outside Phase 1.

### C3 MOVE/PASS idempotency under ack loss

Why it occurs: only `DRAW` had a client-generated `requestId`; `MOVE` and `PASS` actions could not be replay-keyed at the socket boundary.

Invariant violated: every mutating gameplay socket action must be idempotent or explicitly rejected.

Fix applied:

- `client/src/multiplayer/drawAudit.ts`: generalized request id generation with `nextGameActionRequestId('draw' | 'pass' | 'move')`.
- `client/src/multiplayer/roomTransport.ts`: `PASS` and `MOVE` payload types now require `requestId`.
- `client/src/match/session/actions/useLiveMatchActions.ts`: live pass and move actions send request ids.
- `server/src/multiplayer/registerGameplayActionHandlers.ts`: valid mutating action types now require a normalized `requestId`; missing request ids fail closed before room mutation; existing `withGameActionIdempotency` now protects MOVE/PASS/DRAW.

Regression coverage:

- `server/src/multiplayer/registerGameplayActionHandlers.test.ts`: added missing-request-id rejection and duplicate MOVE replay tests.
- `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts`: updated private-room socket action tests to use request ids while preserving concurrent distinct-action semantics.
- `server/src/multiplayer/handReadyGameplayLock.test.ts`: updated late PASS race test to use the hardened payload contract.

Remaining risk: direct in-process room engine calls used by server simulations still do not require socket request ids because they are not network retries. The socket boundary now fails closed.

### C4 Terminal archive recovery

Why it occurs: saved room recovery could learn that a room was completed or abandoned, but the client had no authenticated lookup by room code to fetch the archived terminal match log.

Invariant violated: terminal matches must have a deterministic recovery path from durable persistence, not only live room state.

Fix applied:

- `server/src/multiplayer/roomMatchLogPersistence.ts`: added `queryLatestPersistedRoomMatchLogByRoomCode`.
- `server/src/http/routes/roomEvents.ts`: added authenticated `GET /api/room-events/by-room/:roomCode`, sharing participant authorization with the existing match-id archive route.
- `server/src/index.ts`: wires the new archive query into room event routes.
- `client/src/multiplayer/terminalRoomArchiveRecovery.ts`: added archive recovery helper that fetches terminal log by room code and maps it to a multiplayer terminal notice.
- `client/src/multiplayer/useMultiplayerConnection.ts`: saved room auto-rejoin now attempts terminal archive recovery for completed/abandoned join failures before showing generic unavailable-room fallback.
- `client/src/multiplayer/useMultiplayerConnectionHostParams.ts` and `client/src/App.tsx`: pass the existing terminal notice setter into the multiplayer connection layer.

Regression coverage:

- `server/src/multiplayer/roomMatchLogPersistence.test.ts`: added room-code archive lookup test.
- `client/src/multiplayer/terminalRoomArchiveRecovery.test.ts`: added completed notice, abandoned notice, and fetch mapping tests.

Remaining risk: archive recovery currently requires an authenticated participant because the archive endpoint enforces participant authorization. Guest/offline terminal replay still needs a separate product/security decision.

## Test and Build Results

Focused Critical tests:

- `client`: `npm test -- src/multiplayer/session/sessionReducer.test.ts src/multiplayer/terminalRoomArchiveRecovery.test.ts` passed, 2 files / 4 tests.
- `client`: `npx tsx src/multiplayer/recoveryMachine.behaviorTests.ts` passed.
- `server`: `npm test -- src/multiplayer/disconnectGrace.test.ts src/multiplayer/registerGameplayActionHandlers.test.ts src/multiplayer/registerRoomSessionHandlers.private.test.ts src/multiplayer/handReadyGameplayLock.test.ts src/multiplayer/roomMatchLogPersistence.test.ts` passed, 5 files / 27 tests.

Builds:

- `npm run build --prefix client` passed.
- `npm run build --prefix server` passed.

Client build warnings were pre-existing/non-blocking for this phase: circular chunk warning, one CSS minify warning for `room: recovery`, mixed static/dynamic import warning for `tournament/displayNames.ts`, and large chunk warnings.

## Files Changed For Phase 1 Critical Fixes

Client:

- `client/src/App.tsx`
- `client/src/match/session/actions/useLiveMatchActions.ts`
- `client/src/multiplayer/drawAudit.ts`
- `client/src/multiplayer/recoveryMachine.behaviorTests.ts`
- `client/src/multiplayer/recoveryMachine.ts`
- `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts`
- `client/src/multiplayer/roomTransport.ts`
- `client/src/multiplayer/session/sessionReducer.ts`
- `client/src/multiplayer/session/sessionReducer.test.ts`
- `client/src/multiplayer/terminalRoomArchiveRecovery.ts`
- `client/src/multiplayer/terminalRoomArchiveRecovery.test.ts`
- `client/src/multiplayer/useMultiplayerConnection.ts`
- `client/src/multiplayer/useMultiplayerConnectionHostParams.ts`

Server:

- `server/src/http/routes/roomEvents.ts`
- `server/src/index.ts`
- `server/src/multiplayer/disconnectGrace.test.ts`
- `server/src/multiplayer/disconnectGrace.ts`
- `server/src/multiplayer/handReadyGameplayLock.test.ts`
- `server/src/multiplayer/registerGameplayActionHandlers.test.ts`
- `server/src/multiplayer/registerGameplayActionHandlers.ts`
- `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts`
- `server/src/multiplayer/roomMatchLogPersistence.test.ts`
- `server/src/multiplayer/roomMatchLogPersistence.ts`

Report:

- `MULTIPLAYER_PHASE1_CRITICAL_REMEDIATION_REPORT.md`

## Remaining Critical Issues

None known from the three baseline reports after deduplication and Phase 1 remediation.

## Remaining High Issues

The following High-tier categories remain intentionally out of scope for Phase 1:

- Quick-match readiness/startup timeout and retry hardening.
- Best-effort persistence degraded-mode behavior.
- Browser Back/Forward and mid-match route-transition hardening.
- Async cancellation/generation guards for join, invite, and route-change races.
- Dropped animation/event fallback coverage.
- Matchmaking event generation and stale event dropping.
- Stronger database constraints and migration-level invariant tests.
- Full chaos harness for websocket packet loss, server restart, Supabase outage, and Vercel redeploy scenarios.

## Final Status

- Critical issues before Phase 1: 4 unified Critical work items.
- Critical issues after Phase 1: 0 known remaining Critical work items.
- Estimated certification level after Phase 1: **Production-ready with risks**.

This does not reach Hardened or Chess.com-level confidence. The next tier requires resolving the remaining High findings and adding the chaos/model-based certification suite described in the baseline reports.
