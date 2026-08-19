import { randomUUID } from 'crypto';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
} from '@racehorse/game-core';
import type { Application } from 'express';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { setPrivateShortCache } from './cacheControl';
import { getPacificDateKey } from '../../shared/pacificDate';
import { buildDailyFritzChallengeId, DAILY_FRITZ_RULES_VERSION, DAILY_FRITZ_SEED_VERSION, DAILY_FRITZ_TIME_ZONE } from '../../dailyFritzIdentity';
import {
  buildDailyFritzLeaderboard,
  dailyFritzRunCache,
  ensureDailyFritzRunForDate,
  getCurrentDailyFritzGameNumber,
  getDailyFritzAttempt,
  getDailyFritzRunSummary,
  getDailyFritzStreak,
  normalizeDailyFritzSetResult,
  listDailyFritzAttemptsForUser,
} from '../stores/dailyFritzStore';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  getDailyFritzVerificationStatus,
  readDailyFritzAuthorityContract,
} from './dailyFritzVerificationPolicy';
import { DAILY_FRITZ_COMPETITIVE_VERIFICATION_AVAILABLE } from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';
import { readDailyFritzActiveCheckpoint } from './dailyFritzCheckpointPolicy';
import { resolveDailyFritzClientNextAction } from './dailyFritzClientPhase';

