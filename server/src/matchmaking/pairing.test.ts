import { describe, it, expect } from 'vitest';
import { findPairs, ratingWindowMsAt } from './pairing';
import type { QueuedPlayer } from './types';

function p(socketId: string, rating: number, secondsAgo: number, opts: Partial<QueuedPlayer> = {}): QueuedPlayer {
  return {
    socketId,
    userId: `user-${socketId}`,
    username: socketId,
    rating,
    joinedAtMs: Date.now() - secondsAgo * 1000,
    isSim: false,
    ...opts,
  };
}

describe('ratingWindowMsAt', () => {
  it('starts at 200 at 0s waited', () => {
    expect(ratingWindowMsAt(0)).toBe(200);
  });

  it('expands by +200 every 30s', () => {
    expect(ratingWindowMsAt(30_000)).toBe(400);
    expect(ratingWindowMsAt(60_000)).toBe(600);
  });

  it('becomes unbounded after 90s', () => {
    expect(ratingWindowMsAt(90_000)).toBe(Infinity);
    expect(ratingWindowMsAt(120_000)).toBe(Infinity);
  });
});

describe('findPairs', () => {
  it('returns empty when 0 or 1 players are queued', () => {
    const now = Date.now();
    expect(findPairs([], now)).toEqual([]);
    expect(findPairs([p('a', 1000, 5)], now)).toEqual([]);
  });

  it('pairs two players whose ratings are within ±200 at 0s', () => {
    const now = Date.now();
    const pairs = findPairs([p('a', 1000, 0), p('b', 1150, 0)], now);
    expect(pairs).toHaveLength(1);
    const ids = [pairs[0].a.socketId, pairs[0].b.socketId].sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('does NOT pair players outside their tighter window', () => {
    const now = Date.now();
    const pairs = findPairs([p('a', 1000, 0), p('b', 1500, 0)], now);
    expect(pairs).toEqual([]);
  });

  it('pairs the same players once the window has expanded enough', () => {
    const now = Date.now();
    const pairs = findPairs([p('a', 1000, 35), p('b', 1300, 35)], now);
    expect(pairs).toHaveLength(1);
  });

  it('prefers the longest-waiting player when assigning matches', () => {
    const now = Date.now();
    const players = [
      p('newcomer', 1200, 1),
      p('oldest',   1100, 50),
      p('middle',   1150, 25),
    ];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(1);
    const ids = [pairs[0].a.socketId, pairs[0].b.socketId];
    expect(ids).toContain('oldest');
  });

  it('never pairs the same userId with itself', () => {
    const now = Date.now();
    const dupA = p('s1', 1000, 0, { userId: 'shared' });
    const dupB = p('s2', 1010, 0, { userId: 'shared' });
    expect(findPairs([dupA, dupB], now)).toEqual([]);
  });

  it('returns multiple disjoint pairs in one sweep', () => {
    const now = Date.now();
    const players = [
      p('a', 1000, 0),
      p('b', 1050, 0),
      p('c', 1500, 0),
      p('d', 1550, 0),
    ];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(2);
    const allIds = pairs.flatMap((m) => [m.a.socketId, m.b.socketId]).sort();
    expect(allIds).toEqual(['a', 'b', 'c', 'd']);
  });
});
