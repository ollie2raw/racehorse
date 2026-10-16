/**
 * Realtime command-protocol integrity at the handler level: request-id identity, replay across game
 * over / rematch, match (generation) binding, authorization and malformed payloads, against real rooms
 * (only act()/persistence are stubbed). The real-server counterpart is scripts/realtimeCommandProbe.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import * as rooms from '../rooms';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { resetGameActionIdempotencyForTests } from './gameActionIdempotency';
import {
  ensureSocketDataSeat,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from './roomSession';
import * as roomSession from './roomSession';
import * as livePersistence from './roomLivePersistence';
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
import { registerRoomAbandonHandlers } from './registerRoomAbandonHandlers';
import { registerRematchPregameHandlers } from './registerRematchPregameHandlers';
import * as roomForfeit from './roomForfeit';
import { resetRoomGameplayLocksForTests } from './roomGameplayLock';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });
const state = (): GameState => ({
  config: { maxPips: 6, tilesPerPlayer: 7, deadTileCount: 2, scoringMultiple: 5, blockedHandRule: 'lowestPips', endHandBonus: 'sumOpponentPenalties', winningScore: 60 },
  playerIds: ['seat-1', 'seat-2'],
  players: { 'seat-1': { id: 'seat-1', hand: [t(6, 5)], score: 0 }, 'seat-2': { id: 'seat-2', hand: [t(4, 4)], score: 0 } },
  board: null, boneyard: [t(1, 0)], deadTiles: [t(0, 0), t(1, 1)], currentPlayerIndex: 0, handNumber: 1,
  handOpen: true, handOver: false, gameOver: false, winnerId: null, consecutivePasses: 0, sequence: 5,
});

function makeSocket(socketId: string, seatId: string, userId: string | null = 'u1') {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const socket: any = {
    id: socketId,
    data: { playerId: seatId, userId } as Record<string, unknown>,
    rooms: new Set<string>([socketId]),
    on: (event: string, handler: (...args: unknown[]) => unknown) => { handlers.set(event, handler); return socket; },
    emit: vi.fn(),
  };
  return { socket, handlers };
}
const makeIo = () => ({
  sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
  to: vi.fn(() => ({ emit: vi.fn(), except: vi.fn(() => ({ emit: vi.fn() })) })),
}) as any;
const deps = () => ({
  resolveSocketIdentity: async () => ({ username: 'P1', userId: 'u1' }),
  normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
  normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
  tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
  waitUntilMatchmakingRoomSocketsReady: async () => undefined,
  onAfterMatchStarted: async () => undefined,
  notifyRoomPlayersInGame: () => undefined,
  persistRoomMatchLog: async () => undefined,
  maybeFinalizeTournamentMatch: vi.fn(),
});

function setup(code: string) {
  createReservedRoom(code);
  joinRoom(code, 'seat-1');
  joinRoom(code, 'seat-2');
  const room = getRoom(code);
  room.players = ['seat-1', 'seat-2'];
  room.state = state();
  setRoomRoster(code, [
    { id: 'seat-1', socketId: 'sock-1', username: 'P1', userId: 'u1' },
    { id: 'seat-2', socketId: 'sock-2', username: 'P2', userId: 'u2' },
  ]);
  const io = makeIo();
  const s1 = makeSocket('sock-1', 'seat-1', 'u1');
  const s2 = makeSocket('sock-2', 'seat-2', 'u2');
  ensureSocketDataSeat(s1.socket, 'seat-1');
  ensureSocketDataSeat(s2.socket, 'seat-2');
  registerGameplayActionHandlers(io, s1.socket, { handlerDeps: deps() as any });
  registerGameplayActionHandlers(io, s2.socket, { handlerDeps: deps() as any });
  return { room, io, s1, s2 };
}

function stubActCommit(room: rooms.Room) {
  vi.spyOn(livePersistence, 'flushScheduledLiveRoomPersistence').mockResolvedValue({ flushedRoomCodes: [room.code] });
  vi.spyOn(roomSession, 'broadcastStateUpdate').mockImplementation(() => {});
  return vi.spyOn(rooms, 'act').mockImplementation(async () => {
    room.state!.sequence += 1;
    const version = { asyncStateVersion: room.asyncStateVersion, stateSequence: room.state!.sequence, eventSequence: room.eventSequence };
    const fence = { ...version, commitId: room.durability.targetFence.commitId };
    room.durability = { status: 'healthy', targetVersion: version, targetFence: fence, persistedVersion: version, persistedFence: fence, consecutiveFailures: 0, lastError: null, lastAttemptedAtMs: Date.now(), lastPersistedAtMs: Date.now() };
    return { room, forcedDrawAnimation: undefined };
  });
}

describe('realtime command integrity (handlers)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetRoomGameplayLocksForTests();
    resetGameActionIdempotencyForTests();
    initRoomSession(makeIo(), { ...deps(), onGameOver: () => null } as any);
  });

  const move = (requestId: string, high = 6, low = 5) => ({ type: 'MOVE', move: { tile: { high, low }, position: 'left' }, requestId });

  it('same request id + same payload replays the original ack; same id + altered payload fails closed (act runs once)', async () => {
    const { room, s1 } = setup('CI1');
    const actSpy = stubActCommit(room);
    const a1 = vi.fn(); const a2 = vi.fn(); const a3 = vi.fn();
    await s1.handlers.get('game:action')!('CI1', move('r1'), a1);
    await s1.handlers.get('game:action')!('CI1', move('r1'), a2);
    await s1.handlers.get('game:action')!('CI1', { type: 'PASS', requestId: 'r1' }, a3);
    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(a1).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6 }));
    expect(a2).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6, duplicate: true }));
    expect(a3).toHaveBeenCalledWith({ ok: false, error: 'request_id_conflict', code: 'request_id_conflict' });
    expect(room.state!.sequence).toBe(6);
  });

  it('a retry after the game ended (response lost on the final move) still gets the ORIGINAL result, not "Game is over"', async () => {
    const { room, s1 } = setup('CI2');
    stubActCommit(room);
    await s1.handlers.get('game:action')!('CI2', move('final-1'), vi.fn());
    room.state!.gameOver = true;
    const retry = vi.fn(); const fresh = vi.fn(); const altered = vi.fn();
    await s1.handlers.get('game:action')!('CI2', move('final-1'), retry);
    await s1.handlers.get('game:action')!('CI2', move('fresh-id'), fresh);
    await s1.handlers.get('game:action')!('CI2', { type: 'DRAW', requestId: 'final-1' }, altered);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ ok: true, sequence: 6, duplicate: true }));
    expect(fresh).toHaveBeenCalledWith({ ok: false, error: 'Game is over.', code: 'not_active' });
    expect(altered).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'request_id_conflict' }));
  });

  it('a new match (rematch) keeps resolving the previous game\'s request ids to their original result', async () => {
    const { room, s1 } = setup('CI3');
    const actSpy = stubActCommit(room);
    await s1.handlers.get('game:action')!('CI3', move('old-game-move'), vi.fn());
    // rematch: new match id, fresh state; the receipt cache is NOT cleared any more
    room.matchId = 'match-B';
    room.state = state();
    const replay = vi.fn(); const replayWithLegalNewPayload = vi.fn();
    await s1.handlers.get('game:action')!('CI3', move('old-game-move'), replay);
    await s1.handlers.get('game:action')!('CI3', { type: 'PASS', requestId: 'old-game-move' }, replayWithLegalNewPayload);
    expect(actSpy).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ ok: true, duplicate: true }));
    expect(replayWithLegalNewPayload).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'request_id_conflict' }));
    expect(room.state.sequence).toBe(5);
  });

  it('match binding: a command composed for another match is refused before touching state (action, hand:ready)', async () => {
    const { room, s1 } = setup('CI4');
    const actSpy = stubActCommit(room);
    const a = vi.fn(); const h = vi.fn(); const ok = vi.fn();
    await s1.handlers.get('game:action')!('CI4', { ...move('x1'), matchId: 'previous-match' }, a);
    await s1.handlers.get('hand:ready')!('CI4', { handNumber: 1, requestId: 'x2', matchId: 'previous-match' }, h);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'stale_match', stale: true, matchId: room.matchId }));
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'stale_match' }));
    expect(actSpy).not.toHaveBeenCalled();
    // the right match id is accepted, and legacy clients (no matchId) are unaffected
    await s1.handlers.get('game:action')!('CI4', { ...move('x3'), matchId: room.matchId }, ok);
    expect(ok).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('match binding: a late abandon (forfeit) or rematch from the previous game cannot land in the new game', async () => {
    const { room, io, s1 } = setup('CI5');
    const abandon = makeSocket('sock-1', 'seat-1', 'u1');
    registerRoomAbandonHandlers(io, abandon.socket, { handlerDeps: deps() as any, leaveTrackedRoom: vi.fn(async () => undefined) });
    registerRematchPregameHandlers(io, abandon.socket, { handlerDeps: deps() as any });
    const forfeit = vi.fn(); const rematch = vi.fn();
    await abandon.handlers.get('room:abandon_match')!({ roomCode: 'CI5', matchId: 'previous-match' }, forfeit);
    await abandon.handlers.get('game:rematch')!('CI5', { matchId: 'previous-match' }, rematch);
    expect(forfeit).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'stale_match' }));
    expect(rematch).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'stale_match' }));
    expect(room.abandonedAt).toBeUndefined();
    expect(room.rematchReady.size).toBe(0);
    void s1;
  });

  it('authorization: spectators, forged seat fields and unseated sockets never reach act()', async () => {
    const { room, io } = setup('CI6');
    const actSpy = stubActCommit(room);
    const spectator = makeSocket('sock-9', 'seat-9', 'u9');
    spectator.socket.data.playerId = 'seat-9';
    registerGameplayActionHandlers(io, spectator.socket, { handlerDeps: deps() as any });
    const spec = vi.fn(); const forged = vi.fn();
    await spectator.handlers.get('game:action')!('CI6', move('s1'), spec);
    await spectator.handlers.get('game:action')!('CI6', { ...move('s2'), playerId: 'seat-1', seatId: 'seat-1', userId: 'u1' }, forged);
    expect(spec).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: expect.stringMatching(/unauthorized/) }));
    expect(forged).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(actSpy).not.toHaveBeenCalled();
  });

  it('malformed MOVE payloads are rejected with code=malformed before the engine sees them', async () => {
    const { room, s1 } = setup('CI7');
    const actSpy = stubActCommit(room);
    const bad: unknown[] = [
      { type: 'MOVE', requestId: 'm1' },
      { type: 'MOVE', move: 'x', requestId: 'm2' },
      { type: 'MOVE', move: [], requestId: 'm3' },
      { type: 'MOVE', move: { tile: { high: '6', low: '5' } }, requestId: 'm4' },
      { type: 'MOVE', move: { tile: { high: 1.5, low: 2 } }, requestId: 'm5' },
      { type: 'MOVE', move: { tile: { high: 99, low: -1 } }, requestId: 'm6' },
      { type: 'MOVE', move: { tile: { high: { a: 1 }, low: 1 }, position: {} }, requestId: 'm7' },
    ];
    for (const action of bad) {
      const cb = vi.fn();
      await s1.handlers.get('game:action')!('CI7', action, cb);
      expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Invalid move payload.', code: 'malformed' });
    }
    expect(actSpy).not.toHaveBeenCalled();
    expect(room.state!.sequence).toBe(5);
  });

  it('engine/infrastructure errors never leak implementation detail to the client', async () => {
    const { room, s1 } = setup('CI8');
    vi.spyOn(rooms, 'act').mockRejectedValue(new Error('Supabase request failed: 500 relation room_live_sessions does not exist'));
    const cb = vi.fn();
    await s1.handlers.get('game:action')!('CI8', move('leak-1'), cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Action failed. Please retry.', code: 'internal_error' });
    expect(room.state!.sequence).toBe(5);
  });

  it('hand:ready that changes nothing leaves no receipt (cannot be used to write unbounded receipt rows)', async () => {
    const { room, s1 } = setup('CI9');
    const persist = vi.spyOn(await import('./roomCommandReceiptStore'), 'persistRoomCommandReceipt').mockResolvedValue(undefined);
    for (let i = 0; i < 5; i += 1) {
      const cb = vi.fn();
      await s1.handlers.get('hand:ready')!('CI9', { handNumber: 1, requestId: `noop-${i}` }, cb);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ok: true, started: false }));
    }
    expect(persist).not.toHaveBeenCalled();
    expect(room.state!.handOver).toBe(false);
  });

  it('R1 (guest impersonation): an unverified socket that merely CLAIMS a guest id cannot resign that guest\'s seat; the seat\'s own socket still can', async () => {
    createReservedRoom('CI10');
    joinRoom('CI10', 'seat-1');
    joinRoom('CI10', 'seat-2');
    const room = getRoom('CI10');
    room.players = ['seat-1', 'seat-2'];
    room.state = state();
    // guests: client-chosen, non-UUID ids; every roster entry (and so the opponent) knows them
    setRoomRoster('CI10', [
      { id: 'seat-1', socketId: 'sock-g1', username: 'G1', userId: 'guest-1' },
      { id: 'seat-2', socketId: 'sock-g2', username: 'G2', userId: 'guest-2' },
    ]);
    const io = makeIo();
    const forfeit = vi.spyOn(roomForfeit, 'applyActiveMatchForfeit').mockResolvedValue({ winnerUserId: 'guest-2' });
    const leave = vi.fn(async () => undefined);
    const attacker = makeSocket('sock-evil', 'seat-none', 'guest-1'); // presence:identify accepts a claimed non-UUID id
    const owner = makeSocket('sock-g1', 'seat-1', 'guest-1');
    for (const sock of [attacker, owner]) registerRoomAbandonHandlers(io, sock.socket, { handlerDeps: deps() as any, leaveTrackedRoom: leave });
    const denied = vi.fn(); const allowed = vi.fn();
    await attacker.handlers.get('room:abandon_match')!({ roomCode: 'CI10' }, denied);
    expect(denied).toHaveBeenCalledWith({ ok: false, error: 'not_player' });
    expect(forfeit).not.toHaveBeenCalled();
    await owner.handlers.get('room:abandon_match')!({ roomCode: 'CI10' }, allowed);
    expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ ok: true, winnerId: 'guest-2' }));
    expect(forfeit).toHaveBeenCalledTimes(1);
  });

  it('response-loss retry across a rematch: same id + same payload + game-A matchId returns the original result; changed payload conflicts; a never-applied A command is stale', async () => {
    const { room, s1 } = setup('CI11');
    const actSpy = stubActCommit(room);
    const matchA = room.matchId;
    await s1.handlers.get('game:action')!('CI11', { ...move('a-final'), matchId: matchA }, vi.fn()); // committed; ack "lost"
    room.matchId = 'match-B';
    room.state = state();
    const before = JSON.stringify(room.state);
    const retry = vi.fn(); const changed = vi.fn(); const neverApplied = vi.fn(); const fresh = vi.fn();
    await s1.handlers.get('game:action')!('CI11', { ...move('a-final'), matchId: matchA }, retry);
    await s1.handlers.get('game:action')!('CI11', { type: 'PASS', requestId: 'a-final', matchId: matchA }, changed);
    await s1.handlers.get('game:action')!('CI11', { ...move('a-delayed'), matchId: matchA }, neverApplied);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ ok: true, duplicate: true, sequence: 6 }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'request_id_conflict' }));
    expect(neverApplied).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'stale_match', matchId: 'match-B' }));
    expect(JSON.stringify(room.state)).toBe(before);
    expect(actSpy).toHaveBeenCalledTimes(1);
    // the equivalent NEW command bound to game B is judged by B's legality
    await s1.handlers.get('game:action')!('CI11', { ...move('b-new'), matchId: 'match-B' }, fresh);
    expect(fresh).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(actSpy).toHaveBeenCalledTimes(2);
  });

  it('rollout switch: COMMAND_MATCH_ID_REQUIRED=true makes unbound match-scoped commands fail closed; default accepts legacy clients', async () => {
    const { room, s1 } = setup('CI12');
    const actSpy = stubActCommit(room);
    const legacy = vi.fn();
    await s1.handlers.get('game:action')!('CI12', move('legacy-1'), legacy);
    expect(legacy).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    process.env.COMMAND_MATCH_ID_REQUIRED = 'true';
    try {
      const unbound = vi.fn(); const bound = vi.fn();
      await s1.handlers.get('game:action')!('CI12', move('legacy-2'), unbound);
      await s1.handlers.get('game:action')!('CI12', { ...move('bound-1'), matchId: room.matchId }, bound);
      expect(unbound).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'match_id_required' }));
      expect(bound).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(actSpy).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.COMMAND_MATCH_ID_REQUIRED;
    }
  });
});
