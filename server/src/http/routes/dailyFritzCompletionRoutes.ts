import { createHash } from 'crypto';
import type { Application } from 'express';
import { getDailyFritzPublishedSetScore } from '../../dailyFritzSkunk';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import {
  getVerifiedSinglePlayerMatch,
  persistVerifiedSinglePlayerMatch,
} from '../../shared/verifiedSinglePlayerMatch';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  canFinalizeDailyFritzAttempt,
  getDailyFritzVerificationStatus,
  hasCompleteDailyFritzGameAuthority,
  readAuthorityLedger,
} from './dailyFritzVerificationPolicy';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import {
  buildDailyFritzLeaderboard,
  getDailyFritzAttemptById,
  getDailyFritzRun,
  getDailyFritzSetPointDiff,
  normalizeDailyFritzSetResult,
  upsertDailyFritzAttempt,
} from '../stores/dailyFritzStore';
import { commitDailyFritzAttemptCommand } from '../stores/dailyFritzCommandStore';
import {
  DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
  isRecoverableDailyFritzCommandConflict,
  recordDailyFritzEventBestEffort,
  rejectModernAttemptWhenAuthorityDisabled,
} from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';

export function registerDailyFritzCompletionRoutes(app: Application): void {
  app.post('/api/daily-fritz/complete', async (req, res) => {
  const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'complete');
  incrementDailyFritzMetric('mutation_request');
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const completionHash =
    typeof req.body?.completion_hash === 'string' ? req.body.completion_hash.trim() : '';

  if (!attemptId || !verifiedMatchId) {
    res.status(400).json({ error: 'attempt_id and verified_match_id are required.' });
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
    if (attempt.verifiedMatchId !== verifiedMatchId) {
      res.status(403).json({ error: 'Verified match does not match this attempt.' });
      return;
    }
    const runDate = attempt.runDate;
    const run = await getDailyFritzRun(runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    if (attempt.status === 'completed') {
      incrementDailyFritzMetric('retry_request');
      const replayVerificationStatus = getDailyFritzVerificationStatus(attempt.result);
      await recordDailyFritzEventBestEffort({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'attempt_completed',
        idempotencyKey: `${attemptId}:attempt_completed:replay:${diagnostics.requestId}`,
        payload: { replayed: true, verification_status: replayVerificationStatus },
      });
      const leaderboard = await buildDailyFritzLeaderboard(runDate);
      const isVerified = getDailyFritzVerificationStatus(attempt.result) === 'verified';
      const rank = isVerified
        ? leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null
        : null;
      res.json({
        ok: true,
        replayed: true,
        authority_revision: attempt.revision,
        rank,
        leaderboard_preview: leaderboard.slice(0, 10).map(({ userId: _userId, ...entry }) => entry),
      });
      return;
    }
    if (attempt.status !== 'started') {
      res.status(409).json({ error: 'Daily Fritz attempt is not active.' });
      return;
    }

    const setResult = normalizeDailyFritzSetResult(attempt.result);
    if (!setResult?.setWinner) {
      res.status(400).json({ error: 'Daily Fritz set is not complete.' });
      return;
    }
    const ledger = readAuthorityLedger(attempt.result);
    // A run that advanced any hand without a receipt stays unranked, even if
    // every other game produced a complete authority record.
    const isVerified = getDailyFritzVerificationStatus(attempt.result) !== 'rejected'
      && hasCompleteDailyFritzGameAuthority(attempt.result, setResult);
    const completionVerificationStatus = isVerified ? 'verified' : 'legacy_unverified';
    if (!canFinalizeDailyFritzAttempt(attempt.result, setResult)) {
      res.status(409).json({ error: 'Daily Fritz verification is incomplete.' });
      return;
    }
    const { finalScore, opponentScore } = getDailyFritzPublishedSetScore(setResult);
    const won = setResult.setWinner === 'player';
    const movesUsed = ledger.hands.reduce((sum, hand) => sum + hand.actionCount, 0);
    const handsPlayed = ledger.hands.length;
    const pointDiff = getDailyFritzSetPointDiff(setResult) ?? 0;
    const serverReceipt = createHash('sha256')
      .update(`${attempt.id}:${ledger.hands.map((hand) => hand.transcriptDigest).join(':')}`)
      .digest('hex');
    attempt.status = 'completed';
    attempt.completedAt = new Date().toISOString();
    attempt.completionHash = serverReceipt;
    attempt.finalScore = Math.round(finalScore);
    attempt.opponentScore = Math.round(opponentScore);
    attempt.pointDiff = Math.round(pointDiff);
    attempt.won = won;
    attempt.movesUsed = Math.round(movesUsed);
    attempt.handsPlayed = Math.round(handsPlayed);
    attempt.result = setResult
      ? {
          ...setResult,
          authority: ledger,
          verification_status: isVerified ? 'verified' : 'legacy_unverified',
          verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
          run_date: runDate,
          final_score: attempt.finalScore,
          opponent_score: attempt.opponentScore,
          point_diff: attempt.pointDiff,
          won,
          moves_used: attempt.movesUsed,
          hands_played: attempt.handsPlayed,
        }
      : {
          authority: ledger,
          verification_status: isVerified ? 'verified' : 'legacy_unverified',
          verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
          run_date: runDate,
          final_score: attempt.finalScore,
          opponent_score: attempt.opponentScore,
          point_diff: attempt.pointDiff,
          won,
          moves_used: attempt.movesUsed,
          hands_played: attempt.handsPlayed,
        };
    const transactionalCompletion = Boolean(
      attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
    );
    if (transactionalCompletion) {
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: authenticatedUserId,
        attemptId: attempt.id,
        operationId: 'finalize:set',
        commandType: 'finalize_verified_attempt',
        expectedRevision: attempt.revision,
        next: {
          status: 'completed',
          currentGameNumber: attempt.currentGameNumber,
          currentHandIndex: attempt.currentHandIndex,
          result: attempt.result ?? {},
          finalScore: attempt.finalScore,
          opponentScore: attempt.opponentScore,
          pointDiff: attempt.pointDiff,
          won: attempt.won,
          movesUsed: attempt.movesUsed,
          handsPlayed: attempt.handsPlayed,
          completionHash: serverReceipt,
        },
        outbox: {
          eventType: 'attempt_completed',
          payload: {
            verified: isVerified,
            verification_status: completionVerificationStatus,
            finalScore: attempt.finalScore,
            opponentScore: attempt.opponentScore,
            setOutcome: `${attempt.finalScore}-${attempt.opponentScore}`,
            setWinner: setResult?.setWinner ?? null,
            movesUsed: attempt.movesUsed,
            handsPlayed: attempt.handsPlayed,
          },
        },
      });
      if (command.outcome !== 'committed') {
        const recoverable = isRecoverableDailyFritzCommandConflict(command.errorCode);
        res.status(409).json({
          error: recoverable
            ? 'Daily Fritz completed on another session. Loading the authoritative result.'
            : 'Daily Fritz could not commit the verified completion.',
          code: command.errorCode ?? 'transactional_completion_failed',
          recoverable,
          recovery_action: recoverable ? 'reload_official_hand' : null,
          authority_revision: command.committedRevision,
          authoritative_state: command.response,
        });
        return;
      }
      attempt.revision = command.committedRevision ?? attempt.revision + 1;
    } else {
      await upsertDailyFritzAttempt(attempt);
    }
    incrementDailyFritzMetric('attempt_completed');
    if (!transactionalCompletion) await recordDailyFritzEventBestEffort({
      attemptId,
      runDate,
      userId: authenticatedUserId,
      requestId: diagnostics.requestId,
      eventType: 'attempt_completed',
      idempotencyKey: `${attemptId}:attempt_completed:${serverReceipt}`,
      payload: {
        verified: isVerified,
        verification_status: completionVerificationStatus,
        finalScore: attempt.finalScore,
        opponentScore: attempt.opponentScore,
        movesUsed: attempt.movesUsed,
        handsPlayed: attempt.handsPlayed,
      },
    });

    if (!transactionalCompletion) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(verifiedMatchId);
      if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
        verifiedMatch.status = 'completed';
        verifiedMatch.completedAt = attempt.completedAt;
        verifiedMatch.completionHash = serverReceipt;
        verifiedMatch.completionResult = attempt.result;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }

    const leaderboard = await buildDailyFritzLeaderboard(runDate);
    const rank = isVerified
      ? leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null
      : null;
    res.json({
      ok: true,
      authority_revision: attempt.revision,
      rank,
      leaderboard_preview: leaderboard.slice(0, 10).map(({ userId: _userId, ...entry }) => entry),
    });
    });
  } catch (error) {
    incrementDailyFritzMetric('request_failed');
    await recordDailyFritzEventBestEffort({
      attemptId: attemptId || null,
      requestId: diagnostics.requestId,
      eventType: 'request_failed',
      statusCode: 500,
      idempotencyKey: `${attemptId || 'unknown'}:request_failed:complete:${diagnostics.requestId}`,
      payload: { operation: 'complete', message: error instanceof Error ? error.message : String(error) },
    });
    capture500(error, { route: 'complete' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to complete Daily Fritz attempt.'),
    });
  }
});

  app.post('/api/daily-fritz/abandon', async (req, res) => {
  const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'abandon');
  incrementDailyFritzMetric('mutation_request');
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  if (!attemptId) {
    res.status(400).json({ error: 'attempt_id is required.' });
    return;
  }
  try {
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
    const runDate = attempt.runDate;
    if (attempt.status === 'abandoned') {
      res.json({ ok: true, replayed: true, authority_revision: attempt.revision });
      return;
    }
    if (attempt.status === 'completed') {
      res.status(409).json({ error: 'Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    attempt.status = 'abandoned';
    attempt.completedAt = new Date().toISOString();
    const transactionalAbandon = Boolean(
      attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
    );
    if (transactionalAbandon) {
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: authenticatedUserId,
        attemptId: attempt.id,
        operationId: 'abandon:set',
        commandType: 'abandon_attempt',
        expectedRevision: attempt.revision,
        next: {
          status: 'abandoned',
          currentGameNumber: attempt.currentGameNumber,
          currentHandIndex: attempt.currentHandIndex,
          result: attempt.result ?? {},
        },
        outbox: {
          eventType: 'attempt_abandoned',
          payload: { previousRevision: attempt.revision },
        },
      });
      if (command.outcome !== 'committed') {
        const recoverable = isRecoverableDailyFritzCommandConflict(command.errorCode);
        res.status(409).json({
          error: recoverable
            ? 'Daily Fritz changed on another session. Loading the authoritative state.'
            : 'Daily Fritz could not commit the abandonment.',
          code: command.errorCode ?? 'transactional_abandon_failed',
          recoverable,
          recovery_action: recoverable ? 'reload_official_hand' : null,
          authority_revision: command.committedRevision,
          authoritative_state: command.response,
        });
        return;
      }
      attempt.revision = command.committedRevision ?? attempt.revision + 1;
    } else {
      await upsertDailyFritzAttempt(attempt);
    }
    incrementDailyFritzMetric('attempt_abandoned');
    if (!transactionalAbandon) await recordDailyFritzEventBestEffort({
      attemptId,
      runDate,
      userId: authenticatedUserId,
      requestId: diagnostics.requestId,
      eventType: 'attempt_abandoned',
      idempotencyKey: `${attemptId}:attempt_abandoned`,
      payload: { completedAt: attempt.completedAt },
    });
    if (!transactionalAbandon && attempt.verifiedMatchId) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(attempt.verifiedMatchId);
      if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
        verifiedMatch.status = 'abandoned';
        verifiedMatch.completedAt = attempt.completedAt;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }
    res.json({ ok: true, authority_revision: attempt.revision });
  } catch (error) {
    incrementDailyFritzMetric('request_failed');
    await recordDailyFritzEventBestEffort({
      attemptId: attemptId || null,
      requestId: diagnostics.requestId,
      eventType: 'request_failed',
      statusCode: 500,
      idempotencyKey: `${attemptId || 'unknown'}:request_failed:abandon:${diagnostics.requestId}`,
      payload: { operation: 'abandon', message: error instanceof Error ? error.message : String(error) },
    });
    capture500(error, { route: 'abandon' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to abandon Daily Fritz attempt.'),
    });
   }
});
}
