import { describe, expect, it } from 'vitest';
import {
  canFinalizeDailyFritzAttempt,
  hasCompleteDailyFritzGameAuthority,
  hasPriorDailyFritzGameAuthority,
  isIdenticalDailyFritzGameReplay,
  buildRecordedDailyFritzAttemptResult,
  buildDailyFritzAuthorityContract,
  clientSupportsDailyFritzAuthorityContract,
  readDailyFritzAuthorityContract,
  writeDailyFritzAuthorityContract,
  requiresVerifiedDailyFritzEvidence,
} from './dailyFritzVerificationPolicy';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';

describe('Daily Fritz competitive verification boundary', () => {
  it('round-trips the immutable attempt authority contract', () => {
    const contract = buildDailyFritzAuthorityContract({
      fritzPolicyVersion: 1,
      challengeId: 'daily-fritz:2026-07-31:r2:s1',
      runFingerprint: 'run-fingerprint',
      clientRelease: 'deploy-123',
    });
    expect(readDailyFritzAuthorityContract(writeDailyFritzAuthorityContract({ keep: true }, contract)))
      .toEqual(contract);
    expect(contract.fritzPolicyContract).toBe('fritz-policy-v1-seeded-top-score');
  });

  it('resumes a pinned historical policy only when the client advertises that exact contract', () => {
    const contract = buildDailyFritzAuthorityContract({
      fritzPolicyVersion: 1,
      challengeId: 'daily-fritz:2026-07-31:r2:s1',
      runFingerprint: 'run-fingerprint',
    });
    const base = {
      transcriptProtocolVersions: [1, 2],
      gameRulesVersion: contract.gameRulesVersion,
      stateDigestVersions: [1],
    };
    expect(clientSupportsDailyFritzAuthorityContract(contract, {
      ...base,
      fritzPolicies: [{ version: 1, contract: contract.fritzPolicyContract }],
    })).toBe(true);
    expect(clientSupportsDailyFritzAuthorityContract(contract, {
      ...base,
      fritzPolicies: [{ version: 2, contract: 'fritz-policy-v2-deterministic-canonical-ties' }],
    })).toBe(false);
  });
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
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 2 },
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

  it('preserves verifier pinning when merging record-game set results', () => {
    const previous = {
      verification_status: 'in_progress',
      verification_protocol_version: 1,
      authority: {
        version: 1,
        hands: [{ gameNumber: 1, handIndex: 0, transcriptDigest: 'h1' }],
        games: [],
      },
    };
    const setResult = {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: 1,
      fritzGamesWon: 0,
      totalPointDiff: 20,
      games: [{ gameNumber: 1, playerScore: 60, fritzScore: 40 }],
    };
    const merged = buildRecordedDailyFritzAttemptResult({
      previousResult: previous,
      setResult,
      hasTranscript: true,
    });
    expect(requiresVerifiedDailyFritzEvidence(merged)).toBe(true);
    expect(merged.verification_protocol_version).toBe(2);
    expect(merged.verification_status).toBe('in_progress');
    expect(merged.authority).toEqual(previous.authority);
    expect(merged.playerGamesWon).toBe(1);

    // S1 regression: after a verified record-game merge, score-only evidence stays forbidden.
    expect(requiresVerifiedDailyFritzEvidence(
      buildRecordedDailyFritzAttemptResult({
        previousResult: merged,
        setResult: { ...setResult, playerGamesWon: 2 },
        hasTranscript: true,
      }),
    )).toBe(true);

    const legacyMerged = buildRecordedDailyFritzAttemptResult({
      previousResult: { verification_status: 'legacy_unverified' },
      setResult,
      hasTranscript: false,
    });
    expect(requiresVerifiedDailyFritzEvidence(legacyMerged)).toBe(false);
    expect(legacyMerged.verification_status).toBe('legacy_unverified');
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

  it('blocks silent unranked finalize when only later games have authority', () => {
    const setResult = {
      games: [
        {
          gameNumber: 1 as const,
          seed: 'g1',
          playerWon: true,
          playerScore: 64,
          fritzScore: 42,
          pointDiff: 22,
          completedAt: '2026-07-23T10:00:00.000Z',
        },
        {
          gameNumber: 2 as const,
          seed: 'g2',
          playerWon: true,
          playerScore: 64,
          fritzScore: 38,
          pointDiff: 26,
          completedAt: '2026-07-23T11:00:00.000Z',
        },
      ],
    };
    const partialAuthority = {
      verification_status: 'legacy_unverified' as const,
      verification_protocol_version: 1,
      authority: {
        version: 1,
        hands: [],
        games: [{
          gameNumber: 2,
          playerScore: 64,
          fritzScore: 38,
          handDigests: ['h2'],
          resultDigest: 'g2',
          verificationVersion: 1,
        }],
      },
    };
    expect(hasPriorDailyFritzGameAuthority(partialAuthority, {
      games: [setResult.games[0]!],
    })).toBe(false);
    expect(hasCompleteDailyFritzGameAuthority(partialAuthority, setResult)).toBe(false);
    expect(canFinalizeDailyFritzAttempt(partialAuthority, setResult)).toBe(false);
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
