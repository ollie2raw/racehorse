import { describe, expect, it } from 'vitest';
import type { Tile } from '../types';
import { createPracticeState, playPracticeMove, hintForState } from './noBrainerLogic';

const t = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });

describe('createPracticeState', () => {
  it('starts a playable run when the hand has a legal opener (a double)', () => {
    const s = createPracticeState([t(6, 6), t(5, 5)]);
    expect(s.status).toBe('playing');
    expect(s.board).toBeNull();
    expect(s.legalMoves.length).toBeGreaterThan(0);
    expect(s.legalMoves.some((m) => m.tile && m.tile.low === 6 && m.tile.high === 6)).toBe(true);
    expect(s.remainingHand).toHaveLength(2);
  });

  it('fails immediately when no tile can open (empty hand)', () => {
    const s = createPracticeState([]);
    expect(s.status).toBe('failed');
    expect(s.legalMoves).toHaveLength(0);
    expect(s.message).toMatch(/no legal opening/i);
  });

  it('does not mutate the caller\'s hand array', () => {
    const hand = [t(6, 6)];
    createPracticeState(hand);
    expect(hand).toHaveLength(1);
  });
});

describe('playPracticeMove', () => {
  it('is a no-op once the run is over', () => {
    const done = { ...createPracticeState([t(6, 6)]), status: 'won' as const };
    expect(playPracticeMove(done, t(6, 6), 'left')).toBe(done);
  });

  it('rejects a move that is not in legalMoves, keeping status', () => {
    const s = createPracticeState([t(6, 6), t(0, 1)]);
    const after = playPracticeMove(s, t(0, 1), 'left'); // 0-1 is not a legal opener
    expect(after.status).toBe('playing');
    expect(after.message).toMatch(/illegal move/i);
    expect(after.board).toBeNull();
  });

  it('plays a legal double, advances the board, and keeps the turn going', () => {
    const s0 = createPracticeState([t(6, 6), t(5, 6)]);
    const s1 = playPracticeMove(s0, t(6, 6), 'left');
    expect(s1.status).toBe('playing');
    expect(s1.mustContinue).toBe(true);
    expect(s1.board).not.toBeNull();
    expect(s1.remainingHand).toHaveLength(1);
    expect(s1.legalMoves.length).toBeGreaterThan(0); // 5-6 can follow on the 6 end
  });

  it('fails the run when a legal double leaves no continuation', () => {
    const s0 = createPracticeState([t(6, 6), t(5, 5)]);
    const s1 = playPracticeMove(s0, t(6, 6), 'left'); // 5-5 cannot reach the 6 ends
    expect(s1.status).toBe('failed');
    expect(s1.message).toMatch(/no legal continuation/i);
  });

  it('fails when the final tile is itself a double', () => {
    const s0 = createPracticeState([t(6, 6)]);
    const s1 = playPracticeMove(s0, t(6, 6), 'left');
    expect(s1.status).toBe('failed');
    expect(s1.message).toMatch(/final tile cannot be a double or scoring tile/i);
    expect(s1.remainingHand).toHaveLength(0);
  });
});

describe('hintForState', () => {
  it('returns null once the run is over', () => {
    const done = { ...createPracticeState([t(6, 6)]), status: 'failed' as const };
    expect(hintForState(done, [t(6, 6)])).toBeNull();
  });

  it('returns the first example tile that is both in hand and legal', () => {
    const s = createPracticeState([t(6, 6), t(5, 5)]);
    const hint = hintForState(s, [t(1, 1), t(6, 6)]); // 1-1 not in hand → skip
    expect(hint).not.toBeNull();
    expect(hint!.tile).toEqual(t(6, 6));
    expect(hint!.position).toBe('left');
  });

  it('returns null when no example tile is a legal play', () => {
    const s = createPracticeState([t(6, 6), t(0, 1)]);
    expect(hintForState(s, [t(0, 1)])).toBeNull(); // in hand, but not a legal opener
  });
});
