import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
} from '@racehorse/game-core';
import type { Application } from 'express';
import {
  resolveDailyFritzDrawTiles,
  resolveDailyFritzDrawWinner,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
  type DailyFritzSetGameNumber,
} from '../../dailyFritz';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { getFritzIdentityForTier } from '../../shared/fritzMatchLifecycle';
import { getPacificDateKey } from '../../shared/pacificDate';
import { buildDailyFritzChallengeId, DAILY_FRITZ_RULES_VERSION, DAILY_FRITZ_SEED_VERSION, DAILY_FRITZ_TIME_ZONE } from '../../dailyFritzIdentity';
import { startVerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';
import {
  buildDailyFritzRunFingerprint,
  createDailyFritzAttempt,
  ensureDailyFritzRunForDate,
  getCurrentDailyFritzGameNumber,
  getDailyFritzAttempt,
  getDailyFritzAttemptById,
  getDailyFritzHandForGame,
  normalizeDailyFritzSetResult,
  upsertDailyFritzAttempt,
} from '../stores/dailyFritzStore';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  getDailyFritzVerificationStatus,
  readAuthorityLedger,
  buildDailyFritzAuthorityContract,
  clientSupportsDailyFritzAuthorityContract,
  readDailyFritzAuthorityContract,
  writeDailyFritzAuthorityContract,
} from './dailyFritzVerificationPolicy';
import { startDailyFritzRequestDiagnostics } from './dailyFritzRequestDiagnostics';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import {
  buildDailyFritzPublishedChallenge,
  canonicalizeDailyFritzChallenge,
} from '../../dailyFritzPublishedChallenge';
import { publishDailyFritzChallenge } from '../stores/dailyFritzPublishedChallengeStore';
import { startDailyFritzAttemptCommand } from '../stores/dailyFritzCommandStore';
import {
  loadDailyFritzPublishedAuthority,
  resolveDailyFritzPublishedGameAuthority,
} from './dailyFritzPublishedAuthority';
import {
  DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED,
  readActiveGameProgress,
  recordDailyFritzEventBestEffort,
  rejectModernAttemptWhenAuthorityDisabled,
} from './dailyFritzVerificationGlue';
import { capture500, log, prodSafeError } from './dailyFritzRouteErrors';
import { resolveDailyFritzResumeCheckpoint } from './dailyFritzCheckpointPolicy';
import { resolveDailyFritzClientNextAction } from './dailyFritzClientPhase';

export function registerDailyFritzStartRoute(app: Application): void {
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
    const requestedDebugDate = typeof req.body?.debug_date === 'string' ? req.body.debug_date.trim() : '';
    const allowsTestFixtureDate = process.env.NODE_ENV !== 'production'
      && process.env.DAILY_FRITZ_TEST_FIXTURES_ENABLED === 'true';
    if (requestedDebugDate && !allowsTestFixtureDate) {
      res.status(400).json({ error: 'debug_date requires an enabled non-production fixture environment.' });
      return;
    }
    if (requestedDebugDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDebugDate)) {
      res.status(400).json({ error: 'debug_date must be in YYYY-MM-DD format.' });
      return;
    }
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
      && requestedStateDigestVersion === DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION;

    const runDate = requestedDebugDate || getPacificDateKey();
    log.info({ userId: authenticatedUserId, date: runDate }, '[daily-fritz:init] request');
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
    log.info({
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
    }, '[daily-fritz:start] draw package');
    const runFingerprint = buildDailyFritzRunFingerprint(run);
    const resumeCheckpoint = resolveDailyFritzResumeCheckpoint(attempt, runFingerprint);
    const nextAction = resolveDailyFritzClientNextAction({
      attemptStatus: attempt.status,
      setResult: currentSetResult,
      needsCompletion,
      currentHandIndex: attempt.currentHandIndex,
      hasResumeCheckpoint: Boolean(resumeCheckpoint),
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
      run_fingerprint: runFingerprint,
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
      next_action: nextAction,
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
      ...(resumeCheckpoint ? { resume_checkpoint: resumeCheckpoint } : {}),
    });
  } catch (error) {
    log.error({
      userId: null,
      date: getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz:init] error');
    capture500(error, { route: 'start' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to start Daily Fritz.'),
    });
  }
});
}
