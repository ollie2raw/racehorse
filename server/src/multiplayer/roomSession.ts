import { childLogger } from '../logger';
const log = childLogger('room-session');
import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { assertValidGameState } from '../game/invariants';
import type { BranchArm, GameState } from '../game/types';
import {
  act,
  deleteRoom,
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  readyForNextHand,
  registerLiveRoomPersistHook,
  type ActionPayload,
  type DrawAnimationStep,
  type Room,
  type RoomConfig,
} from '../rooms';
import { chooseBotMoveServer, type ServerBotTier } from '../bot/serverBot';
import { clearGameActionIdempotencyForRoom } from './gameActionIdempotency';
import { configureDisconnectGraceSeatResolver, clearDisconnectGrace } from './disconnectGrace';
import {
  configureLiveRoomPersistence,
  schedulePersistLiveRoomSessionForRoom,
} from './roomLivePersistence';
import type { MatchStartDeps } from './matchStartReady';
import { drawAudit } from './drawAudit';
import { maskPregameDrawForRecipient } from './preGameDraw';
import { isLegacyLeagueRoom } from './roomKind';
import { publishMultiplayerSpectatorSnapshotIfEnabled } from '../spectator/spectatorIntegration';
import type {
  LegacyMatchmakingRoomShellHydrationResult,
  MatchmakingRoomShellHydrationResult,
  MatchmakingSocketSyncResult,
} from '../matchmaking/roomShellHydration';

function drawAuditUpdateEmitted(roomCode: string, reason: string): void {
  drawAudit('update-emitted', {
    roomCode,
    reason,
    privateHandsIncluded: true,
  });
}

export type PersistedRoomMatchLogStatus = 'completed' | 'abandoned';

const RECONNECT_GRACE_MS = 5 * 60_000;
const parsedRoomCleanupGrace = Number.parseInt(process.env.ROOM_CLEANUP_GRACE_MS ?? '', 10);
export const ROOM_CLEANUP_GRACE_MS = Number.isFinite(parsedRoomCleanupGrace)
  ? Math.max(60_000, parsedRoomCleanupGrace)
  : 5 * 60_000;

type ReconnectSeat = {
  seatId: string;
  oldSocketId: string;
  username: string;
  userId: string | null;
  expiresAt: number;
};

const reconnectSeatsByCode = new Map<string, ReconnectSeat[]>();
const roomCleanupTimersByCode = new Map<string, ReturnType<typeof setTimeout>>();

export type RoomPlayer = { id: string; socketId: string; username: string; userId: string | null };
export type RoomJoinConfig = { username?: string; userId?: string | null; authToken?: string | null };
export type AckFn = (payload: unknown) => void;

const roomPlayersByCode = new Map<string, RoomPlayer[]>();
const botTurnTimersByRoom = new Map<string, ReturnType<typeof setTimeout>>();

let ioRef: Server | null = null;

export type GameOverPersistInput = {
  room: Room;
  /** Frozen at persist schedule time — do not read `room.matchId` again in the IIFE. */
  sourceMatchId: string;
  cfg: RoomConfig;
  aId: string;
  bId: string;
  a: RoomPlayer;
  b: RoomPlayer;
  scoreA: number;
  scoreB: number;
  winnerSeatId: string;
};

export type RoomSessionHandlerDeps = {
  resolveSocketIdentity: (
    config: RoomJoinConfig,
  ) => Promise<{ username: string; userId: string | null }>;
  normalizeUsername: (value: unknown) => string;
  normalizeUserId: (value: unknown) => string | null;
  tryHydrateMatchmakingRoomShell: (
    roomCode: string,
    /** Identity of the socket asking to seat; checked against the match's players (M4). */
    requesterUserId?: string | null,
  ) => Promise<MatchmakingRoomShellHydrationResult | LegacyMatchmakingRoomShellHydrationResult>;
  waitUntilMatchmakingRoomSocketsReady: (
    io: Server,
    roomCode: string,
    engineSeatSocketIds: string[],
    resolveSeatSocketIds?: () => string[],
  ) => Promise<MatchmakingSocketSyncResult | void>;
  /**
   * M6: abort a matchmaking match that must not be dealt (socket-sync timeout).
   * Optional so non-matchmaking test harnesses need not supply it; when absent
   * the match is simply not started.
   */
  abortMatchmakingMatchOnStartFailure?: (roomCode: string, reason: string) => void;
  onAfterMatchStarted: (room: Room) => Promise<void>;
  notifyRoomPlayersInGame: (roomCode: string) => void;
  maybeFinalizeTournamentMatch?: (room: Room) => void;
  persistRoomMatchLog: (room: Room, status: PersistedRoomMatchLogStatus) => Promise<void>;
};

