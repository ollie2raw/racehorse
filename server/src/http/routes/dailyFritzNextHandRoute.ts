import type { Application } from 'express';
import {
  resolveDailyFritzDrawTiles,
  resolveDailyFritzDrawWinner,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
} from '../../dailyFritz';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import {
  DailyFritzVerificationError,
  digestDailyFritzTranscript,
} from '../../dailyFritzVerifier';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import {
  requiresVerifiedDailyFritzEvidence,
} from './dailyFritzVerificationPolicy';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import { loadDailyFritzPublishedAuthority, resolveDailyFritzPublishedGameAuthority } from './dailyFritzPublishedAuthority';
import {
  getCurrentDailyFritzGameNumber,
  getDailyFritzAttemptById,
  getDailyFritzHandForGame,
  getDailyFritzRun,
  normalizeDailyFritzSetGameNumber,
  upsertDailyFritzAttempt,
  type DailyFritzAttemptRecord,
} from '../stores/dailyFritzStore';
import { commitDailyFritzAttemptCommand } from '../stores/dailyFritzCommandStore';
import {
  DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
  findVerifiedHand,
  isRecoverableDailyFritzCommandConflict,
  parseTranscriptForRequest,
  pinAuthorityContractFromVerifiedTranscript,
  readActiveGameProgress,
  attemptVerifyHand,
  isDailyFritzGameEndingScore,
  recordDailyFritzAdvanceWithoutVerification,
  recordDailyFritzEventBestEffort,
  rejectModernAttemptWhenAuthorityDisabled,
  respondVerificationError,
  writeActiveGameProgress,
  writeUnverifiedDailyFritzHand,
  writeVerifiedHand,
} from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';

