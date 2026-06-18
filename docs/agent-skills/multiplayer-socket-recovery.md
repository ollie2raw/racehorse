# Racehorse Multiplayer Socket Recovery Skill

Use this whenever changing multiplayer rooms, socket events, reconnect/recovery, room joins, room leaves, abandon/forfeit, forced draw sync, tournament match attach, or anything that touches live online game state.

## Goal

Keep online matches reliable, fast, server-authoritative, and free of stale recovery loops.

Multiplayer is used by:
- Quick Match
- Tournament matches
- Presence
- Friend/online status
- Reconnect/rejoin
- Leave Game / forfeit
- Forced draw and auto-pass sync

## Core principles

1. Server is authoritative.
2. Client may display optimistic/cosmetic animation, but gameplay state comes from server.
3. Completed rooms must not be recoverable.
4. Abandoned/forfeited rooms must not be recoverable.
5. Normal disconnect should allow reconnect.
6. Confirmed Leave Game should not allow reconnect.
7. Cosmetic animation must not block authoritative state updates.
8. LocalStorage room recovery must be cleared for terminal rooms.
9. Duplicate socket attach/join attempts must be guarded.
10. A single forced-draw chain should not spam multiple DRAW emits or duplicate animations.

## Important room states

Live/recoverable:
- waiting
- ready
- in_progress

Terminal/not recoverable:
- completed
- match_completed
- gameOver
- abandoned
- forfeited
- cancelled
- expired

## Required audit questions

Before changing multiplayer/socket code, answer:

1. What socket event does this affect?
2. Does it affect room join, rejoin, disconnect, or recovery?
3. Does it affect localStorage/sessionStorage recovery?
4. Does it affect completed-room recovery?
5. Does it affect tournament attach?
6. Does it affect leave-game/forfeit?
7. Does it affect forced draw or auto-pass?
8. Does it trigger room:update?
9. Could it emit duplicate room:update events?
10. Could it trigger duplicate client animations?
11. Could it leave the client stuck in appMode multiplayer?
12. Could it allow rejoining a terminal room?
13. Does it need an ack/timeout?
14. Does the server always call the ack callback exactly once?

## Files to inspect

Client:
- client/src/App.tsx
- client/src/multiplayer/useMultiplayerConnection.ts
- client/src/multiplayer/useMultiplayerRoomActions.ts
- client/src/multiplayer/useRoomSocketSync.ts
- client/src/multiplayer/drawAudit.ts
- client/src/tournament/tournamentAttachGuard.ts
- client/src/tournament/terminalMatches.ts
- client/src/components/LeaveGameModal.tsx

Server:
- server/src/rooms.ts
- server/src/multiplayer/registerRoomSessionHandlers.ts
- server/src/multiplayer/roomSession.ts
- server/src/multiplayer/drawAudit.ts
- server/src/scheduledTournament/matchDispatch.ts
- server/src/scheduledTournament/engine.ts
- server/src/scheduledTournament/recovery.ts

## Socket event rules

For any socket event that changes game state:

- Authenticate socket user.
- Validate user belongs to room.
- Reject terminal rooms.
- Ack exactly once.
- Include clear error codes.
- Emit room:update only when state actually changes.
- Include private hand state only for the correct player.
- Avoid duplicate updates for one action.
- Include requestId/drawChainId when useful for dedupe.

## Recovery rules

Client recovery should never restore:

- completed match
- abandoned match
- forfeited match
- stale tournament room
- terminal tournament match
- room rejected by server as match_completed

On terminal state:
- clear joinedRoom
- clear last room code
- clear reconnect timers
- clear tournament match context if applicable
- clear pending attach/rejoin
- route to appropriate hub/result screen

## Client recovery state machine (item 6)

The client uses a single explicit recovery state machine in `client/src/multiplayer/recoveryMachine.ts`.
`useMultiplayerConnection.ts` dispatches events into the machine; legacy refs (`reconnectShouldJoinRef`,
`preventAutoRejoinRef`, `reconnectRoomCodeRef`, `roomRecoveryState`) are **shims** derived from machine state.

### States

| State | Meaning |
|-------|---------|
| `idle` | Transport up, room joined and synced (or no recovery target) |
| `connecting` | (Re)establishing socket transport for recovery |
| `joining` | `room:join` recovery handshake in flight |
| `resyncing` | In-room authoritative sync (`fetchGameState`) |
| `failed` | Episode exhausted or terminal join error; user may retry |

Legacy UI maps `connecting` + `joining` → banner `reconnecting`; `resyncing` → `resyncing`; `failed` → `failed`.

### Policy (replaces `preventAutoRejoinRef`)

