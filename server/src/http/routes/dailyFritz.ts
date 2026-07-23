import { createHash, randomUUID } from 'crypto';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
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

type DailyFritzActiveGameProgress = { gameNumber: DailyFritzSetGameNumber; you: number; fritz: number };
const DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION = DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION;
const DAILY_FRITZ_COMPETITIVE_VERIFICATION_AVAILABLE = true;

type DailyFritzAuthorityLedger = {
  version: 1;
  hands: VerifiedDailyFritzHandRecord[];
  games: VerifiedDailyFritzGameRecord[];
};

type VerifiedDailyFritzGameRecord = {
  verificationVersion: number;
  gameNumber: DailyFritzSetGameNumber;
  playerScore: number;
  fritzScore: number;
  handDigests: string[];
  resultDigest: string;
};

function readAuthorityLedger(result: Record<string, unknown> | null): DailyFritzAuthorityLedger {
  const raw = result?.authority;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).hands)) {
    return { version: 1, hands: [], games: [] };
  }
  const authority = raw as { hands: VerifiedDailyFritzHandRecord[]; games?: VerifiedDailyFritzGameRecord[] };
  return {
    version: 1,
    hands: authority.hands,
    games: Array.isArray(authority.games) ? authority.games : [],
  };
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
    verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
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

export function requiresVerifiedDailyFritzEvidence(result: Record<string, unknown> | null): boolean {
  return result?.verification_protocol_version === DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION
    && getDailyFritzVerificationStatus(result) !== 'legacy_unverified';
}

export function hasCompleteDailyFritzGameAuthority(
  result: Record<string, unknown> | null,
  setResult: { games: DailyFritzSetGameResult[] },
): boolean {
  const ledger = readAuthorityLedger(result);
  return setResult.games.length > 0 && !setResult.games.some((game) => {
    const verifiedGame = ledger.games.find((candidate) => candidate.gameNumber === game.gameNumber);
    return !verifiedGame
      || verifiedGame.playerScore !== game.playerScore
      || verifiedGame.fritzScore !== game.fritzScore
      || verifiedGame.handDigests.length === 0;
  });
}

export function canFinalizeDailyFritzAttempt(
  result: Record<string, unknown> | null,
  setResult: { games: DailyFritzSetGameResult[] },
): boolean {
  return !requiresVerifiedDailyFritzEvidence(result)
    || hasCompleteDailyFritzGameAuthority(result, setResult);
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

function getDailyFritzVerificationStatus(result: Record<string, unknown> | null): 'in_progress' | 'pending_verification' | 'verified' | 'rejected' | 'legacy_unverified' {
  const value = result?.verification_status;
  return value === 'in_progress' || value === 'pending_verification' || value === 'verified' || value === 'rejected'
    ? value
    : 'legacy_unverified';
}

export function isIdenticalDailyFritzGameReplay(
  existing: Pick<DailyFritzSetGameResult, 'playerScore' | 'fritzScore' | 'movesUsed' | 'handsPlayed'>,
  submitted: { playerScore: number; fritzScore: number; movesUsed: number; handsPlayed: number },
): boolean {
  return existing.playerScore === Math.round(submitted.playerScore)
    && existing.fritzScore === Math.round(submitted.fritzScore)
    && existing.movesUsed === Math.round(submitted.movesUsed)
    && existing.handsPlayed === Math.round(submitted.handsPlayed);
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
}) {
  const expectedSeed = getDailyFritzSeed(input.run.runDate);
  if (input.run.seed !== expectedSeed) {
    throw new DailyFritzVerificationError('Daily Fritz challenge seed is invalid.', 'challenge_mismatch');
  }
  if (buildDailyFritzChallengeId(input.run.runDate) !== buildDailyFritzChallengeId(input.attempt.runDate)) {
    throw new DailyFritzVerificationError('Daily Fritz challenge identity is invalid.', 'challenge_mismatch');
  }
  const progress = readActiveGameProgress(input.attempt.result, input.gameNumber);
  const deal = getDailyFritzHandForGame(input.run, input.gameNumber, input.handIndex);
  const drawWinner = resolveDailyFritzDrawWinner({
    runDate: input.run.runDate,
    gameNumber: input.gameNumber,
    metadata: input.run.metadata,
  });
  return verifyDailyFritzHand({
    transcript: input.transcript,
    initialState: createOfficialDailyFritzHandState({
      deal,
      handIndex: input.handIndex,
      drawWinner,
      winningScore: input.run.winningScore,
      dealSize: input.run.dealSize,
      playerScore: progress.you,
      fritzScore: progress.fritz,
    }),
    expectedChallengeId: buildDailyFritzChallengeId(input.run.runDate),
    expectedAttemptId: input.attempt.id,
    expectedGameNumber: input.gameNumber,
    expectedHandIndex: input.handIndex,
    userId: input.userId,
    fritzTier: input.run.fritzTier,
  });
}

