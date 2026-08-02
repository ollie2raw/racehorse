import { describe, expect, it } from 'vitest';
import {
  assertValidDailyFritzPublishedChallenge,
  buildDailyFritzPublishedChallenge,
  canonicalizeDailyFritzChallenge,
} from './dailyFritzPublishedChallenge';

describe('immutable Daily Fritz challenge contract', () => {
  it('publishes byte-stable authority for all three games', () => {
    const first = buildDailyFritzPublishedChallenge({
      runDate: '2026-08-01',
      publishedAt: '2026-08-01T07:00:00.000Z',
    });
    const second = buildDailyFritzPublishedChallenge({
      runDate: '2026-08-01',
      publishedAt: '2026-08-01T08:00:00.000Z',
    });

    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.games.map((game) => game.contentDigest))
      .toEqual(second.games.map((game) => game.contentDigest));
    expect(first.games.map((game) => game.hands.length)).toEqual([12, 12, 12]);
    expect(first.games.map((game) => game.gameNumber)).toEqual([1, 2, 3]);
    expect(() => assertValidDailyFritzPublishedChallenge(first)).not.toThrow();
  });

  it('changes the package digest for a different calendar day', () => {
    const first = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const second = buildDailyFritzPublishedChallenge({ runDate: '2026-08-02' });
    expect(first.contentDigest).not.toBe(second.contentDigest);
  });

  it('canonicalizes object keys before hashing or persistence comparison', () => {
    expect(canonicalizeDailyFritzChallenge({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(canonicalizeDailyFritzChallenge({ nested: { a: 1, b: 2 }, z: 1 }));
  });

  it('rejects altered hand authority even when the outer digest is unchanged', () => {
    const challenge = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const corrupted = structuredClone(challenge);
    corrupted.games[1].hands[0].player_tiles[0] = { low: 6, high: 6 };
    expect(() => assertValidDailyFritzPublishedChallenge(corrupted))
      .toThrow(/duplicate tiles|digest is invalid/);
  });

  it('rejects inconsistent draw authority', () => {
    const challenge = buildDailyFritzPublishedChallenge({ runDate: '2026-08-01' });
    const corrupted = structuredClone(challenge);
    corrupted.games[0].drawWinner = corrupted.games[0].drawWinner === 'you' ? 'bot' : 'you';
    expect(() => assertValidDailyFritzPublishedChallenge(corrupted))
      .toThrow('Daily Fritz game 1 draw package is inconsistent.');
  });
});
