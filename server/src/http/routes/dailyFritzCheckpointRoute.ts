import type { Application } from 'express';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import {
  getDailyFritzAttemptById,
  upsertDailyFritzAttempt,
} from '../stores/dailyFritzStore';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import { recordDailyFritzEventBestEffort } from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';
import {
  parseDailyFritzServerCheckpoint,
  readDailyFritzActiveCheckpoint,
  validateDailyFritzCheckpointWrite,
  writeDailyFritzActiveCheckpoint,
} from './dailyFritzCheckpointPolicy';

export function registerDailyFritzCheckpointRoute(app: Application): void {
  app.post('/api/daily-fritz/checkpoint', async (req, res) => {
    const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'checkpoint');
    incrementDailyFritzMetric('mutation_request');
    const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
    const verifiedMatchId =
      typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
    const checkpointInput = req.body?.checkpoint;
    if (!attemptId || !verifiedMatchId || checkpointInput == null) {
      res.status(400).json({
        error: 'attempt_id, verified_match_id, and checkpoint are required.',
      });
      return;
    }

    try {
      await withDailyFritzAttemptLock(attemptId, async () => {
        const authenticatedUserId = await getAuthenticatedUserId(req);
        if (!authenticatedUserId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const checkpoint = parseDailyFritzServerCheckpoint(checkpointInput);
        if (!checkpoint) {
          res.status(400).json({ error: 'Invalid Daily Fritz checkpoint payload.', code: 'malformed_checkpoint' });
          return;
        }

        const attempt = await getDailyFritzAttemptById(attemptId, authenticatedUserId);
        if (!attempt) {
          res.status(404).json({ error: 'Daily Fritz attempt not found.' });
          return;
        }

        const existing = readDailyFritzActiveCheckpoint(attempt.result);
        const validation = validateDailyFritzCheckpointWrite(
          attempt,
          verifiedMatchId,
          checkpoint,
          existing,
        );
        if (!validation.ok) {
          const status = validation.reason === 'stale_checkpoint' ? 409 : 422;
          res.status(status).json({
            error: 'Daily Fritz checkpoint rejected.',
            code: validation.reason,
            checkpoint_revision: existing?.checkpointRevision ?? null,
          });
          return;
        }

        attempt.result = writeDailyFritzActiveCheckpoint(attempt.result, checkpoint);
        const saved = await upsertDailyFritzAttempt(attempt);
        const stored = readDailyFritzActiveCheckpoint(saved.result);
        await recordDailyFritzEventBestEffort({
          attemptId: attempt.id,
          runDate: attempt.runDate,
          userId: authenticatedUserId,
          requestId: diagnostics.requestId,
          eventType: 'checkpoint_saved',
          idempotencyKey: `${attempt.id}:checkpoint:${checkpoint.checkpointRevision}`,
          payload: {
            gameNumber: checkpoint.gameNumber,
            handIndex: checkpoint.currentHandIndex,
            checkpointRevision: checkpoint.checkpointRevision,
            lifecyclePhase: checkpoint.lifecyclePhase,
          },
        });
        incrementDailyFritzMetric('checkpoint_saved');
        log.info({
          attemptId,
          checkpointRevision: checkpoint.checkpointRevision,
          handIndex: checkpoint.currentHandIndex,
        }, '[daily-fritz:checkpoint] saved');
        res.json({
          ok: true,
          checkpoint_revision: stored?.checkpointRevision ?? checkpoint.checkpointRevision,
          authority_revision: saved.revision,
        });
      });
    } catch (error) {
      log.error({
        attemptId,
        error: error instanceof Error ? error.message : String(error),
      }, '[daily-fritz:checkpoint] error');
      capture500(error, { route: 'checkpoint' });
      res.status(500).json({
        error: prodSafeError(error, 'Failed to save Daily Fritz checkpoint.'),
      });
    }
  });
}
