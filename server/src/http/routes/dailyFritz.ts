import { createHash, randomUUID } from 'crypto';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
  parseDailyFritzTranscript,
} from '@racehorse/game-core';
import type { Application, Response } from 'express';
import {
  generateDailyFritzRun,
  getDailyFritzGameSeed,
  getDailyFritzSeed,
  resolveDailyFritzDrawTiles,
  resolveDailyFritzDrawWinner,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
} from '../../dailyFritz';
import { appendDailyFritzGameToSet } from '../../dailyFritzSkunk';
import { isAdminSecret } from '../../platform/auth/adminSecret';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { writeDailyFritzGameActivity } from '../../social/activityWriter';
import { supabaseFetch } from '../../supabaseUtils';
import { getFritzIdentityForTier } from '../../shared/fritzMatchLifecycle';
import { getPacificDateKey } from '../../shared/pacificDate';
import { buildDailyFritzChallengeId, DAILY_FRITZ_RULES_VERSION, DAILY_FRITZ_SEED_VERSION, DAILY_FRITZ_TIME_ZONE } from '../../dailyFritzIdentity';
import {
  getVerifiedSinglePlayerMatch,
  persistVerifiedSinglePlayerMatch,
  startVerifiedSinglePlayerMatch,
} from '../../shared/verifiedSinglePlayerMatch';
import {
  buildDailyFritzLeaderboard,
  buildDailyFritzRunFingerprint,
  createDailyFritzAttempt,
  dailyFritzRunCache,
  ensureDailyFritzRunForDate,
  getCurrentDailyFritzGameNumber,
  getDailyFritzAttempt,
  getDailyFritzAttemptById,
  getDailyFritzHandForGame,
  getDailyFritzRun,
  getDailyFritzRunSummary,
  getDailyFritzSetPointDiff,
  getDailyFritzStreak,
  normalizeDailyFritzSetGameNumber,
  normalizeDailyFritzSetResult,
  normalizeDailyFritzTier,
  listDailyFritzAttemptsForUser,
  upsertDailyFritzAttempt,
  upsertDailyFritzRun,
  type DailyFritzAttemptRecord,
  type DailyFritzRunRecord,
} from '../stores/dailyFritzStore';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  digestDailyFritzTranscript,
  verifyDailyFritzHand,
  type VerifiedDailyFritzHandRecord,
} from '../../dailyFritzVerifier';
import { withDailyFritzAttemptLock } from '../../dailyFritzAttemptLock';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  buildRecordedDailyFritzAttemptResult,
  canFinalizeDailyFritzAttempt,
  getDailyFritzVerificationStatus,
  hasCompleteDailyFritzGameAuthority,
  hasPriorDailyFritzGameAuthority,
  isIdenticalDailyFritzGameReplay,
  readAuthorityLedger,
  buildDailyFritzAuthorityContract,
  clientSupportsDailyFritzAuthorityContract,
  readDailyFritzAuthorityContract,
  writeDailyFritzAuthorityContract,
  requiresVerifiedDailyFritzEvidence,
  type VerifiedDailyFritzGameRecord,
} from './dailyFritzVerificationPolicy';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { listDailyFritzEvents, listDailyFritzPersistedMetrics, recordDailyFritzEvent, type DailyFritzEventInput } from '../stores/dailyFritzEventStore';
import { getDailyFritzMetricRates, getDailyFritzMetrics, incrementDailyFritzMetric } from './dailyFritzMetrics';
import {
  buildDailyFritzPublishedChallenge,
  canonicalizeDailyFritzChallenge,
} from '../../dailyFritzPublishedChallenge';
import {
  invalidateDailyFritzPublishedChallenge,
  publishDailyFritzChallenge,
} from '../stores/dailyFritzPublishedChallengeStore';
import {
  commitDailyFritzAttemptCommand,
  startDailyFritzAttemptCommand,
} from '../stores/dailyFritzCommandStore';
import { isDailyFritzEventType } from '../../dailyFritzTelemetry';
import { isDailyFritzTransactionalAuthorityEnabled } from '../../dailyFritzAuthorityFeature';
import type { DailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';
import {
  loadDailyFritzPublishedAuthority,
  resolveDailyFritzPublishedGameAuthority,
} from './dailyFritzPublishedAuthority';

export {
  buildRecordedDailyFritzAttemptResult,
  canFinalizeDailyFritzAttempt,
  hasCompleteDailyFritzGameAuthority,
  hasPriorDailyFritzGameAuthority,
  isIdenticalDailyFritzGameReplay,
  requiresVerifiedDailyFritzEvidence,
} from './dailyFritzVerificationPolicy';

async function recordDailyFritzEventBestEffort(event: DailyFritzEventInput): Promise<void> {
  try {
    await recordDailyFritzEvent(event);
  } catch (error) {
    incrementDailyFritzMetric('event_persistence_failed');
    console.error('[daily-fritz-event] persistence failed', {
      eventType: event.eventType,
      attemptId: event.attemptId ?? null,
      idempotencyKey: event.idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type DailyFritzActiveGameProgress = { gameNumber: DailyFritzSetGameNumber; you: number; fritz: number };
const DAILY_FRITZ_COMPETITIVE_VERIFICATION_AVAILABLE = true;
const DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED =
  isDailyFritzTransactionalAuthorityEnabled();
const isRecoverableDailyFritzCommandConflict = (code: string | null): boolean =>
  code === 'stale_revision' || code === 'command_slot_conflict';

function rejectModernAttemptWhenAuthorityDisabled(
  attempt: DailyFritzAttemptRecord,
  res: Response,
): boolean {
  if (!attempt.challengeId || DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) return false;
  res.status(503).json({
    error: 'Daily Fritz verified authority is temporarily unavailable. Your progress is safe.',
    code: 'authority_temporarily_unavailable',
    recoverable: true,
    recovery_action: 'retry',
  });
  return true;
}

function writeVerifiedHand(
  result: Record<string, unknown> | null,
  hand: VerifiedDailyFritzHandRecord,
): Record<string, unknown> {
  const ledger = readAuthorityLedger(result);
  return {
    ...(result ?? {}),
    authority: { ...ledger, hands: [...ledger.hands, hand] },
    verification_status: 'in_progress',
    verification_protocol_version:
      readDailyFritzAuthorityContract(result)?.transcriptProtocolVersion
      ?? DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  };
}

function writeVerifiedGame(
  result: Record<string, unknown> | null,
  game: VerifiedDailyFritzGameRecord,
): Record<string, unknown> {
  const ledger = readAuthorityLedger(result);
  return {
    ...(result ?? {}),
    authority: { ...ledger, games: [...ledger.games, game] },
  };
}

function pinAuthorityContractFromVerifiedTranscript(input: {
  result: Record<string, unknown> | null;
  run: DailyFritzRunRecord;
  transcript: ReturnType<typeof parseDailyFritzTranscript>;
}): Record<string, unknown> {
  if (readDailyFritzAuthorityContract(input.result)) return input.result ?? {};
  return writeDailyFritzAuthorityContract(
    input.result,
    buildDailyFritzAuthorityContract({
      fritzPolicyVersion: input.transcript.fritzPolicyVersion,
      challengeId: buildDailyFritzChallengeId(input.run.runDate),
      runFingerprint: buildDailyFritzRunFingerprint(input.run),
      clientRelease: input.transcript.clientRelease ?? null,
      transcriptProtocolVersion: input.transcript.protocolVersion,
      // Existing in-flight attempts can contain earlier actions without state
      // fingerprints. Pin their policy, but do not retroactively invalidate them.
      stateDigestRequired: false,
    }),
  );
}

function findVerifiedHand(
  result: Record<string, unknown> | null,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
): VerifiedDailyFritzHandRecord | null {
  return readAuthorityLedger(result).hands.find(
    (hand) => hand.gameNumber === gameNumber && hand.handIndex === handIndex,
  ) ?? null;
}

function parseTranscriptForRequest(value: unknown) {
  try {
    return parseDailyFritzTranscript(value);
  } catch (error) {
    throw new DailyFritzVerificationError(
      error instanceof Error ? error.message : 'Malformed transcript.',
      'malformed_transcript',
    );
  }
}
export function readActiveGameProgress(result: Record<string, unknown> | null, gameNumber: DailyFritzSetGameNumber): DailyFritzActiveGameProgress {
  const value = result?.active_game;
  if (!value || typeof value !== 'object') return { gameNumber, you: 0, fritz: 0 };
  const rec = value as Record<string, unknown>;
  const you = Number(rec.you);
  const fritz = Number(rec.fritz);
  return Number(rec.game_number) === gameNumber && Number.isFinite(you) && you >= 0 && Number.isFinite(fritz) && fritz >= 0
    ? { gameNumber, you: Math.round(you), fritz: Math.round(fritz) }
    : { gameNumber, you: 0, fritz: 0 };
}
export function writeActiveGameProgress(result: Record<string, unknown> | null, progress: DailyFritzActiveGameProgress): Record<string, unknown> {
  return { ...(result ?? {}), active_game: { game_number: progress.gameNumber, you: progress.you, fritz: progress.fritz } };
}

function verifyAttemptHand(input: {
  transcript: unknown;
  attempt: DailyFritzAttemptRecord;
  run: DailyFritzRunRecord;
  userId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  publishedChallenge: DailyFritzPublishedChallenge | null;
}) {
  const expectedSeed = getDailyFritzSeed(input.run.runDate);
  if (input.run.seed !== expectedSeed) {
    throw new DailyFritzVerificationError('Daily Fritz challenge seed is invalid.', 'challenge_mismatch');
  }
  if (buildDailyFritzChallengeId(input.run.runDate) !== buildDailyFritzChallengeId(input.attempt.runDate)) {
    throw new DailyFritzVerificationError('Daily Fritz challenge identity is invalid.', 'challenge_mismatch');
  }
  const progress = readActiveGameProgress(input.attempt.result, input.gameNumber);
  const authorityContract = readDailyFritzAuthorityContract(input.attempt.result);
  const publishedAuthority = input.publishedChallenge
    ? resolveDailyFritzPublishedGameAuthority({
        challenge: input.publishedChallenge,
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
      })
    : null;
  const deal = publishedAuthority?.deal
    ?? getDailyFritzHandForGame(input.run, input.gameNumber, input.handIndex);
  const drawWinner = publishedAuthority?.drawWinner
    ?? resolveDailyFritzDrawWinner({
      runDate: input.run.runDate,
      gameNumber: input.gameNumber,
      metadata: input.run.metadata,
    });
  const challengeId = input.publishedChallenge?.challengeId
    ?? buildDailyFritzChallengeId(input.run.runDate);
  const fritzTier = input.publishedChallenge?.fritzTier ?? input.run.fritzTier;
  const winningScore = input.publishedChallenge?.winningScore ?? input.run.winningScore;
  const dealSize = input.publishedChallenge?.dealSize ?? input.run.dealSize;
  return verifyDailyFritzHand({
    transcript: input.transcript,
    initialState: createOfficialDailyFritzHandState({
      deal,
      handIndex: input.handIndex,
      drawWinner,
      winningScore,
      dealSize,
      playerScore: progress.you,
      fritzScore: progress.fritz,
    }),
    expectedChallengeId: challengeId,
    expectedAttemptId: input.attempt.id,
    expectedGameNumber: input.gameNumber,
    expectedHandIndex: input.handIndex,
    userId: input.userId,
    fritzTier,
    expectedFritzPolicyVersion: authorityContract?.fritzPolicyVersion,
    expectedFritzPolicyContract: authorityContract?.fritzPolicyContract,
    requireStateDigests: authorityContract?.stateDigestRequired === true,
  });
}

function respondVerificationError(res: Response, error: unknown): boolean {
  if (!(error instanceof DailyFritzVerificationError)) return false;
  const status = error.code.endsWith('_mismatch') || error.code === 'wrong_actor' ? 409 : 400;
  const recoverable = [
    'fritz_action_mismatch',
    'fritz_state_mismatch',
    'fritz_policy_version_mismatch',
    'fritz_policy_contract_mismatch',
    'missing_fritz_state_digest',
  ].includes(error.code);
  res.status(status).json({
    error: recoverable
      ? 'Daily Fritz detected a synchronization issue. Refresh to resume from the last verified hand.'
      : error.message,
    code: error.code,
    recoverable,
    recovery_action: recoverable ? 'reload_official_hand' : null,
  });
  return true;
}

export function registerDailyFritzRoutes(app: Application): void {
  app.get('/api/daily-fritz/history', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const attempts = await listDailyFritzAttemptsForUser(userId, Number(req.query.limit ?? 10));
      res.json({ ok: true, results: attempts.map((attempt) => ({ challenge_date: attempt.runDate, player_score: attempt.finalScore ?? 0, fritz_score: attempt.opponentScore ?? 0, won: attempt.won === true, completed_at: attempt.completedAt, verification_status: getDailyFritzVerificationStatus(attempt.result) })) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Daily Fritz history is unavailable.' });
    }
  });
  app.get('/api/daily-fritz/today', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  const isDevLike = process.env.NODE_ENV !== 'production';
  let initUserId: string | null = null;
  let initRunDate: string | null = null;
  const mark = (label: string, startedAt: number, extra?: Record<string, unknown>) => {
    const now = Date.now();
    console.log('[daily-fritz-server] today', {
      requestId,
      label,
      ms: now - startedAt,
      totalMs: now - requestStartedAt,
      ...extra,
    });
  };
  try {
    console.log('[daily-fritz-server] today', {
      requestId,
      label: 'entry',
      totalMs: 0,
      method: req.method,
      path: req.path,
    });

    const authStartedAt = Date.now();
    const authenticatedUserId = await getAuthenticatedUserId(req);
    mark('auth', authStartedAt, { authenticated: Boolean(authenticatedUserId) });
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const dateCalcStartedAt = Date.now();
    const requestedDebugDate = typeof req.query.debugDate === 'string' ? req.query.debugDate.trim() : '';
    if (requestedDebugDate && !isDevLike) {
      res.status(400).json({ error: 'debugDate is only available outside production.' });
      return;
    }
    if (requestedDebugDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDebugDate)) {
      res.status(400).json({ error: 'debugDate must be in YYYY-MM-DD format.' });
      return;
    }
    const runDate = requestedDebugDate || getPacificDateKey();
    initUserId = authenticatedUserId;
    initRunDate = runDate;
    console.log('[daily-fritz:init] request', { userId: authenticatedUserId, date: runDate });
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
            console.log('[daily-fritz-server] today', {
              requestId,
              label,
              ms,
              totalMs: Date.now() - requestStartedAt,
              ...extra,
            });
          },
        },
      );
      mark('ensureDailyFritzRunForDate', ensureStartedAt, {
        runDate,
        generated: Boolean(generated),
      });
      if (generated) {
        console.log('[daily-fritz:init] created-new', { userId: authenticatedUserId, date: runDate });
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
      console.log('[daily-fritz:init] loaded-existing', {
        userId: authenticatedUserId,
        date: runDate,
        phase: attempt.status,
      });
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
    console.log('[daily-fritz-server] today', {
      requestId,
      label: 'response',
      totalMs: Date.now() - requestStartedAt,
      attemptStatus: attempt?.status ?? 'none',
      runDate,
      hadCachedRun,
      cacheMiss: !hadCachedRun,
    });
    res.json(payload);
  } catch (error) {
    console.error('[daily-fritz:init] error', {
      userId: initUserId,
      date: initRunDate ?? getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load today’s Daily Fritz run.',
    });
  }
});

  app.post('/api/daily-fritz/start', async (req, res) => {
  const diagnostics = startDailyFritzRequestDiagnostics(req, res, 'start');
  incrementDailyFritzMetric('mutation_request');
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const requestedProtocol = Number(req.body?.verification_protocol_version);
    const requestedRules = Number(req.body?.game_rules_version);
    const requestedFritz = Number(req.body?.fritz_policy_version);
    const requestedPolicyContract =
      typeof req.body?.fritz_policy_contract === 'string'
        ? req.body.fritz_policy_contract.trim()
        : '';
    const requestedStateDigestVersion = Number(req.body?.state_digest_version);
    const requestedClientRelease =
      typeof req.body?.client_release === 'string' ? req.body.client_release.trim().slice(0, 120) : '';
    const supportedTranscriptProtocols = Array.isArray(req.body?.supported_transcript_protocol_versions)
      ? req.body.supported_transcript_protocol_versions.map(Number).filter(Number.isInteger)
      : [requestedProtocol];
    const supportedStateDigests = Array.isArray(req.body?.supported_state_digest_versions)
      ? req.body.supported_state_digest_versions.map(Number).filter(Number.isInteger)
      : [requestedStateDigestVersion];
    const supportedFritzPolicies = Array.isArray(req.body?.supported_fritz_policies)
      ? req.body.supported_fritz_policies.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object') return [];
          const record = value as Record<string, unknown>;
          const version = Number(record.version);
          const contract = typeof record.contract === 'string' ? record.contract.trim() : '';
          return isSupportedFritzPolicyVersion(version) && contract === getFritzPolicyContract(version)
            ? [{ version, contract }]
            : [];
        })
      : isSupportedFritzPolicyVersion(requestedFritz) && requestedPolicyContract
        ? [{ version: requestedFritz, contract: requestedPolicyContract }]
        : [];
    const supportsVerifier = requestedProtocol === DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION
      && requestedRules === GAME_RULES_VERSION
      && requestedFritz === FRITZ_POLICY_VERSION
      && requestedPolicyContract === getFritzPolicyContract(FRITZ_POLICY_VERSION)
      && requestedStateDigestVersion === 1;

    const runDate = getPacificDateKey();
    console.log('[daily-fritz:init] request', { userId: authenticatedUserId, date: runDate });
    const run = await ensureDailyFritzRunForDate(runDate);
    if (!run) {
      res.status(500).json({ error: 'Daily Fritz storage is not available.' });
      return;
    }
    if (run.status === 'invalidated') {
      res.status(409).json({ error: 'Today’s Daily Fritz run was invalidated.', runDate });
      return;
    }

    let attempt = await getDailyFritzAttempt(runDate, authenticatedUserId);
    if (attempt && rejectModernAttemptWhenAuthorityDisabled(attempt, res)) return;
    if (attempt?.status === 'completed' || attempt?.status === 'abandoned') {
      res.status(409).json({ error: 'Today’s Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    let existingAuthorityContract = readDailyFritzAuthorityContract(attempt?.result ?? null);
    const canResumePinnedContract = Boolean(
      attempt
      && existingAuthorityContract
      && clientSupportsDailyFritzAuthorityContract(existingAuthorityContract, {
        transcriptProtocolVersions: supportedTranscriptProtocols,
        gameRulesVersion: requestedRules,
        fritzPolicies: supportedFritzPolicies,
        stateDigestVersions: supportedStateDigests,
      })
    );
    if (!attempt && !supportsVerifier) {
      res.status(426).json({
        error: 'Daily Fritz requires the latest verified client. Update required.',
        code: 'authority_contract_unsupported',
      });
      return;
    }
    if (
      attempt
      && (
        (existingAuthorityContract && !canResumePinnedContract)
        || (!existingAuthorityContract && !supportsVerifier)
      )
    ) {
      res.status(426).json({
        error: 'This Daily Fritz attempt requires a compatible verified client. Update required.',
        code: 'authority_contract_unsupported',
      });
      return;
    }
    let createdTransactionally = false;
    if (!attempt && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) {
      const policyVersion = isSupportedFritzPolicyVersion(requestedFritz)
        ? requestedFritz
        : FRITZ_POLICY_VERSION;
      const initialAuthorityContract = buildDailyFritzAuthorityContract({
        fritzPolicyVersion: policyVersion,
        challengeId: buildDailyFritzChallengeId(run.runDate),
        runFingerprint: buildDailyFritzRunFingerprint(run),
        clientRelease: requestedClientRelease,
        transcriptProtocolVersion: requestedProtocol,
        stateDigestRequired: true,
      });
      const initialResult = {
        ...writeDailyFritzAuthorityContract(null, initialAuthorityContract),
        verification_status: 'in_progress',
      };
      const publishedChallenge = buildDailyFritzPublishedChallenge({
        runDate: run.runDate,
        fritzTier: run.fritzTier,
        dealSize: run.dealSize,
        winningScore: run.winningScore,
        publishedAt: run.generatedAt,
      });
      if (
        canonicalizeDailyFritzChallenge(publishedChallenge.games[0].hands)
        !== canonicalizeDailyFritzChallenge(run.handDeals)
      ) {
        res.status(409).json({
          error: 'Published Daily Fritz authority does not match the stored run.',
          code: 'challenge_publication_mismatch',
        });
        return;
      }
      await publishDailyFritzChallenge(publishedChallenge);
      const command = await startDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: authenticatedUserId,
        challengeId: publishedChallenge.challengeId,
        operationId: `start:${publishedChallenge.challengeId}`,
        authorityResult: initialResult,
      });
      if (command.outcome !== 'committed' || !command.response) {
        res.status(command.errorCode === 'operation_id_reused' ? 409 : 422).json({
          error: 'Daily Fritz attempt could not be started transactionally.',
          code: command.errorCode ?? 'transactional_start_failed',
          authority_revision: command.committedRevision,
        });
        return;
      }
      const commandAttemptId = typeof command.response.attempt_id === 'string'
        ? command.response.attempt_id
        : '';
      attempt = commandAttemptId
        ? await getDailyFritzAttemptById(commandAttemptId, authenticatedUserId)
        : null;
      if (!attempt) throw new Error('Transactional Daily Fritz attempt was not readable after commit.');
      existingAuthorityContract = readDailyFritzAuthorityContract(attempt.result);
      createdTransactionally = command.response.created === true;
      incrementDailyFritzMetric(createdTransactionally ? 'attempt_started' : 'retry_request');
    }
    if (!attempt) {
      attempt = await createDailyFritzAttempt(runDate, authenticatedUserId);
      incrementDailyFritzMetric('attempt_started');
      await recordDailyFritzEventBestEffort({
        attemptId: attempt.id,
        runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'attempt_started',
        idempotencyKey: `${attempt.id}:attempt_started`,
        payload: { verificationCapable: supportsVerifier },
      });
    } else if (!createdTransactionally) {
      incrementDailyFritzMetric('retry_request');
      await recordDailyFritzEventBestEffort({
        attemptId: attempt.id,
        runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'retry_request',
        idempotencyKey: `${attempt.id}:start:retry:${diagnostics.requestId}`,
        payload: { operation: 'start', status: attempt.status },
      });
    }
    let authorityContract = existingAuthorityContract;
    if (!authorityContract) {
      const hasExistingEvidence =
        attempt.currentHandIndex > 0
        || readAuthorityLedger(attempt.result).hands.length > 0
        || Boolean(normalizeDailyFritzSetResult(attempt.result)?.games.length);
      const policyVersion = isSupportedFritzPolicyVersion(requestedFritz)
        ? requestedFritz
        : FRITZ_POLICY_VERSION;
      authorityContract = buildDailyFritzAuthorityContract({
        fritzPolicyVersion: policyVersion,
        challengeId: buildDailyFritzChallengeId(run.runDate),
        runFingerprint: buildDailyFritzRunFingerprint(run),
        clientRelease: requestedClientRelease,
        transcriptProtocolVersion: requestedProtocol,
        stateDigestRequired: !hasExistingEvidence,
      });
      attempt.result = writeDailyFritzAuthorityContract(attempt.result, authorityContract);
      attempt.result = {
        ...attempt.result,
        verification_status: 'in_progress',
      };
      attempt = await upsertDailyFritzAttempt(attempt);
    }

    let verifiedMatchId = attempt.verifiedMatchId;
    if (!verifiedMatchId) {
      const localMatchId = `daily-fritz:${runDate}:${attempt.id}`;
      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId: authenticatedUserId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: getFritzIdentityForTier(run.fritzTier).fritzId,
        fritzTier: run.fritzTier,
      });
      verifiedMatchId = verifiedMatch.matchId;
      attempt.verifiedMatchId = verifiedMatch.matchId;
      attempt.status = 'started';
      attempt = await upsertDailyFritzAttempt(attempt);
    }

    const currentSetResult = normalizeDailyFritzSetResult(attempt.result);
    const needsCompletion = Boolean(currentSetResult?.setWinner);
    const currentGameNumber = needsCompletion ? null : getCurrentDailyFritzGameNumber(attempt.result);
    const gameNumberForDraw: DailyFritzSetGameNumber = (currentGameNumber ?? 1) as DailyFritzSetGameNumber;
    const currentGameScores = readActiveGameProgress(attempt.result, gameNumberForDraw);
    const publishedAuthority = await loadDailyFritzPublishedAuthority({ attempt, run });
    const publishedGameAuthority = publishedAuthority
      ? resolveDailyFritzPublishedGameAuthority({
          challenge: publishedAuthority,
          gameNumber: gameNumberForDraw,
          handIndex: attempt.currentHandIndex,
        })
      : null;
    const handDeal = publishedGameAuthority?.deal
      ?? getDailyFritzHandForGame(run, gameNumberForDraw, attempt.currentHandIndex);
    const drawWinner: DailyFritzDrawWinner = publishedGameAuthority?.drawWinner
      ?? resolveDailyFritzDrawWinner({
        runDate: run.runDate,
        gameNumber: gameNumberForDraw,
        metadata: run.metadata,
      });
    const drawTiles: DailyFritzDrawTiles = publishedGameAuthority?.drawTiles
      ?? resolveDailyFritzDrawTiles({
        runDate: run.runDate,
        gameNumber: gameNumberForDraw,
        metadata: run.metadata,
        drawWinner,
      });
    console.log('[daily-fritz:start] draw package', {
      runDate: run.runDate,
      gameNumber: gameNumberForDraw,
      drawWinner,
      drawPlayerTile: drawTiles.playerTile,
      drawFritzTile: drawTiles.fritzTile,
      metadataHasDrawTiles: Boolean(
        run.metadata &&
          typeof run.metadata === 'object' &&
          (run.metadata as Record<string, unknown>).draw_tiles_by_game,
      ),
    });
    res.json({
      ok: true,
      attempt_id: attempt.id,
      verified_match_id: verifiedMatchId,
      authority_revision: attempt.revision,
      run_date: run.runDate,
      challenge_id: publishedAuthority?.challengeId ?? buildDailyFritzChallengeId(run.runDate),
      rules_version: DAILY_FRITZ_RULES_VERSION,
      seed_version: DAILY_FRITZ_SEED_VERSION,
      run_fingerprint: buildDailyFritzRunFingerprint(run),
      verification_protocol_version: authorityContract.transcriptProtocolVersion,
      game_rules_version: authorityContract.gameRulesVersion,
      fritz_policy_version: authorityContract.fritzPolicyVersion,
      fritz_policy_contract: authorityContract.fritzPolicyContract,
      state_digest_version: authorityContract.stateDigestVersion,
      state_digest_required: authorityContract.stateDigestRequired,
      authority_client_release: authorityContract.clientRelease,
      verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
      time_zone: DAILY_FRITZ_TIME_ZONE,
      verification_status: getDailyFritzVerificationStatus(attempt.result),
      current_hand_index: attempt.currentHandIndex,
      current_game_scores: { you: currentGameScores.you, fritz: currentGameScores.fritz },
      current_game_number: currentGameNumber,
      needs_completion: needsCompletion,
      set_result: currentSetResult,
      fritz_tier: run.fritzTier,
      deal_size: run.dealSize,
      winning_score: run.winningScore,
      first_hand: handDeal,
      draw_winner: drawWinner,
      draw_player_tile: drawTiles.playerTile,
      draw_fritz_tile: drawTiles.fritzTile,
    });
  } catch (error) {
    console.error('[daily-fritz:init] error', {
      userId: null,
      date: getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Daily Fritz.',
    });
  }
});

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
  console.log('[daily-fritz-next-hand] request', {
    requestId: diagnostics.requestId,
    attemptId,
    runDateFromClient,
    rawGameNumber,
    completedHandIndex,
  });
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
    console.log('[daily-fritz-next-hand] current game', {
      attemptId,
      requestedGameNumber,
      currentGameNumber,
      resolvedGameNumber: gameNumber,
      currentHandIndex: attempt.currentHandIndex,
    });
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
      options: { replayed?: boolean; ignored?: boolean } = {},
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
      console.log('[daily-fritz-next-hand] draw package', {
        attemptId,
        runDate: run.runDate,
        gameNumber,
        currentHandIndex,
        drawWinner,
        drawPlayerTile: drawTiles.playerTile,
        drawFritzTile: drawTiles.fritzTile,
      });
      console.log('[daily-fritz-next-hand] returning hand', {
        attemptId,
        gameNumber,
        currentHandIndex,
        replayed: Boolean(options.replayed),
        ignored: Boolean(options.ignored),
      });
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
    const parsedTranscript = parseTranscriptForRequest(transcriptInput);
    const existingHand = findVerifiedHand(attempt.result, gameNumber, completedHandIndex);
    if (existingHand) {
      if (existingHand.transcriptDigest !== digestDailyFritzTranscript(parsedTranscript)) {
        console.warn('[daily-fritz-next-hand] conflicting verified hand retry', {
          attemptId,
          gameNumber,
          completedHandIndex,
          userId: authenticatedUserId,
        });
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
    if (completedHandIndex !== attempt.currentHandIndex) {
      res.status(409).json({ error: 'Daily Fritz hand is no longer current.' });
      return;
    }
    // Do NOT cap by hand count — Daily Fritz plays to the winning score (e.g.
    // 60 points), not a fixed number of hands.  The pre-stored handDeals array
    // covers the common case; any hand beyond it is generated on-demand from
    // the same deterministic seed so all players still get identical tiles.
    const verified = verifyAttemptHand({
      transcript: parsedTranscript,
      attempt,
      run,
      userId: authenticatedUserId,
      gameNumber,
      handIndex: completedHandIndex,
      publishedChallenge: publishedAuthority,
    });
    if (verified.terminalState.gameOver) {
      res.status(409).json({ error: 'Daily Fritz game is complete; finalize the verified game.' });
      return;
    }
    attempt.result = pinAuthorityContractFromVerifiedTranscript({
      result: attempt.result,
      run,
      transcript: verified.transcript,
    });
    attempt.result = writeVerifiedHand(attempt.result, verified.result);
    attempt.result = writeActiveGameProgress(attempt.result, {
      gameNumber,
      you: verified.result.playerScoreAfter,
      fritz: verified.result.fritzScoreAfter,
    });
    attempt.currentHandIndex += 1;
    let saved: DailyFritzAttemptRecord;
    const transactionalHand = Boolean(attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED);
    if (transactionalHand) {
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
    respondWithCurrentHand(saved.currentHandIndex);
    });
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) {
      incrementDailyFritzMetric('verification_failed', error.code);
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'verification_failed',
        verifierCode: error.code,
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
    if (respondVerificationError(res, error)) return;
    console.warn('[daily-fritz-next-hand] error', {
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to advance Daily Fritz hand.',
    });
  }
});

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
    if (!parsedTranscript && requiresVerifiedDailyFritzEvidence(attempt.result)) {
      res.status(426).json({ error: 'This attempt requires verified game evidence. Update required.' });
      return;
    }

    const currentSetResult = normalizeDailyFritzSetResult(attempt.result) ?? {
      version: 2,
      format: 'best_of_3' as const,
      playerGamesWon: 0,
      fritzGamesWon: 0,
      totalPointDiff: 0,
      games: [],
    };
    if (
      requiresVerifiedDailyFritzEvidence(attempt.result)
      && !hasPriorDailyFritzGameAuthority(attempt.result, currentSetResult)
    ) {
      res.status(409).json({
        error: 'Earlier Daily Fritz games are missing verification receipts. Resume from an earlier game or contact support.',
      });
      return;
    }
    if (currentSetResult.setWinner) {
      res.status(409).json({ error: 'Daily Fritz set is already decided.' });
      return;
    }
    if (gameNumber !== currentSetResult.games.length + 1) {
      const existing = currentSetResult.games.find((game) => game.gameNumber === gameNumber);
      if (existing) {
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
          console.warn('[daily-fritz-record-game] conflicting replay', {
            attemptId,
            gameNumber,
            userId: authenticatedUserId,
          });
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
    if (parsedTranscript) {
      const verified = verifyAttemptHand({
        transcript: parsedTranscript,
        attempt,
        run,
        userId: authenticatedUserId,
        gameNumber,
        handIndex: attempt.currentHandIndex,
        publishedChallenge: publishedAuthority,
      });
      playerScore = verified.result.playerScoreAfter;
      fritzScore = verified.result.fritzScoreAfter;
      if (!verified.terminalState.gameOver || playerScore === fritzScore) {
        res.status(409).json({ error: 'Daily Fritz game is not complete.' });
        return;
      }
      terminalHandReceipt = verified.result;
      attempt.result = pinAuthorityContractFromVerifiedTranscript({
        result: attempt.result,
        run,
        transcript: verified.transcript,
      });
      attempt.result = writeVerifiedHand(attempt.result, verified.result);
      attempt.result = writeActiveGameProgress(attempt.result, { gameNumber, you: playerScore, fritz: fritzScore });
      const gameHands = readAuthorityLedger(attempt.result).hands.filter((hand) => hand.gameNumber === gameNumber);
      movesUsed = gameHands.reduce((sum, hand) => sum + hand.actionCount, 0);
      handsPlayed = gameHands.length;
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

    if (parsedTranscript) {
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
    });
    if (!setResult.setWinner) {
      attempt.currentHandIndex = 0;
      attempt.currentGameNumber = Math.min(gameNumber + 1, 3) as DailyFritzSetGameNumber;
    }
    let saved: DailyFritzAttemptRecord;
    const transactionalGame = Boolean(attempt.challengeId && DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED);
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
      }).catch(() => {});
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
      },
    });
    res.json({
      ok: true,
      authority_revision: saved.revision,
      set_result: savedSetResult ?? setResult,
      next_game_number: setResult.setWinner ? null : Math.min(setResult.games.length + 1, 3),
    });
    });
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) {
      incrementDailyFritzMetric('verification_failed', error.code);
      await recordDailyFritzEventBestEffort({
        attemptId: attemptId || null,
        requestId: diagnostics.requestId,
        eventType: 'verification_failed',
        verifierCode: error.code,
        idempotencyKey: `${attemptId || 'unknown'}:verification_failed:record-game:${diagnostics.requestId}`,
        payload: { operation: 'record-game', message: error.message },
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
    if (respondVerificationError(res, error)) return;
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record Daily Fritz game.',
    });
  }
});

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
      await recordDailyFritzEventBestEffort({
        attemptId,
        runDate: attempt.runDate,
        userId: authenticatedUserId,
        requestId: diagnostics.requestId,
        eventType: 'attempt_completed',
        idempotencyKey: `${attemptId}:attempt_completed:replay:${diagnostics.requestId}`,
        payload: { replayed: true },
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
    const isVerified = hasCompleteDailyFritzGameAuthority(attempt.result, setResult);
    if (!canFinalizeDailyFritzAttempt(attempt.result, setResult)) {
      res.status(409).json({ error: 'Daily Fritz verification is incomplete.' });
      return;
    }
    const finalScore = setResult.playerGamesWon;
    const opponentScore = setResult.fritzGamesWon;
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete Daily Fritz attempt.',
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to abandon Daily Fritz attempt.',
    });
   }
});

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
  const suppliedAdminSecret = req.get('x-admin-secret') ?? req.query.admin_key;
  if (!isAdminSecret(suppliedAdminSecret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  let persistedMetrics: Awaited<ReturnType<typeof listDailyFritzPersistedMetrics>> | null = null;
  try {
    persistedMetrics = await listDailyFritzPersistedMetrics();
  } catch (error) {
    console.warn('[daily-fritz-metrics] persisted metrics unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  res.json({
    ok: true,
    metrics: getDailyFritzMetrics(),
    rates: getDailyFritzMetricRates(),
    persisted_metrics: persistedMetrics,
  });
  });

  app.get('/api/daily-fritz/events/:attemptId', async (req, res) => {
  const suppliedAdminSecret = req.get('x-admin-secret') ?? req.query.admin_key;
  if (!isAdminSecret(suppliedAdminSecret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const events = await listDailyFritzEvents(req.params.attemptId, Number(req.query.limit ?? 200));
    res.json({ ok: true, attempt_id: req.params.attemptId, events });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Daily Fritz event history is unavailable.',
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
    res.json({
      ok: true,
      run_date: runDate,
      leaderboard: leaderboard.map(({ userId, ...entry }) => ({
        ...entry,
        is_current_user: userId === authenticatedUserId,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Daily Fritz leaderboard.',
    });
  }
});

  app.post('/api/daily-fritz/generate', async (req, res) => {
  if (!isAdminSecret(req.body?.adminKey)) {
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate Daily Fritz run.',
    });
  }
});

  app.post('/api/daily-fritz/invalidate', async (req, res) => {
  if (!isAdminSecret(req.body?.adminKey)) {
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
    await publishDailyFritzChallenge(buildDailyFritzPublishedChallenge({
      runDate: run.runDate,
      fritzTier: run.fritzTier,
      dealSize: run.dealSize,
      winningScore: run.winningScore,
      publishedAt: run.generatedAt,
    }));
    const invalidated = await invalidateDailyFritzPublishedChallenge(runDate, reason);
    dailyFritzRunCache.delete(runDate);
    res.json({ ok: true, challenge_id: invalidated.challengeId, status: invalidated.status });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to invalidate Daily Fritz run.',
    });
  }
});

  app.post('/api/daily-fritz/reset-attempt', async (req, res) => {
  if (!isAdminSecret(req.body?.adminKey)) {
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to reset Daily Fritz attempt.',
    });
  }
});
}