export function registerDailyFritzTodayRoutes(app: Application): void {
  app.get('/api/daily-fritz/history', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const attempts = await listDailyFritzAttemptsForUser(userId, Number(req.query.limit ?? 10));
      setPrivateShortCache(res, 60);
      res.json({ ok: true, results: attempts.map((attempt) => ({ challenge_date: attempt.runDate, player_score: attempt.finalScore ?? 0, fritz_score: attempt.opponentScore ?? 0, won: attempt.won === true, completed_at: attempt.completedAt, verification_status: getDailyFritzVerificationStatus(attempt.result) })) });
    } catch (error) {
      capture500(error, { route: 'history' });
      res.status(500).json({ error: prodSafeError(error, 'Daily Fritz history is unavailable.') });
    }
  });
  app.get('/api/daily-fritz/today', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  const allowsTestFixtureDate = process.env.NODE_ENV !== 'production'
    && process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED === 'true';
  let initUserId: string | null = null;
  let initRunDate: string | null = null;
  const mark = (label: string, startedAt: number, extra?: Record<string, unknown>) => {
    const now = Date.now();
    log.info({
      requestId,
      label,
      ms: now - startedAt,
      totalMs: now - requestStartedAt,
      ...extra,
    }, '[daily-fritz-server] today');
  };
  try {
    log.info({
      requestId,
      label: 'entry',
      totalMs: 0,
      method: req.method,
      path: req.path,
    }, '[daily-fritz-server] today');

    const authStartedAt = Date.now();
    const authenticatedUserId = await getAuthenticatedUserId(req);
    mark('auth', authStartedAt, { authenticated: Boolean(authenticatedUserId) });
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const dateCalcStartedAt = Date.now();
    const requestedDebugDate = typeof req.query.debugDate === 'string' ? req.query.debugDate.trim() : '';
    if (requestedDebugDate && !allowsTestFixtureDate) {
      res.status(400).json({ error: 'debugDate requires an enabled non-production fixture environment.' });
      return;
    }
    if (requestedDebugDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDebugDate)) {
      res.status(400).json({ error: 'debugDate must be in YYYY-MM-DD format.' });
      return;
    }
    const runDate = requestedDebugDate || getPacificDateKey();
    initUserId = authenticatedUserId;
    initRunDate = runDate;
    log.info({ userId: authenticatedUserId, date: runDate }, '[daily-fritz:init] request');
    mark('dateKey', dateCalcStartedAt, {
      runDate,
      usedDebugDate: Boolean(requestedDebugDate),
    });

    const cacheProbeStartedAt = Date.now();
    const hadCachedRun = dailyFritzRunCache.has(runDate);
    mark('cacheProbe', cacheProbeStartedAt, { runDate, hadCachedRun });

    const runSummaryStartedAt = Date.now();
    let run = await getDailyFritzRunSummary(runDate);
    mark('getDailyFritzRunSummary', runSummaryStartedAt, {
      runDate,
      cacheHit: Boolean(run),
      hadCachedRun,
    });
    if (!run) {
      const ensureStartedAt = Date.now();
      const generated = await ensureDailyFritzRunForDate(
        runDate,
        undefined,
        {
          requestId,
          log: (label, ms, extra) => {
            log.info({
              requestId,
              label,
              ms,
              totalMs: Date.now() - requestStartedAt,
              ...extra,
            }, '[daily-fritz-server] today');
          },
        },
      );
      mark('ensureDailyFritzRunForDate', ensureStartedAt, {
        runDate,
        generated: Boolean(generated),
      });
      if (generated) {
        log.info({ userId: authenticatedUserId, date: runDate }, '[daily-fritz:init] created-new');
      }
      run = generated
        ? {
            runDate: generated.runDate,
            fritzTier: generated.fritzTier,
            dealSize: generated.dealSize,
            winningScore: generated.winningScore,
            status: generated.status,
          }
        : null;
    }
    if (!run) {
      res.status(500).json({ error: 'Daily Fritz storage is not available.' });
      return;
    }
    if (run.status === 'invalidated') {
      res.status(409).json({ error: 'Today’s Daily Fritz run was invalidated.', runDate, status: run.status });
      return;
    }

    const userStateStartedAt = Date.now();
    const attemptPromiseStartedAt = Date.now();
    const streakPromiseStartedAt = Date.now();
    const [attempt, streak] = await Promise.all([
      getDailyFritzAttempt(runDate, authenticatedUserId).then((value) => {
        mark('getDailyFritzAttempt', attemptPromiseStartedAt, {
          runDate,
          status: value?.status ?? 'none',
        });
        return value;
      }),
      getDailyFritzStreak(authenticatedUserId, runDate).then((value) => {
        mark('getDailyFritzStreak', streakPromiseStartedAt, {
          runDate,
          streak: value,
        });
        return value;
      }),
    ]);
    mark('userStateCombined', userStateStartedAt, { runDate });
    if (attempt) {
      log.info({
        userId: authenticatedUserId,
        date: runDate,
        phase: attempt.status,
      }, '[daily-fritz:init] loaded-existing');
    }
    const attemptSetResult = attempt ? normalizeDailyFritzSetResult(attempt.result) : null;
    const attemptAuthorityContract = readDailyFritzAuthorityContract(attempt?.result ?? null);
    const needsCompletion = attempt?.status === 'started' && Boolean(attemptSetResult?.setWinner);
    let ownRank: number | null = null;
    if (attempt?.status === 'completed') {
      const leaderboardStartedAt = Date.now();
      const leaderboard = await buildDailyFritzLeaderboard(runDate);
      mark('buildDailyFritzLeaderboard', leaderboardStartedAt, {
        runDate,
        entryCount: leaderboard.length,
      });
      ownRank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
    }

    const serializeStartedAt = Date.now();
    const activeCheckpoint = attempt ? readDailyFritzActiveCheckpoint(attempt.result) : null;
    const hasResumeCheckpoint = Boolean(
      activeCheckpoint
      && attempt
      && activeCheckpoint.currentHandIndex === attempt.currentHandIndex
      && activeCheckpoint.authorityRevision === attempt.revision,
    );
    const nextAction = resolveDailyFritzClientNextAction({
      attemptStatus: attempt?.status ?? null,
      setResult: attemptSetResult,
      needsCompletion,
      currentHandIndex: attempt?.currentHandIndex ?? 0,
      hasResumeCheckpoint,
    });
    const payload = {
      ok: true,
      run_date: run.runDate,
      challenge_id: buildDailyFritzChallengeId(run.runDate),
      rules_version: DAILY_FRITZ_RULES_VERSION,
      seed_version: DAILY_FRITZ_SEED_VERSION,
      time_zone: DAILY_FRITZ_TIME_ZONE,
      fritz_tier: run.fritzTier,
      deal_size: run.dealSize,
      winning_score: run.winningScore,
      attempt_status: attempt?.status ?? 'none',
      authority_revision: attempt?.revision ?? null,
      next_action: nextAction,
      verification_protocol_version:
        attemptAuthorityContract?.transcriptProtocolVersion
        ?? DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
      game_rules_version: attemptAuthorityContract?.gameRulesVersion ?? GAME_RULES_VERSION,
      fritz_policy_version: attemptAuthorityContract?.fritzPolicyVersion ?? FRITZ_POLICY_VERSION,
      fritz_policy_contract:
        attemptAuthorityContract?.fritzPolicyContract
        ?? getFritzPolicyContract(FRITZ_POLICY_VERSION),
      state_digest_version: attemptAuthorityContract?.stateDigestVersion ?? 1,
      state_digest_required: attemptAuthorityContract?.stateDigestRequired ?? true,
      verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
      competitive_verification_available: DAILY_FRITZ_COMPETITIVE_VERIFICATION_AVAILABLE,
      verification_status: getDailyFritzVerificationStatus(attempt?.result ?? null),
      current_game_number:
        attempt?.status === 'started' && !needsCompletion
          ? getCurrentDailyFritzGameNumber(attempt.result)
          : null,
      needs_completion: needsCompletion,
      streak,
      result: attempt?.status === 'completed' ? attempt.result : null,
      set_result: attemptSetResult,
      rank: ownRank,
      leaderboard_preview: [],
    };
    mark('serializeResponse', serializeStartedAt, {
      runDate,
      payloadKeys: Object.keys(payload).length,
    });
    log.info({
      requestId,
      label: 'response',
      totalMs: Date.now() - requestStartedAt,
      attemptStatus: attempt?.status ?? 'none',
      runDate,
      hadCachedRun,
      cacheMiss: !hadCachedRun,
    }, '[daily-fritz-server] today');
    res.json(payload);
  } catch (error) {
    log.error({
      userId: initUserId,
      date: initRunDate ?? getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz:init] error');
    capture500(error, { route: 'today' });
    res.status(500).json({
      error: prodSafeError(error, "Failed to load today's Daily Fritz run."),
    });
  }
});
}
