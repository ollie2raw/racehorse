import { createHash } from 'crypto';
import type { Application } from 'express';
import {
  getDailyFritzGameSeed,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
} from '../../dailyFritz';
import { appendDailyFritzGameToSet } from '../../dailyFritzSkunk';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { writeDailyFritzGameActivity } from '../../social/activityWriter';
import {
  DailyFritzVerificationError,
  digestDailyFritzTranscript,
  type VerifiedDailyFritzHandRecord,
} from '../../dailyFritzVerifier';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import {
  buildRecordedDailyFritzAttemptResult,
  classifyDailyFritzGameRecordingPosition,
  isIdenticalDailyFritzGameReplay,
  readAuthorityLedger,
} from './dailyFritzVerificationPolicy';
import { clearDailyFritzActiveCheckpoint } from './dailyFritzCheckpointPolicy';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import { loadDailyFritzPublishedAuthority } from './dailyFritzPublishedAuthority';
import {
  getDailyFritzAttemptById,
  getDailyFritzRun,
  normalizeDailyFritzSetGameNumber,
  normalizeDailyFritzSetResult,
  upsertDailyFritzAttempt,
  type DailyFritzAttemptRecord,
} from '../stores/dailyFritzStore';
import { commitDailyFritzAttemptCommand } from '../stores/dailyFritzCommandStore';
import {
  DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
  attemptVerifyHand,
  findVerifiedHand,
  isRecoverableDailyFritzCommandConflict,
  parseTranscriptForRequest,
  pinAuthorityContractFromVerifiedTranscript,
  readActiveGameProgress,
  isDailyFritzGameEndingScore,
  recordDailyFritzAdvanceWithoutVerification,
  recordDailyFritzEventBestEffort,
  dailyFritzTranscriptEvidenceFields,
  rejectModernAttemptWhenAuthorityDisabled,
  respondVerificationError,
  writeActiveGameProgress,
  writeUnverifiedDailyFritzHand,
  writeVerifiedGame,
  writeVerifiedHand,
} from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';
import { DAILY_FRITZ_VERIFIER_VERSION } from '@racehorse/game-core';

