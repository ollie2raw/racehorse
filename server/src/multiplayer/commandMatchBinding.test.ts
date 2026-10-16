import { describe, expect, it } from 'vitest';
import { classifyCommandError, isWellFormedGameAction, staleMatchAck } from './commandMatchBinding';

describe('staleMatchAck', () => {
  it('is inert without a claimed matchId (legacy clients) or when it matches', () => {
    expect(staleMatchAck({ matchId: 'm1' }, undefined)).toBeNull();
    expect(staleMatchAck({ matchId: 'm1' }, '')).toBeNull();
    expect(staleMatchAck({ matchId: 'm1' }, 42)).toBeNull();
    expect(staleMatchAck({ matchId: 'm1' }, 'm1')).toBeNull();
  });
  it('refuses a command composed for another match and says which match is current', () => {
    expect(staleMatchAck({ matchId: 'm2' }, 'm1')).toEqual({ ok: false, error: 'stale_match', stale: true, matchId: 'm2' });
  });
});

describe('isWellFormedGameAction', () => {
  const move = (tile: unknown, position: unknown = 'left') => ({ type: 'MOVE', move: { tile, position } });
  it('accepts the shapes the client sends', () => {
    expect(isWellFormedGameAction({ type: 'DRAW' })).toBe(true);
    expect(isWellFormedGameAction({ type: 'PASS' })).toBe(true);
    expect(isWellFormedGameAction(move({ high: 6, low: 3 }))).toBe(true);
    expect(isWellFormedGameAction({ type: 'MOVE', move: { tile: { high: 6, low: 3 }, end: 'right' } })).toBe(true);
  });
  it.each([
    ['null', null],
    ['array', []],
    ['string', 'MOVE'],
    ['unknown type', { type: 'EXPLODE' }],
    ['move missing', { type: 'MOVE' }],
    ['move string', { type: 'MOVE', move: 'x' }],
    ['move array', { type: 'MOVE', move: [] }],
    ['tile missing', { type: 'MOVE', move: {} }],
    ['tile strings', move({ high: '6', low: '3' })],
    ['tile null pips', move({ high: null, low: null })],
    ['tile float', move({ high: 1.5, low: 2 })],
    ['tile out of range', move({ high: 99, low: -3 })],
    ['tile nested junk', move({ high: { a: 1 }, low: 1 })],
    ['position object', move({ high: 1, low: 1 }, {})],
    ['position huge', move({ high: 1, low: 1 }, 'x'.repeat(100))],
  ])('rejects %s', (_name, action) => {
    expect(isWellFormedGameAction(action)).toBe(false);
  });
  it('ignores prototype-pollution style keys', () => {
    const polluted = JSON.parse('{"__proto__":{"type":"MOVE"},"type":"PASS"}');
    expect(isWellFormedGameAction(polluted)).toBe(true);
    expect(({} as { type?: string }).type).toBeUndefined();
  });
});

describe('classifyCommandError', () => {
  it('categorizes rejections without parsing client-side prose', () => {
    expect(classifyCommandError('Spectators cannot act.').code).toBe('unauthorized');
    expect(classifyCommandError('Player seat not found for socket.').code).toBe('unauthorized');
    expect(classifyCommandError('Room not found.').code).toBe('not_active');
    expect(classifyCommandError('Game is over. Only rematch or leave is accepted.').code).toBe('not_active');
    expect(classifyCommandError('match_abandoned').code).toBe('not_active');
    expect(classifyCommandError("It's not your turn.").code).toBe('illegal');
  });
  it('never forwards infrastructure detail', () => {
    for (const leak of [
      'Supabase request failed: 500 {"message":"relation room_live_sessions"}',
      'fetch failed',
      "Cannot read properties of undefined (reading 'x')\n    at foo (/home/user/racehorse/server/src/rooms.ts:1:1)",
    ]) {
      const out = classifyCommandError(leak);
      expect(out.code).toBe('internal_error');
      expect(out.error).toBe('Action failed. Please retry.');
    }
  });
});
