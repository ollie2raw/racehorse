import { describe, expect, it } from 'vitest';
import { buildDailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';
import {
  assertDailyFritzAttemptPinsPublishedChallenge,
  resolveDailyFritzPublishedGameAuthority,
} from './dailyFritzPublishedAuthority';

const challenge = buildDailyFritzPublishedChallenge({
  runDate: '2026-08-01',
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  publishedAt: '2026-08-01T07:00:00.000Z',
});

function attempt() {
  return {
    id: 'attempt-1', runDate: challenge.runDate, userId: 'user-1', status: 'started' as const,
    currentHandIndex: 0, currentGameNumber: 1 as const, revision: 1,
    challengeId: challenge.challengeId, challengeContractVersion: challenge.contractVersion,
    generationVersion: challenge.generationVersion, gameRulesVersion: challenge.gameRulesVersion,
    transcriptProtocolVersion: challenge.transcriptProtocolVersion,
    fritzPolicyVersion: challenge.fritzPolicyVersion, rankingVersion: challenge.rankingVersion,
    authoritySchemaVersion: 1, startedAt: challenge.publishedAt, completedAt: null,
    verifiedMatchId: null, completionHash: null, result: null, finalScore: null,
    opponentScore: null, pointDiff: null, won: null, movesUsed: null, handsPlayed: null,
  };
}

describe('Daily Fritz published authority resolver', () => {
  it('uses the exact published hand and draw package', () => {
    const resolved = resolveDailyFritzPublishedGameAuthority({ challenge, gameNumber: 2, handIndex: 3 });
    expect(resolved.deal).toEqual(challenge.games[1].hands[3]);
    expect(resolved.drawWinner).toBe(challenge.games[1].drawWinner);
    expect(resolved.drawTiles).toEqual(challenge.games[1].drawTiles);
  });

  it('retains the pinned v1 generator for deterministic overflow hands', () => {
    const first = resolveDailyFritzPublishedGameAuthority({ challenge, gameNumber: 3, handIndex: 20 });
    const second = resolveDailyFritzPublishedGameAuthority({ challenge, gameNumber: 3, handIndex: 20 });
    expect(second.deal).toEqual(first.deal);
  });

  it('rejects any attempt version drift', () => {
    expect(() => assertDailyFritzAttemptPinsPublishedChallenge({
      ...attempt(), fritzPolicyVersion: challenge.fritzPolicyVersion + 1,
    }, challenge)).toThrow('daily_fritz_attempt_challenge_version_mismatch');
  });
});
