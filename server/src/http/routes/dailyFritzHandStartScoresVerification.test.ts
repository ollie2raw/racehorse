import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { FRITZ_POLICY_VERSION } from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand, getDailyFritzDrawWinner, getDailyFritzSeed } from '../../dailyFritz';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { verifyDailyFritzHand, createOfficialDailyFritzHandState } from '../../dailyFritzVerifier';
import { buildHonestDailyFritzHandTranscript } from '../../testing/dailyFritzTranscriptDriver';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import { buildRecordedDailyFritzAttemptResult } from './dailyFritzVerificationPolicy';
import {
  assertHandStartScoresAvailableForVerification,
  attemptVerifyHand,
  readActiveGameProgress,
  recordDailyFritzAdvanceWithoutVerification,
  resolveHandStartScoresForVerification,
  writeActiveGameProgress,
  writeVerifiedHand,
} from './dailyFritzVerificationGlue';

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));

vi.mock('../stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined),
}));

const RUN_DATE = '2026-08-01';
const CHALLENGE_ID = buildDailyFritzChallengeId(RUN_DATE);
const USER_ID = 'user-hand-start-ledger';
const ATTEMPT_ID = 'attempt-hand-start-ledger';

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: [],
    metadata: { draw_winners_by_game: { 1: 'you' } },
  };
}

function buildAttempt(result: Record<string, unknown>): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    userId: USER_ID,
    runDate: RUN_DATE,
    status: 'started',
    revision: 7,
    currentGameNumber: 1,
    currentHandIndex: 6,
    verifiedMatchId: 'verified-match-hand-start',
    challengeId: CHALLENGE_ID,
    challengeContractVersion: 1,
    generationVersion: 1,
    gameRulesVersion: 1,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: 2,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    result,
    startedAt: '2026-08-19T22:04:16.000Z',
    updatedAt: '2026-08-19T22:10:25.000Z',
  };
}

