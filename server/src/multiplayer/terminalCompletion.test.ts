import { describe, expect, it } from 'vitest';
import { createDetachedRoom } from '../rooms';
import {
  buildLiveSessionRow,
  parseRoomShell,
  serializeRoomShell,
  type LiveRosterEntry,
} from './roomLivePersistence';
import { materializeDetachedRoomFromSession } from './applyLiveSessionRoom';
import { accountIdOrNull, isRatedForfeitRoom, roomOwesTerminalCompletion } from './terminalCompletion';
import { mkTerminalGameState } from './terminalCompletionTestKit';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const roster = (a: string | null, b: string | null): LiveRosterEntry[] => [
  { seatId: 'seat-a', userId: a, username: 'A' },
  { seatId: 'seat-b', userId: b, username: 'B' },
];

function room(overrides: Partial<ReturnType<typeof createDetachedRoom>> = {}) {
  const r = createDetachedRoom('TERM1', { winningScore: 60 });
  r.matchId = '11111111-1111-4111-8111-111111111111';
  r.players = ['seat-a', 'seat-b'];
  Object.assign(r, overrides);
  return r;
}

describe('roomOwesTerminalCompletion', () => {
  it('game over and unlogged owes completion; logged does not', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 1 });
    expect(roomOwesTerminalCompletion(room({ state }), roster(A, B))).toBe(true);
    expect(roomOwesTerminalCompletion(room({ state, matchLogged: true }), roster(A, B))).toBe(false);
  });

  it('applies to guests too (the match record is still owed), but never mid-game', () => {
    const over = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 1 });
    expect(roomOwesTerminalCompletion(room({ state: over }), roster(null, null))).toBe(true);
    const live = mkTerminalGameState('seat-a', 'seat-b', { a: 6, b: 1 }, { gameOver: false });
    expect(roomOwesTerminalCompletion(room({ state: live }), roster(A, B))).toBe(false);
    expect(roomOwesTerminalCompletion(room({ state: null }), roster(A, B))).toBe(false);
  });

  it('tournament rooms are out of scope (tournaments stay OFF)', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 1 });
    expect(roomOwesTerminalCompletion(room({ state, scheduledTournamentMatchId: 'm1' }), roster(A, B))).toBe(false);
    expect(roomOwesTerminalCompletion(room({ state, scheduledTournamentId: 't1' }), roster(A, B))).toBe(false);
  });

  it('forfeits owe completion only when both seats are signed-in accounts', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 3, b: 1 }, { gameOver: false });
    const forfeit = { state, abandonedAt: new Date().toISOString(), abandonedReason: 'forfeit' as const };
    expect(roomOwesTerminalCompletion(room(forfeit), roster(A, B))).toBe(true);
    expect(roomOwesTerminalCompletion(room(forfeit), roster(A, 'guest_x'))).toBe(false);
    expect(roomOwesTerminalCompletion(room({ ...forfeit, abandonedReason: 'abandon' }), roster(A, B))).toBe(false);
    expect(isRatedForfeitRoom(room(forfeit), roster(A, B))).toBe(true);
    expect(accountIdOrNull('guest_x')).toBeNull();
    expect(accountIdOrNull(A)).toBe(A);
  });
});

describe('durable shell metadata', () => {
  it('a terminal snapshot is self-describing: completionPending + forfeit reason round-trip', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 3, b: 1 }, { gameOver: false });
    const r = room({
      state,
      abandonedAt: '2026-10-15T00:00:00.000Z',
      abandonedByUserId: A,
      abandonedReason: 'forfeit',
      abandonedForfeitReason: 'disconnect_timeout',
    });
    const row = buildLiveSessionRow(r, roster(A, B));
    expect(row.status).toBe('abandoned');
    expect(row.room_shell).toMatchObject({
      completionPending: true,
      abandonedForfeitReason: 'disconnect_timeout',
      matchLogged: false,
    });
    const parsed = parseRoomShell(JSON.parse(JSON.stringify(row.room_shell)));
    expect(parsed.abandonedForfeitReason).toBe('disconnect_timeout');
    expect(parsed.completionPending).toBe(true);
    expect(serializeRoomShell(r).abandonedForfeitReason).toBe('disconnect_timeout');
  });

  it('logged completion clears the pending flag on the next snapshot', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 1 });
    expect(buildLiveSessionRow(room({ state }), roster(A, B)).room_shell.completionPending).toBe(true);
    expect(buildLiveSessionRow(room({ state, matchLogged: true }), roster(A, B)).room_shell.completionPending).toBe(false);
  });

  it('unknown or malformed recovery metadata is ignored, never trusted', () => {
    const parsed = parseRoomShell({ completionPending: 'yes', completionRecovery: { attempts: 'x' }, abandonedForfeitReason: 'weird' });
    expect(parsed.completionPending).toBeUndefined();
    expect(parsed.completionRecovery).toBeUndefined();
    expect(parsed.abandonedForfeitReason).toBeUndefined();
  });

  it('a detached replay room carries the evidence but is never registered or hydrated', () => {
    const state = mkTerminalGameState('seat-a', 'seat-b', { a: 60, b: 1 });
    const source = room({ state, leadTracker: { aId: 'seat-a', bId: 'seat-b', maxLeadA: 9, maxLeadB: 2 } });
    const row = buildLiveSessionRow(source, roster(A, B));
    const detached = materializeDetachedRoomFromSession(row);
    expect(detached.matchId).toBe(row.match_id);
    expect(detached.state?.gameOver).toBe(true);
    expect(detached.leadTracker).toMatchObject({ maxLeadA: 9 });
    expect(detached.players).toEqual(['seat-a', 'seat-b']);
  });
});