export type RoomSessionDeps = RoomSessionHandlerDeps & {
  onGameOver: (input: GameOverPersistInput) => (() => Promise<'succeeded' | 'failed'>) | null;
  finalizeTournamentMatch?: (room: Room) => void;
};

let sessionDeps: RoomSessionDeps | null = null;

export function requireRoomSessionHandlerDeps(): RoomSessionHandlerDeps {
  return requireDeps();
}

function requireDeps(): RoomSessionDeps {
  if (!sessionDeps) {
    throw new Error('roomSession: initRoomSession must be called before use');
  }
  return sessionDeps;
}

export function initRoomSession(io: Server, deps: RoomSessionDeps): void {
  ioRef = io;
  sessionDeps = deps;
  configureLiveRoomPersistence({
    resolveRoster: (roomCode) =>
      getRoomRoster(roomCode).map((player) => ({
        seatId: player.id,
        userId: player.userId,
        username: player.username,
      })),
  });
  registerLiveRoomPersistHook((room) => {
    schedulePersistLiveRoomSessionForRoom(room);
  });
  configureDisconnectGraceSeatResolver((roomCode, playerSeatId) => {
    const roster = roomPlayersByCode.get(roomCode) ?? [];
    return roster.find((player) => player.id === playerSeatId)?.socketId ?? null;
  });
}

/** Clears session-scoped maps between vitest cases (test environments only). */
export function resetRoomSessionStoresForTests(): void {
  roomPlayersByCode.clear();
  reconnectSeatsByCode.clear();
  for (const timer of botTurnTimersByRoom.values()) {
    clearTimeout(timer);
  }
  botTurnTimersByRoom.clear();
  for (const timer of roomCleanupTimersByCode.values()) {
    clearTimeout(timer);
  }
  roomCleanupTimersByCode.clear();
}

function requireIo(): Server {
  if (!ioRef) {
    throw new Error('roomSession: initRoomSession must be called before use');
  }
  return ioRef;
}

export function allocatePlayerSeatId(): string {
  return randomUUID();
}

export function getRoomRoster(roomCode: string): RoomPlayer[] {
  return roomPlayersByCode.get(roomCode) ?? [];
}

export function setRoomRoster(roomCode: string, players: RoomPlayer[]): void {
  roomPlayersByCode.set(roomCode, players);
}

export function deleteRoomRoster(roomCode: string): void {
  roomPlayersByCode.delete(roomCode);
}

export function getSeatIdForSocket(roomCode: string, socketId: string): string | null {
  const match = getRoomRoster(roomCode).find((player) => player.socketId === socketId);
  return match?.id ?? null;
}

export function getSocketForSeat(roomCode: string, seatId: string): string | null {
  return getRoomRoster(roomCode).find((player) => player.id === seatId)?.socketId ?? null;
}

export function ensureSocketDataSeat(socket: Socket, playerSeatId: string): void {
  socket.data.playerId = playerSeatId;
}

export function resolveActorSeatId(roomCode: string, socket: Socket): string {
  const fromData = typeof socket.data?.playerId === 'string' ? socket.data.playerId : null;
  if (fromData) {
    const roster = getRoomRoster(roomCode);
    // Trusting socket.data.playerId alone is not enough: it is a value
    // cached on this specific socket object at attach time, and a
    // duplicate-tab takeover migrates the seat's roster entry to the new
    // socket without necessarily having invalidated this (stale) socket's
    // cached data yet — the exact race window between seat migration and
    // old-socket teardown. Require the roster to say THIS socket currently
    // owns that seat, not just that the seat exists somewhere in the room.
    const owner = roster.find((player) => player.id === fromData);
    if (owner && owner.socketId === socket.id) {
      return fromData;
    }
  }
  const fromRoster = getSeatIdForSocket(roomCode, socket.id);
  if (fromRoster) return fromRoster;
  throw new Error('Player seat not found for socket.');
}

export function getEngineSeatSocketIds(roomCode: string, seatIds: string[]): string[] {
  return seatIds
    .map((seatId) => getSocketForSeat(roomCode, seatId))
    .filter((socketId): socketId is string => Boolean(socketId));
}

