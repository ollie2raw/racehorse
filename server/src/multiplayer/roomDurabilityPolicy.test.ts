import { describe, expect, it } from 'vitest';
import type { Room } from '../rooms';
import { createInitialRoomDurabilityState } from './roomDurability';
import { evaluateRoomDurabilityOperation } from './roomDurabilityPolicy';

function mkRoom(status: Room['durability']['status']): Room {
  const room = {
    code: 'DURP1',
    players: ['p1', 'p2'],
    state: {
      config: { winningScore: 60 },
      playerIds: ['p1', 'p2'],
      players: {
        p1: { id: 'p1', hand: [], score: 0 },
        p2: { id: 'p2', hand: [], score: 0 },
      },
      board: null,
      boneyard: [],
      deadTiles: [],
      currentPlayerIndex: 0,
      handNumber: 1,
      handOpen: true,
      handOver: false,
      gameOver: false,
      winnerId: null,
      consecutivePasses: 0,
      sequence: 1,
    } as any,
    config: { winningScore: 60 },
    asyncStateVersion: 1,
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
    eventLogVersion: 1,
    eventSequence: 1,
    events: [],
    disconnectExpiries: {},
  } as Room;
  room.durability = {
    ...createInitialRoomDurabilityState(room),
    status,
  };
  return room;
}

describe('room durability runtime policy', () => {
  it('allows all runtime operations while healthy', () => {
    const room = mkRoom('healthy');
    expect(evaluateRoomDurabilityOperation(room, 'gameplay_action')).toMatchObject({ allowed: true });
    expect(evaluateRoomDurabilityOperation(room, 'match_start')).toMatchObject({ allowed: true });
    expect(evaluateRoomDurabilityOperation(room, 'new_hand')).toMatchObject({ allowed: true });
    expect(evaluateRoomDurabilityOperation(room, 'rematch')).toMatchObject({ allowed: true });
  });

  it('allows degraded reconnect only from already in-memory authority', () => {
    const room = mkRoom('degraded');
    expect(
      evaluateRoomDurabilityOperation(room, 'reconnect_existing_player', {
        attachSource: 'already_in_memory',
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateRoomDurabilityOperation(room, 'reconnect_existing_player', {
        attachSource: 'hydrated',
      }),
    ).toMatchObject({ allowed: false, error: 'reconnect_unavailable' });
  });

  it('blocks degraded lifecycle transitions while allowing current gameplay to continue', () => {
    const room = mkRoom('degraded');
    expect(evaluateRoomDurabilityOperation(room, 'gameplay_action')).toMatchObject({ allowed: true });
    expect(evaluateRoomDurabilityOperation(room, 'match_start')).toMatchObject({
      allowed: false,
      error: 'match_start_blocked',
    });
    expect(evaluateRoomDurabilityOperation(room, 'new_hand')).toMatchObject({
      allowed: false,
      error: 'new_hand_blocked',
    });
    expect(evaluateRoomDurabilityOperation(room, 'rematch')).toMatchObject({
      allowed: false,
      error: 'rematch_blocked',
    });
  });

  it('blocks failed gameplay and reconnect outright', () => {
    const room = mkRoom('failed');
    expect(evaluateRoomDurabilityOperation(room, 'gameplay_action')).toMatchObject({
      allowed: false,
      error: 'room_persistence_failed',
    });
    expect(
      evaluateRoomDurabilityOperation(room, 'reconnect_existing_player', {
        attachSource: 'already_in_memory',
      }),
    ).toMatchObject({
      allowed: false,
      error: 'reconnect_unavailable',
    });
  });
});
