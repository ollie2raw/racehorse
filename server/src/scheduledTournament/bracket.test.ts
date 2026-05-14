import { describe, it, expect } from 'vitest';
import { seedBracket, advanceSlot } from './bracket';
import type { SeededPlayer } from './types';

function p(userId: string, rating: number): SeededPlayer {
  return { userId, username: userId, rating };
}

describe('seedBracket', () => {
  it('throws when fewer than 4 players', () => {
    expect(() => seedBracket([p('a', 1000), p('b', 1000), p('c', 1000)])).toThrow();
  });

  it('throws when more than 8 players', () => {
    expect(() => seedBracket(Array.from({ length: 9 }, (_, i) => p(`u${i}`, 1000)))).toThrow();
  });

  it('seeds 8 players by rating descending (1 vs 8, 4 vs 5, 3 vs 6, 2 vs 7)', () => {
    const players = [
      p('h', 1000), p('a', 2000), p('e', 1500), p('b', 1900),
      p('g', 1100), p('c', 1800), p('f', 1300), p('d', 1700),
    ];
    const qf = seedBracket(players);
    expect(qf).toHaveLength(4);
    // 1 (a:2000) vs 8 (h:1000)
    expect(qf[0].player1?.userId).toBe('a');
    expect(qf[0].player2?.userId).toBe('h');
    // 4 (d:1700) vs 5 (e:1500)
    expect(qf[1].player1?.userId).toBe('d');
    expect(qf[1].player2?.userId).toBe('e');
    // 3 (c:1800) vs 6 (f:1300)
    expect(qf[2].player1?.userId).toBe('c');
    expect(qf[2].player2?.userId).toBe('f');
    // 2 (b:1900) vs 7 (g:1100)
    expect(qf[3].player1?.userId).toBe('b');
    expect(qf[3].player2?.userId).toBe('g');
  });

  it('fills bottom seeds with byes when only 5 players register', () => {
    const players = [p('a', 1900), p('b', 1800), p('c', 1700), p('d', 1600), p('e', 1500)];
    const qf = seedBracket(players);
    // Slots 6, 7, 8 are byes. Top seeds (1, 2, 3) face byes.
    expect(qf[0].player1?.userId).toBe('a'); // seed 1
    expect(qf[0].player2).toBeNull();         // seed 8 (bye)
    expect(qf[1].player1?.userId).toBe('d'); // seed 4
    expect(qf[1].player2?.userId).toBe('e'); // seed 5
    expect(qf[2].player1?.userId).toBe('c'); // seed 3
    expect(qf[2].player2).toBeNull();         // seed 6 (bye)
    expect(qf[3].player1?.userId).toBe('b'); // seed 2
    expect(qf[3].player2).toBeNull();         // seed 7 (bye)
  });

  it('preserves input order on tied ratings', () => {
    const players = [p('first', 1500), p('second', 1500), p('third', 1500), p('fourth', 1500)];
    const qf = seedBracket(players);
    expect(qf[0].player1?.userId).toBe('first');
    expect(qf[3].player1?.userId).toBe('second');
  });

  it('handles a 4-player tournament with byes for the bottom 4 seeds', () => {
    const players = [p('a', 1900), p('b', 1800), p('c', 1700), p('d', 1600)];
    const qf = seedBracket(players);
    expect(qf[0].player2).toBeNull(); // seed 1 has bye
    expect(qf[1].player1?.userId).toBe('d');
    expect(qf[1].player2).toBeNull();
    expect(qf[2].player2).toBeNull();
    expect(qf[3].player2).toBeNull();
  });
});

describe('advanceSlot', () => {
  it('routes QF1 → SF1 player1', () => {
    expect(advanceSlot(1, 1)).toEqual({ nextRound: 2, nextMatchNumber: 1, slot: 'player1' });
  });

  it('routes QF2 → SF1 player2', () => {
    expect(advanceSlot(1, 2)).toEqual({ nextRound: 2, nextMatchNumber: 1, slot: 'player2' });
  });

  it('routes QF3 → SF2 player1', () => {
    expect(advanceSlot(1, 3)).toEqual({ nextRound: 2, nextMatchNumber: 2, slot: 'player1' });
  });

  it('routes QF4 → SF2 player2', () => {
    expect(advanceSlot(1, 4)).toEqual({ nextRound: 2, nextMatchNumber: 2, slot: 'player2' });
  });

  it('routes SF1 → Final player1', () => {
    expect(advanceSlot(2, 1)).toEqual({ nextRound: 3, nextMatchNumber: 1, slot: 'player1' });
  });

  it('routes SF2 → Final player2', () => {
    expect(advanceSlot(2, 2)).toEqual({ nextRound: 3, nextMatchNumber: 1, slot: 'player2' });
  });

  it('throws on unknown match number', () => {
    expect(() => advanceSlot(1, 99)).toThrow();
    expect(() => advanceSlot(2, 99)).toThrow();
  });
});
