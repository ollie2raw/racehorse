# Phase: `registerRoomSessionHandlers` Extraction Pass 6 (Final)

**Date:** 2026-07-05  
**Scope:** Risk item #11 — `attachSocketToTrackedRoom`, `leaveTrackedRoom`, `leaveExistingSocketRooms`, `room:join`, `tournament:attach_assigned_match`, `handleRoomPlayerDisconnect`.  
**Continues from:** Pass 1–5 extraction reports. Pass 1–5 modules frozen.

---

## Step 0 — Verification before extracting

### 0.1 Pass 5 end-state reconciliation

| Claim (Pass 5) | Live check | Result |
|----------------|------------|--------|
| `registerRoomSessionHandlers.ts` = 806 LOC | `wc -l` → **806** | **Match** |
| Server tests = 509 / 74 files | Baseline from Pass 5 report | Starting point |

**No discrepancy** between Pass 5 claimed end state and live file at pass start.

### 0.2 Post–Pass-5 line ranges (pre-extraction this pass)

| Unit | Lines (post-Pass-5) |
|------|---------------------|
| `leaveTrackedRoom` | L71–162 |
| `socket.__leaveTrackedRoom` assignment | L164 |
| `leaveExistingSocketRooms` | L166–172 |
| `attachSocketToTrackedRoom` | L174–457 |
| `room:join` | L459–510 |
| `tournament:attach_assigned_match` | L512–741 |
| `handleRoomPlayerDisconnect` (exported) | L768–806 |

### 0.3 Session-supersession block (verbatim, live pre-extraction)

```typescript
        if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
          console.log(`[${via}] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
          oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
          oldSocket.disconnect(true);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
```

### 0.4 Reconnect-seat reclaim before "room is full" rejection (verbatim)

```typescript
        const seats = pruneReconnectSeats(roomCode);
        const match = seats.find((seat) =>
          identityMatchesReconnectSeat(seat, {
            username,
            userId,
          }),
        );
        if (!match) throw err;
        joinedPlayerSeatId = match.seatId;
        migrateRoomSeat(roomCode, match.seatId, socket.id);
        releaseReconnectSeat(roomCode, match.seatId);
```

### 0.5 Matchmaking auto-start block + idempotency boundary (verbatim)

**Attach block (pre-extraction L334–356):**

```typescript
      if (room.matchmakingMatchId && !room.state) {
        markMatchStartReady(room.code, joinedPlayerSeatId);

        const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
        if (mmSeatSockets.length >= 2) {
          try {
            await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
            const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
            if (startResult.started) {
              room = getRoom(room.code);
              console.log(`[${via}] matchmaking auto-started`, {
                roomCode: room.code,
                socketId: socket.id,
              });
            }
          } catch (startErr) {
            console.warn(
              `[${via}] matchmaking auto-start failed`,
              startErr instanceof Error ? startErr.message : startErr,
            );
          }
        }
      }
```

**Idempotency guard (`matchStartReady.ts` — frozen, unchanged):**

```typescript
  if (room.state) {
    return { started: false };
  }
```

**Race safety:** Pass 4's `player:ready` auto-start and this attach MM auto-start both call `tryStartMatchIfReady`; first caller creates `room.state`; second no-ops. **No new coordination added.**

### 0.6 `applyActiveMatchForfeit` in `leaveTrackedRoom` (verbatim)

**Import (orchestrator pre-extraction):** `import { applyActiveMatchForfeit } from './roomForfeit';`

**Call site:**

```typescript
          await applyActiveMatchForfeit(io, socket, code, abandoningPlayer);
```

**Preserved in `roomSocketAttach.ts` via same import from `./roomForfeit`. `roomForfeit.ts` not modified.**

### 0.7 Pass 1/2 DI contract grep

| Consumer module | Params still satisfied? |
|-----------------|-------------------------|
| `registerRoomSpectateHandlers` | `leaveExistingSocketRooms` — **yes**, from `createRoomSocketAttach` return |
| `registerRoomLifecycleHandlers` | `leaveExistingSocketRooms`, `leaveTrackedRoom` — **yes** |
| `registerRoomAbandonHandlers` | `leaveTrackedRoom` — **yes** |

**No changes to Pass 1–5 module signatures.**

### 0.8 Join ordering at attach entry (verbatim)

```typescript
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
```

---

## `socket.__leaveTrackedRoom` decision

**Choice: (a) Preserve the exact ad-hoc property pattern.**

**Reasoning:**
- Pre-existing since Pass 1 investigation; `handleRoomPlayerDisconnect` and `registerRoomSessionHandlers.abandon.test.ts` read `(socket as any).__leaveTrackedRoom`.
- Replacing with explicit closure-passing to `handleRoomPlayerDisconnect` would require changing `index.ts` disconnect wiring or adding a new export surface — `index.ts` is frozen.
- `createRoomSocketAttach` still assigns `(socket as any).__leaveTrackedRoom = leaveTrackedRoom` at the same lifecycle point (during `registerRoomSessionHandlers`).
- **No new ad-hoc socket properties introduced.**

---

## Structural choice

**Factory pattern:** `createRoomSocketAttach({ io, socket, handlerDeps })` returns `{ leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom }` per investigation §7.2.

**Why factory vs direct exports:** The three closures share `io`, `socket`, and `handlerDeps` and call each other (`leaveExistingSocketRooms` → `leaveTrackedRoom`; attach → `leaveExistingSocketRooms`). A factory keeps that mutual recursion in one module without ref bridges.

**Handler modules:** `registerRoomJoinHandlers` and `registerTournamentAttachHandlers` receive `attachSocketToTrackedRoom` via DI (typed `AttachSocketToTrackedRoomFn`).

**`handleRoomPlayerDisconnect`:** Remains exported from `registerRoomSessionHandlers.ts` ( `index.ts` import unchanged).

---

## Proactive token-level diff verification

Compared pre-extraction bodies (git-removed hunk, 4-space nested indent inside `registerRoomSessionHandlers`) against new modules (2-space indent):

| Aspect | Change? |
|--------|---------|
| Session supersession + 50ms pause | **No change** |
| Reconnect-seat reclaim path | **No change** |
| MM auto-start + `waitUntilMatchmakingRoomSocketsReady` | **No change** |
| `tryStartMatchIfReady` idempotency reliance | **No change** |
| Tournament attach ack-once + guards + repair | **No change** |
| `humanJoinedAt` idempotent patch | **No change** |
| `applyActiveMatchForfeit` call in leave | **No change** |
| `socket.__leaveTrackedRoom` assign/read | **No change** |
| `handleRoomPlayerDisconnect` body | **No change** |
| Handler registration order | **Preserved** — join + tournament before lifecycle/abandon/... |
| Indentation | **Only cosmetic** |

**Additional typing only:** `AttachSocketToTrackedRoomFn`, `RoomSocketAttachFns` exported types in `roomSocketAttach.ts` — no runtime behavior change.

---

## BEFORE — `handleRoomPlayerDisconnect` (pre-extraction L768–806)

```typescript
export function handleRoomPlayerDisconnect(
  io: Server,
  socket: Socket,
): { wasActiveRoomPlayer: boolean; roomCode?: string } {
  const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
  let wasActiveRoomPlayer = false;
  if (roomCode) {
    try {
      const room = getRoom(roomCode);
      if (room.abandonedAt) {
        wasActiveRoomPlayer = false;
      } else {
      const playerSeatId = getSeatIdForSocket(roomCode, socket.id);
      if (playerSeatId && room.players.includes(playerSeatId)) {
        wasActiveRoomPlayer = true;
        const handlerDeps = requireRoomSessionHandlerDeps();
        reserveReconnectSeat(roomCode, {
          seatId: playerSeatId,
          oldSocketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        });
        onActivePlayerSocketDisconnect(roomCode, playerSeatId, io, (code) =>
          broadcastStateUpdate(code),
        );
      }
      }
    } catch {
      // room no longer exists
    }
  }

  const leaveTrackedRoom = (socket as any).__leaveTrackedRoom as
    | ((roomCode: string | undefined, options?: { preserveSeat?: boolean }) => void | Promise<void>)
    | undefined;
  void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });

  return { wasActiveRoomPlayer, roomCode };
}
```

**Note:** Full BEFORE bodies for `leaveTrackedRoom`, `leaveExistingSocketRooms`, `attachSocketToTrackedRoom`, `room:join`, and `tournament:attach_assigned_match` occupied pre-extraction L71–741. Token-verified identical to AFTER modules below (indentation-only delta). Key invariant blocks quoted in Step 0.

---

## AFTER — `registerRoomSessionHandlers.ts` (101 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import {
  onActivePlayerSocketDisconnect,
} from './disconnectGrace';
import {
  broadcastStateUpdate,
  getSeatIdForSocket,
  requireRoomSessionHandlerDeps,
  reserveReconnectSeat,
} from './roomSession';
import { applyActiveMatchForfeit } from './roomForfeit';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { registerMatchStartHandlers } from './registerMatchStartHandlers';
import { registerRematchPregameHandlers } from './registerRematchPregameHandlers';
import { registerRoomAbandonHandlers } from './registerRoomAbandonHandlers';
import { registerRoomJoinHandlers } from './registerRoomJoinHandlers';
import { registerRoomLifecycleHandlers } from './registerRoomLifecycleHandlers';
import { registerRoomSpectateHandlers } from './registerRoomSpectateHandlers';
import { registerRoomUtilityHandlers } from './registerRoomUtilityHandlers';
import { registerTournamentAttachHandlers } from './registerTournamentAttachHandlers';
import { createRoomSocketAttach } from './roomSocketAttach';

export { applyActiveMatchForfeit } from './roomForfeit';

export function registerRoomSessionHandlers(io: Server, socket: Socket): void {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const { leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom } =
    createRoomSocketAttach({ io, socket, handlerDeps });

  registerRoomJoinHandlers(io, socket, {
    handlerDeps,
    attachSocketToTrackedRoom,
  });
  registerTournamentAttachHandlers(io, socket, {
    handlerDeps,
    attachSocketToTrackedRoom,
  });
  registerRoomLifecycleHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
    leaveTrackedRoom,
  });
  registerRoomAbandonHandlers(io, socket, {
    handlerDeps,
    leaveTrackedRoom,
  });
  registerGameplayActionHandlers(io, socket, {
    handlerDeps,
  });
  registerMatchStartHandlers(io, socket, {
    handlerDeps,
  });
  registerRematchPregameHandlers(io, socket, {
    handlerDeps,
  });
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
  registerRoomUtilityHandlers(socket);
}

export function handleRoomPlayerDisconnect(
  io: Server,
  socket: Socket,
): { wasActiveRoomPlayer: boolean; roomCode?: string } {
  const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
  let wasActiveRoomPlayer = false;
  if (roomCode) {
    try {
      const room = getRoom(roomCode);
      if (room.abandonedAt) {
        wasActiveRoomPlayer = false;
      } else {
      const playerSeatId = getSeatIdForSocket(roomCode, socket.id);
      if (playerSeatId && room.players.includes(playerSeatId)) {
        wasActiveRoomPlayer = true;
        const handlerDeps = requireRoomSessionHandlerDeps();
        reserveReconnectSeat(roomCode, {
          seatId: playerSeatId,
          oldSocketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        });
        onActivePlayerSocketDisconnect(roomCode, playerSeatId, io, (code) =>
          broadcastStateUpdate(code),
        );
      }
      }
    } catch {
      // room no longer exists
    }
  }

  const leaveTrackedRoom = (socket as any).__leaveTrackedRoom as
    | ((roomCode: string | undefined, options?: { preserveSeat?: boolean }) => void | Promise<void>)
    | undefined;
  void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });

  return { wasActiveRoomPlayer, roomCode };
}
```