export function getRoomPlayersWithFallback(roomCode: string, seatIds: string[]): RoomPlayer[] {
  const existing = getRoomRoster(roomCode);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const next = seatIds.map(
    (id) => byId.get(id) ?? { id, socketId: '', username: 'Guest', userId: null },
  );
  setRoomRoster(roomCode, next);
  return next;
}

export function pruneReconnectSeats(roomCode: string): ReconnectSeat[] {
  const now = Date.now();
  const seats = (reconnectSeatsByCode.get(roomCode) ?? []).filter((seat) => seat.expiresAt > now);
  if (seats.length > 0) reconnectSeatsByCode.set(roomCode, seats);
  else reconnectSeatsByCode.delete(roomCode);
  return seats;
}

export function reserveReconnectSeat(roomCode: string, seat: Omit<ReconnectSeat, 'expiresAt'>): void {
  const seats = pruneReconnectSeats(roomCode).filter((s) => s.oldSocketId !== seat.oldSocketId);
  seats.push({ ...seat, expiresAt: Date.now() + RECONNECT_GRACE_MS });
  reconnectSeatsByCode.set(roomCode, seats);
}

export function releaseReconnectSeat(roomCode: string, seatId: string): void {
  const seats = pruneReconnectSeats(roomCode).filter((seat) => seat.seatId !== seatId);
  if (seats.length > 0) reconnectSeatsByCode.set(roomCode, seats);
  else reconnectSeatsByCode.delete(roomCode);
}

export function clearReconnectSeatsForSocket(roomCode: string, socketId: string): void {
  const seats = (reconnectSeatsByCode.get(roomCode) ?? []).filter((seat) => seat.oldSocketId !== socketId);
  if (seats.length > 0) reconnectSeatsByCode.set(roomCode, seats);
  else reconnectSeatsByCode.delete(roomCode);
}

export function clearReconnectSeatsForRoom(roomCode: string): void {
  reconnectSeatsByCode.delete(roomCode);
}

export function clearRoomMetadata(roomCode: string): void {
  deleteRoomRoster(roomCode);
  reconnectSeatsByCode.delete(roomCode);
  clearGameActionIdempotencyForRoom(roomCode);
  clearDisconnectGrace(roomCode);
}

export function cancelRoomCleanup(roomCode: string): void {
  const timer = roomCleanupTimersByCode.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimersByCode.delete(roomCode);
  }
}

export function scheduleRoomCleanup(roomCode: string): void {
  if (!roomCode || roomCleanupTimersByCode.has(roomCode)) return;
  const io = requireIo();
  const timer = setTimeout(async () => {
    roomCleanupTimersByCode.delete(roomCode);
    let room;
    try {
      room = getRoom(roomCode);
    } catch {
      clearRoomMetadata(roomCode);
      return;
    }
    const activePlayers = room.players.filter((seatId) => {
      const socketId = getSocketForSeat(roomCode, seatId);
      return Boolean(socketId && io.sockets.sockets.has(socketId));
    });
    if (activePlayers.length > 0) return;
    try {
      await requireDeps().persistRoomMatchLog(room, room.state?.gameOver ? 'completed' : 'abandoned');
    } catch (error) {
      log.error({ err: error }, '[room-match-logs] failed to archive room before cleanup');
    }
    const botTimer = botTurnTimersByRoom.get(roomCode);
    if (botTimer) clearTimeout(botTimer);
    botTurnTimersByRoom.delete(roomCode);
    deleteRoom(roomCode);
    clearRoomMetadata(roomCode);
  }, ROOM_CLEANUP_GRACE_MS);
  roomCleanupTimersByCode.set(roomCode, timer);
}

export function evaluateRoomLifecycle(roomCode: string | undefined): void {
  if (!roomCode) return;
  const io = requireIo();
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    clearRoomMetadata(roomCode);
    cancelRoomCleanup(roomCode);
    return;
  }
  const activePlayers = room.players.filter((seatId) => {
    const socketId = getSocketForSeat(roomCode, seatId);
    return Boolean(socketId && io.sockets.sockets.has(socketId));
  });
  if (activePlayers.length === 0 || room.state?.gameOver) {
    scheduleRoomCleanup(roomCode);
    return;
  }
  cancelRoomCleanup(roomCode);
}

