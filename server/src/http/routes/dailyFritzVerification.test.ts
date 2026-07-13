import { describe, expect, it } from 'vitest';
import {
  canFinalizeDailyFritzAttempt,
  hasCompleteDailyFritzGameAuthority,
  isIdenticalDailyFritzGameReplay,
  requiresVerifiedDailyFritzEvidence,
} from './dailyFritz';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';

describe('Daily Fritz competitive verification boundary', () => {
  it('excludes completed client-reported results from the verified leaderboard', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'legacy_unverified', final_score: 60 },
    })).toBe(false);
  });

  it('admits only an explicitly server-verified completed result', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 1 },
    })).toBe(true);
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'started',
      result: { verification_status: 'verified', verification_protocol_version: 1 },
    })).toBe(false);
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 0 },
    })).toBe(false);
  });

  it('rejects a fabricated score as a conflicting game replay', () => {
    const existing = { playerScore: 60, fritzScore: 42, movesUsed: 31, handsPlayed: 6 };
    expect(isIdenticalDailyFritzGameReplay(existing, existing)).toBe(true);
    expect(isIdenticalDailyFritzGameReplay(existing, { ...existing, playerScore: 600 })).toBe(false);
    expect(isIdenticalDailyFritzGameReplay(existing, { ...existing, fritzScore: 0 })).toBe(false);
  });

  it('pins a verifier-capable attempt to transcript evidence', () => {
    expect(requiresVerifiedDailyFritzEvidence({
      verification_status: 'in_progress',
      verification_protocol_version: 1,
    })).toBe(true);
    expect(requiresVerifiedDailyFritzEvidence({
      verification_status: 'legacy_unverified',
      verification_protocol_version: 1,
    })).toBe(false);
  });

  it('does not allow a verifier-capable attempt to fall back to an unverified set', () => {
    const setResult = { games: [] };
    expect(canFinalizeDailyFritzAttempt({
      verification_status: 'in_progress',
      verification_protocol_version: 1,
    }, setResult)).toBe(false);
    expect(canFinalizeDailyFritzAttempt({
      verification_status: 'legacy_unverified',
      verification_protocol_version: 1,
    }, setResult)).toBe(true);
  });

  it('does not verify a set from hand evidence without immutable game receipts', () => {
    const game = {
      gameNumber: 1 as const,
      seed: 'seed',
      playerWon: true,
      playerScore: 60,
      fritzScore: 40,
      pointDiff: 20,
      completedAt: '2026-07-13T08:00:00.000Z',
    };
    const hand = {
      gameNumber: 1,
      handIndex: 0,
      transcriptDigest: 'hand-digest',
    };
    expect(hasCompleteDailyFritzGameAuthority({
      authority: { version: 1, hands: [hand], games: [] },
    }, { games: [game] })).toBe(false);
    expect(hasCompleteDailyFritzGameAuthority({
      authority: {
        version: 1,
        hands: [hand],
        games: [{
          gameNumber: 1,
          playerScore: 60,
          fritzScore: 40,
          handDigests: ['hand-digest'],
          resultDigest: 'game-digest',
          verificationVersion: 1,
        }],
      },
    }, { games: [game] })).toBe(true);
    expect(hasCompleteDailyFritzGameAuthority({
      authority: {
        version: 1,
        hands: [hand],
        games: [{
          gameNumber: 1,
          playerScore: 600,
          fritzScore: 0,
          handDigests: ['hand-digest'],
          resultDigest: 'forged',
          verificationVersion: 1,
        }],
      },
    }, { games: [game] })).toBe(false);
  });
});
