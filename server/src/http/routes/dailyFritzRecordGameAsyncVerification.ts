import { createHash } from 'crypto';
import type { DailyFritzSetGameNumber } from '../../dailyFritz';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import {
  type VerifiedDailyFritzHandRecord,
} from '../../dailyFritzVerifier';
import {
  getDailyFritzAttemptById,
  upsertDailyFritzAttempt,
  type DailyFritzRunRecord,
} from '../stores/dailyFritzStore';
import { commitDailyFritzAttemptCommand } from '../stores/dailyFritzCommandStore';
import { readAuthorityLedger } from './dailyFritzVerificationPolicy';
import type { DailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';
import {
  DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
  attemptVerifyHand,
  findVerifiedHand,
  pinAuthorityContractFromVerifiedTranscript,
  recordDailyFritzAdvanceWithoutVerification,
  recordDailyFritzEventBestEffort,
  writeVerifiedGame,
  writeVerifiedHand,
  writeUnverifiedDailyFritzHand,
} from './dailyFritzVerificationGlue';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import { capture500, log } from './dailyFritzRouteErrors';
import { DAILY_FRITZ_VERIFIER_VERSION } from '@racehorse/game-core';
import type { parseTranscriptForRequest } from './dailyFritzVerificationGlue';

/** Test hook: artificial delay before async verification runs. */
let recordGameVerificationDelayMsForTests = 0;

export function setRecordGameVerificationDelayMsForTests(delayMs: number): void {
  recordGameVerificationDelayMsForTests = delayMs;
}

export function resetRecordGameVerificationDelayMsForTests(): void {
  recordGameVerificationDelayMsForTests = 0;
}

export type DailyFritzRecordGameAsyncVerificationInput = {
  attemptId: string;
  userId: string;
  runDate: string;
  requestId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  transcript: ReturnType<typeof parseTranscriptForRequest>;
  run: DailyFritzRunRecord;
  publishedChallenge: DailyFritzPublishedChallenge | null;
  expectedPlayerScore: number;
  expectedFritzScore: number;
  challengeId: string | null;
};

/**
 * Fire-and-forget wrapper. Errors are logged and reported; they never block
 * the advance-first HTTP response.
 */
export function scheduleDailyFritzRecordGameVerification(
  input: DailyFritzRecordGameAsyncVerificationInput,
): void {
  void runDailyFritzRecordGameVerification(input).catch((error) => {
    capture500(error, { route: 'record-game-async', attemptId: input.attemptId });
    log.error({
      attemptId: input.attemptId,
      gameNumber: input.gameNumber,
      handIndex: input.handIndex,
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz-record-game] async verification crashed');
  });
}

export async function runDailyFritzRecordGameVerification(
  input: DailyFritzRecordGameAsyncVerificationInput,
): Promise<void> {
  if (recordGameVerificationDelayMsForTests > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, recordGameVerificationDelayMsForTests);
    });
  }

  await withDailyFritzAttemptLock(input.attemptId, async () => {
    const attempt = await getDailyFritzAttemptById(input.attemptId, input.userId);
    if (!attempt || attempt.status !== 'started') return;

    if (findVerifiedHand(attempt.result, input.gameNumber, input.handIndex)) {
      await ensureVerifiedGameReceipt(input, attempt.result, input.expectedPlayerScore, input.expectedFritzScore);
      return;
    }

    const verification = attemptVerifyHand({
      transcript: input.transcript,
      attempt,
      run: input.run,
      userId: input.userId,
      gameNumber: input.gameNumber,
      handIndex: input.handIndex,
      publishedChallenge: input.publishedChallenge,
    });

    if (!verification.ok) {
      await recordDailyFritzAdvanceWithoutVerification({
        attemptId: input.attemptId,
        runDate: input.runDate,
        userId: input.userId,
        requestId: input.requestId,
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        verifierCode: verification.error.code,
        operation: 'record-game',
        message: verification.error.message,
      });
      attempt.result = writeUnverifiedDailyFritzHand(attempt.result, {
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        verifierCode: verification.error.code,
      });
      await upsertDailyFritzAttempt(attempt);
      return;
    }

    const verified = verification.verified;
    const terminalComplete = verified.terminalState.gameOver
      && verified.result.playerScoreAfter !== verified.result.fritzScoreAfter;
    const scoresMatch = verified.result.playerScoreAfter === input.expectedPlayerScore
      && verified.result.fritzScoreAfter === input.expectedFritzScore;

    if (!terminalComplete || !scoresMatch) {
      const verifierCode = !terminalComplete ? 'game_not_complete' : 'score_mismatch';
      await recordDailyFritzAdvanceWithoutVerification({
        attemptId: input.attemptId,
        runDate: input.runDate,
        userId: input.userId,
        requestId: input.requestId,
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        verifierCode,
        operation: 'record-game',
        message: !terminalComplete
          ? 'Async verification found the terminal hand was not complete.'
          : 'Async verification found recorded scores did not match the transcript.',
      });
      attempt.result = writeUnverifiedDailyFritzHand(attempt.result, {
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        verifierCode,
      });
      await upsertDailyFritzAttempt(attempt);
      return;
    }

    attempt.result = pinAuthorityContractFromVerifiedTranscript({
      result: attempt.result,
      run: input.run,
      transcript: verified.transcript,
    });
    attempt.result = writeVerifiedHand(attempt.result, verified.result);
    attempt.result = writeVerifiedGameReceipt(
      attempt.result,
      input.gameNumber,
      verified.result,
    );
    if (attempt.result?.verification_status === 'pending_verification') {
      attempt.result = { ...attempt.result, verification_status: 'in_progress' };
    }

    const transactionalGame = Boolean(input.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED);
    if (transactionalGame) {
      const authorityGame = readAuthorityLedger(attempt.result).games.find(
        (game) => game.gameNumber === input.gameNumber,
      );
      if (!authorityGame) {
        await upsertDailyFritzAttempt(attempt);
        return;
      }
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: input.userId,
        attemptId: attempt.id,
        operationId: `game:${input.gameNumber}:verify`,
        commandType: 'record_verified_game',
        expectedRevision: attempt.revision,
        next: {
          status: 'started',
          currentGameNumber: attempt.currentGameNumber,
          currentHandIndex: attempt.currentHandIndex,
          result: attempt.result ?? {},
        },
        gameReceipt: {
          ...authorityGame,
          pointDiff: authorityGame.playerScore - authorityGame.fritzScore,
          playerWon: authorityGame.playerScore > authorityGame.fritzScore,
          actionCount: verified.result.actionCount,
          handsPlayed: readAuthorityLedger(attempt.result).hands.filter(
            (hand) => hand.gameNumber === input.gameNumber,
          ).length,
        },
        handReceipt: verified.result,
        outbox: {
          eventType: 'hand_verified',
          payload: {
            gameNumber: input.gameNumber,
            handIndex: input.handIndex,
            transcriptDigest: verified.result.transcriptDigest,
            async: true,
          },
        },
      });
      if (command.outcome !== 'committed') {
        log.warn({
          attemptId: input.attemptId,
          gameNumber: input.gameNumber,
          code: command.errorCode,
        }, '[daily-fritz-record-game] async transactional verify commit failed');
      }
      return;
    }

    await upsertDailyFritzAttempt(attempt);
    incrementDailyFritzMetric('hand_verified');
    await recordDailyFritzEventBestEffort({
      attemptId: input.attemptId,
      runDate: input.runDate,
      userId: input.userId,
      requestId: input.requestId,
      eventType: 'hand_verified',
      gameNumber: input.gameNumber,
      handIndex: input.handIndex,
      transcriptDigest: verified.result.transcriptDigest,
      idempotencyKey: `${input.attemptId}:hand_verified:async:${input.gameNumber}:${input.handIndex}:${verified.result.transcriptDigest}`,
      payload: {
        actionCount: verified.result.actionCount,
        winner: verified.result.winner,
        playerScoreAfter: verified.result.playerScoreAfter,
        fritzScoreAfter: verified.result.fritzScoreAfter,
        async: true,
      },
    });
  });
}