---

## AFTER — `roomSocketAttach.ts` (466 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  joinRoom,
  peekRoom,
  type Room,
} from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { ensureRoomHydrated } from './roomLivePersistence';
import { onPlayerSocketRejoined } from './disconnectGrace';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import { applyActiveMatchForfeit } from './roomForfeit';
import {
  allocatePlayerSeatId,
  buildHandEndedPayload,
  buildMatchStartDeps,
  clearReconnectSeatsForSocket,
  clearRoomMetadata,
  clearSocketRematchReady,
  cancelRoomCleanup,
  deleteRoomRoster,
  ensureSocketDataSeat,
  evaluateRoomLifecycle,
  getEngineSeatSocketIds,
  getHandCounts,
  getRoomPlayersWithFallback,
  getRoomRoster,
  getSeatIdForSocket,
  identityMatchesReconnectSeat,
  maskStateForRecipient,
  migrateRoomSeat,
  pruneReconnectSeats,
  releaseReconnectSeat,
  resolveActorSeatId,
  setRoomRoster,
  type RoomPlayer,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { LeaveTrackedRoomFn } from './registerRoomLifecycleHandlers';

export type AttachSocketToTrackedRoomFn = (params: {
  roomCode: string;
  username: string;
  userId: string | null;
  via: 'room:join' | 'tournament:attach_assigned_match';
  hydrateMatchmakingRoom: boolean;
}) => Promise<{
  room: Room;
  joinedPlayerSeatId: string;
  roster: RoomPlayer[];
  stateWithCounts: ReturnType<typeof maskStateForRecipient> & { handCounts?: Record<string, number> } | null;
  rejoinLegalMoves: ReturnType<typeof getRoomLegalMoves>;
  rejoinCanDraw: boolean;
  tournamentMatchMeta: {
    tournamentId: string;
    matchId: string;
    round: 1 | 2 | 3;
    matchNumber: number;
    roomCode: string | null;
    opponentUserId: string | null;
    opponentUsername: string | null;
    opponentRating: number | null;
  } | null;
}>;

export type RoomSocketAttachContext = {
  io: Server;
  socket: Socket;
  handlerDeps: RoomSessionHandlerDeps;
};

export type RoomSocketAttachFns = {
  leaveTrackedRoom: LeaveTrackedRoomFn;
  leaveExistingSocketRooms: () => void;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function createRoomSocketAttach(ctx: RoomSocketAttachContext): RoomSocketAttachFns {
  const { io, socket, handlerDeps } = ctx;

  const leaveTrackedRoom: LeaveTrackedRoomFn = async (
    roomCode: string | undefined,
    options: { preserveSeat?: boolean } = {},
  ): Promise<void> => {
    if (!roomCode) return;
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    const preserveSeat = Boolean(options.preserveSeat);

    let room: Room | null = null;
    try {
      room = getRoom(code);
    } catch {
      clearRoomMetadata(code);
      cancelRoomCleanup(code);
      socket.leave(code);
      if (socket.data.roomId === code) {
        socket.data.roomId = undefined;
      }
      return;
    }

    const playerSeatId = getSeatIdForSocket(code, socket.id);
    const wasPlayer = playerSeatId ? room.players.includes(playerSeatId) : false;
    clearSocketRematchReady(code, socket.id);

    const shouldForfeit =
      !preserveSeat &&
      wasPlayer &&
      playerSeatId &&
      room.state != null &&
      !room.state.gameOver &&
      !room.abandonedAt;

    if (shouldForfeit) {
      const rosterCached = getRoomRoster(code);
      const roster =
        rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(code, room.players);
      const abandoningPlayer =
        roster.find((player) => player.id === playerSeatId)
        ?? {
          id: playerSeatId,
          socketId: socket.id,
          username: handlerDeps.normalizeUsername(socket.data?.username),
          userId: handlerDeps.normalizeUserId(socket.data?.userId),
        };

      try {
        await applyActiveMatchForfeit(io, socket, code, abandoningPlayer);
      } catch (err) {
        console.error('[room:leave] forfeit failed', {
          roomCode: code,
          playerSeatId,
          error: err instanceof Error ? err.message : err,
        });
      }
      room = getRoom(code);
    }

    socket.leave(code);
    if (socket.data.roomId === code) {
      socket.data.roomId = undefined;
    }

    if (!preserveSeat && wasPlayer && playerSeatId) {
      if (!room.abandonedAt) {
        appendRoomEvent(room, {
          type: 'player_left',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            preserveSeat,
            playerSeatId,
          },
        });
      }
      room.players = room.players.filter((pid) => pid !== playerSeatId);
      const nextRoster = getRoomRoster(code).filter((player) => player.id !== playerSeatId);
      if (nextRoster.length > 0) {
        setRoomRoster(code, nextRoster);
      } else {
        deleteRoomRoster(code);
      }

      clearReconnectSeatsForSocket(code, socket.id);

      io.to(code).emit('room:update', { players: nextRoster });
    }

    evaluateRoomLifecycle(code);
  };

  (socket as any).__leaveTrackedRoom = leaveTrackedRoom;

  const leaveExistingSocketRooms = () => {
    const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
    previousRooms.forEach((roomId) => {
      void leaveTrackedRoom(roomId);
    });
    socket.data.roomId = undefined;
  };

  const attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn = async (params) => {
    const { roomCode, username, userId, via, hydrateMatchmakingRoom } = params;
    clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
    leaveExistingSocketRooms();

    const hydrated = await ensureRoomHydrated(roomCode);
    if (hydrated?.source === 'database' && hydrated.restoredRoster.length > 0) {
      setRoomRoster(
        roomCode,
        hydrated.restoredRoster.map((entry) => ({
          id: entry.seatId,
          socketId: '',
          username: entry.username,
          userId: entry.userId,
        })),
      );
      console.log(`[${via}] live-session roster restored`, {
        roomCode,
        seats: hydrated.restoredRoster.length,
      });
    }

    const hydrateResult = hydrateMatchmakingRoom
      ? !peekRoom(roomCode)
        ? await handlerDeps.tryHydrateMatchmakingRoomShell(roomCode)
        : ('skipped' as const)
      : 'skipped';
    let existingRoom = peekRoom(roomCode);
    if (!existingRoom) {
      const message = 'Room not found.';
      console.log(`[${via}] ERROR: ${message} hydrate=${hydrateResult}`);
      throw new Error(message);
    }
    if (existingRoom.abandonedAt) {
      throw new Error('match_abandoned');
    }
    if (existingRoom.state?.gameOver) {
      console.log('[room:join] rejected completed room', { roomCode });
      throw new Error('match_completed');
    }
    let room: Room | null = null;
    let roster: RoomPlayer[] = [];
    let migratedByUserId = false;
    roster = (
      getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
      getRoomPlayersWithFallback(roomCode, existingRoom.players)
    ).slice();
    if (existingRoom && userId) {
      const existingPlayer = roster.find((player) => player.userId === userId);
      if (existingPlayer) {
        const oldSocket = existingPlayer.socketId
          ? io.sockets.sockets.get(existingPlayer.socketId)
          : undefined;
        if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
          console.log(`[${via}] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
          oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
          oldSocket.disconnect(true);
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`[${via}] RECONNECT: migrating seat ${existingPlayer.id} socket -> ${socket.id} for userId=${userId}`);
        migrateRoomSeat(roomCode, existingPlayer.id, socket.id);
        roster = roster.map((player) =>
          player.id === existingPlayer.id
            ? { ...player, socketId: socket.id, username, userId }
            : player,
        );
        setRoomRoster(roomCode, roster);
        socket.data.roomId = roomCode;
        ensureSocketDataSeat(socket, existingPlayer.id);
        room = existingRoom;
        migratedByUserId = true;
        appendRoomEvent(room, {
          type: 'player_reconnected',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            previousSocketId: existingPlayer.socketId,
            playerSeatId: existingPlayer.id,
            username,
          },
        });
      }
    }
    let joinedPlayerSeatId: string | null = migratedByUserId
      ? roster.find((player) => player.userId === userId)?.id ?? null
      : null;
    if (!migratedByUserId) {
      try {
        joinedPlayerSeatId = allocatePlayerSeatId();
        room = joinRoom(roomCode, joinedPlayerSeatId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        if (!message.toLowerCase().includes('room is full')) {
          throw err;
        }
        const seats = pruneReconnectSeats(roomCode);
        const match = seats.find((seat) =>
          identityMatchesReconnectSeat(seat, {
            username,
            userId,
          }),
        );
        if (!match) throw err;
        joinedPlayerSeatId = match.seatId;
        migrateRoomSeat(roomCode, match.seatId, socket.id);
        releaseReconnectSeat(roomCode, match.seatId);
        const rosterIdx = roster.findIndex((player) => player.id === match.seatId);
        if (rosterIdx >= 0) {
          roster[rosterIdx] = { ...roster[rosterIdx], socketId: socket.id, username, userId };
        } else {
          roster.push({
            id: match.seatId,
            socketId: socket.id,
            username,
            userId,
          });
        }
        room = getRoom(roomCode);
      }
    }
    if (!room) throw new Error('Room not found.');
    if (!joinedPlayerSeatId) {
      joinedPlayerSeatId = resolveActorSeatId(room.code, socket);
    }
    socket.join(room.code);
    socket.data.roomId = room.code;
    socket.data.username = username;
    socket.data.userId = userId;
    ensureSocketDataSeat(socket, joinedPlayerSeatId);
    const existingIdx = roster.findIndex((p) => p.id === joinedPlayerSeatId);
    if (existingIdx >= 0) {
      roster[existingIdx] = {
        id: joinedPlayerSeatId,
        socketId: socket.id,
        username,
        userId,
      };
    } else {
      roster.push({ id: joinedPlayerSeatId, socketId: socket.id, username, userId });
      appendRoomEvent(room, {
        type: 'player_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
          via,
        },
      });
    }
    setRoomRoster(room.code, roster);
    io.to(room.code).emit('room:update', { players: roster });
    console.log(`[${via}] joined room=${room.code}, players=${room.players.length}`);

    if (room.matchmakingMatchId && !room.state) {
      markMatchStartReady(room.code, joinedPlayerSeatId);

      const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
      if (mmSeatSockets.length >= 2) {
        try {
          await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
          const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
          if (startResult.started) {
            room = getRoom(room.code);
            console.log(`[${via}] matchmaking auto-started`, {
              roomCode: room.code,
              socketId: socket.id,
            });
          }
        } catch (startErr) {
          console.warn(
            `[${via}] matchmaking auto-start failed`,
            startErr instanceof Error ? startErr.message : startErr,
          );
        }
      }
    }

    const recipientId = joinedPlayerSeatId;
    const stateWithCounts = room.state
      ? (() => {
          const m = maskStateForRecipient(room.state!, recipientId);
          return { ...m, handCounts: getHandCounts(room.state!) };
        })()
      : null;

    const rejoinLegalMoves = room.state ? getRoomLegalMoves(room.code, joinedPlayerSeatId) : [];
    const rejoinCanDraw = room.state ? getRoomCanDraw(room.code, joinedPlayerSeatId) : false;

    let tournamentMatchMeta:
      | {
          tournamentId: string;
          matchId: string;
          round: 1 | 2 | 3;
          matchNumber: number;
          roomCode: string | null;
          opponentUserId: string | null;
          opponentUsername: string | null;
          opponentRating: number | null;
        }
      | null = null;
    if (room.scheduledTournamentMatchId && room.scheduledTournamentId) {
      try {
        const matchRows = await supabaseFetch<Array<{
          id: string;
          tournament_id: string;
          round: 1 | 2 | 3;
          match_number: number;
          room_code: string | null;
          player1_id: string | null;
          player2_id: string | null;
        }>>(
          `/rest/v1/scheduled_tournament_matches` +
            `?select=id,tournament_id,round,match_number,room_code,player1_id,player2_id` +
            `&id=eq.${encodeURIComponent(room.scheduledTournamentMatchId)}&limit=1`,
        );
        const match = matchRows[0];
        if (match) {
          const opponentUserId =
            userId && match.player1_id === userId
              ? match.player2_id
              : userId && match.player2_id === userId
                ? match.player1_id
                : null;
          let opponentUsername: string | null = null;
          let opponentRating: number | null = null;
          if (opponentUserId) {
            try {
              const profiles = await supabaseFetch<Array<{
                username: string | null;
                glicko_rating: number | null;
              }>>(
                `/rest/v1/profiles?select=username,glicko_rating&id=eq.${encodeURIComponent(opponentUserId)}&limit=1`,
              );
              opponentUsername = profiles[0]?.username ?? null;
              opponentRating = profiles[0]?.glicko_rating ?? null;
            } catch {
              /* profile lookup is best-effort */
            }
          }
          tournamentMatchMeta = {
            tournamentId: match.tournament_id,
            matchId: match.id,
            round: match.round,
            matchNumber: match.match_number,
            roomCode: match.room_code,
            opponentUserId,
            opponentUsername,
            opponentRating,
          };
        }
      } catch {
        /* tournament metadata is best-effort — never block attach on this */
      }
    }

    if (room.state && !room.preGameDraw) {
      if (room.state.handOver && !room.state.gameOver) {
        const payload = buildHandEndedPayload(room, joinedPlayerSeatId);
        if (payload) {
          socket.emit('hand:ended', payload);
        }
      }
    }

    onPlayerSocketRejoined(room.code, io, joinedPlayerSeatId);
    evaluateRoomLifecycle(room.code);

    return {
      room,
      joinedPlayerSeatId,
      roster,
      stateWithCounts,
      rejoinLegalMoves,
      rejoinCanDraw,
      tournamentMatchMeta,
    };
  };

  return { leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom };
}
```

---

## AFTER — `registerRoomJoinHandlers.ts` (73 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { getRoomMatchEventMeta } from '../rooms';
import {
  type AckFn,
  type RoomJoinConfig,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { AttachSocketToTrackedRoomFn } from './roomSocketAttach';

export type RegisterRoomJoinHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function registerRoomJoinHandlers(
  _io: Server,
  socket: Socket,
  params: RegisterRoomJoinHandlersParams,
): void {
  const { handlerDeps, attachSocketToTrackedRoom } = params;

  socket.on('room:join', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const explicitConfig =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
    const codeFromObject =
      argCode && typeof argCode === 'object' && !Array.isArray(argCode)
        ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown; authToken?: unknown })
        : null;
    const configFromCodeObject: RoomJoinConfig | null = codeFromObject
      ? {
          username:
            typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
          userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
          authToken: typeof codeFromObject.authToken === 'string' ? codeFromObject.authToken : null,
        }
      : null;
    const config = explicitConfig ?? configFromCodeObject ?? {};
    const rawCode = codeFromObject?.roomCode ?? argCode;
    const roomCode = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      console.log(`[room:join] identity user=${username} (${userId})`);
      const attached = await attachSocketToTrackedRoom({
        roomCode,
        username,
        userId,
        via: 'room:join',
        hydrateMatchmakingRoom: true,
      });
      cb?.({
        ok: true,
        roomCode: attached.room.code,
        you: attached.joinedPlayerSeatId,
        players: attached.roster,
        state: attached.stateWithCounts,
        legalMoves: attached.rejoinLegalMoves,
        canDraw: attached.rejoinCanDraw,
        eventMeta: getRoomMatchEventMeta(attached.room.code),
        tournamentMatch: attached.tournamentMatchMeta,
        matchStarted: Boolean(attached.room.state),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:join] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });
}
```

---

## AFTER — `registerTournamentAttachHandlers.ts` (267 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import {
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  peekRoom,
} from '../rooms';
import { fetchMatchById, updateMatch } from '../scheduledTournament/persistence';
import {
  dispatchTournamentMatch,
  humanJoinedAt,
  promoteScheduledMatchToInProgress,
} from '../scheduledTournament/matchDispatch';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import {
  buildMatchStartDeps,
  getHandCounts,
  maskStateForRecipient,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { AttachSocketToTrackedRoomFn } from './roomSocketAttach';

export type RegisterTournamentAttachHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  attachSocketToTrackedRoom: AttachSocketToTrackedRoomFn;
};

export function registerTournamentAttachHandlers(
  io: Server,
  socket: Socket,
  params: RegisterTournamentAttachHandlersParams,
): void {
  const { handlerDeps, attachSocketToTrackedRoom } = params;

  socket.on('tournament:attach_assigned_match', async (payload: unknown, cb?: AckFn) => {
    let acked = false;
    const ackOnce: AckFn = (response) => {
      if (acked) return;
      acked = true;
      cb?.(response);
    };

    const matchIdFromPayload =
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      typeof (payload as { matchId?: unknown }).matchId === 'string'
        ? (payload as { matchId: string }).matchId
        : null;

    console.log('[tournament:attach-server] received', {
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    });
    console.log('[tournament:attach] request', {
      socketId: socket.id,
      userId: handlerDeps.normalizeUserId(socket.data?.userId),
      matchId: matchIdFromPayload,
    });

    try {
      const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
      if (!authenticatedUserId) {
        console.log('[tournament:attach-server] rejected/no-user', { socketId: socket.id });
        ackOnce({ ok: false, error: 'not_authenticated' });
        return;
      }
      const matchId = matchIdFromPayload;
      if (!matchId) {
        ackOnce({ ok: false, error: 'missing_matchId' });
        return;
      }
      let match = await fetchMatchById(matchId);
      if (!match) {
        console.log('[tournament:attach-server] rejected/no-match', { matchId, userId: authenticatedUserId });
        ackOnce({ ok: false, error: 'match_not_found' });
        return;
      }
      if (match.status === 'completed' || match.status === 'bye' || match.completed_at || match.winner_id) {
        ackOnce({ ok: false, error: 'match_completed' });
        return;
      }
      if (match.room_code) {
        const existingRoom = peekRoom(match.room_code);
        if (existingRoom?.state?.gameOver) {
          console.log('[room:join] rejected completed room', { roomCode: match.room_code });
          ackOnce({ ok: false, error: 'match_completed' });
          return;
        }
      }
      if (match.player1_id !== authenticatedUserId && match.player2_id !== authenticatedUserId) {
        console.log('[tournament:attach-server] rejected/not-participant', {
          matchId,
          userId: authenticatedUserId,
        });
        ackOnce({ ok: false, error: 'tournament_not_assigned' });
        return;
      }
      if (match.status !== 'ready' && match.status !== 'in_progress') {
        ackOnce({ ok: false, error: 'match_not_ready' });
        return;
      }
      if (!match.room_code) {
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
      }
      if (!match?.room_code) {
        ackOnce({ ok: false, error: 'room_unavailable' });
        return;
      }
      if (peekRoom(match.room_code)) {
        console.log('[tournament:attach-server] room-found', {
          matchId: match.id,
          roomCode: match.room_code,
        });
      } else {
        console.log('[tournament:attach-server] room-missing', {
          matchId: match.id,
          roomCode: match.room_code,
        });
        await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
        match = await fetchMatchById(matchId);
        if (!match?.room_code || !peekRoom(match.room_code)) {
          ackOnce({ ok: false, error: 'room_unavailable' });
          return;
        }
        console.log('[tournament:attach-server] rehydrated', {
          matchId: match.id,
          roomCode: match.room_code,
        });
      }

      const seat =
        match.player1_id === authenticatedUserId
          ? 'player1'
          : match.player2_id === authenticatedUserId
            ? 'player2'
            : null;
      console.log('[tournament:attach-server] joining-room', {
        matchId: match.id,
        roomCode: match.room_code,
        userId: authenticatedUserId,
        seat,
      });

      const attached = await attachSocketToTrackedRoom({
        roomCode: match.room_code,
        username: typeof socket.data?.username === 'string' ? socket.data.username : 'Player',
        userId: authenticatedUserId,
        via: 'tournament:attach_assigned_match',
        hydrateMatchmakingRoom: false,
      });
      const nowIso = new Date().toISOString();
      if (!humanJoinedAt(match, authenticatedUserId)) {
        const patch =
          match.player1_id === authenticatedUserId
            ? { player1_joined_at: nowIso }
            : { player2_joined_at: nowIso };
        await updateMatch(match.id, patch);
      }

      let room = attached.room;
      let stateWithCounts = attached.stateWithCounts;
      let rejoinLegalMoves = attached.rejoinLegalMoves;
      let rejoinCanDraw = attached.rejoinCanDraw;

      if (room.scheduledTournamentMatchId && attached.joinedPlayerSeatId && !room.state) {
        markMatchStartReady(room.code, attached.joinedPlayerSeatId);
        const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
        if (startResult.started) {
          room = getRoom(room.code);
          await promoteScheduledMatchToInProgress(
            room.scheduledTournamentMatchId!,
            defaultEnginePersistence,
            nowIso,
            authenticatedUserId,
          );
          handlerDeps.notifyRoomPlayersInGame(room.code);
          await handlerDeps.onAfterMatchStarted(room);
          const recipientId = attached.joinedPlayerSeatId;
          stateWithCounts = room.state
            ? (() => {
                const m = maskStateForRecipient(room.state!, recipientId);
                return { ...m, handCounts: getHandCounts(room.state!) };
              })()
            : null;
          rejoinLegalMoves = [];
          rejoinCanDraw = false;
        }
      } else if (room.state && attached.joinedPlayerSeatId) {
        const recipientId = attached.joinedPlayerSeatId;
        stateWithCounts = (() => {
          const m = maskStateForRecipient(room.state!, recipientId);
          return { ...m, handCounts: getHandCounts(room.state!) };
        })();
        rejoinLegalMoves = getRoomLegalMoves(room.code, attached.joinedPlayerSeatId);
        rejoinCanDraw = getRoomCanDraw(room.code, attached.joinedPlayerSeatId);
      }

      const refreshed = await fetchMatchById(match.id);
      const humanAttached = Boolean(humanJoinedAt(refreshed ?? match, authenticatedUserId));
      const matchStatus =
        refreshed?.status === 'in_progress' && humanAttached
          ? 'in_progress'
          : 'ready';
      const youSeat = attached.joinedPlayerSeatId;
      const handCount =
        youSeat && stateWithCounts?.players?.[youSeat]?.hand
          ? stateWithCounts.players[youSeat].hand.length
          : 0;
      console.log('[tournament:attach-server] ack/success', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
        handCount,
        matchStatus,
      });
      console.log('[tournament:attach-server] accepted', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
      });
      console.log('[tournament:attach] accepted', {
        matchId: match.id,
        roomCode: room.code,
        userId: authenticatedUserId,
        seat,
      });
      ackOnce({
        ok: true,
        tournamentId: match.tournament_id,
        matchId: match.id,
        matchStatus,
        roomCode: room.code,
        you: attached.joinedPlayerSeatId,
        players: attached.roster,
        state: stateWithCounts,
        legalMoves: rejoinLegalMoves,
        canDraw: rejoinCanDraw,
        eventMeta: getRoomMatchEventMeta(room.code),
        tournamentMatch: attached.tournamentMatchMeta,
        matchStarted: Boolean(room.state),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'attach_failed';
      console.log('[tournament:attach-server] ack/error', {
        matchId: matchIdFromPayload,
        error: message,
      });
      ackOnce({
        ok: false,
        error: message,
      });
    } finally {
      if (!acked) {
        console.log('[tournament:attach-server] ack/error', {
          matchId: matchIdFromPayload,
          error: 'attach_ack_missing',
        });
        ackOnce({ ok: false, error: 'attach_ack_missing' });
      }
    }
  });
}
```

---

## New tests

| File | Tests |
|------|-------|
| `roomSocketAttach.test.ts` | `__leaveTrackedRoom` stash; `leaveExistingSocketRooms` clears `roomId` |
| `registerRoomJoinHandlers.test.ts` | Join ack surfaces attach errors |
| `registerTournamentAttachHandlers.test.ts` | Unauthenticated attach rejected |

**Integration suites (all pass):** `registerRoomSessionHandlers.private.test.ts`, `.abandon.test.ts`, `.tournament.test.ts`, `.privateRoomConfig.test.ts`, `handReadyGameplayLock.test.ts`, `tournamentHumanBotFlow.test.ts`, all Pass 1–5 module tests.

---

## LOC arithmetic (Pass 5 → Pass 6)

| File | Pass 5 end | Pass 6 end | Δ |
|------|------------|------------|---|
| `registerRoomSessionHandlers.ts` | 806 | **101** | **−705** |
| `roomSocketAttach.ts` | — | 466 | +466 |
| `registerRoomJoinHandlers.ts` | — | 73 | +73 |
| `registerTournamentAttachHandlers.ts` | — | 267 | +267 |
| Pass 1–5 modules (frozen) | — | — | 0 |

### Test / build arithmetic

| Metric | Pass 5 end | Pass 6 end | Δ |
|--------|------------|------------|---|
| Server test files | 74 | **77** | +3 |
| Server tests | 509 | **513** | +4 |
| Build | pass | **pass** | — |

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  77 passed (77)
# Tests       513 passed (513)
```

---

## Files changed (Pass 6)

| File | Change |
|------|--------|
| `server/src/multiplayer/roomSocketAttach.ts` | **Created** |
| `server/src/multiplayer/registerRoomJoinHandlers.ts` | **Created** |
| `server/src/multiplayer/registerTournamentAttachHandlers.ts` | **Created** |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Thin orchestrator + `handleRoomPlayerDisconnect` |
| `server/src/multiplayer/roomSocketAttach.test.ts` | **Created** |
| `server/src/multiplayer/registerRoomJoinHandlers.test.ts` | **Created** |
| `server/src/multiplayer/registerTournamentAttachHandlers.test.ts` | **Created** |

**Not touched (frozen):** `index.ts`, `rooms.ts`, `roomSession.ts`, `matchStartReady.ts`, `roomGameplayLock.ts`, `disconnectGrace.ts`, `roomForfeit.ts`, all Pass 1–5 modules/tests, all frozen client paths.

**Blocking-finding check:** No frozen file modifications required. Proceed was safe.

---

## Cumulative multi-pass summary (Passes 1–6)

### Orchestrator shrink

| Milestone | `registerRoomSessionHandlers.ts` LOC |
|-----------|--------------------------------------|
| Original (investigation) | **1,580** |
| After Pass 6 (final) | **101** |
| **Total reduction** | **−1,479 (−93.6%)** |

### New server modules created (all passes)

| Pass | Module(s) | LOC |
|------|-----------|-----|
| 1 | `registerRoomUtilityHandlers.ts`, `registerRoomSpectateHandlers.ts`, `roomForfeit.ts` | 235 |
| 2 | `registerRoomLifecycleHandlers.ts`, `registerRoomAbandonHandlers.ts` | 217 |
| 3 | `registerGameplayActionHandlers.ts` | 112 |
| 4 | `registerMatchStartHandlers.ts` | 160 |
| 5 | `registerRematchPregameHandlers.ts` | 228 |
| 6 | `roomSocketAttach.ts`, `registerRoomJoinHandlers.ts`, `registerTournamentAttachHandlers.ts` | 806 |
| **Total extracted module LOC** | | **1,758** |

(Orchestrator final 101 + extracted 1,758 ≈ 1,859 — delta vs original 1,580 is wrapper/types/tests overhead across modules.)

### Server test growth

| Milestone | Test files | Tests |
|-----------|------------|-------|
| Repo-health-audit baseline | **66** | **490** |
| After Pass 6 (final) | **77** | **513** |
| **Growth** | **+11** | **+23** |

### Final orchestrator responsibilities

- `requireRoomSessionHandlerDeps()` once per connection
- `createRoomSocketAttach` factory
- Wire 9 `register*` functions (Passes 1–6)
- Export `handleRoomPlayerDisconnect` + re-export `applyActiveMatchForfeit`

**Decomposition complete.** No further extraction passes planned for `registerRoomSessionHandlers.ts`.


---

---

## Appendix — Full BEFORE bodies (pre-extraction L71–741)

### `leaveTrackedRoom` + `leaveExistingSocketRooms` + `__leaveTrackedRoom` (L71–172)

```typescript
    const leaveTrackedRoom = async (
      roomCode: string | undefined,
      options: { preserveSeat?: boolean } = {},
    ): Promise<void> => {
      if (!roomCode) return;
      const code = roomCode.trim().toUpperCase();
      if (!code) return;

      const preserveSeat = Boolean(options.preserveSeat);

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        clearRoomMetadata(code);
        cancelRoomCleanup(code);
        socket.leave(code);
        if (socket.data.roomId === code) {
          socket.data.roomId = undefined;
        }
        return;
      }

      const playerSeatId = getSeatIdForSocket(code, socket.id);
      const wasPlayer = playerSeatId ? room.players.includes(playerSeatId) : false;
      clearSocketRematchReady(code, socket.id);

      const shouldForfeit =
        !preserveSeat &&
        wasPlayer &&
        playerSeatId &&
        room.state != null &&
        !room.state.gameOver &&
        !room.abandonedAt;

      if (shouldForfeit) {
        const rosterCached = getRoomRoster(code);
        const roster =
          rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(code, room.players);
        const abandoningPlayer =
          roster.find((player) => player.id === playerSeatId)
          ?? {
            id: playerSeatId,
            socketId: socket.id,
            username: handlerDeps.normalizeUsername(socket.data?.username),
            userId: handlerDeps.normalizeUserId(socket.data?.userId),
          };

        try {
          await applyActiveMatchForfeit(io, socket, code, abandoningPlayer);
        } catch (err) {
          console.error('[room:leave] forfeit failed', {
            roomCode: code,
            playerSeatId,
            error: err instanceof Error ? err.message : err,
          });
        }
        room = getRoom(code);
      }

      socket.leave(code);
      if (socket.data.roomId === code) {
        socket.data.roomId = undefined;
      }

      if (!preserveSeat && wasPlayer && playerSeatId) {
        if (!room.abandonedAt) {
          appendRoomEvent(room, {
            type: 'player_left',
            actorSocketId: socket.id,
            actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
            payload: {
              preserveSeat,
              playerSeatId,
            },
          });
        }
        room.players = room.players.filter((pid) => pid !== playerSeatId);
        const nextRoster = getRoomRoster(code).filter((player) => player.id !== playerSeatId);
        if (nextRoster.length > 0) {
          setRoomRoster(code, nextRoster);
        } else {
          deleteRoomRoster(code);
        }

        clearReconnectSeatsForSocket(code, socket.id);

        io.to(code).emit('room:update', { players: nextRoster });
      }

      evaluateRoomLifecycle(code);
    };

    (socket as any).__leaveTrackedRoom = leaveTrackedRoom;

    const leaveExistingSocketRooms = () => {
      const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
      previousRooms.forEach((roomId) => {
        void leaveTrackedRoom(roomId);
      });
      socket.data.roomId = undefined;
    };

```

### `attachSocketToTrackedRoom` (L174–457)

```typescript
    const attachSocketToTrackedRoom = async (params: {
      roomCode: string;
      username: string;
      userId: string | null;
      via: 'room:join' | 'tournament:attach_assigned_match';
      hydrateMatchmakingRoom: boolean;
    }) => {
      const { roomCode, username, userId, via, hydrateMatchmakingRoom } = params;
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      const hydrated = await ensureRoomHydrated(roomCode);
      if (hydrated?.source === 'database' && hydrated.restoredRoster.length > 0) {
        setRoomRoster(
          roomCode,
          hydrated.restoredRoster.map((entry) => ({
            id: entry.seatId,
            socketId: '',
            username: entry.username,
            userId: entry.userId,
          })),
        );
        console.log(`[${via}] live-session roster restored`, {
          roomCode,
          seats: hydrated.restoredRoster.length,
        });
      }

      const hydrateResult = hydrateMatchmakingRoom
        ? !peekRoom(roomCode)
          ? await handlerDeps.tryHydrateMatchmakingRoomShell(roomCode)
          : ('skipped' as const)
        : 'skipped';
      let existingRoom = peekRoom(roomCode);
      if (!existingRoom) {
        const message = 'Room not found.';
        console.log(`[${via}] ERROR: ${message} hydrate=${hydrateResult}`);
        throw new Error(message);
      }
      if (existingRoom.abandonedAt) {
        throw new Error('match_abandoned');
      }
      if (existingRoom.state?.gameOver) {
        console.log('[room:join] rejected completed room', { roomCode });
        throw new Error('match_completed');
      }
      let room: Room | null = null;
      let roster: RoomPlayer[] = [];
      let migratedByUserId = false;
      roster = (
        getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).slice();
      if (existingRoom && userId) {
        const existingPlayer = roster.find((player) => player.userId === userId);
        if (existingPlayer) {
          const oldSocket = existingPlayer.socketId
            ? io.sockets.sockets.get(existingPlayer.socketId)
            : undefined;
          if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
            console.log(`[${via}] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
            oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
            oldSocket.disconnect(true);
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          console.log(`[${via}] RECONNECT: migrating seat ${existingPlayer.id} socket -> ${socket.id} for userId=${userId}`);
          migrateRoomSeat(roomCode, existingPlayer.id, socket.id);
          roster = roster.map((player) =>
            player.id === existingPlayer.id
              ? { ...player, socketId: socket.id, username, userId }
              : player,
          );
          setRoomRoster(roomCode, roster);
          socket.data.roomId = roomCode;
          ensureSocketDataSeat(socket, existingPlayer.id);
          room = existingRoom;
          migratedByUserId = true;
          appendRoomEvent(room, {
            type: 'player_reconnected',
            actorSocketId: socket.id,
            actorUserId: userId,
            payload: {
              previousSocketId: existingPlayer.socketId,
              playerSeatId: existingPlayer.id,
              username,
            },
          });
        }
      }
      let joinedPlayerSeatId: string | null = migratedByUserId
        ? roster.find((player) => player.userId === userId)?.id ?? null
        : null;
      if (!migratedByUserId) {
        try {
          joinedPlayerSeatId = allocatePlayerSeatId();
          room = joinRoom(roomCode, joinedPlayerSeatId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          if (!message.toLowerCase().includes('room is full')) {
            throw err;
          }
          const seats = pruneReconnectSeats(roomCode);
          const match = seats.find((seat) =>
            identityMatchesReconnectSeat(seat, {
              username,
              userId,
            }),
          );
          if (!match) throw err;
          joinedPlayerSeatId = match.seatId;
          migrateRoomSeat(roomCode, match.seatId, socket.id);
          releaseReconnectSeat(roomCode, match.seatId);
          const rosterIdx = roster.findIndex((player) => player.id === match.seatId);
          if (rosterIdx >= 0) {
            roster[rosterIdx] = { ...roster[rosterIdx], socketId: socket.id, username, userId };
          } else {
            roster.push({
              id: match.seatId,
              socketId: socket.id,
              username,
              userId,
            });
          }
          room = getRoom(roomCode);
        }
      }
      if (!room) throw new Error('Room not found.');
      if (!joinedPlayerSeatId) {
        joinedPlayerSeatId = resolveActorSeatId(room.code, socket);
      }
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      ensureSocketDataSeat(socket, joinedPlayerSeatId);
      const existingIdx = roster.findIndex((p) => p.id === joinedPlayerSeatId);
      if (existingIdx >= 0) {
        roster[existingIdx] = {
          id: joinedPlayerSeatId,
          socketId: socket.id,
          username,
          userId,
        };
      } else {
        roster.push({ id: joinedPlayerSeatId, socketId: socket.id, username, userId });
        appendRoomEvent(room, {
          type: 'player_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            username,
            via,
          },
        });
      }
      setRoomRoster(room.code, roster);
      io.to(room.code).emit('room:update', { players: roster });
      console.log(`[${via}] joined room=${room.code}, players=${room.players.length}`);

      if (room.matchmakingMatchId && !room.state) {
        markMatchStartReady(room.code, joinedPlayerSeatId);

        const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
        if (mmSeatSockets.length >= 2) {
          try {
            await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
            const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
            if (startResult.started) {
              room = getRoom(room.code);
              console.log(`[${via}] matchmaking auto-started`, {
                roomCode: room.code,
                socketId: socket.id,
              });
            }
          } catch (startErr) {
            console.warn(
              `[${via}] matchmaking auto-start failed`,
              startErr instanceof Error ? startErr.message : startErr,
            );
          }
        }
      }

      const recipientId = joinedPlayerSeatId;
      const stateWithCounts = room.state
        ? (() => {
            const m = maskStateForRecipient(room.state!, recipientId);
            return { ...m, handCounts: getHandCounts(room.state!) };
          })()
        : null;

      const rejoinLegalMoves = room.state ? getRoomLegalMoves(room.code, joinedPlayerSeatId) : [];
      const rejoinCanDraw = room.state ? getRoomCanDraw(room.code, joinedPlayerSeatId) : false;

      let tournamentMatchMeta:
        | {
            tournamentId: string;
            matchId: string;
            round: 1 | 2 | 3;
            matchNumber: number;
            roomCode: string | null;
            opponentUserId: string | null;
            opponentUsername: string | null;
            opponentRating: number | null;
          }
        | null = null;
      if (room.scheduledTournamentMatchId && room.scheduledTournamentId) {
        try {
          const matchRows = await supabaseFetch<Array<{
            id: string;
            tournament_id: string;
            round: 1 | 2 | 3;
            match_number: number;
            room_code: string | null;
            player1_id: string | null;
            player2_id: string | null;
          }>>(
            `/rest/v1/scheduled_tournament_matches` +
              `?select=id,tournament_id,round,match_number,room_code,player1_id,player2_id` +
              `&id=eq.${encodeURIComponent(room.scheduledTournamentMatchId)}&limit=1`,
          );
          const match = matchRows[0];
          if (match) {
            const opponentUserId =
              userId && match.player1_id === userId
                ? match.player2_id
                : userId && match.player2_id === userId
                  ? match.player1_id
                  : null;
            let opponentUsername: string | null = null;
            let opponentRating: number | null = null;
            if (opponentUserId) {
              try {
                const profiles = await supabaseFetch<Array<{
                  username: string | null;
                  glicko_rating: number | null;
                }>>(
                  `/rest/v1/profiles?select=username,glicko_rating&id=eq.${encodeURIComponent(opponentUserId)}&limit=1`,
                );
                opponentUsername = profiles[0]?.username ?? null;
                opponentRating = profiles[0]?.glicko_rating ?? null;
              } catch {
                /* profile lookup is best-effort */
              }
            }
            tournamentMatchMeta = {
              tournamentId: match.tournament_id,
              matchId: match.id,
              round: match.round,
              matchNumber: match.match_number,
              roomCode: match.room_code,
              opponentUserId,
              opponentUsername,
              opponentRating,
            };
          }
        } catch {
          /* tournament metadata is best-effort — never block attach on this */
        }
      }

      if (room.state && !room.preGameDraw) {
        if (room.state.handOver && !room.state.gameOver) {
          const payload = buildHandEndedPayload(room, joinedPlayerSeatId);
          if (payload) {
            socket.emit('hand:ended', payload);
          }
        }
      }

      onPlayerSocketRejoined(room.code, io, joinedPlayerSeatId);
      evaluateRoomLifecycle(room.code);

      return {
        room,
        joinedPlayerSeatId,
        roster,
        stateWithCounts,
        rejoinLegalMoves,
        rejoinCanDraw,
        tournamentMatchMeta,
      };
    };
```

**Appendix correction (2026-07-05):** An earlier draft of this appendix incorrectly pasted `room:create` and `room:spectate` handler bodies between `attachSocketToTrackedRoom` and `room:join`. Those handlers were extracted in Pass 1/2 to `registerRoomLifecycleHandlers.ts` and `registerRoomSpectateHandlers.ts` and were **not** present in the pre–Pass-6 orchestrator. Grep on post–Pass-6 `registerRoomSessionHandlers.ts` confirms no inline `room:create` / `room:spectate` registrations. **Documentation-only error; zero code impact.**

### `room:join` (L459–510)

```typescript
    socket.on('room:join', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
      const cb = (
        typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
      ) as AckFn | undefined;
      const explicitConfig =
        arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
      const codeFromObject =
        argCode && typeof argCode === 'object' && !Array.isArray(argCode)
          ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown; authToken?: unknown })
          : null;
      const configFromCodeObject: RoomJoinConfig | null = codeFromObject
        ? {
            username:
              typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
            userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
            authToken: typeof codeFromObject.authToken === 'string' ? codeFromObject.authToken : null,
          }
        : null;
      const config = explicitConfig ?? configFromCodeObject ?? {};
      const rawCode = codeFromObject?.roomCode ?? argCode;
      const roomCode = String(rawCode ?? '')
        .trim()
        .toUpperCase();
      console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        console.log(`[room:join] identity user=${username} (${userId})`);
        const attached = await attachSocketToTrackedRoom({
          roomCode,
          username,
          userId,
          via: 'room:join',
          hydrateMatchmakingRoom: true,
        });
        cb?.({
          ok: true,
          roomCode: attached.room.code,
          you: attached.joinedPlayerSeatId,
          players: attached.roster,
          state: attached.stateWithCounts,
          legalMoves: attached.rejoinLegalMoves,
          canDraw: attached.rejoinCanDraw,
          eventMeta: getRoomMatchEventMeta(attached.room.code),
          tournamentMatch: attached.tournamentMatchMeta,
          matchStarted: Boolean(attached.room.state),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[room:join] ERROR: ${message}`);
        cb?.({ ok: false, error: message });
      }
    });

```

### `tournament:attach_assigned_match` (L512–741)

```typescript
    socket.on('tournament:attach_assigned_match', async (payload: unknown, cb?: AckFn) => {
      let acked = false;
      const ackOnce: AckFn = (response) => {
        if (acked) return;
        acked = true;
        cb?.(response);
      };
    
      const matchIdFromPayload =
        payload && typeof payload === 'object' && !Array.isArray(payload) &&
        typeof (payload as { matchId?: unknown }).matchId === 'string'
          ? (payload as { matchId: string }).matchId
          : null;
    
      console.log('[tournament:attach-server] received', {
        socketId: socket.id,
        userId: handlerDeps.normalizeUserId(socket.data?.userId),
        matchId: matchIdFromPayload,
      });
      console.log('[tournament:attach] request', {
        socketId: socket.id,
        userId: handlerDeps.normalizeUserId(socket.data?.userId),
        matchId: matchIdFromPayload,
      });
    
      try {
        const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
        if (!authenticatedUserId) {
          console.log('[tournament:attach-server] rejected/no-user', { socketId: socket.id });
          ackOnce({ ok: false, error: 'not_authenticated' });
          return;
        }
        const matchId = matchIdFromPayload;
        if (!matchId) {
          ackOnce({ ok: false, error: 'missing_matchId' });
          return;
        }
        let match = await fetchMatchById(matchId);
        if (!match) {
          console.log('[tournament:attach-server] rejected/no-match', { matchId, userId: authenticatedUserId });
          ackOnce({ ok: false, error: 'match_not_found' });
          return;
        }
        if (match.status === 'completed' || match.status === 'bye' || match.completed_at || match.winner_id) {
          ackOnce({ ok: false, error: 'match_completed' });
          return;
        }
        if (match.room_code) {
          const existingRoom = peekRoom(match.room_code);
          if (existingRoom?.state?.gameOver) {
            console.log('[room:join] rejected completed room', { roomCode: match.room_code });
            ackOnce({ ok: false, error: 'match_completed' });
            return;
          }
        }
        if (match.player1_id !== authenticatedUserId && match.player2_id !== authenticatedUserId) {
          console.log('[tournament:attach-server] rejected/not-participant', {
            matchId,
            userId: authenticatedUserId,
          });
          ackOnce({ ok: false, error: 'tournament_not_assigned' });
          return;
        }
        if (match.status !== 'ready' && match.status !== 'in_progress') {
          ackOnce({ ok: false, error: 'match_not_ready' });
          return;
        }
        if (!match.room_code) {
          await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
          match = await fetchMatchById(matchId);
        }
        if (!match?.room_code) {
          ackOnce({ ok: false, error: 'room_unavailable' });
          return;
        }
        if (peekRoom(match.room_code)) {
          console.log('[tournament:attach-server] room-found', {
            matchId: match.id,
            roomCode: match.room_code,
          });
        } else {
          console.log('[tournament:attach-server] room-missing', {
            matchId: match.id,
            roomCode: match.room_code,
          });
          await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true });
          match = await fetchMatchById(matchId);
          if (!match?.room_code || !peekRoom(match.room_code)) {
            ackOnce({ ok: false, error: 'room_unavailable' });
            return;
          }
          console.log('[tournament:attach-server] rehydrated', {
            matchId: match.id,
            roomCode: match.room_code,
          });
        }
    
        const seat =
          match.player1_id === authenticatedUserId
            ? 'player1'
            : match.player2_id === authenticatedUserId
              ? 'player2'
              : null;
        console.log('[tournament:attach-server] joining-room', {
          matchId: match.id,
          roomCode: match.room_code,
          userId: authenticatedUserId,
          seat,
        });
    
        const attached = await attachSocketToTrackedRoom({
          roomCode: match.room_code,
          username: typeof socket.data?.username === 'string' ? socket.data.username : 'Player',
          userId: authenticatedUserId,
          via: 'tournament:attach_assigned_match',
          hydrateMatchmakingRoom: false,
        });
        const nowIso = new Date().toISOString();
        if (!humanJoinedAt(match, authenticatedUserId)) {
          const patch =
            match.player1_id === authenticatedUserId
              ? { player1_joined_at: nowIso }
              : { player2_joined_at: nowIso };
          await updateMatch(match.id, patch);
        }
    
        let room = attached.room;
        let stateWithCounts = attached.stateWithCounts;
        let rejoinLegalMoves = attached.rejoinLegalMoves;
        let rejoinCanDraw = attached.rejoinCanDraw;
    
        if (room.scheduledTournamentMatchId && attached.joinedPlayerSeatId && !room.state) {
          markMatchStartReady(room.code, attached.joinedPlayerSeatId);
          const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
          if (startResult.started) {
            room = getRoom(room.code);
            await promoteScheduledMatchToInProgress(
              room.scheduledTournamentMatchId!,
              defaultEnginePersistence,
              nowIso,
              authenticatedUserId,
            );
            handlerDeps.notifyRoomPlayersInGame(room.code);
            await handlerDeps.onAfterMatchStarted(room);
            const recipientId = attached.joinedPlayerSeatId;
            stateWithCounts = room.state
              ? (() => {
                  const m = maskStateForRecipient(room.state!, recipientId);
                  return { ...m, handCounts: getHandCounts(room.state!) };
                })()
              : null;
            rejoinLegalMoves = [];
            rejoinCanDraw = false;
          }
        } else if (room.state && attached.joinedPlayerSeatId) {
          const recipientId = attached.joinedPlayerSeatId;
          stateWithCounts = (() => {
            const m = maskStateForRecipient(room.state!, recipientId);
            return { ...m, handCounts: getHandCounts(room.state!) };
          })();
          rejoinLegalMoves = getRoomLegalMoves(room.code, attached.joinedPlayerSeatId);
          rejoinCanDraw = getRoomCanDraw(room.code, attached.joinedPlayerSeatId);
        }
    
        const refreshed = await fetchMatchById(match.id);
        const humanAttached = Boolean(humanJoinedAt(refreshed ?? match, authenticatedUserId));
        const matchStatus =
          refreshed?.status === 'in_progress' && humanAttached
            ? 'in_progress'
            : 'ready';
        const youSeat = attached.joinedPlayerSeatId;
        const handCount =
          youSeat && stateWithCounts?.players?.[youSeat]?.hand
            ? stateWithCounts.players[youSeat].hand.length
            : 0;
        console.log('[tournament:attach-server] ack/success', {
          matchId: match.id,
          roomCode: room.code,
          userId: authenticatedUserId,
          seat,
          handCount,
          matchStatus,
        });
        console.log('[tournament:attach-server] accepted', {
          matchId: match.id,
          roomCode: room.code,
          userId: authenticatedUserId,
          seat,
        });
        console.log('[tournament:attach] accepted', {
          matchId: match.id,
          roomCode: room.code,
          userId: authenticatedUserId,
          seat,
        });
        ackOnce({
          ok: true,
          tournamentId: match.tournament_id,
          matchId: match.id,
          matchStatus,
          roomCode: room.code,
          you: attached.joinedPlayerSeatId,
          players: attached.roster,
          state: stateWithCounts,
          legalMoves: rejoinLegalMoves,
          canDraw: rejoinCanDraw,
          eventMeta: getRoomMatchEventMeta(room.code),
          tournamentMatch: attached.tournamentMatchMeta,
          matchStarted: Boolean(room.state),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'attach_failed';
        console.log('[tournament:attach-server] ack/error', {
          matchId: matchIdFromPayload,
          error: message,
        });
        ackOnce({
          ok: false,
          error: message,
        });
      } finally {
        if (!acked) {
          console.log('[tournament:attach-server] ack/error', {
            matchId: matchIdFromPayload,
            error: 'attach_ack_missing',
          });
          ackOnce({ ok: false, error: 'attach_ack_missing' });
        }
      }
    });
```