export function registerDailyFritzRecordGameRoute(app: Application): void {
  app.post('/api/daily-fritz/record-game', async (req, res) => {
  const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'record-game');
  incrementDailyFritzMetric('mutation_request');
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const gameNumber = normalizeDailyFritzSetGameNumber(Number(req.body?.game_number));
  const transcriptInput = req.body?.transcript;
  const legacyPlayerScore = Number(req.body?.player_score);
  const legacyFritzScore = Number(req.body?.fritz_score);
  const legacyMovesUsed = Number(req.body?.moves_used);
  const legacyHandsPlayed = Number(req.body?.hands_played);
  const hasLegacyResult = [legacyPlayerScore, legacyFritzScore, legacyMovesUsed, legacyHandsPlayed]
    .every((value) => Number.isFinite(value) && value >= 0);
  if (!attemptId || !verifiedMatchId || !gameNumber || (transcriptInput == null && !hasLegacyResult)) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, game_number, and verification evidence are required.' });
    return;
  }

  let evidenceTranscript: ReturnType<typeof parseTranscriptForRequest> | null = null;
  try {
    await withDailyFritzAttemptLock(attemptId, async () => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyFritzAttemptById(attemptId, authenticatedUserId);
    if (!attempt || attempt.id !== attemptId) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    if (rejectModernAttemptWhenAuthorityDisabled(attempt, res)) return;
    if (runDateFromClient && runDateFromClient !== attempt.runDate) {
      res.status(400).json({ error: 'Daily Fritz run date does not match this attempt.' });
      return;
    }
    if (attempt.status !== 'started') {
      res.status(409).json({ error: 'Daily Fritz attempt is not active.' });
      return;
    }
    if (attempt.verifiedMatchId !== verifiedMatchId) {
      res.status(403).json({ error: 'Verified match does not match this attempt.' });
      return;
    }
    const run = await getDailyFritzRun(attempt.runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    const publishedAuthority = await loadDailyFritzPublishedAuthority({ attempt, run });
    const parsedTranscript = transcriptInput == null ? null : parseTranscriptForRequest(transcriptInput);
    if (parsedTranscript) evidenceTranscript = parsedTranscript;
    // Verification does not gate saving. A game the player already finished is
    // saved whether or not evidence came with it; a missing transcript is
    // recorded as unverified, never refused.

    const currentSetResult = normalizeDailyFritzSetResult(attempt.result) ?? {
      version: 2,
      format: 'best_of_3' as const,
      playerGamesWon: 0,
      fritzGamesWon: 0,
      totalPointDiff: 0,
      games: [],
    };
    // No prior-receipt gate. This is what trapped four players between
    // 2026-08-19 and 2026-08-24: one hand failing verification left its game
    // without a receipt, and every later game then 409'd forever, with no way
    // back because the earlier game could never be re-verified.
    const recordingPosition = classifyDailyFritzGameRecordingPosition(currentSetResult, gameNumber);
    if (recordingPosition.kind === 'replay') {
      const existing = recordingPosition.existing;
        const identical = parsedTranscript
          ? (() => {
              const authorityGame = readAuthorityLedger(attempt.result).games.find(
                (game) => game.gameNumber === gameNumber,
              );
              const submittedDigest = digestDailyFritzTranscript(parsedTranscript);
              const terminalHandIndex = readAuthorityLedger(attempt.result).hands
                .filter((hand) => hand.gameNumber === gameNumber)
                .reduce((max, hand) => Math.max(max, hand.handIndex), -1);
              return Boolean(
                authorityGame
                && parsedTranscript.handIndex === terminalHandIndex
                && authorityGame.handDigests[authorityGame.handDigests.length - 1] === submittedDigest,
              );
            })()
          : isIdenticalDailyFritzGameReplay(existing, {
              playerScore: legacyPlayerScore,
              fritzScore: legacyFritzScore,
              movesUsed: legacyMovesUsed,
              handsPlayed: legacyHandsPlayed,
            });
        if (!identical) {
          log.warn({
            attemptId,
            gameNumber,
            userId: authenticatedUserId,
          }, '[daily-fritz-record-game] conflicting replay');
          res.status(409).json({ error: 'Daily Fritz game was already recorded with a different result.' });
          return;
        }
        incrementDailyFritzMetric('retry_request');
        await recordDailyFritzEventBestEffort({
          attemptId,
          runDate: attempt.runDate,
          userId: authenticatedUserId,
          requestId: diagnostics.requestId,
          eventType: 'game_recorded',
          gameNumber,
          idempotencyKey: `${attemptId}:game_recorded:${gameNumber}:replay:${diagnostics.requestId}`,
          payload: { replayed: true },
        });
        res.json({
          ok: true,
          replayed: true,
          set_result: currentSetResult,
          next_game_number: currentSetResult.setWinner ? null : Math.min(currentSetResult.games.length + 1, 3),
        });
        return;
    }
    if (recordingPosition.kind === 'set_decided') {
      res.status(409).json({ error: 'Daily Fritz set is already decided.' });
      return;
    }
    if (recordingPosition.kind === 'invalid_order') {
      res.status(409).json({ error: 'Daily Fritz game order is invalid.' });
      return;
    }

    if (parsedTranscript && parsedTranscript.handIndex !== attempt.currentHandIndex) {
      res.status(409).json({ error: 'Daily Fritz hand is no longer current.' });
      return;
    }
    let playerScore = Math.round(legacyPlayerScore);
    let fritzScore = Math.round(legacyFritzScore);
    let movesUsed = Math.round(legacyMovesUsed);
    let handsPlayed = Math.round(legacyHandsPlayed);
    let terminalHandReceipt: VerifiedDailyFritzHandRecord | null = null;
    let advancedUnverified = false;
    const terminalHandIndex = attempt.currentHandIndex;
    const winningScore = publishedAuthority?.winningScore ?? run.winningScore;
    if (parsedTranscript) {
      // /next-hand may already have verified and persisted this exact terminal
      // hand (it does so before returning "game is complete; finalize" so the
      // score is never lost). Reuse that receipt instead of re-verifying and
      // re-appending a duplicate hand into the authority ledger.
      const existingTerminalHand = findVerifiedHand(attempt.result, gameNumber, attempt.currentHandIndex);
      let verifiedHandResult: VerifiedDailyFritzHandRecord | null = null;
      if (existingTerminalHand) {
        if (existingTerminalHand.transcriptDigest !== digestDailyFritzTranscript(parsedTranscript)) {
          log.warn({
            attemptId,
            gameNumber,
            userId: authenticatedUserId,
          }, '[daily-fritz-record-game] conflicting verified terminal hand retry');
          incrementDailyFritzMetric('command_conflict', 'verified_hand_conflict');
          await recordDailyFritzEventBestEffort({
            attemptId,
            runDate: attempt.runDate,
            userId: authenticatedUserId,
            requestId: diagnostics.requestId,
            eventType: 'command_conflict',
            gameNumber,
            handIndex: attempt.currentHandIndex,
            verifierCode: 'verified_hand_conflict',
            idempotencyKey: `${attemptId}:command_conflict:record-game:${gameNumber}:${attempt.currentHandIndex}:${diagnostics.requestId}`,
            payload: { reason: 'verified_hand_evidence_differs' },
          });
          res.status(409).json({
            error: 'Daily Fritz advanced on another session. Resume from the authoritative state.',
            code: 'verified_hand_conflict',
            recoverable: true,
            recovery_action: 'reload_official_hand',
            authority_revision: attempt.revision,
          });
          return;
        }
        if (existingTerminalHand.playerScoreAfter === existingTerminalHand.fritzScoreAfter) {
          res.status(409).json({ error: 'Daily Fritz game is not complete.' });
          return;
        }
        verifiedHandResult = existingTerminalHand;
      } else {
        // Sync verify + receipt under lock before publishing / advancing.
        // Forward-only: attempts already advance-first published are not rewritten.
        const progress = readActiveGameProgress(attempt.result, gameNumber);
        const resolvedPlayerScore = hasLegacyResult ? playerScore : progress.you;
        const resolvedFritzScore = hasLegacyResult ? fritzScore : progress.fritz;
        if (!isDailyFritzGameEndingScore(resolvedPlayerScore, resolvedFritzScore, winningScore)) {
          if (!hasLegacyResult) {
            res.status(409).json({ error: 'Daily Fritz game is not complete.' });
            return;
          }
          if (playerScore === fritzScore) {
            res.status(400).json({ error: 'Daily Fritz games cannot be recorded with tied scores.' });
            return;
          }
        } else {
          playerScore = resolvedPlayerScore;
          fritzScore = resolvedFritzScore;
        }

        const verification = attemptVerifyHand({
          transcript: parsedTranscript,
          attempt,
          run,
          userId: authenticatedUserId,
          gameNumber,
          handIndex: terminalHandIndex,
          publishedChallenge: publishedAuthority,
        });

        const verified = verification.ok ? verification.verified : null;
        const terminalComplete = Boolean(
          verified
          && verified.terminalState.gameOver
          && verified.result.playerScoreAfter !== verified.result.fritzScoreAfter,
        );
        const scoresMatch = Boolean(
          verified
          && verified.result.playerScoreAfter === playerScore
          && verified.result.fritzScoreAfter === fritzScore,
        );

        if (verified && terminalComplete && scoresMatch) {
          attempt.result = pinAuthorityContractFromVerifiedTranscript({
            result: attempt.result,
            run,
            transcript: verified.transcript,
          });
          attempt.result = writeVerifiedHand(attempt.result, verified.result);
          verifiedHandResult = verified.result;
          playerScore = verified.result.playerScoreAfter;
          fritzScore = verified.result.fritzScoreAfter;
        } else {
          // Never-strand: publish with sticky rejected only after evidence is archived.
          // Do not leave pending_verification / fire-and-forget async verify.
          const verifierCode = !verification.ok
            ? verification.error.code
            : !terminalComplete
              ? 'game_not_complete'
              : 'score_mismatch';
          const message = !verification.ok
            ? verification.error.message
            : !terminalComplete
              ? 'Terminal hand verification found the game was not complete.'
              : 'Recorded scores did not match the verified transcript.';
          await recordDailyFritzAdvanceWithoutVerification({
            attemptId,
            runDate: attempt.runDate,
            userId: authenticatedUserId,
            requestId: diagnostics.requestId,
            gameNumber,
            handIndex: terminalHandIndex,
            verifierCode,
            operation: 'record-game',
            message,
            transcript: parsedTranscript,
          });
          attempt.result = writeUnverifiedDailyFritzHand(attempt.result, {
            gameNumber,
            handIndex: terminalHandIndex,
            verifierCode,
          });
          advancedUnverified = true;
        }

        if (hasLegacyResult) {
          movesUsed = Math.round(legacyMovesUsed);
          handsPlayed = Math.round(legacyHandsPlayed);
        } else if (verifiedHandResult) {
          const gameHands = readAuthorityLedger(attempt.result).hands.filter(
            (hand) => hand.gameNumber === gameNumber,
          );
          movesUsed = gameHands.reduce((sum, hand) => sum + hand.actionCount, 0);
          handsPlayed = gameHands.length;
        } else {
          const priorHands = readAuthorityLedger(attempt.result).hands.filter(
            (hand) => hand.gameNumber === gameNumber,
          );
          movesUsed = priorHands.reduce((sum, hand) => sum + hand.actionCount, 0);
          handsPlayed = attempt.currentHandIndex + 1;
        }
        attempt.result = writeActiveGameProgress(attempt.result, {
          gameNumber,
          you: playerScore,
          fritz: fritzScore,
        });
      }
      if (verifiedHandResult) {
        playerScore = verifiedHandResult.playerScoreAfter;
        fritzScore = verifiedHandResult.fritzScoreAfter;
        terminalHandReceipt = verifiedHandResult;
        attempt.result = writeActiveGameProgress(attempt.result, { gameNumber, you: playerScore, fritz: fritzScore });
        const gameHands = readAuthorityLedger(attempt.result).hands.filter((hand) => hand.gameNumber === gameNumber);
        movesUsed = gameHands.reduce((sum, hand) => sum + hand.actionCount, 0);
        handsPlayed = gameHands.length;
      }
    } else if (playerScore === fritzScore) {
      res.status(400).json({ error: 'Daily Fritz games cannot be recorded with tied scores.' });
      return;
    }
    const playerWon = playerScore > fritzScore;
    const gameResult: DailyFritzSetGameResult = {
      gameNumber,
      seed: getDailyFritzGameSeed(attempt.runDate, gameNumber),
      playerWon,
      playerScore: Math.round(playerScore),
      fritzScore: Math.round(fritzScore),
      pointDiff: Math.round(playerScore - fritzScore),
      movesUsed: Math.round(movesUsed),
      handsPlayed: Math.round(handsPlayed),
      completedAt: new Date().toISOString(),
    };
    const setResult = appendDailyFritzGameToSet(currentSetResult, gameResult);

    if (parsedTranscript && !advancedUnverified) {
      const gameHands = readAuthorityLedger(attempt.result).hands.filter((hand) => hand.gameNumber === gameNumber);
      const resultDigest = createHash('sha256')
        .update(`${attempt.id}:${gameNumber}:${playerScore}:${fritzScore}:${gameHands.map((hand) => hand.transcriptDigest).join(':')}`)
        .digest('hex');
      attempt.result = writeVerifiedGame(attempt.result, {
        verificationVersion: DAILY_FRITZ_VERIFIER_VERSION,
        gameNumber,
        playerScore,
        fritzScore,
        handDigests: gameHands.map((hand) => hand.transcriptDigest),
        resultDigest,
      });
    }

    attempt.result = buildRecordedDailyFritzAttemptResult({
      previousResult: attempt.result,
      setResult,
      hasTranscript: Boolean(parsedTranscript),
      verificationPending: false,
    });
    attempt.result = clearDailyFritzActiveCheckpoint(attempt.result);
    if (!setResult.setWinner) {
      attempt.currentHandIndex = 0;
      attempt.currentGameNumber = Math.min(gameNumber + 1, 3) as DailyFritzSetGameNumber;
    }
    let saved: DailyFritzAttemptRecord;
    const transactionalGame = Boolean(
      attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED && !advancedUnverified,
    );
    if (transactionalGame) {
      const authorityGame = readAuthorityLedger(attempt.result).games.find(
        (game) => game.gameNumber === gameNumber,
      );
      if (!authorityGame) throw new Error('Verified Daily Fritz game receipt is missing.');
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: authenticatedUserId,
        attemptId: attempt.id,
        operationId: `game:${gameNumber}:record`,
        commandType: 'record_verified_game',
        expectedRevision: attempt.revision,
        next: {
          status: 'started',
          currentGameNumber: setResult.setWinner ? gameNumber : attempt.currentGameNumber,
          currentHandIndex: setResult.setWinner ? attempt.currentHandIndex : 0,
          result: attempt.result ?? {},
        },
        gameReceipt: {
          ...authorityGame,
          pointDiff: gameResult.pointDiff,
          playerWon: gameResult.playerWon,
          actionCount: movesUsed,
          handsPlayed,
        },
        handReceipt: terminalHandReceipt,
        outbox: {
          eventType: 'game_recorded',
          payload: {
            gameNumber,
            playerScore,
            fritzScore,
            setWinner: setResult.setWinner ?? null,
          },
        },
      });
      if (command.outcome !== 'committed') {
        const recoverable = isRecoverableDailyFritzCommandConflict(command.errorCode);
        res.status(409).json({
          error: recoverable
            ? 'Daily Fritz advanced on another session. Resume from the authoritative state.'
            : 'Daily Fritz could not commit the verified game.',
          code: command.errorCode ?? 'transactional_game_commit_failed',
          recoverable,
          recovery_action: recoverable ? 'reload_official_hand' : null,
          authority_revision: command.committedRevision,
          authoritative_state: command.response,
        });
        return;
      }
      saved = await getDailyFritzAttemptById(attempt.id, authenticatedUserId)
        ?? (() => { throw new Error('Committed Daily Fritz game was not readable.'); })();
    } else {
      saved = await upsertDailyFritzAttempt(attempt);
    }
    const savedSetResult = normalizeDailyFritzSetResult(saved.result);
    const recordedGame = (savedSetResult ?? setResult).games.find(
      (game: DailyFritzSetGameResult) => game.gameNumber === gameNumber,
    );
    if (recordedGame) {
      void writeDailyFritzGameActivity({
        userId: authenticatedUserId,
        gameNumber: recordedGame.gameNumber,
        playerWon: recordedGame.playerWon,
        playerScore: recordedGame.playerScore,
        fritzScore: recordedGame.fritzScore,
        skunk: recordedGame.skunk,
        skunkBy: recordedGame.skunkBy,
      }).catch((error) => {
        log.warn({ err: error, attemptId, gameNumber: recordedGame.gameNumber, userId: authenticatedUserId }, '[daily-fritz] activity_write_failed');
      });
    }
    incrementDailyFritzMetric('game_recorded');
    const eventTranscriptDigest = parsedTranscript ? digestDailyFritzTranscript(parsedTranscript) : null;
    if (!transactionalGame) await recordDailyFritzEventBestEffort({
      attemptId,
      runDate: attempt.runDate,
      userId: authenticatedUserId,
      requestId: diagnostics.requestId,
      eventType: 'game_recorded',
      gameNumber,
      handIndex: parsedTranscript?.handIndex ?? null,
      transcriptDigest: eventTranscriptDigest,
      idempotencyKey: `${attemptId}:game_recorded:${gameNumber}:${parsedTranscript?.handIndex ?? 'legacy'}:${eventTranscriptDigest ?? 'legacy'}`,
      payload: {
        playerScore,
        fritzScore,
        movesUsed,
        handsPlayed,
        setWinner: setResult.setWinner ?? null,
        ...(advancedUnverified ? { unverified: true } : {}),
      },
    });
    res.json({
      ok: true,
      authority_revision: saved.revision,
      set_result: savedSetResult ?? setResult,
      next_game_number: setResult.setWinner ? null : Math.min(setResult.games.length + 1, 3),
      ...(advancedUnverified ? { unverified: true } : {}),
    });
    });
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) {
      incrementDailyFritzMetric('verification_failed', error.code);
      const evidence = dailyFritzTranscriptEvidenceFields(evidenceTranscript);
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'verification_failed',
        verifierCode: error.code,
        transcriptDigest: evidence.transcriptDigest,
        idempotencyKey: `${attemptId || 'unknown'}:verification_failed:record-game:${diagnostics.requestId}`,
        payload: {
          operation: 'record-game',
          message: error.message,
          ...evidence.payload,
        },
      });
    } else {
      incrementDailyFritzMetric('request_failed');
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'request_failed',
        statusCode: 500,
        idempotencyKey: `${attemptId || 'unknown'}:request_failed:record-game:${diagnostics.requestId}`,
        payload: { operation: 'record-game', message: error instanceof Error ? error.message : String(error) },
      });
    }
    if (respondVerificationError(res, error, { attemptId, gameNumber })) return;
    capture500(error, { route: 'record-game' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to record Daily Fritz game.'),
    });
  }
});
}