function respondVerificationError(res: Response, error: unknown): boolean {
  if (!(error instanceof DailyFritzVerificationError)) return false;
  const status = error.code.endsWith('_mismatch') || error.code === 'wrong_actor' ? 409 : 400;
  res.status(status).json({ error: error.message, code: error.code });
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
      verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
      game_rules_version: GAME_RULES_VERSION,
      fritz_policy_version: FRITZ_POLICY_VERSION,
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
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const requestedProtocol = Number(req.body?.verification_protocol_version);
    const requestedRules = Number(req.body?.game_rules_version);
    const requestedFritz = Number(req.body?.fritz_policy_version);
    const supportsVerifier = requestedProtocol === DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION
      && requestedRules === GAME_RULES_VERSION
      && requestedFritz === FRITZ_POLICY_VERSION;
    if (
      req.body?.verification_protocol_version != null
      && (requestedProtocol !== DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION
        || requestedRules !== GAME_RULES_VERSION
        || requestedFritz !== FRITZ_POLICY_VERSION)
    ) {
      res.status(426).json({ error: 'Daily Fritz verification protocol is not supported. Update required.' });
      return;
    }

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
    if (attempt?.status === 'completed' || attempt?.status === 'abandoned') {
      res.status(409).json({ error: 'Today’s Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    if (attempt && !supportsVerifier && requiresVerifiedDailyFritzEvidence(attempt.result)) {
      res.status(426).json({ error: 'This Daily Fritz attempt requires the latest verified client. Update required.' });
      return;
    }
    if (!attempt) {
      attempt = await createDailyFritzAttempt(runDate, authenticatedUserId);
    }
    if (
      supportsVerifier
      && attempt.currentHandIndex === 0
      && readAuthorityLedger(attempt.result).hands.length === 0
      && !(normalizeDailyFritzSetResult(attempt.result)?.games.length)
    ) {
      attempt.result = {
        ...(attempt.result ?? {}),
        verification_status: 'in_progress',
        verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
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
    const handDeal = getDailyFritzHandForGame(run, gameNumberForDraw, attempt.currentHandIndex);
    const drawWinner: DailyFritzDrawWinner = resolveDailyFritzDrawWinner({
      runDate: run.runDate,
      gameNumber: gameNumberForDraw,
      metadata: run.metadata,
    });
    const drawTiles: DailyFritzDrawTiles = resolveDailyFritzDrawTiles({
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
      run_date: run.runDate,
      challenge_id: buildDailyFritzChallengeId(run.runDate),
      rules_version: DAILY_FRITZ_RULES_VERSION,
      seed_version: DAILY_FRITZ_SEED_VERSION,
      verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
      game_rules_version: GAME_RULES_VERSION,
      fritz_policy_version: FRITZ_POLICY_VERSION,
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
    if (completedHandIndex > attempt.currentHandIndex) {
      res.status(400).json({ error: 'Requested completed hand is ahead of the persisted attempt.' });
      return;
    }

    const respondWithCurrentHand = (
      currentHandIndex: number,
      options: { replayed?: boolean; ignored?: boolean } = {},
    ) => {
      const hand = getDailyFritzHandForGame(run, gameNumber, currentHandIndex);
      const scores = readActiveGameProgress(attempt.result, gameNumber);
      const drawWinner: DailyFritzDrawWinner = resolveDailyFritzDrawWinner({
        runDate: run.runDate,
        gameNumber,
        metadata: run.metadata,
      });
      const drawTiles: DailyFritzDrawTiles = resolveDailyFritzDrawTiles({
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
        res.status(409).json({ error: 'Daily Fritz hand was already verified with different evidence.' });
        return;
      }
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
    });
    if (verified.terminalState.gameOver) {
      res.status(409).json({ error: 'Daily Fritz game is complete; finalize the verified game.' });
      return;
    }
    attempt.result = writeVerifiedHand(attempt.result, verified.result);
    attempt.result = writeActiveGameProgress(attempt.result, {
      gameNumber,
      you: verified.result.playerScoreAfter,
      fritz: verified.result.fritzScoreAfter,
    });
    attempt.currentHandIndex += 1;
    const saved = await upsertDailyFritzAttempt(attempt);
    respondWithCurrentHand(saved.currentHandIndex);
    });
  } catch (error) {
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
    if (parsedTranscript) {
      const verified = verifyAttemptHand({
        transcript: parsedTranscript,
        attempt,
        run,
        userId: authenticatedUserId,
        gameNumber,
        handIndex: attempt.currentHandIndex,
      });
      playerScore = verified.result.playerScoreAfter;
      fritzScore = verified.result.fritzScoreAfter;
      if (!verified.terminalState.gameOver || playerScore === fritzScore) {
        res.status(409).json({ error: 'Daily Fritz game is not complete.' });
        return;
      }
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

    attempt.result = {
      ...setResult as unknown as Record<string, unknown>,
      authority: readAuthorityLedger(attempt.result),
      ...(!parsedTranscript ? { verification_status: 'legacy_unverified' } : {}),
    };
    if (!setResult.setWinner) {
      attempt.currentHandIndex = 0;
    }
    const saved = await upsertDailyFritzAttempt(attempt);
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
    res.json({
      ok: true,
      set_result: savedSetResult ?? setResult,
      next_game_number: setResult.setWinner ? null : Math.min(setResult.games.length + 1, 3),
    });
    });
  } catch (error) {
    if (respondVerificationError(res, error)) return;
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record Daily Fritz game.',
    });
  }
});

  app.post('/api/daily-fritz/complete', async (req, res) => {
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
      const leaderboard = await buildDailyFritzLeaderboard(runDate);
      const isVerified = getDailyFritzVerificationStatus(attempt.result) === 'verified';
      const rank = isVerified
        ? leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null
        : null;
      res.json({
        ok: true,
        replayed: true,
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
    await upsertDailyFritzAttempt(attempt);

    const verifiedMatch = await getVerifiedSinglePlayerMatch(verifiedMatchId);
    if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
      verifiedMatch.status = 'completed';
      verifiedMatch.completedAt = attempt.completedAt;
      verifiedMatch.completionHash = serverReceipt;
      verifiedMatch.completionResult = attempt.result;
      await persistVerifiedSinglePlayerMatch(verifiedMatch);
    }

    const leaderboard = await buildDailyFritzLeaderboard(runDate);
    const rank = isVerified
      ? leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null
      : null;
    res.json({
      ok: true,
      rank,
      leaderboard_preview: leaderboard.slice(0, 10).map(({ userId: _userId, ...entry }) => entry),
    });
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete Daily Fritz attempt.',
    });
  }
});

  app.post('/api/daily-fritz/abandon', async (req, res) => {
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
    const runDate = getPacificDateKey();
    const attempt = await getDailyFritzAttempt(runDate, authenticatedUserId);
    if (!attempt || attempt.id !== attemptId) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    if (attempt.status === 'completed' || attempt.status === 'abandoned') {
      res.status(409).json({ error: 'Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    attempt.status = 'abandoned';
    attempt.completedAt = new Date().toISOString();
    await upsertDailyFritzAttempt(attempt);
    if (attempt.verifiedMatchId) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(attempt.verifiedMatchId);
      if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
        verifiedMatch.status = 'abandoned';
        verifiedMatch.completedAt = attempt.completedAt;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to abandon Daily Fritz attempt.',
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
    run.status = 'invalidated';
    run.invalidatedAt = new Date().toISOString();
    run.metadata = { ...(run.metadata ?? {}), invalidation_reason: reason || null };
    await upsertDailyFritzRun(run);
    res.json({ ok: true });
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