export function joinSocketToRoom(
  socketId: string,
  roomCode: string,
  preservePrefixes: string[] = [],
): void {
  const io = requireIo();
  const target = io.sockets.sockets.get(socketId);
  if (!target) return;
  const currentRooms = [...target.rooms].filter(
    (joined) =>
      joined !== target.id && !preservePrefixes.some((prefix) => joined.startsWith(prefix)),
  );
  currentRooms.forEach((joined) => {
    target.leave(joined);
    evaluateRoomLifecycle(joined);
  });
  target.join(roomCode);
  target.data.roomId = roomCode;
}

export function identityMatchesReconnectSeat(
  seat: Omit<ReconnectSeat, 'expiresAt'>,
  identity: { username: string; userId: string | null },
): boolean {
  if (seat.userId && identity.userId) {
    return seat.userId === identity.userId;
  }
  if (seat.userId || identity.userId) {
    return false;
  }
  const genericNames = new Set(['guest', 'player', '']);
  const normalized = identity.username.toLowerCase().trim();
  if (genericNames.has(normalized)) {
    return false;
  }
  return seat.username === identity.username;
}

export function migrateRoomSeat(roomCode: string, playerSeatId: string, newSocketId: string): void {
  const roster = getRoomRoster(roomCode).slice();
  const rosterIdx = roster.findIndex((player) => player.id === playerSeatId);
  if (rosterIdx < 0) return;
  roster[rosterIdx] = { ...roster[rosterIdx], socketId: newSocketId };
  setRoomRoster(roomCode, roster);
}

export function emitRematchStatus(roomCode: string): void {
  const io = requireIo();
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    return;
  }
  const readyPlayerIds = room.players.filter((pid) => room.rematchReady.has(pid));
  io.to(room.code).emit('game:rematch:status', {
    roomCode: room.code,
    readyPlayerIds,
    readyCount: readyPlayerIds.length,
    needed: room.players.length,
  });
}

