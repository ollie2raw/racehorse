import type { Application } from 'express';
import {
  generateDailyFritzRun,
  getDailyFritzSeed,
} from '../../dailyFritz';
import { isAdminSecret } from '../../platform/auth/adminSecret';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { supabaseFetch } from '../../supabaseUtils';
import { setPublicShortCache } from './cacheControl';
import {
  getVerifiedSinglePlayerMatch,
  persistVerifiedSinglePlayerMatch,
} from '../../shared/verifiedSinglePlayerMatch';
import {
  buildDailyFritzLeaderboard,
  dailyFritzRunCache,
  getDailyFritzAttempt,
  getDailyFritzAttemptById,
  getDailyFritzRun,
  normalizeDailyFritzTier,
  upsertDailyFritzRun,
} from '../stores/dailyFritzStore';
import { listDailyFritzEvents, listDailyFritzPersistedMetrics, recordDailyFritzEvent } from '../stores/dailyFritzEventStore';
import {
  buildDailyFritzHealthDeltas,
  formatDailyFritzRunDatePacific,
  listDailyFritzHealthSummary,
  previousDailyFritzRunDate,
} from '../stores/dailyFritzHealthSummary';
import { evaluateDailyFritzHealthStatus } from './dailyFritzHealthPolicy';
import { getDailyFritzMetricRates, getDailyFritzMetrics, incrementDailyFritzMetric } from './dailyFritzMetrics';
import { buildDailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';
import {
  getDailyFritzPublishedChallenge,
  invalidateDailyFritzPublishedChallenge,
  publishDailyFritzChallenge,
} from '../stores/dailyFritzPublishedChallengeStore';
import { isDailyFritzEventType } from '../../dailyFritzTelemetry';
import { DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED } from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';

export function registerDailyFritzAdminRoutes(app: Application): void {
  app.post('/api/daily-fritz/telemetry', async (req, res) => {
  const authenticatedUserId = await getAuthenticatedUserId(req);
  if (!authenticatedUserId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const eventType = req.body?.event_type;
  const eventId = typeof req.body?.event_id === 'string' ? req.body.event_id.trim() : '';
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const clientEvents = new Set([
    'mode_impression', 'start_requested', 'first_move',
    'recovery_started', 'recovery_succeeded', 'recovery_failed',
    'review_opened', 'leaderboard_opened', 'share_requested', 'share_completed',
  ]);
  if (!isDailyFritzEventType(eventType) || !clientEvents.has(eventType) || eventId.length < 8 || eventId.length > 160) {
    res.status(400).json({ error: 'A valid Daily Fritz client event and event_id are required.' });
    return;
  }
  const attempt = attemptId
    ? await getDailyFritzAttemptById(attemptId, authenticatedUserId)
    : null;
  if (attemptId && !attempt) {
    res.status(404).json({ error: 'Daily Fritz attempt not found.' });
    return;
  }
  const payload = req.body?.payload && typeof req.body.payload === 'object'
    ? req.body.payload as Record<string, unknown>
    : {};
  if (JSON.stringify(payload).length > 4_096) {
    res.status(413).json({ error: 'Daily Fritz telemetry payload is too large.' });
    return;
  }
  try {
    await recordDailyFritzEvent({
      attemptId: attempt?.id ?? null,
      runDate: attempt?.runDate
        ?? (typeof req.body?.run_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.run_date)
          ? req.body.run_date : null),
      userId: authenticatedUserId,
      eventType,
      idempotencyKey: `client:${authenticatedUserId}:${eventId}`,
      challengeId: attempt?.challengeId
        ?? (typeof req.body?.challenge_id === 'string' ? req.body.challenge_id.slice(0, 200) : null),
      authorityRevision: attempt?.revision ?? null,
      source: 'client',
      sessionId: typeof req.body?.session_id === 'string' ? req.body.session_id.slice(0, 160) : null,
      clientRelease: typeof req.body?.client_release === 'string' ? req.body.client_release.slice(0, 120) : null,
      durationMs: Number.isInteger(req.body?.duration_ms) && req.body.duration_ms >= 0
        ? Math.min(req.body.duration_ms, 86_400_000) : null,
      verifierCode: typeof req.body?.failure_code === 'string' ? req.body.failure_code.slice(0, 120) : null,
      payload,
    });
    res.status(202).json({ ok: true });
  } catch (error) {
    incrementDailyFritzMetric('event_persistence_failed');
    res.status(503).json({ error: 'Daily Fritz telemetry is temporarily unavailable.' });
  }
  });

  app.get('/api/daily-fritz/metrics', async (req, res) => {
  // AU-6 (HARDENING_PLAN §6.3): header-only. The admin UI already sends the
  // secret exclusively via `x-admin-secret`; accepting it as a `?admin_key=`
  // query param leaked it into access logs, browser history, and Referer.
  const suppliedAdminSecret = req.get('x-admin-secret');
  if (!isAdminSecret(suppliedAdminSecret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  let persistedMetrics: Awaited<ReturnType<typeof listDailyFritzPersistedMetrics>> | null = null;
  try {
    persistedMetrics = await listDailyFritzPersistedMetrics();
  } catch (error) {
    log.warn({
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz-metrics] persisted metrics unavailable');
  }
  res.json({
    ok: true,
    metrics: getDailyFritzMetrics(),
    rates: getDailyFritzMetricRates(),
    persisted_metrics: persistedMetrics,
  });
  });

  app.get('/api/daily-fritz/health', async (req, res) => {
    // AU-6 (HARDENING_PLAN §6.3): header-only — see /metrics above.
    const suppliedAdminSecret = req.get('x-admin-secret');
    if (!isAdminSecret(suppliedAdminSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const requestedRunDate = typeof req.query.run_date === 'string' ? req.query.run_date.trim() : '';
    const runDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedRunDate)
      ? requestedRunDate
      : formatDailyFritzRunDatePacific();
    const comparedTo = previousDailyFritzRunDate(runDate);
    try {
      const todaySummary = await listDailyFritzHealthSummary(runDate);
      const yesterdaySummary = await listDailyFritzHealthSummary(comparedTo);
      const deltas = buildDailyFritzHealthDeltas(todaySummary.metrics, yesterdaySummary.metrics);
      const status = evaluateDailyFritzHealthStatus(
        todaySummary.metrics,
        yesterdaySummary.metrics,
        deltas,
      );
      res.json({
        ok: true,
        run_date: runDate,
        compared_to: comparedTo,
        status,
        today: todaySummary.metrics,
        yesterday: yesterdaySummary.metrics,
        deltas,
        top_failures: todaySummary.topFailures,
      });
    } catch (error) {
      capture500(error, { route: 'health' });
      res.status(500).json({
        error: prodSafeError(error, 'Daily Fritz health summary is unavailable.'),
      });
    }
  });

  app.get('/api/daily-fritz/events/:attemptId', async (req, res) => {
  // AU-6 (HARDENING_PLAN §6.3): header-only — see /metrics above.
  const suppliedAdminSecret = req.get('x-admin-secret');
  if (!isAdminSecret(suppliedAdminSecret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const events = await listDailyFritzEvents(req.params.attemptId, Number(req.query.limit ?? 200));
    res.json({ ok: true, attempt_id: req.params.attemptId, events });
  } catch (error) {
    capture500(error, { route: 'events' });
    res.status(500).json({
      error: prodSafeError(error, 'Daily Fritz event history is unavailable.'),
    });
  }
});

  app.get('/api/daily-fritz/leaderboard/:date', async (req, res) => {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDate = typeof req.params.date === 'string' ? req.params.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      res.status(400).json({ error: 'Valid date is required.' });
      return;
    }
    const leaderboard = await buildDailyFritzLeaderboard(runDate);
    setPublicShortCache(res, 60, 300);
    res.json({
      ok: true,
      run_date: runDate,
      leaderboard: leaderboard.map(({ userId, ...entry }) => ({
        ...entry,
        is_current_user: userId === authenticatedUserId,
      })),
    });
  } catch (error) {
    capture500(error, { route: 'leaderboard' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to load Daily Fritz leaderboard.'),
    });
  }
});

  app.post('/api/daily-fritz/generate', async (req, res) => {
  // AU-6 (HARDENING_PLAN §6.3 / §13.1.6): header-only, matching /metrics,
  // /health, and /events above — a body-param secret was the one remaining
  // inconsistency across this file's admin routes.
  if (!isAdminSecret(req.get('x-admin-secret'))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const fritzTier = normalizeDailyFritzTier(req.body?.fritz_tier);
  const dealSize = Number(req.body?.deal_size) === 14 ? 14 : Number(req.body?.deal_size) === 7 ? 7 : null;
  const winningScore = Number(req.body?.winning_score);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || !fritzTier || !dealSize || !Number.isFinite(winningScore)) {
    res.status(400).json({ error: 'run_date, fritz_tier, deal_size, and winning_score are required.' });
    return;
  }
  try {
    const existing = await getDailyFritzRun(runDate);
    if (existing?.status === 'live') {
      res.status(409).json({
        error: 'A live Daily Fritz run already exists for this date. Invalidate it before regenerating.',
        run_date: runDate,
        status: existing.status,
      });
      return;
    }
    // Guardrail #7 / INV-19: this route deliberately does NOT reuse an existing
    // published challenge — regenerate means "produce a new artifact". But a
    // published-challenge row is content-addressed and immutable, and its
    // challenge_id is a pure function of run_date/rules/seed (no generation
    // counter), so an in-place regenerate for a date that already has one is not
    // expressible — publishDailyFritzChallenge would hit
    // daily_fritz_challenge_identity_conflict. Surface that as a clear 409 here
    // rather than an opaque 500 from the RPC. (This is the one publish call site
    // that is not reuse-first; INV-19 is satisfied by the getDailyFritzPublishedChallenge
    // reference in this file, added for /invalidate below.)
    if (DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) {
      const publishedChallengeId = buildDailyFritzPublishedChallenge({
        runDate,
        fritzTier,
        dealSize,
        winningScore: Math.round(winningScore),
      }).challengeId;
      const alreadyPublished = await getDailyFritzPublishedChallenge(publishedChallengeId);
      if (alreadyPublished) {
        res.status(409).json({
          error:
            'A published Daily Fritz challenge already exists for this date. Its content is frozen; '
            + 'regenerating a different challenge for the same date is not supported.',
          run_date: runDate,
          challenge_id: alreadyPublished.challengeId,
          status: alreadyPublished.status,
        });
        return;
      }
    }
    const generated = generateDailyFritzRun(runDate, fritzTier, dealSize, Math.round(winningScore));
    const saved = await upsertDailyFritzRun({
      runDate: generated.runDate,
      seed: generated.seed,
      fritzTier: generated.fritzTier,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      status: generated.status,
      handDeals: generated.handDeals,
      generatedAt: generated.generatedAt,
      invalidatedAt: generated.invalidatedAt,
      metadata: generated.metadata,
    });
    if (DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) {
      await publishDailyFritzChallenge(buildDailyFritzPublishedChallenge({
        runDate: saved.runDate,
        fritzTier: saved.fritzTier,
        dealSize: saved.dealSize,
        winningScore: saved.winningScore,
        publishedAt: saved.generatedAt,
      }));
    }
    res.json({ ok: true, run_date: saved.runDate, seed: getDailyFritzSeed(saved.runDate) });
  } catch (error) {
    capture500(error, { route: 'generate' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to generate Daily Fritz run.'),
    });
  }
});

  app.post('/api/daily-fritz/invalidate', async (req, res) => {
  // AU-6 (HARDENING_PLAN §6.3 / §13.1.6): header-only, same as /generate above.
  if (!isAdminSecret(req.get('x-admin-secret'))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    res.status(400).json({ error: 'run_date is required.' });
    return;
  }
  try {
    const run = await getDailyFritzRun(runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    if (!DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) {
      run.status = 'invalidated';
      run.invalidatedAt = new Date().toISOString();
      run.metadata = { ...(run.metadata ?? {}), invalidation_reason: reason || null };
      await upsertDailyFritzRun(run);
      res.json({ ok: true, status: run.status });
      return;
    }
    // Materialize the published-challenge row only if pre-generation never ran
    // for this date — otherwise reuse the existing (immutable) row as-is.
    // Guardrail #7 / INV-19: a blind publish here re-derives under current
    // constants and would raise daily_fritz_challenge_identity_conflict against a
    // row whose version stamp has since drifted — i.e. you could not invalidate a
    // stale challenge, the one operation you most need to work.
    const built = buildDailyFritzPublishedChallenge({
      runDate: run.runDate,
      fritzTier: run.fritzTier,
      dealSize: run.dealSize,
      winningScore: run.winningScore,
      publishedAt: run.generatedAt,
    });
    const existingPublished = await getDailyFritzPublishedChallenge(built.challengeId);
    if (!existingPublished) {
      await publishDailyFritzChallenge(built);
    }
    const invalidated = await invalidateDailyFritzPublishedChallenge(runDate, reason);
    dailyFritzRunCache.delete(runDate);
    res.json({ ok: true, challenge_id: invalidated.challengeId, status: invalidated.status });
  } catch (error) {
    capture500(error, { route: 'invalidate' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to invalidate Daily Fritz run.'),
    });
  }
});

  app.post('/api/daily-fritz/reset-attempt', async (req, res) => {
  // AU-6 (HARDENING_PLAN §6.3 / §13.1.6): header-only, same as /generate above.
  if (!isAdminSecret(req.get('x-admin-secret'))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const userId = typeof req.body?.user_id === 'string' ? req.body.user_id.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || !userId) {
    res.status(400).json({ error: 'run_date and user_id are required.' });
    return;
  }
  try {
    const attempt = await getDailyFritzAttempt(runDate, userId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    await supabaseFetch(`/rest/v1/daily_fritz_attempts?id=eq.${encodeURIComponent(attempt.id)}`, {
      method: 'DELETE',
    });
    if (attempt.verifiedMatchId) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(attempt.verifiedMatchId);
      if (verifiedMatch) {
        verifiedMatch.status = 'abandoned';
        verifiedMatch.completedAt = new Date().toISOString();
        verifiedMatch.completionResult = reason ? { reset_reason: reason } : null;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    capture500(error, { route: 'reset-attempt' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to reset Daily Fritz attempt.'),
    });
  }
});
}