describe('Daily Fritz hand-start scores for verification', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves hand-start scores from the authority ledger, not active_game', () => {
    const runDate = '2026-08-01';
    const deal0 = generateSingleDailyFritzGameHand(runDate, 1, 0, 7);
    const drawWinner = getDailyFritzDrawWinner(runDate, 1);
    const hand0 = buildHonestDailyFritzHandTranscript({
      challengeId: buildDailyFritzChallengeId(runDate),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      deal: deal0,
      drawWinner,
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
      fritzTier: 'elite',
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
    });
    const hand0Initial = createOfficialDailyFritzHandState({
      deal: deal0,
      handIndex: 0,
      drawWinner,
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });
    const hand0Verified = verifyDailyFritzHand({
      transcript: hand0.transcript,
      initialState: hand0Initial,
      expectedChallengeId: buildDailyFritzChallengeId(runDate),
      expectedAttemptId: ATTEMPT_ID,
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: USER_ID,
      fritzTier: 'elite',
    });

    let result = writeVerifiedHand(null, hand0Verified.result);
    result = writeActiveGameProgress(result, {
      gameNumber: 1,
      you: hand0Verified.result.playerScoreAfter,
      fritz: hand0Verified.result.fritzScoreAfter,
    });

    const deal1 = generateSingleDailyFritzGameHand(runDate, 1, 1, 7);
    const hand1 = buildHonestDailyFritzHandTranscript({
      challengeId: buildDailyFritzChallengeId(runDate),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 1,
      deal: deal1,
      drawWinner,
      winningScore: 60,
      dealSize: 7,
      playerScore: hand0Verified.result.playerScoreAfter,
      fritzScore: hand0Verified.result.fritzScoreAfter,
      fritzTier: 'elite',
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
    });

    const hand1Verified = verifyDailyFritzHand({
      transcript: hand1.transcript,
      initialState: createOfficialDailyFritzHandState({
        deal: deal1,
        handIndex: 1,
        drawWinner,
        winningScore: 60,
        dealSize: 7,
        playerScore: hand0Verified.result.playerScoreAfter,
        fritzScore: hand0Verified.result.fritzScoreAfter,
      }),
      expectedChallengeId: buildDailyFritzChallengeId(runDate),
      expectedAttemptId: ATTEMPT_ID,
      expectedGameNumber: 1,
      expectedHandIndex: 1,
      userId: USER_ID,
      fritzTier: 'elite',
    });

    // Reproduce the record-game merge that wiped active_game in production.
    result = buildRecordedDailyFritzAttemptResult({
      previousResult: result,
      setResult: {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 1,
        fritzGamesWon: 0,
        totalPointDiff: 10,
        setWinner: 'player',
        games: [{
          gameNumber: 1,
          playerScore: hand1Verified.result.playerScoreAfter,
          fritzScore: hand1Verified.result.fritzScoreAfter,
        }],
      },
      hasTranscript: true,
      verificationPending: true,
    });

    expect(readActiveGameProgress(result, 1)).toEqual({ gameNumber: 1, you: 0, fritz: 0 });
    expect(resolveHandStartScoresForVerification({
      result,
      gameNumber: 1,
      handIndex: 1,
    })).toEqual({
      gameNumber: 1,
      you: hand0Verified.result.playerScoreAfter,
      fritz: hand0Verified.result.fritzScoreAfter,
    });

    const run = {
      ...buildRun(),
      runDate,
      seed: getDailyFritzSeed(runDate),
      handDeals: [deal0, deal1],
    };
    const verification = attemptVerifyHand({
      transcript: hand1.transcript,
      attempt: buildAttempt(result),
      run,
      userId: USER_ID,
      gameNumber: 1,
      handIndex: 1,
      publishedChallenge: null,
    });

    expect(verification.ok).toBe(true);
    if (!verification.ok) {
      throw new Error(`${verification.error.code}: ${verification.error.message}`);
    }
    expect(verification.verified.result.playerScoreAfter).toBeGreaterThan(0);
  });

  it('fails closed when hand-start would be 0-0 but prior verified hands exist', () => {
    const runDate = '2026-08-01';
    const deal0 = generateSingleDailyFritzGameHand(runDate, 1, 0, 7);
    const drawWinner = getDailyFritzDrawWinner(runDate, 1);
    const hand0 = buildHonestDailyFritzHandTranscript({
      challengeId: buildDailyFritzChallengeId(runDate),
      attemptId: ATTEMPT_ID,
      gameNumber: 1,
      handIndex: 0,
      deal: deal0,
      drawWinner,
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
      fritzTier: 'elite',
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
    });
    const hand0Verified = verifyDailyFritzHand({
      transcript: hand0.transcript,
      initialState: createOfficialDailyFritzHandState({
        deal: deal0,
        handIndex: 0,
        drawWinner,
        winningScore: 60,
        dealSize: 7,
        playerScore: 0,
        fritzScore: 0,
      }),
      expectedChallengeId: buildDailyFritzChallengeId(runDate),
      expectedAttemptId: ATTEMPT_ID,
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: USER_ID,
      fritzTier: 'elite',
    });
    const result = writeVerifiedHand(null, hand0Verified.result);

    expect(() => assertHandStartScoresAvailableForVerification({
      result,
      gameNumber: 1,
      handIndex: 2,
      startScores: { gameNumber: 1, you: 0, fritz: 0 },
    })).toThrow(/hand-start scores/i);

    try {
      assertHandStartScoresAvailableForVerification({
        result,
        gameNumber: 1,
        handIndex: 2,
        startScores: { gameNumber: 1, you: 0, fritz: 0 },
      });
    } catch (error) {
      expect((error as { code: string }).code).toBe('missing_hand_start_progress');
    }

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('infrastructure failure'),
      expect.objectContaining({
        tags: expect.objectContaining({
          daily_fritz_alert: 'verification_infrastructure_error',
          verifier_code: 'missing_hand_start_progress',
        }),
      }),
    );
  });

  it('does not emit cheat-style bypass alerts for infrastructure verifier codes', async () => {
    await recordDailyFritzAdvanceWithoutVerification({
      attemptId: ATTEMPT_ID,
      runDate: RUN_DATE,
      userId: USER_ID,
      requestId: 'req-infra',
      gameNumber: 1,
      handIndex: 6,
      verifierCode: 'missing_hand_start_progress',
      operation: 'record-game',
      message: 'Daily Fritz hand verification is missing authoritative hand-start scores while prior verified hands exist.',
    });

    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('verification bypassed'),
      expect.anything(),
    );
  });
});