export function emitForcedDrawAnimationPayload(
  roomCode: string,
  payload: {
    playerId: string;
    sequence: number;
    steps: DrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
    finalState: GameState;
  },
): void {
  const io = requireIo();
  const hasPlayableFollowUp = getRoomLegalMoves(roomCode, payload.playerId).some((move) => move.type === 'play');
  const sequence = payload.finalState.sequence;
  const targetSocketId = getSocketForSeat(roomCode, payload.playerId);
  if (!targetSocketId) return;
  io.to(targetSocketId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence,
    drawChainId: sequence,
    mode: 'forced_draw',
    steps: payload.steps.map((step) => ({
      tile: step.tile,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: hasPlayableFollowUp,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });

  io.to(roomCode).except(targetSocketId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence,
    drawChainId: sequence,
    mode: 'forced_draw',
    steps: payload.steps.map((step) => ({
      tile: null,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: false,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });
}

export function clearSocketRematchReady(roomCode: string | undefined, socketId: string): void {
  if (!roomCode) return;
  try {
    const playerSeatId = getSeatIdForSocket(roomCode, socketId);
    if (!playerSeatId) return;
    const room = getRoom(roomCode);
    const changed = room.rematchReady.delete(playerSeatId);
    if (changed) emitRematchStatus(room.code);
  } catch {
    // room no longer exists
  }
}

export function buildHandEndedPayload(room: Room, playerId: string) {
  if (!room.state || room.preGameDraw) return null;
  const opponentId = room.state.playerIds.find((id) => id !== playerId) ?? null;
  const opponentHand = opponentId ? (room.state.players[opponentId]?.hand ?? []) : [];
  const myHand = room.state.players[playerId]?.hand ?? [];

  const opponentPipSum = opponentHand.reduce((s, t) => s + t.high + t.low, 0);
  const myPipSum = myHand.reduce((s, t) => s + t.high + t.low, 0);

  const iWentOut = myHand.length === 0;
  const opponentWentOut = opponentHand.length === 0;

  const youScoreDelta = iWentOut
    ? Math.round(opponentPipSum / 5)
    : opponentWentOut
      ? 0
      : myPipSum <= opponentPipSum
        ? Math.round(opponentPipSum / 5)
        : 0;

  const opponentScoreDelta = opponentWentOut
    ? Math.round(myPipSum / 5)
    : iWentOut
      ? 0
      : opponentPipSum <= myPipSum
        ? Math.round(myPipSum / 5)
        : 0;

  let handWinnerId: string | null = null;
  if (iWentOut) handWinnerId = playerId;
  else if (opponentWentOut) handWinnerId = opponentId;
  else if (myPipSum <= opponentPipSum) handWinnerId = playerId;
  else handWinnerId = opponentId;

  return {
    handNumber: room.state.handNumber,
    opponentRemainingTiles: opponentHand,
    yourRemainingTiles: myHand,
    pointsAwarded: {
      you: youScoreDelta,
      opponent: opponentScoreDelta,
    },
    whoWentOut: iWentOut ? playerId : opponentWentOut ? opponentId : null,
    winnerId: handWinnerId,
    handWinnerId: handWinnerId,
  };
}

function isSyntheticBotSeatId(seatId: string | null | undefined): seatId is string {
  return typeof seatId === 'string' && seatId.startsWith('bot:fritz:');
}

function currentPlayerSeatId(room: Room): string | null {
  const state = room.state;
  if (!state) return null;
  return state.playerIds[state.currentPlayerIndex] ?? null;
}

function buildSyntheticBotAction(roomCode: string, botSeatId: string): ActionPayload {
  const room = getRoom(roomCode);
  if (!room.state) return { type: 'PASS' };
  if (getRoomCanDraw(roomCode, botSeatId)) {
    return { type: 'DRAW' };
  }

  const tier: ServerBotTier = room.scheduledTournamentBotTier ?? 'elite';
  const move = chooseBotMoveServer(room.state, botSeatId, new Set<number>(), tier);
  if (move.type !== 'play') {
    return { type: 'PASS' };
  }
  return {
    type: 'MOVE',
    move: {
      tile: move.tile,
      position: move.position,
    },
  };
}

export function scheduleBotTurn(roomCode: string): void {
  if (botTurnTimersByRoom.has(roomCode)) return;

  let room: Room;
  try {
    room = getRoom(roomCode);
  } catch {
    return;
  }
  const botSeatId = currentPlayerSeatId(room);
  if (
    !room.state ||
    room.state.handOver ||
    room.state.gameOver ||
    !isSyntheticBotSeatId(botSeatId)
  ) {
    return;
  }

  const delayMs = 800 + Math.floor(Math.random() * 701);
  const timer = setTimeout(async () => {
    botTurnTimersByRoom.delete(roomCode);
    try {
      const latest = getRoom(roomCode);
      const latestBotSeatId = currentPlayerSeatId(latest);
      if (
        !latest.state ||
        latest.state.handOver ||
        latest.state.gameOver ||
        latestBotSeatId !== botSeatId ||
        !isSyntheticBotSeatId(latestBotSeatId)
      ) {
        return;
      }

      const result = await act(
        roomCode,
        latestBotSeatId,
        buildSyntheticBotAction(roomCode, latestBotSeatId),
        requireIo(),
        (code) => broadcastStateUpdate(code),
      );
      result.room.pendingForcedDrawBroadcast = result.forcedDrawAnimation
        ? {
            playerId: result.forcedDrawAnimation.playerId,
            count: result.forcedDrawAnimation.steps.length,
          }
        : undefined;
      broadcastStateUpdate(result.room.code);
      if (result.forcedDrawAnimation) {
        emitForcedDrawAnimationPayload(result.room.code, result.forcedDrawAnimation);
      }
      setImmediate(() => requireDeps().maybeFinalizeTournamentMatch?.(result.room));
    } catch (error) {
      log.warn({ err: error }, '[bot] turn failed');
    }
  }, delayMs);
  botTurnTimersByRoom.set(roomCode, timer);
}

function warnIfMaskedSnapshotMalformed(state: GameState, ctx: string): void {
  if (!state.players || typeof state.players !== 'object') {
    log.warn(`[maskStateForRecipient:${ctx}] players dictionary missing`);
  }
  if (!Array.isArray(state.playerIds)) {
    log.warn(`[maskStateForRecipient:${ctx}] playerIds missing or not array`);
  }
  const board = state.board as GameState['board'];
  if (board === undefined) {
    log.warn(`[maskStateForRecipient:${ctx}] board omitted (must be explicit null)`);
    return;
  }
  if (board === null) return;
  if (!Array.isArray(board.mainLine) || !Array.isArray(board.hubDoubles)) {
    log.warn(`[maskStateForRecipient:${ctx}] board malformed: mainLine/hubDoubles must be arrays`);
    return;
  }
  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    if (!hub || typeof hub !== 'object' || !Array.isArray(hub.branches)) {
      log.warn(`[maskStateForRecipient:${ctx}] hub ${hubIdx} missing branches BranchArm[]`);
      continue;
    }
    hub.branches.forEach((arm: BranchArm | undefined | null, armIdx: number) => {
      // null arm = empty slot; valid per BranchArm | null type. Only warn if arm exists but lacks tiles.
      if (arm !== null && arm !== undefined && !Array.isArray(arm.tiles)) {
        log.warn(
          `[maskStateForRecipient:${ctx}] hub ${hubIdx} arm ${armIdx} missing BranchArm.tiles array`,
        );
      }
    });
  }
}

export function maskStateForRecipient(state: GameState, recipientPlayerId: string | null): GameState {
  const canRevealAll = state.handOver || state.gameOver;
  const masked: GameState = {
    ...state,
    boneyard: canRevealAll
      ? state.boneyard
      : state.boneyard.map(() => ({ high: -1, low: -1 })),
    deadTiles: canRevealAll
      ? state.deadTiles
      : state.deadTiles.map(() => ({ high: -1, low: -1 })),
    players: Object.fromEntries(
      state.playerIds.map((pid) => {
        const ps = state.players[pid];
        if (!ps) {
          return [pid, { id: pid, hand: [], score: 0 }];
        }
        const reveal = canRevealAll || pid === recipientPlayerId;
        return [
          pid,
          {
            ...ps,
            hand: reveal ? ps.hand : [],
          },
        ];
      }),
    ),
  };

  warnIfMaskedSnapshotMalformed(
    masked,
    typeof recipientPlayerId === 'string' ? `player:${recipientPlayerId}` : 'spectator-null',
  );
  return masked;
}

export function getHandCounts(state: GameState): Record<string, number> {
  return Object.fromEntries(
    state.playerIds.map((pid) => [pid, state.players[pid]?.hand.length ?? 0]),
  );
}

export async function waitForActiveGameOverPersist(
  roomCode: string,
): Promise<'succeeded' | 'failed' | 'none'> {
  try {
    const room = getRoom(roomCode);
    const pending = room.activeGameOverPersist;
    if (pending) {
      return await pending;
    }
    if (room.matchLogged || room.gameOverPersistStatus === 'succeeded') {
      return 'succeeded';
    }
    if (room.gameOverPersistStatus === 'failed') {
      return 'failed';
    }
  } catch {
    // room gone — nothing to wait for
  }
  return 'none';
}

export function broadcastStateUpdate(roomCode: string): void {
  const io = requireIo();
  const deps = requireDeps();
  let scheduleDeferredMatchPersist: null | (() => Promise<'succeeded' | 'failed'>) = null;

  const room = getRoom(roomCode);
  if (!room.state) return;
  assertValidGameState(
    room.state,
    `broadcastStateUpdate:${roomCode}`,
    room.activeTileSetSize,
  );

  const cfg = room.config;
  // ONLY the legacy league (`cfg.tournamentId`). Scheduled-tournament rooms are
  // `roomKind === 'scheduled_tournament'` and are deliberately NOT this — see
  // the game-over branch below.
  const legacyLeagueRoom = isLegacyLeagueRoom(room);
  const pidsForLead = room.state.playerIds;
  if (Array.isArray(pidsForLead) && pidsForLead.length === 2) {
    const aId = pidsForLead[0];
    const bId = pidsForLead[1];
    const scoreA = room.state.players[aId]?.score ?? 0;
    const scoreB = room.state.players[bId]?.score ?? 0;
    const diff = scoreA - scoreB;
    const t = (room.leadTracker ??= { aId, bId, maxLeadA: 0, maxLeadB: 0 });
    if (t.aId !== aId || t.bId !== bId) {
      room.leadTracker = { aId, bId, maxLeadA: 0, maxLeadB: 0 };
    } else {
      if (diff > 0) t.maxLeadA = Math.max(t.maxLeadA, diff);
      if (diff < 0) t.maxLeadB = Math.max(t.maxLeadB, -diff);
    }
  }

  // DO NOT widen this guard to `!isAnyTournamentRoom`. A scheduled-tournament
  // match's normal play-to-completion result reaches the bracket ONLY by
  // flowing through this branch: `onGameOver` -> `persistGameOverOnce` ->
  // `applyTournamentGameOverFromRoom`, which is the single call site of that
  // function for game-over-from-play. Excluding scheduled-tournament rooms here
  // (the obvious-looking "consolidation") silently stops bracket advancement
  // for played-out matches — forfeit / no-show paths still work, so it passes a
  // smoke test. Only the legacy league (`legacyLeagueRoom`) is excluded, because
  // it runs its own finalizer via `deps.finalizeTournamentMatch` below.
  if (room.state.gameOver && !legacyLeagueRoom && !room.matchLogged) {
    const status = room.gameOverPersistStatus ?? 'idle';
    // Do not re-schedule while pending, after success, or after give-up.
    if (status === 'idle') {
      const pids = room.state.playerIds;
      if (Array.isArray(pids) && pids.length === 2) {
        const roster = getRoomRoster(room.code);
        const byId = new Map(roster.map((p) => [p.id, p]));
        const aId = pids[0];
        const bId = pids[1];
        const a = byId.get(aId) ?? { id: aId, socketId: '', username: 'Guest', userId: null };
        const b = byId.get(bId) ?? { id: bId, socketId: '', username: 'Guest', userId: null };
        const scoreA = room.state.players[aId]?.score ?? 0;
        const scoreB = room.state.players[bId]?.score ?? 0;
        const winnerSeatId = room.state.winnerId ?? (scoreA >= scoreB ? aId : bId);

        room.gameOverPersistStatus = 'pending';
        scheduleDeferredMatchPersist = deps.onGameOver({
          room,
          sourceMatchId: room.matchId,
          cfg,
          aId,
          bId,
          a,
          b,
          scoreA,
          scoreB,
          winnerSeatId,
        });
        if (!scheduleDeferredMatchPersist) {
          room.matchLogged = true;
          room.gameOverPersistStatus = 'succeeded';
        }
      }
    }
  }

  for (const seatId of room.state.playerIds) {
    if (seatId.startsWith('bot:fritz:')) continue;
    const connectionId = getSocketForSeat(roomCode, seatId);
    if (!connectionId) continue;
    const playerSocket = io.sockets.sockets.get(connectionId);
    if (!playerSocket) continue;
    if (!playerSocket.rooms.has(roomCode)) {
      playerSocket.join(roomCode);
      playerSocket.data.roomId = roomCode;
      ensureSocketDataSeat(playerSocket, seatId);
    }
  }

  const sockets = io.sockets.adapter.rooms.get(roomCode) ?? new Set<string>();

  const pendingForcedDraw = room.pendingForcedDrawBroadcast;
  const pendingAutoPasses =
    Array.isArray(room.pendingAutoPassNotice) && room.pendingAutoPassNotice.length > 0
      ? room.pendingAutoPassNotice
      : undefined;

  const currentScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );

  for (const connectionId of sockets) {
    const socket = io.sockets.sockets.get(connectionId);
    if (socket) {
      const recipientPlayerId = (() => {
        const fromData = typeof socket.data?.playerId === 'string' ? socket.data.playerId : null;
        if (fromData && room.state!.playerIds.includes(fromData)) {
          return fromData;
        }
        const fromRoster = getSeatIdForSocket(roomCode, connectionId);
        if (fromRoster && room.state!.playerIds.includes(fromRoster)) {
          return fromRoster;
        }
        return null;
      })();
      const isPlayer = recipientPlayerId !== null;

      const legalMoves = isPlayer ? getRoomLegalMoves(roomCode, recipientPlayerId) : [];
      const canDraw = isPlayer ? getRoomCanDraw(roomCode, recipientPlayerId) : false;

      const maskedState = maskStateForRecipient(room.state, recipientPlayerId);
      const broadcastHandCounts = getHandCounts(room.state);
      socket.emit('state:update', {
        state: { ...maskedState, handCounts: broadcastHandCounts },
        legalMoves,
        canDraw,
        you: recipientPlayerId ?? undefined,
        eventMeta: getRoomMatchEventMeta(room.code),
        matchStarted: true,
        preGameDraw: (() => {
          if (room.preGameDraw && recipientPlayerId) {
            log.info({ connectionId, recipientPlayerId, picks: room.preGameDraw?.picks, yourPick: room.preGameDraw?.picks[recipientPlayerId ?? ''] ?? null }, '[PREGAME-DEBUG] broadcasting to socket');
            return maskPregameDrawForRecipient(room.preGameDraw, recipientPlayerId, room.players);
          }
          return undefined;
        })(),
        ...(pendingForcedDraw
          ? {
              forcedDrawCount: pendingForcedDraw.count,
              forcedDrawActorId: pendingForcedDraw.playerId,
            }
          : {}),
        ...(pendingAutoPasses ? { recentAutoPasses: pendingAutoPasses } : {}),
      });

      if (
        room.state.handOver &&
        !room.state.gameOver &&
        !room.preGameDraw &&
        room.lastHandEndedNotifiedHand !== room.state.handNumber
      ) {
        room.lastHandEndedNotifiedHand = room.state.handNumber;
        for (const seatId of room.state.playerIds) {
          if (seatId.startsWith('bot:fritz:')) continue;
          const seatConnectionId = getSocketForSeat(roomCode, seatId);
          if (!seatConnectionId) continue;
          const playerSocket = io.sockets.sockets.get(seatConnectionId);
          if (!playerSocket) continue;

          const payload = buildHandEndedPayload(room, seatId);
          if (payload) {
            playerSocket.emit('hand:ended', payload);
          }
        }
      }
    }
  }

  room.lastBroadcastScores = currentScores;
  publishMultiplayerSpectatorSnapshotIfEnabled(io, room, () => getRoomRoster(room.code));

  if (room.state) {
    const spectatorMasked = maskStateForRecipient(room.state, null);
    const stateForSpectators = { ...spectatorMasked, handCounts: getHandCounts(room.state) };
    const spectatorPayload = {
      state: stateForSpectators,
      eventMeta: getRoomMatchEventMeta(room.code),
      ...(pendingForcedDraw
        ? {
            forcedDrawCount: pendingForcedDraw.count,
            forcedDrawActorId: pendingForcedDraw.playerId,
          }
        : {}),
      ...(pendingAutoPasses ? { recentAutoPasses: pendingAutoPasses } : {}),
    };
    const currentRoomSockets = io.sockets.adapter.rooms.get(room.code);
    if (currentRoomSockets) {
      for (const connectionId of currentRoomSockets) {
        const recipient = io.sockets.sockets.get(connectionId);
        if (!recipient) continue;
        const playerSeatId =
          typeof recipient.data?.playerId === 'string' &&
          room.state.playerIds.includes(recipient.data.playerId)
            ? recipient.data.playerId
            : getSeatIdForSocket(room.code, connectionId);
        if (playerSeatId && room.state.playerIds.includes(playerSeatId)) continue;
        recipient.emit('state:spectate', spectatorPayload);
      }
    }
  }

  room.pendingForcedDrawBroadcast = undefined;
  room.pendingAutoPassNotice = undefined;

  drawAuditUpdateEmitted(roomCode, pendingForcedDraw ? 'forced_draw_chain' : 'state_sync');

  if (scheduleDeferredMatchPersist) {
    const persistPromise = scheduleDeferredMatchPersist();
    room.activeGameOverPersist = persistPromise;
    setImmediate(() => {
      void persistPromise.finally(() => {
        if (room.activeGameOverPersist === persistPromise) {
          room.activeGameOverPersist = undefined;
        }
      });
    });
  }

  const roomAfter = (() => {
    try {
      return getRoom(roomCode);
    } catch {
      return null;
    }
  })();

  if (roomAfter?.state?.handOver && !roomAfter.state.gameOver) {
    for (const pid of roomAfter.players) {
      if (pid.startsWith('bot:fritz:') && !roomAfter.nextHandReady.has(pid)) {
        setTimeout(async () => {
          try {
            const result = await readyForNextHand(roomCode, pid, io);
            if (result.started) {
              broadcastStateUpdate(roomCode);
            }
          } catch (e) {
            log.warn({ err: e }, '[bot] auto-ready error');
          }
        }, 800);
      }
    }
  }

  scheduleBotTurn(room.code);

  if (room.state.gameOver) {
    const finRoom = room;
    const finCode = roomCode;
    // `deps.finalizeTournamentMatch` was the Legacy League finalizer — removed
    // with the System 5 decommission; `legacyLeagueRoom` is now always false
    // (nothing sets `config.tournamentId`). Scheduled-tournament rooms finalize
    // via the game-over branch above, not here. Kept inert for the roomKind
    // contract.
    const shouldFinalizeTour = legacyLeagueRoom;
    setImmediate(() => {
      if (shouldFinalizeTour) deps.finalizeTournamentMatch?.(finRoom);
      evaluateRoomLifecycle(finCode);
    });
  }
}

export function buildMatchStartDeps(_io: Server): MatchStartDeps {
  return {
    broadcastStateUpdate: (roomCode: string) => broadcastStateUpdate(roomCode),
    onSimMatchStarted: (_room: Room) => {
      // Sim matches removed from matchmaking path.
    },
  };
}