| Policy | When set | Behavior |
|--------|----------|----------|
| `auto` | Normal seated match / lobby | Unintentional disconnect starts auto recovery |
| `manual_only` | After retry exhaustion, friend-invite window | Only `USER_RETRY` / `MANUAL_JOIN` starts `joining` |
| `disabled` | Leave Game, terminal join, sign-out | No auto `connecting` / `joining` / `resyncing` |

### Invariant (fixes resyncing trap)

Never enter `joining` or `resyncing` unless:

- `policy !== 'disabled'`
- `targetRoom !== null`
- `policy === 'auto'` **or** `manualRetry === true`

`RESYNC_NEEDED` is accepted **only from `idle`** (ignored during `connecting`, `joining`, `resyncing`, or `failed`).

On `SOCKET_CONNECTED` when invariant fails → `idle` (transport only), **not** `resyncing`.

### Scheduler

- One timer owned by the machine (`schedule` / `cancel_schedule` effects).
- Max **5** attempts per episode (`MAX_RECOVERY_ATTEMPTS`); then `failed` + `manual_only`.
- Backoff: `min(10_000, 1500 + min(attempt, 8) * 750)`.
- All reconnect triggers (`disconnect`, `connect_error`, `reconnect_failed`, watchdog, supersede) must
  `dispatch` events — never call `connect()` directly outside effect handlers.

### Expected logs

Every state transition logs:

```
[room:recovery] state=<from>-><to> event=<EVENT> attempt=<n> episode=<id> policy=<policy> room=<code?>
```

### Tests

Run: `npm run test:recovery-machine --prefix client`

Cover: auto disconnect, policy disabled/manual traps, join ok/resync, transient vs terminal join,
max attempts, user retry/leave, session supersede, shim derivations, scheduler retry.

## Leave Game rules

Leave Game is not local navigation.

Confirmed Leave Game means:
- casual multiplayer: forfeit/abandon match server-side
- tournament: forfeit tournament match server-side
- bot/local: abandon local hand/set according to mode

Never rely only on socket disconnect.

## Forced draw sync rules

Racehorse has no manual draw/pass.

DRAW/PASS socket actions are only forced-state actions.

Forced draw should:
- resolve server-side atomically when possible
- emit one clear state update
- include forcedDraw/drawChainId metadata
- animate cosmetically without blocking authoritative hand update
- dedupe repeated animation events

## Expected logs

Client:
[room:recovery] attempting
[room:recovery] rejected-terminal
[room:join] ack/success
[room:join] ack/error
[leave-game] confirm
[leave-game] ack/success
[leave-game] ack/error
[draw:audit] forced-state-detected
[draw:audit] emit
[draw:audit] ack
[draw:audit] room-update
[draw:audit] animation-start

Server:
[room:join] request
[room:join] rejected completed room
[room:abandon] request
[room:abandon] completed
[room:update] emitted
[draw:audit] action-received
[draw:audit] forced-draw-resolved
[draw:audit] update-emitted

## Tests expected

When relevant, add/update tests for:

- completed room rejects join
- abandoned room rejects join
- forfeit clears recoverability
- normal disconnect can recover
- confirmed Leave Game cannot recover
- server ack is always called
- non-player cannot join room
- duplicate join does not corrupt room state
- same-user second socket supersedes old socket safely
- tournament attach returns full join payload
- private hand goes only to correct player
- forced draw emits one chain/update
- duplicate draw animation is deduped

## Manual acceptance checklist

For multiplayer/socket changes, manually test:

1. Start Quick Match with two browsers.
2. Refresh one player mid-game; they reconnect.
3. Click Leave Game; match ends/forfeits.
4. Refresh after Leave Game; does not rejoin.
5. Finish a match; refresh does not reopen completed room.
6. Trigger forced draw; hand updates quickly.
7. Trigger blocked + locked boneyard; auto-pass happens.
8. Tournament match attach works once.
9. No duplicate socket logs or repeated attach spam.

## Rules for agents

- Do not treat socket disconnect as intentional leave.
- Do not let completed rooms recover.
- Do not block gameplay behind cosmetic animation.
- Do not create manual draw/pass UI.
- Do not add socket events without ack/error behavior.
- Do not persist room codes for terminal rooms.
- Do not change tournament attach without checking tournament-flow.md.
- Do not change Racehorse draw/pass without checking racehorse-rules.md.

## Final report format

Multiplayer Socket Recovery Review

What changed:
...

Socket events affected:
...

Recovery impact:
...

Terminal-room behavior:
...

Forced-draw impact:
...

Tests added/updated:
...

Manual test needed:
...

Risks:
...

Build/test result:
...
