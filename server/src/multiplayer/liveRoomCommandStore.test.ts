import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { createInitialRoomDurabilityState } from './roomDurability';
import {
  commitLiveRoomGameplayCommand,
  isTransactionalMultiplayerCommandsEnabled,
  prepareLiveRoomGameplayCommand,
} from './liveRoomCommandStore';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

const tile = (low: number, high: number) => ({ low, high });

function gameState(sequence = 15): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['seat-a', 'seat-b'],
    players: {
      'seat-a': { id: 'seat-a', hand: [tile(1, 2)], score: 0 },
      'seat-b': { id: 'seat-b', hand: [tile(3, 4)], score: 0 },
    },
    board: null,
    boneyard: [tile(5, 6)],
    deadTiles: [tile(0, 0), tile(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence,
  };
}

function room(): Room {
  const base = {
    code: 'CAS01',
    players: ['seat-a', 'seat-b'],
    state: gameState(),
    config: { winningScore: 60 },
    asyncStateVersion: 2,
    authorityRevision: 3,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    matchStartReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1 as const,
    eventSequence: 2,
    events: [],
  } as Room;
  base.durability = createInitialRoomDurabilityState(base);
  return base;
}

const roster = [
  { seatId: 'seat-a', userId: null, username: 'A' },
  { seatId: 'seat-b', userId: null, username: 'B' },
];

describe('liveRoomCommandStore', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('keeps the transactional path off until its migration is confirmed applied', () => {
    const previous = process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS;
    delete process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS;
    expect(isTransactionalMultiplayerCommandsEnabled()).toBe(false);
    process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS = 'true';
    expect(isTransactionalMultiplayerCommandsEnabled()).toBe(true);
    if (previous === undefined) delete process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS;
    else process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS = previous;
  });

  it('replays a durable committed receipt before local mutation after a process restart', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        outcome: 'committed',
        error_code: null,
        replayed: true,
        authority_revision: 4,
        response: { ok: true, sequence: 15 },
      },
    ]);

    const result = await prepareLiveRoomGameplayCommand({
      room: room(),
      actorSeatId: 'seat-a',
      requestId: 'request-1',
      requestDigest: 'a'.repeat(64),
    });

    expect(result).toEqual({
      kind: 'replay',
      authorityRevision: 4,
      ack: { ok: true, sequence: 15, duplicate: true },
    });
  });

  it('rejects a reused request ID whose durable digest does not match', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        outcome: 'rejected',
        error_code: 'request_id_conflict',
        replayed: false,
        authority_revision: 4,
        response: { ok: false, error: 'request_id_conflict', sequence: 15 },
      },
    ]);

    const result = await prepareLiveRoomGameplayCommand({
      room: room(),
      actorSeatId: 'seat-a',
      requestId: 'request-conflict',
      requestDigest: 'd'.repeat(64),
    });

    expect(result).toEqual({
      kind: 'rejected',
      authorityRevision: 4,
      ack: { ok: false, error: 'request_id_conflict', sequence: 15 },
    });
  });

  it('atomically sends snapshot and receipt identity and advances the room CAS revision', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        outcome: 'committed',
        error_code: null,
        replayed: false,
        authority_revision: 4,
        response: { ok: true, sequence: 15, authorityRevision: 4 },
      },
    ]);
    const liveRoom = room();

    const result = await commitLiveRoomGameplayCommand({
      room: liveRoom,
      roster,
      actorSeatId: 'seat-a',
      requestId: 'request-1',
      requestDigest: 'b'.repeat(64),
      expectedAuthorityRevision: 3,
      ack: { ok: true, sequence: 15 },
    });

    expect(result.kind).toBe('committed');
    expect(liveRoom.authorityRevision).toBe(4);
    expect(liveRoom.durability.status).toBe('healthy');
    const [path, init] = vi.mocked(supabaseFetch).mock.calls[0]!;
    expect(path).toBe('/rest/v1/rpc/commit_room_live_session_command');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      p_room_code: 'CAS01',
      p_actor_seat_id: 'seat-a',
      p_request_id: 'request-1',
      p_request_digest: 'b'.repeat(64),
      p_expected_revision: 3,
      p_response: { ok: true, sequence: 15 },
      p_snapshot: { room_code: 'CAS01', game_state_sequence: 15 },
    });
  });

  it('marks the room degraded when the database rejects a stale CAS commit', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        outcome: 'rejected',
        error_code: 'stale_revision',
        replayed: false,
        authority_revision: 7,
        response: { ok: false, error: 'stale_revision', sequence: 16 },
      },
    ]);
    const liveRoom = room();

    const result = await commitLiveRoomGameplayCommand({
      room: liveRoom,
      roster,
      actorSeatId: 'seat-a',
      requestId: 'request-2',
      requestDigest: 'c'.repeat(64),
      expectedAuthorityRevision: 3,
      ack: { ok: true, sequence: 15 },
    });

    expect(result).toMatchObject({
      kind: 'rejected',
      authorityRevision: 7,
      ack: { ok: false, error: 'stale_revision' },
    });
    expect(liveRoom.durability.status).toBe('degraded');
  });

  it('treats a receipt replay that wins between preflight and commit as uncertain', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([
      {
        outcome: 'committed',
        error_code: null,
        replayed: true,
        authority_revision: 4,
        response: { ok: true, sequence: 15 },
      },
    ]);
    const liveRoom = room();

    const result = await commitLiveRoomGameplayCommand({
      room: liveRoom,
      roster,
      actorSeatId: 'seat-a',
      requestId: 'request-raced',
      requestDigest: 'e'.repeat(64),
      expectedAuthorityRevision: 3,
      ack: { ok: true, sequence: 15 },
    });

    expect(result).toMatchObject({
      kind: 'rejected',
      authorityRevision: 4,
      ack: { ok: false, error: 'room_command_commit_raced', uncertain: true },
    });
    expect(liveRoom.authorityRevision).toBe(3);
    expect(liveRoom.durability.status).toBe('degraded');
  });

  it('marks durability degraded when the atomic RPC transport fails', async () => {
    vi.mocked(supabaseFetch).mockRejectedValueOnce(new Error('database_unreachable'));
    const liveRoom = room();

    await expect(commitLiveRoomGameplayCommand({
      room: liveRoom,
      roster,
      actorSeatId: 'seat-a',
      requestId: 'request-outage',
      requestDigest: 'f'.repeat(64),
      expectedAuthorityRevision: 3,
      ack: { ok: true, sequence: 15 },
    })).rejects.toThrow('database_unreachable');

    expect(liveRoom.authorityRevision).toBe(3);
    expect(liveRoom.durability).toMatchObject({
      status: 'degraded',
      lastError: 'database_unreachable',
    });
  });
});
