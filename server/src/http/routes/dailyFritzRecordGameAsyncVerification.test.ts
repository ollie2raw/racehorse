import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

const {
  getAttemptByIdMock,
  upsertAttemptMock,
  commitCommandMock,
  recordEventMock,
  supabaseFetchMock,
} = vi.hoisted(() => ({
  getAttemptByIdMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  commitCommandMock: vi.fn(),
  recordEventMock: vi.fn(),
  supabaseFetchMock: vi.fn(),
}));

vi.mock('../../dailyFritzAttemptLock', () => ({
  withDailyFritzAttemptLock: async (_attemptId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>('../stores/dailyFritzStore');
  return {
    ...actual,
    getDailyFritzAttemptById: getAttemptByIdMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
  };
});

vi.mock('../stores/dailyFritzCommandStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzCommandStore')>(
    '../stores/dailyFritzCommandStore',
  );
  return {
    ...actual,
    commitDailyFritzAttemptCommand: commitCommandMock,
  };
});

vi.mock('../../supabaseUtils', async () => {
  const actual = await vi.importActual<typeof import('../../supabaseUtils')>('../../supabaseUtils');
  return {
    ...actual,
    supabaseFetch: supabaseFetchMock,
  };
});

vi.mock('./dailyFritzVerificationGlue', async () => {
  const actual = await vi.importActual<typeof import('./dailyFritzVerificationGlue')>(
    './dailyFritzVerificationGlue',
  );
  return {
    ...actual,
    DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED: true,
    recordDailyFritzEventBestEffort: recordEventMock,
    attemptVerifyHand: vi.fn(() => ({
      ok: true,
      verified: {
        transcript: {
          protocolVersion: 2,
          rulesVersion: 1,
          fritzPolicyVersion: 2,
          fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
          stateDigestVersion: 1,
          clientRelease: 'test',
          challengeId: 'daily-fritz:2026-08-20:r2:s1',
          attemptId: 'attempt-1',
          gameNumber: 1,
          handIndex: 4,
          actions: [],
        },
        terminalState: { gameOver: true },
        result: {
          reason: 'domino',
          userId: 'user-1',
          winner: 'fritz',
          attemptId: 'attempt-1',
          handIndex: 4,
          gameNumber: 1,
          verifiedAt: '2026-08-20T07:07:10.000Z',
          actionCount: 14,
          challengeId: 'daily-fritz:2026-08-20:r2:s1',
          pointsAwarded: 11,
          fritzScoreAfter: 70,
          fritzScoreBefore: 59,
          playerScoreAfter: 46,
          playerScoreBefore: 33,
          transcriptDigest: 'f'.repeat(64),
          fritzPolicyVersion: 2,
          fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
          verificationVersion: 2,
          lastAuthorityStateDigest: 'df-state-v1:test',
        },
      },
    })),
  };
});

import { runDailyFritzRecordGameVerification } from './dailyFritzRecordGameAsyncVerification';

