import { afterEach, describe, expect, it } from 'vitest';
import { generateDailyFritzRun } from '../../dailyFritz';
import {
  buildDailyFritzRunFingerprint,
  getDailyFritzHandForGame,
  toDailyFritzAttemptRow,
} from './dailyFritzStore';

describe('Daily Fritz run deal authority', () => {
  const originalAuthority = process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
  afterEach(() => {
    if (originalAuthority === undefined) delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    else process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = originalAuthority;
  });
  it('prefers persisted game-1 hand deals over regenerated tiles', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const mutated = {
      ...run,
      handDeals: run.handDeals.map((deal, index) => (
        index === 0
          ? {
              ...deal,
              player_tiles: [{ low: 0, high: 0 }],
              fritz_tiles: [{ low: 1, high: 1 }],
              boneyard: deal.boneyard,
              locked: deal.locked,
            }
          : deal
      )),
    };
    const hand = getDailyFritzHandForGame(mutated, 1, 0);
    expect(hand.player_tiles).toEqual([{ low: 0, high: 0 }]);
    expect(hand.fritz_tiles).toEqual([{ low: 1, high: 1 }]);
  });

  it('still generates on-demand hands beyond the persisted snapshot', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const hand = getDailyFritzHandForGame(run, 1, run.handDeals.length);
    expect(hand.player_tiles).toHaveLength(7);
    expect(hand.fritz_tiles).toHaveLength(7);
  });

  it('builds a stable run fingerprint that changes when deals change', () => {
    const run = generateDailyFritzRun('2026-07-24', 'elite', 7, 60);
    const a = buildDailyFritzRunFingerprint(run);
    const b = buildDailyFritzRunFingerprint(run);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    const altered = {
      ...run,
      handDeals: run.handDeals.map((deal, index) => (
        index === 0
          ? { ...deal, player_tiles: [{ low: 6, high: 6 }, ...deal.player_tiles.slice(1)] }
          : deal
      )),
    };
    expect(buildDailyFritzRunFingerprint(altered)).not.toBe(a);
  });

  it('omits expanded columns until migration rollout is explicitly enabled', () => {
    const record = {
      id: 'attempt-1', runDate: '2026-08-01', userId: 'user-1', status: 'started' as const,
      currentHandIndex: 0, currentGameNumber: 1 as const, revision: 2,
      challengeId: 'challenge-1', challengeContractVersion: 1, generationVersion: 1,
      gameRulesVersion: 1, transcriptProtocolVersion: 2, fritzPolicyVersion: 2,
      rankingVersion: 1, authoritySchemaVersion: 1, startedAt: '2026-08-01T07:00:00Z',
      completedAt: null, verifiedMatchId: null, completionHash: null, result: null,
      finalScore: null, opponentScore: null, pointDiff: null, won: null,
      movesUsed: null, handsPlayed: null,
    };
    delete process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS;
    expect(toDailyFritzAttemptRow(record)).not.toHaveProperty('revision');
    process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS = 'true';
    expect(toDailyFritzAttemptRow(record)).toMatchObject({ revision: 2, challenge_id: 'challenge-1' });
  });
});