export function registerDailyFritzNextHandRoute(app: Application): void {
  app.post('/api/daily-fritz/next-hand', async (req, res) => {
  const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'next-hand');
  incrementDailyFritzMetric('mutation_request');
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const completedHandIndex = Number(req.body?.completed_hand_index);
  const transcriptInput = req.body?.transcript;
  const legacyScores = req.body?.completed_hand_scores as { you?: unknown; fritz?: unknown } | undefined;
  const legacyYouScore = Number(legacyScores?.you);
  const legacyFritzScore = Number(legacyScores?.fritz);
  const hasLegacyScores = Number.isFinite(legacyYouScore) && legacyYouScore >= 0
    && Number.isFinite(legacyFritzScore) && legacyFritzScore >= 0;
  const rawGameNumber = req.body?.game_number;
  const requestedGameNumber =
    rawGameNumber == null ? null : normalizeDailyFritzSetGameNumber(Number(rawGameNumber));
  log.info({
    requestId: diagnostics.requestId,
    attemptId,
    runDateFromClient,
    rawGameNumber,
    completedHandIndex,
  }, '[daily-fritz-next-hand] request');
  if (!attemptId || !verifiedMatchId || (rawGameNumber != null && !requestedGameNumber) || !Number.isInteger(completedHandIndex) || completedHandIndex < 0 || (transcriptInput == null && !hasLegacyScores)) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, valid game_number, completed_hand_index, and verification evidence are required.' });
    return;
  }

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
    const currentGameNumber = getCurrentDailyFritzGameNumber(attempt.result);
    const gameNumber = requestedGameNumber ?? currentGameNumber;
    log.info({
      attemptId,
      requestedGameNumber,
      currentGameNumber,
      resolvedGameNumber: gameNumber,
      currentHandIndex: attempt.currentHandIndex,
    }, '[daily-fritz-next-hand] current game');
    if (gameNumber !== currentGameNumber) {
      res.status(409).json({ error: 'Daily Fritz game is no longer current.' });
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
    if (completedHandIndex > attempt.currentHandIndex) {
      res.status(400).json({ error: 'Requested completed hand is ahead of the persisted attempt.' });
      return;
    }

    const respondWithCurrentHand = (
      currentHandIndex: number,
      options: { replayed?: boolean; ignored?: boolean; unverified?: boolean } = {},
    ) => {
      const publishedGameAuthority = publishedAuthority
        ? resolveDailyFritzPublishedGameAuthority({
            challenge: publishedAuthority,
            gameNumber,
            handIndex: currentHandIndex,
          })
        : null;
      const hand = publishedGameAuthority?.deal
        ?? getDailyFritzHandForGame(run, gameNumber, currentHandIndex);
      const scores = readActiveGameProgress(attempt.result, gameNumber);
      const drawWinner: DailyFritzDrawWinner = publishedGameAuthority?.drawWinner
        ?? resolveDailyFritzDrawWinner({ runDate: run.runDate, gameNumber, metadata: run.metadata });
      const drawTiles: DailyFritzDrawTiles = publishedGameAuthority?.drawTiles
        ?? resolveDailyFritzDrawTiles({
          runDate: run.runDate,
          gameNumber,
          metadata: run.metadata,
          drawWinner,
        });
      log.info({
        attemptId,
        runDate: run.runDate,
        gameNumber,
        currentHandIndex,
        drawWinner,
        drawPlayerTile: drawTiles.playerTile,
        drawFritzTile: drawTiles.fritzTile,
      }, '[daily-fritz-next-hand] draw package');
      log.info({
        attemptId,
        gameNumber,
        currentHandIndex,
        replayed: Boolean(options.replayed),
        ignored: Boolean(options.ignored),
      }, '[daily-fritz-next-hand] returning hand');
      res.json({
        ok: true,
        run_date: run.runDate,
        game_number: gameNumber,
        current_game_number: gameNumber,
        set_result: attempt.result ?? null,
        current_hand_index: currentHandIndex,
        authority_revision: attempt.revision,
        current_game_scores: { you: scores.you, fritz: scores.fritz },
        hand,
        draw_winner: drawWinner,
        draw_player_tile: drawTiles.playerTile,
        draw_fritz_tile: drawTiles.fritzTile,
        replayed: Boolean(options.replayed),
        ignored: Boolean(options.ignored),
        // The hand advanced without a verification receipt; this run can no
        // longer place on the leaderboard.
        unverified: Boolean(options.unverified),
      });
    };

    if (transcriptInput == null) {
      if (requiresVerifiedDailyFritzEvidence(attempt.result)) {
        res.status(426).json({ error: 'This attempt requires verified hand evidence. Update required.' });
        return;
      }
      if (attempt.currentHandIndex === completedHandIndex + 1) {
        incrementDailyFritzMetric('next_hand_replayed');
        incrementDailyFritzMetric('retry_request');
        await recordDailyFritzEventBestEffort({
          attemptId,
          runDate: attempt.runDate,
          userId: authenticatedUserId,
          requestId: diagnostics.requestId,
          eventType: 'next_hand_replayed',
          gameNumber,
          handIndex: completedHandIndex,
          idempotencyKey: `${attemptId}:next_hand_replayed:${gameNumber}:${completedHandIndex}:${diagnostics.requestId}`,
          payload: { reason: 'server_already_advanced' },
        });
        respondWithCurrentHand(attempt.currentHandIndex, { replayed: true });
        return;
      }
      if (completedHandIndex !== attempt.currentHandIndex) {
        res.status(409).json({ error: 'Daily Fritz hand is no longer current.' });
        return;
      }
      attempt.result = writeActiveGameProgress({
        ...(attempt.result ?? {}),
        verification_status: 'legacy_unverified',
      }, {
        gameNumber,
        you: Math.round(legacyYouScore),
        fritz: Math.round(legacyFritzScore),
      });
      attempt.currentHandIndex += 1;
      const saved = await upsertDailyFritzAttempt(attempt);
      respondWithCurrentHand(saved.currentHandIndex);
      return;
    }
    let parsedTranscript: ReturnType<typeof parseTranscriptForRequest> | null = null;
    let parseError: DailyFritzVerificationError | null = null;
    try {
      parsedTranscript = parseTranscriptForRequest(transcriptInput);
    } catch (error) {
      if (error instanceof DailyFritzVerificationError && hasLegacyScores) {
        parseError = error;
      } else {
        throw error;
      }
    }
    const existingHand = parsedTranscript
      ? findVerifiedHand(attempt.result, gameNumber, completedHandIndex)
      : null;
    if (existingHand && parsedTranscript) {
      if (existingHand.transcriptDigest !== digestDailyFritzTranscript(parsedTranscript)) {
        log.warn({
          attemptId,
          gameNumber,
          completedHandIndex,
          userId: authenticatedUserId,
        }, '[daily-fritz-next-hand] conflicting verified hand retry');
        incrementDailyFritzMetric('command_conflict', 'verified_hand_conflict');
        await recordDailyFritzEventBestEffort({
          attemptId,
          runDate: attempt.runDate,
          userId: authenticatedUserId,
          requestId: diagnostics.requestId,
          eventType: 'command_conflict',
          gameNumber,
          handIndex: completedHandIndex,
          verifierCode: 'verified_hand_conflict',
          idempotencyKey: `${attemptId}:command_conflict:${gameNumber}:${completedHandIndex}:${diagnostics.requestId}`,
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
      incrementDailyFritzMetric('next_hand_replayed');
      incrementDailyFritzMetric('retry_request');
      await recordDailyFritzEventBestEffort({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'next_hand_replayed',
        gameNumber,
        handIndex: completedHandIndex,
        transcriptDigest: existingHand.transcriptDigest,
        idempotencyKey: `${attemptId}:next_hand_replayed:${gameNumber}:${completedHandIndex}:${diagnostics.requestId}`,
        payload: { reason: 'hand_already_verified' },
      });
      respondWithCurrentHand(attempt.currentHandIndex, { replayed: true });
      return;
    }
    if (attempt.currentHandIndex === completedHandIndex + 1) {
      incrementDailyFritzMetric('next_hand_replayed');
      incrementDailyFritzMetric('retry_request');
      await recordDailyFritzEventBestEffort({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'next_hand_replayed',
        gameNumber,
        handIndex: completedHandIndex,
        idempotencyKey: `${attemptId}:next_hand_replayed:${gameNumber}:${completedHandIndex}:${diagnostics.requestId}`,
        payload: { reason: 'server_already_advanced' },
      });
      respondWithCurrentHand(attempt.currentHandIndex, { replayed: true });
      return;
    }
    if (completedHandIndex !== attempt.currentHandIndex) {
      res.status(409).json({ error: 'Daily Fritz hand is no longer current.' });
      return;
    }
    // Do NOT cap by hand count — Daily Fritz plays to the winning score (e.g.
    // 60 points), not a fixed number of hands.  The pre-stored handDeals array
    // covers the common case; any hand beyond it is generated on-demand from
    // the same deterministic seed so all players still get identical tiles.
    const winningScore = publishedAuthority?.winningScore ?? run.winningScore;
    const verification = parsedTranscript
      ? attemptVerifyHand({
          transcript: parsedTranscript,
          attempt,
          run,
          userId: authenticatedUserId,
          gameNumber,
          handIndex: completedHandIndex,
          publishedChallenge: publishedAuthority,
        })
      : { ok: false as const, error: parseError! };
    const verified = verification.ok ? verification.verified : null;
    const verificationError = verification.ok ? null : verification.error;

    const progressScores = verified
      ? { you: verified.result.playerScoreAfter, fritz: verified.result.fritzScoreAfter }
      : hasLegacyScores
        ? { you: Math.round(legacyYouScore), fritz: Math.round(legacyFritzScore) }
        : null;
    if (!progressScores) {
      if (verificationError) throw verificationError;
      res.status(400).json({ error: 'completed_hand_scores are required when verification evidence is unusable.' });
      return;
    }

    const gameOver = verified?.terminalState.gameOver
      ?? isDailyFritzGameEndingScore(progressScores.you, progressScores.fritz, winningScore);
    if (gameOver) {
      // This hand crossed the winning score and ends the game, so it must be
      // finalized through /record-game rather than advanced here. Persist the
      // score now so a refresh cannot silently drop it.
      if (!findVerifiedHand(attempt.result, gameNumber, completedHandIndex)) {
        if (verified) {
          attempt.result = pinAuthorityContractFromVerifiedTranscript({
            result: attempt.result,
            run,
            transcript: verified.transcript,
          });
          attempt.result = writeVerifiedHand(attempt.result, verified.result);
        } else {
          await recordDailyFritzAdvanceWithoutVerification({
            attemptId,
            runDate: attempt.runDate,
            userId: authenticatedUserId,
            requestId: diagnostics.requestId,
            gameNumber,
            handIndex: completedHandIndex,
            verifierCode: verificationError!.code,
            operation: 'next-hand',
            message: verificationError!.message,
          });
          attempt.result = writeUnverifiedDailyFritzHand(attempt.result, {
            gameNumber,
            handIndex: completedHandIndex,
            verifierCode: verificationError!.code,
          });
        }
        attempt.result = writeActiveGameProgress(attempt.result, {
          gameNumber,
          you: progressScores.you,
          fritz: progressScores.fritz,
        });
        await upsertDailyFritzAttempt(attempt);
      }
      res.status(409).json({
        error: 'Daily Fritz game is complete; finalize the verified game.',
        unverified: !verified,
      });
      return;
    }

    if (verified) {
      attempt.result = pinAuthorityContractFromVerifiedTranscript({
        result: attempt.result,
        run,
        transcript: verified.transcript,
      });
      attempt.result = writeVerifiedHand(attempt.result, verified.result);
    } else {
      await recordDailyFritzAdvanceWithoutVerification({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        gameNumber,
        handIndex: completedHandIndex,
        verifierCode: verificationError!.code,
        operation: 'next-hand',
        message: verificationError!.message,
      });
      attempt.result = writeUnverifiedDailyFritzHand(attempt.result, {
        gameNumber,
        handIndex: completedHandIndex,
        verifierCode: verificationError!.code,
      });
    }
    attempt.result = writeActiveGameProgress(attempt.result, {
      gameNumber,
      you: progressScores.you,
      fritz: progressScores.fritz,
    });
    attempt.currentHandIndex += 1;
    let saved: DailyFritzAttemptRecord;
    const transactionalHand = Boolean(attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED);
    if (transactionalHand && verified) {
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: authenticatedUserId,
        attemptId: attempt.id,
        operationId: `hand:${gameNumber}:${completedHandIndex}`,
        commandType: 'accept_verified_hand',
        expectedRevision: attempt.revision,
        next: {
          status: 'started',
          currentGameNumber: gameNumber,
          currentHandIndex: attempt.currentHandIndex,
          result: attempt.result,
        },
        handReceipt: verified.result,
        outbox: {
          eventType: 'hand_verified',
          payload: {
            gameNumber,
            handIndex: completedHandIndex,
            transcriptDigest: verified.result.transcriptDigest,
          },
        },
      });
      if (command.outcome !== 'committed') {
        const recoverable = isRecoverableDailyFritzCommandConflict(command.errorCode);
        res.status(409).json({
          error: recoverable
            ? 'Daily Fritz advanced on another session. Resume from the authoritative state.'
            : 'Daily Fritz could not commit the verified hand.',
          code: command.errorCode ?? 'transactional_hand_commit_failed',
          recoverable,
          recovery_action: recoverable ? 'reload_official_hand' : null,
          authority_revision: command.committedRevision,
          authoritative_state: command.response,
        });
        return;
      }
      saved = await getDailyFritzAttemptById(attempt.id, authenticatedUserId)
        ?? (() => { throw new Error('Committed Daily Fritz hand was not readable.'); })();
      attempt.revision = saved.revision;
    } else {
      saved = await upsertDailyFritzAttempt(attempt);
    }
    if (verified) {
      incrementDailyFritzMetric('hand_verified');
      if (!transactionalHand) await recordDailyFritzEventBestEffort({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'hand_verified',
        gameNumber,
        handIndex: completedHandIndex,
        transcriptDigest: verified.result.transcriptDigest,
        idempotencyKey: `${attemptId}:hand_verified:${gameNumber}:${completedHandIndex}:${verified.result.transcriptDigest}`,
        payload: {
          actionCount: verified.result.actionCount,
          winner: verified.result.winner,
          playerScoreAfter: verified.result.playerScoreAfter,
          fritzScoreAfter: verified.result.fritzScoreAfter,
        },
      });
    }
    respondWithCurrentHand(saved.currentHandIndex, { unverified: !verified });
    });
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) {
      incrementDailyFritzMetric('verification_failed', error.code);
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'verification_failed',
        verifierCode: error.code,
        handIndex: completedHandIndex,
        idempotencyKey: `${attemptId || 'unknown'}:verification_failed:${diagnostics.requestId}`,
        payload: { operation: 'next-hand', message: error.message },
      });
    } else {
      incrementDailyFritzMetric('request_failed');
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'request_failed',
        statusCode: 500,
        idempotencyKey: `${attemptId || 'unknown'}:request_failed:next-hand:${diagnostics.requestId}`,
        payload: { operation: 'next-hand', message: error instanceof Error ? error.message : String(error) },
      });
    }
    if (respondVerificationError(res, error, { attemptId, handIndex: completedHandIndex })) return;
    log.warn({
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz-next-hand] error');
    capture500(error, { route: 'next-hand' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to advance Daily Fritz hand.'),
    });
  }
});
}