function buildAttempt(): DailyFritzAttemptRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    runDate: '2026-08-20',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 2,
    revision: 5,
    challengeId: 'daily-fritz:2026-08-20:r2:s1',
    challengeContractVersion: 1,
    generationVersion: 1,
    gameRulesVersion: 1,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: 2,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-20T07:02:45.000Z',
    completedAt: null,
    verifiedMatchId: '33333333-3333-4333-8333-333333333333',
    completionHash: null,
    result: {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: 0,
      fritzGamesWon: 1,
      totalPointDiff: -24,
      games: [{
        gameNumber: 1,
        seed: 'daily-fritz-2026-08-20:game:1',
        playerWon: false,
        playerScore: 46,
        fritzScore: 70,
        pointDiff: -24,
        movesUsed: 37,
        handsPlayed: 5,
        completedAt: '2026-08-20T07:07:10.000Z',
      }],
      authority: {
        version: 1,
        games: [],
        hands: [
          {
            reason: 'domino',
            userId: 'user-1',
            winner: 'player',
            attemptId: '11111111-1111-4111-8111-111111111111',
            handIndex: 0,
            gameNumber: 1,
            verifiedAt: '2026-08-20T07:04:01.000Z',
            actionCount: 20,
            challengeId: 'daily-fritz:2026-08-20:r2:s1',
            pointsAwarded: 30,
            fritzScoreAfter: 30,
            fritzScoreBefore: 0,
            playerScoreAfter: 4,
            playerScoreBefore: 0,
            transcriptDigest: 'a'.repeat(64),
            fritzPolicyVersion: 2,
            fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
            verificationVersion: 2,
            lastAuthorityStateDigest: 'df-state-v1:a',
          },
          {
            reason: 'domino',
            userId: 'user-1',
            winner: 'player',
            attemptId: '11111111-1111-4111-8111-111111111111',
            handIndex: 1,
            gameNumber: 1,
            verifiedAt: '2026-08-20T07:04:35.000Z',
            actionCount: 11,
            challengeId: 'daily-fritz:2026-08-20:r2:s1',
            pointsAwarded: 7,
            fritzScoreAfter: 34,
            fritzScoreBefore: 30,
            playerScoreAfter: 11,
            playerScoreBefore: 4,
            transcriptDigest: 'b'.repeat(64),
            fritzPolicyVersion: 2,
            fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
            verificationVersion: 2,
            lastAuthorityStateDigest: 'df-state-v1:b',
          },
          {
            reason: 'domino',
            userId: 'user-1',
            winner: 'player',
            attemptId: '11111111-1111-4111-8111-111111111111',
            handIndex: 2,
            gameNumber: 1,
            verifiedAt: '2026-08-20T07:05:15.000Z',
            actionCount: 13,
            challengeId: 'daily-fritz:2026-08-20:r2:s1',
            pointsAwarded: 11,
            fritzScoreAfter: 35,
            fritzScoreBefore: 34,
            playerScoreAfter: 22,
            playerScoreBefore: 11,
            transcriptDigest: 'c'.repeat(64),
            fritzPolicyVersion: 2,
            fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
            verificationVersion: 2,
            lastAuthorityStateDigest: 'df-state-v1:c',
          },
          {
            reason: 'domino',
            userId: 'user-1',
            winner: 'player',
            attemptId: '11111111-1111-4111-8111-111111111111',
            handIndex: 3,
            gameNumber: 1,
            verifiedAt: '2026-08-20T07:06:14.000Z',
            actionCount: 19,
            challengeId: 'daily-fritz:2026-08-20:r2:s1',
            pointsAwarded: 24,
            fritzScoreAfter: 59,
            fritzScoreBefore: 35,
            playerScoreAfter: 33,
            playerScoreBefore: 22,
            transcriptDigest: 'd'.repeat(64),
            fritzPolicyVersion: 2,
            fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
            verificationVersion: 2,
            lastAuthorityStateDigest: 'df-state-v1:d',
          },
        ],
      },
      authority_contract: {
        version: 1,
        challengeId: 'daily-fritz:2026-08-20:r2:s1',
        clientRelease: 'test',
        runFingerprint: 'fp',
        gameRulesVersion: 1,
        fritzPolicyVersion: 2,
        stateDigestVersion: 1,
        fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
        stateDigestRequired: true,
        transcriptProtocolVersion: 2,
      },
      verification_status: 'in_progress',
      verification_protocol_version: 2,
      active_game: { game_number: 2, you: 0, fritz: 0 },
    },
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
}

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: '2026-08-20',
    seed: 'seed',
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: [],
    generatedAt: '2026-08-20T00:00:00.000Z',
    invalidatedAt: null,
    metadata: { draw_winners_by_game: { '1': 'you' } },
  };
}

describe('runDailyFritzRecordGameVerification', () => {
  let storedAttempt: DailyFritzAttemptRecord;

  beforeEach(() => {
    vi.clearAllMocks();
    storedAttempt = buildAttempt();
    getAttemptByIdMock.mockImplementation(async () => ({ ...storedAttempt }));
    upsertAttemptMock.mockImplementation(async (attempt: DailyFritzAttemptRecord) => {
      storedAttempt = { ...attempt, revision: attempt.revision + 1 };
      return { ...storedAttempt };
    });
    supabaseFetchMock.mockResolvedValue([]);
    commitCommandMock.mockResolvedValue({
      outcome: 'rejected',
      errorCode: 'stale_revision',
      replayed: false,
      committedRevision: 6,
      response: { attempt_id: '11111111-1111-4111-8111-111111111111', revision: 6 },
    });
    recordEventMock.mockResolvedValue(undefined);
  });

  it('backfills authority.games for an advance-first game even after the attempt already advanced to the next game', async () => {
    await runDailyFritzRecordGameVerification({
      attemptId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      runDate: '2026-08-20',
      requestId: 'req-1',
      gameNumber: 1,
      handIndex: 4,
      transcript: {
        protocolVersion: 2,
        rulesVersion: 1,
        fritzPolicyVersion: 2,
        fritzPolicyContract: 'fritz-policy-v2-deterministic-canonical-ties',
        stateDigestVersion: 1,
        clientRelease: 'test',
        challengeId: 'daily-fritz:2026-08-20:r2:s1',
        attemptId: '11111111-1111-4111-8111-111111111111',
        gameNumber: 1,
        handIndex: 4,
        actions: [],
      },
      run: buildRun(),
      publishedChallenge: null,
      expectedPlayerScore: 46,
      expectedFritzScore: 70,
      challengeId: 'daily-fritz:2026-08-20:r2:s1',
    });

    expect(storedAttempt.result?.authority?.games).toHaveLength(1);
    expect(storedAttempt.result?.authority?.games?.[0]).toMatchObject({
      gameNumber: 1,
      playerScore: 46,
      fritzScore: 70,
    });
    expect(storedAttempt.result?.authority?.hands).toHaveLength(5);
  });
});