function writeVerifiedGameReceipt(
  result: Record<string, unknown> | null,
  gameNumber: DailyFritzSetGameNumber,
  terminalHand: VerifiedDailyFritzHandRecord,
): Record<string, unknown> {
  const gameHands = readAuthorityLedger(result).hands.filter((hand) => hand.gameNumber === gameNumber);
  const playerScore = terminalHand.playerScoreAfter;
  const fritzScore = terminalHand.fritzScoreAfter;
  const resultDigest = createHash('sha256')
    .update(`${gameNumber}:${playerScore}:${fritzScore}:${gameHands.map((hand) => hand.transcriptDigest).join(':')}`)
    .digest('hex');
  return writeVerifiedGame(result, {
    verificationVersion: DAILY_FRITZ_VERIFIER_VERSION,
    gameNumber,
    playerScore,
    fritzScore,
    handDigests: gameHands.map((hand) => hand.transcriptDigest),
    resultDigest,
  });
}

async function ensureVerifiedGameReceipt(
  input: DailyFritzRecordGameAsyncVerificationInput,
  result: Record<string, unknown> | null,
  playerScore: number,
  fritzScore: number,
): Promise<void> {
  const ledger = readAuthorityLedger(result);
  const existingGame = ledger.games.find((game) => game.gameNumber === input.gameNumber);
  if (existingGame
    && existingGame.playerScore === playerScore
    && existingGame.fritzScore === fritzScore) {
    return;
  }
  const terminalHand = findVerifiedHand(result, input.gameNumber, input.handIndex);
  if (!terminalHand) return;
  const attempt = await getDailyFritzAttemptById(input.attemptId, input.userId);
  if (!attempt) return;
  attempt.result = writeVerifiedGameReceipt(attempt.result, input.gameNumber, terminalHand);
  await upsertDailyFritzAttempt(attempt);
}
