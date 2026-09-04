import type { Application, Request, Response } from 'express';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  type FritzPolicyVersion,
} from '@racehorse/game-core';
import {
  FritzChallengeError,
  buildFritzChallengeFingerprint,
  buildFritzChallengeIdentity,
  normalizeFritzChallengeDealSize,
  normalizeFritzChallengeShareCode,
  normalizeFritzChallengeTier,
  type FritzChallengeStatus,
  type GeneratedFritzChallenge,
} from '../../fritzChallenge';
import {
  getFritzChallengeDrawTiles,
  getFritzChallengeDrawWinner,
} from '../../fritzChallenge';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import {
  claimFritzChallengeOpponent,
  createFritzChallenge,
  getOrCreateFritzChallengeHand,
  getFritzChallengeAttempt,
  getFritzChallengeByCode,
  type FritzChallengeAttemptRecord,
} from '../stores/fritzChallengeStore';
import {
  createOfficialDailyFritzHandState,
  digestDailyFritzTranscript,
  DailyFritzVerificationError,
  verifyDailyFritzHand,
} from '../../dailyFritzVerifier';
import { DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION } from './dailyFritzVerificationPolicy';
import {
  commitFritzChallengeAttemptCommand,
  startFritzChallengeAttemptCommand,
} from '../stores/fritzChallengeCommandStore';

export type FritzChallengeRoutesDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  createChallenge: typeof createFritzChallenge;
  getChallengeByCode: typeof getFritzChallengeByCode;
  claimOpponent: typeof claimFritzChallengeOpponent;
  getOrCreateHand: typeof getOrCreateFritzChallengeHand;
  getAttempt: typeof getFritzChallengeAttempt;
  commitCommand: typeof commitFritzChallengeAttemptCommand;
  startCommand: typeof startFritzChallengeAttemptCommand;
  now: () => Date;
};

const DEFAULT_DEPS: FritzChallengeRoutesDeps = {
  getAuthenticatedUserId,
  createChallenge: createFritzChallenge,
  getChallengeByCode: getFritzChallengeByCode,
  claimOpponent: claimFritzChallengeOpponent,
  getOrCreateHand: getOrCreateFritzChallengeHand,
  getAttempt: getFritzChallengeAttempt,
  commitCommand: commitFritzChallengeAttemptCommand,
  startCommand: startFritzChallengeAttemptCommand,
  now: () => new Date(),
};

function resolveVisibleStatus(
  challenge: GeneratedFritzChallenge,
  now: Date,
): FritzChallengeStatus {
  if (
    (challenge.status === 'open' || challenge.status === 'active')
    && new Date(challenge.expiresAt).getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return challenge.status;
}

export function toFritzChallengeApiView(
  challenge: GeneratedFritzChallenge,
  viewerUserId: string | null,
  now = new Date(),
) {
  const viewerRole = viewerUserId === challenge.creatorUserId
    ? 'creator'
    : viewerUserId === challenge.opponentUserId
      ? 'opponent'
      : null;
  return {
    id: challenge.id,
    share_code: challenge.shareCode,
    challenge_id: buildFritzChallengeIdentity(challenge),
    fingerprint: buildFritzChallengeFingerprint(challenge),
    status: resolveVisibleStatus(challenge, now),
    format: 'best_of_3' as const,
    fritz_tier: challenge.config.fritzTier,
    deal_size: challenge.config.dealSize,
    winning_score: challenge.config.winningScore,
    has_opponent: Boolean(challenge.opponentUserId),
    viewer_role: viewerRole,
    created_at: challenge.createdAt,
    expires_at: challenge.expiresAt,
  };
}

function toFritzChallengeAttemptApiView(attempt: FritzChallengeAttemptRecord) {
  return {
    id: attempt.id,
    status: attempt.status,
    current_game_number: attempt.currentGameNumber,
    current_hand_index: attempt.currentHandIndex,
    final_score: attempt.finalScore,
    opponent_score: attempt.opponentScore,
    point_diff: attempt.pointDiff,
    won: attempt.won,
    moves_used: attempt.movesUsed,
    hands_played: attempt.handsPlayed,
    revision: attempt.revision,
    started_at: attempt.startedAt,
    updated_at: attempt.updatedAt,
    completed_at: attempt.completedAt,
  };
}

function readFritzChallengeGameScores(
  attempt: FritzChallengeAttemptRecord,
): { you: number; fritz: number } {
  const activeGame = attempt.result?.active_game;
  if (!activeGame || typeof activeGame !== 'object') return { you: 0, fritz: 0 };
  const record = activeGame as Record<string, unknown>;
  const you = Number(record.you);
  const fritz = Number(record.fritz);
  if (
    Number(record.game_number) !== attempt.currentGameNumber
    || !Number.isFinite(you)
    || !Number.isFinite(fritz)
    || you < 0
    || fritz < 0
  ) {
    return { you: 0, fritz: 0 };
  }
  return { you: Math.round(you), fritz: Math.round(fritz) };
}

function sendChallengeError(res: Response, error: unknown): void {
  if (error instanceof DailyFritzVerificationError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof FritzChallengeError) {
    const status = error.code === 'not_found'
      ? 404
      : error.code === 'not_participant'
        ? 403
        : error.code === 'version_mismatch'
          ? 426
      : error.code === 'opponent_already_claimed'
        || error.code === 'creator_cannot_join'
        || error.code === 'expired'
        ? 409
        : error.code === 'invalid_config'
          ? 400
          : 503;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({
    error: error instanceof Error ? error.message : 'Fritz Challenge request failed.',
  });
}

export function registerFritzChallengeRoutes(
  app: Application,
  deps: FritzChallengeRoutesDeps = DEFAULT_DEPS,
): void {
  app.post('/api/fritz-challenges', async (req, res) => {
    try {
      const userId = await deps.getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Sign in to create a Fritz Challenge.' });
        return;
      }
      const fritzTier = normalizeFritzChallengeTier(req.body?.fritz_tier);
      const dealSize = normalizeFritzChallengeDealSize(req.body?.deal_size);
      if (!fritzTier || !dealSize) {
        throw new FritzChallengeError(
          'Choose a valid Fritz tier and 7- or 14-tile format.',
          'invalid_config',
        );
      }
      const challenge = await deps.createChallenge({
        creatorUserId: userId,
        fritzTier,
        dealSize,
        now: deps.now(),
      });
      res.status(201).json({
        ok: true,
        challenge: toFritzChallengeApiView(challenge, userId, deps.now()),
        share_path: `/fritz/challenge/${challenge.shareCode}`,
      });
    } catch (error) {
      sendChallengeError(res, error);
    }
  });

  app.get('/api/fritz-challenges/:shareCode', async (req, res) => {
    try {
      const shareCode = normalizeFritzChallengeShareCode(req.params.shareCode);
      if (!shareCode) {
        res.status(400).json({ error: 'Invalid Fritz Challenge code.' });
        return;
      }
      const [challenge, viewerUserId] = await Promise.all([
        deps.getChallengeByCode(shareCode),
        deps.getAuthenticatedUserId(req),
      ]);
      if (!challenge) {
        throw new FritzChallengeError('Fritz Challenge not found.', 'not_found');
      }
      res.json({
        ok: true,
        challenge: toFritzChallengeApiView(challenge, viewerUserId, deps.now()),
      });
    } catch (error) {
      sendChallengeError(res, error);
    }
  });

  app.post('/api/fritz-challenges/:shareCode/join', async (req, res) => {
    try {
      const userId = await deps.getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Sign in to join this Fritz Challenge.' });
        return;
      }
      const shareCode = normalizeFritzChallengeShareCode(req.params.shareCode);
      if (!shareCode) {
        res.status(400).json({ error: 'Invalid Fritz Challenge code.' });
        return;
      }
      const challenge = await deps.getChallengeByCode(shareCode);
      if (!challenge) {
        throw new FritzChallengeError('Fritz Challenge not found.', 'not_found');
      }
      const joined = await deps.claimOpponent({
        challenge,
        userId,
        now: deps.now(),
      });
      res.json({
        ok: true,
        challenge: toFritzChallengeApiView(joined, userId, deps.now()),
      });
    } catch (error) {
      sendChallengeError(res, error);
    }
  });

  app.post('/api/fritz-challenges/:shareCode/start', async (req, res) => {
    try {
      const userId = await deps.getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Sign in to play this Fritz Challenge.' });
        return;
      }
      const shareCode = normalizeFritzChallengeShareCode(req.params.shareCode);
      if (!shareCode) {
        res.status(400).json({ error: 'Invalid Fritz Challenge code.' });
        return;
      }
      const challenge = await deps.getChallengeByCode(shareCode);
      if (!challenge) {
        throw new FritzChallengeError('Fritz Challenge not found.', 'not_found');
      }
      const requestedProtocol = Number(req.body?.verification_protocol_version);
      const requestedRules = Number(req.body?.game_rules_version);
      const requestedPolicy = Number(req.body?.fritz_policy_version);
      const requestedVerifier = Number(req.body?.verifier_version);
      if (
        requestedProtocol !== DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION
        || requestedRules !== GAME_RULES_VERSION
        || requestedPolicy !== FRITZ_POLICY_VERSION
        || requestedVerifier !== DAILY_FRITZ_VERIFIER_VERSION
        || requestedRules !== challenge.versions.rulesVersion
        || requestedPolicy !== challenge.versions.fritzPolicyVersion
        || requestedVerifier !== challenge.versions.verifierVersion
      ) {
        throw new FritzChallengeError(
          'This Fritz Challenge requires the latest verified client.',
          'version_mismatch',
        );
      }

      const start = await deps.startCommand({
        userId,
        challengeId: challenge.id,
        operationId: `start:${challenge.id}`,
        authorityResult: {
          authority_schema_version: 1,
          challenge_id: buildFritzChallengeIdentity(challenge),
          challenge_fingerprint: buildFritzChallengeFingerprint(challenge),
          game_rules_version: challenge.versions.rulesVersion,
          fritz_policy_version: challenge.versions.fritzPolicyVersion,
          verifier_version: challenge.versions.verifierVersion,
          verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
        },
      });
      if (start.outcome !== 'committed' || !start.response) {
        res.status(start.errorCode === 'operation_id_reused' ? 409 : 422).json({
          error: 'Challenge attempt could not be started transactionally.',
          code: start.errorCode ?? 'transactional_start_failed',
          authority_revision: start.committedRevision,
        });
        return;
      }
      const commandAttemptId = typeof start.response.attempt_id === 'string'
        ? start.response.attempt_id
        : '';
      const attempt = commandAttemptId
        ? await deps.getAttempt({ challengeId: challenge.id, userId })
        : null;
      if (!attempt) throw new FritzChallengeError('Challenge attempt was not readable after transactional start.', 'persistence_failed');
      const hand = await deps.getOrCreateHand({
        challenge,
        gameNumber: attempt.currentGameNumber,
        handIndex: attempt.currentHandIndex,
      });
      const drawWinner = getFritzChallengeDrawWinner(
        challenge.seed,
        attempt.currentGameNumber,
      );
      const drawTiles = getFritzChallengeDrawTiles(
        challenge.seed,
        attempt.currentGameNumber,
      );
      const scores = readFritzChallengeGameScores(attempt);

      res.json({
        ok: true,
        challenge: toFritzChallengeApiView(challenge, userId, deps.now()),
        attempt: toFritzChallengeAttemptApiView(attempt),
        challenge_id: buildFritzChallengeIdentity(challenge),
        challenge_code: challenge.shareCode,
        run_date: challenge.createdAt.slice(0, 10),
        verified_match_id: attempt.id,
        fingerprint: buildFritzChallengeFingerprint(challenge),
        verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
        game_rules_version: GAME_RULES_VERSION,
        fritz_policy_version: FRITZ_POLICY_VERSION,
        verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
        current_game_number: attempt.currentGameNumber,
        current_hand_index: attempt.currentHandIndex,
        current_game_scores: scores,
        fritz_tier: challenge.config.fritzTier,
        deal_size: challenge.config.dealSize,
        winning_score: challenge.config.winningScore,
        first_hand: hand,
        draw_winner: drawWinner,
        draw_player_tile: drawTiles.playerTile,
        draw_fritz_tile: drawTiles.fritzTile,
      });
    } catch (error) {
      sendChallengeError(res, error);
    }
  });

  app.post('/api/fritz-challenges/:shareCode/next-hand', async (req, res) => {
    try {
      const userId = await deps.getAuthenticatedUserId(req);
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const shareCode = normalizeFritzChallengeShareCode(req.params.shareCode);
      const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
      const verifiedMatchId = typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
      const gameNumber = Number(req.body?.game_number);
      const handIndex = Number(req.body?.completed_hand_index);
      if (!shareCode || !attemptId || verifiedMatchId !== attemptId || ![1, 2, 3].includes(gameNumber) || !Number.isInteger(handIndex) || handIndex < 0 || !req.body?.transcript) {
        res.status(400).json({ error: 'Challenge hand evidence is incomplete.' }); return;
      }
      const challenge = await deps.getChallengeByCode(shareCode);
      if (!challenge) throw new FritzChallengeError('Fritz Challenge not found.', 'not_found');
      if (userId !== challenge.creatorUserId && userId !== challenge.opponentUserId) {
        throw new FritzChallengeError('You are not a participant in this challenge.', 'not_participant');
      }
      const attempt = await deps.getAttempt({ challengeId: challenge.id, userId });
      if (!attempt || attempt.id !== attemptId || attempt.status !== 'started') {
        res.status(409).json({
          error: 'Challenge attempt is no longer active.',
          code: 'attempt_inactive',
        });
        return;
      }
      if (attempt.currentGameNumber !== gameNumber || attempt.currentHandIndex !== handIndex) {
        res.status(409).json({
          error: 'Challenge hand is no longer current.',
          code: 'stale_revision',
          recoverable: true,
          authority_revision: attempt.revision,
        });
        return;
      }
      const hand = await deps.getOrCreateHand({ challenge, gameNumber: gameNumber as 1 | 2 | 3, handIndex });
      const active = (attempt.result?.active_game ?? {}) as Record<string, unknown>;
      const scores = { you: Number(active.you) || 0, fritz: Number(active.fritz) || 0 };
      const drawWinner = getFritzChallengeDrawWinner(challenge.seed, gameNumber as 1 | 2 | 3);
      const verified = verifyDailyFritzHand({
        transcript: req.body.transcript,
        initialState: createOfficialDailyFritzHandState({
          deal: hand,
          handIndex,
          drawWinner,
          winningScore: challenge.config.winningScore,
          dealSize: challenge.config.dealSize,
          playerScore: scores.you,
          fritzScore: scores.fritz,
        }),
        expectedChallengeId: buildFritzChallengeIdentity(challenge),
        expectedAttemptId: attemptId,
        expectedGameNumber: gameNumber as 1 | 2 | 3,
        expectedHandIndex: handIndex,
        userId,
        fritzTier: challenge.config.fritzTier,
        expectedFritzPolicyVersion: challenge.versions.fritzPolicyVersion as FritzPolicyVersion,
      });
      if (verified.terminalState.gameOver) {
        res.status(409).json({ error: 'Challenge game is complete; finalize the game.' }); return;
      }
      const previousHands = Array.isArray(attempt.result?.authority_hands) ? attempt.result.authority_hands : [];
      const result: Record<string, unknown> = {
        ...(attempt.result ?? {}),
        active_game: { game_number: gameNumber, you: verified.result.playerScoreAfter, fritz: verified.result.fritzScoreAfter },
        authority_hands: [...previousHands, verified.result],
        last_transcript_digest: digestDailyFritzTranscript(verified.transcript),
      };
      const command = await deps.commitCommand({
        userId, attemptId, operationId: `hand:${gameNumber}:${handIndex}`,
        commandType: 'accept_verified_hand', expectedRevision: attempt.revision,
        next: {
          status: 'started', currentGameNumber: gameNumber as 1 | 2 | 3,
          currentHandIndex: handIndex + 1, result,
          movesUsed: (attempt.movesUsed ?? 0) + verified.result.actionCount,
          handsPlayed: (attempt.handsPlayed ?? 0) + 1,
        },
        handReceipt: verified.result,
        outbox: { eventType: 'hand_verified', payload: { gameNumber, handIndex } },
      });
      if (command.outcome !== 'committed') {
        res.status(409).json({
          error: 'Challenge advanced on another session. Resume from the authoritative state.',
          code: command.errorCode ?? 'challenge_command_rejected',
          recoverable: command.errorCode === 'stale_revision',
          authority_revision: command.committedRevision,
        });
        return;
      }
      const saved = await deps.getAttempt({ challengeId: challenge.id, userId });
      if (!saved) throw new FritzChallengeError('Challenge hand commit was not readable.', 'persistence_failed');
      const nextHand = await deps.getOrCreateHand({ challenge, gameNumber: gameNumber as 1 | 2 | 3, handIndex: saved.currentHandIndex });
      const drawTiles = getFritzChallengeDrawTiles(challenge.seed, gameNumber as 1 | 2 | 3);
      res.json({
        ok: true,
        run_date: challenge.createdAt.slice(0, 10),
        game_number: gameNumber,
        current_game_number: gameNumber,
        current_hand_index: saved.currentHandIndex,
        current_game_scores: readFritzChallengeGameScores(saved),
        authority_revision: saved.revision,
        hand: nextHand,
        draw_winner: drawWinner,
        draw_player_tile: drawTiles.playerTile,
        draw_fritz_tile: drawTiles.fritzTile,
      });
    } catch (error) { sendChallengeError(res, error); }
  });

  app.post('/api/fritz-challenges/:shareCode/record-game', async (req, res) => {
    try {
      const userId = await deps.getAuthenticatedUserId(req);
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const shareCode = normalizeFritzChallengeShareCode(req.params.shareCode);
      const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
      const gameNumber = Number(req.body?.game_number);
      if (!shareCode || !attemptId || ![1, 2, 3].includes(gameNumber)) { res.status(400).json({ error: 'Challenge game evidence is incomplete.' }); return; }
      const challenge = await deps.getChallengeByCode(shareCode);
      if (!challenge) throw new FritzChallengeError('Fritz Challenge not found.', 'not_found');
      const attempt = await deps.getAttempt({ challengeId: challenge.id, userId });
      if (!attempt || attempt.id !== attemptId) { res.status(409).json({ error: 'Challenge game is no longer current.' }); return; }
      const existingSet = (attempt.result?.set_result ?? null) as Record<string, any> | null;
      const existingGames = Array.isArray(existingSet?.games) ? existingSet.games : [];
      if (existingGames.some((game) => Number(game.gameNumber) === gameNumber)) {
        res.json({
          ok: true,
          replayed: true,
          set_result: existingSet,
          next_game_number: existingSet?.setWinner ? null : existingGames.length + 1,
        });
        return;
      }
      if (attempt.currentGameNumber !== gameNumber || attempt.status !== 'started') {
        res.status(409).json({
          error: 'Challenge game is no longer current.',
          code: 'stale_revision',
          recoverable: true,
          authority_revision: attempt.revision,
        });
        return;
      }
      const active = (attempt.result?.active_game ?? {}) as Record<string, unknown>;
      const terminalTranscript = req.body?.transcript;
      if (!terminalTranscript) { res.status(400).json({ error: 'The completed challenge hand requires verification evidence.' }); return; }
      const terminalHandIndex = attempt.currentHandIndex;
      const terminalHand = await deps.getOrCreateHand({ challenge, gameNumber: gameNumber as 1 | 2 | 3, handIndex: terminalHandIndex });
      const terminalDrawWinner = getFritzChallengeDrawWinner(challenge.seed, gameNumber as 1 | 2 | 3);
      const terminalVerified = verifyDailyFritzHand({
        transcript: terminalTranscript,
        initialState: createOfficialDailyFritzHandState({
          deal: terminalHand,
          handIndex: terminalHandIndex,
          drawWinner: terminalDrawWinner,
          winningScore: challenge.config.winningScore,
          dealSize: challenge.config.dealSize,
          playerScore: Number(active.you) || 0,
          fritzScore: Number(active.fritz) || 0,
        }),
        expectedChallengeId: buildFritzChallengeIdentity(challenge),
        expectedAttemptId: attemptId,
        expectedGameNumber: gameNumber as 1 | 2 | 3,
        expectedHandIndex: terminalHandIndex,
        userId,
        fritzTier: challenge.config.fritzTier,
        expectedFritzPolicyVersion: challenge.versions.fritzPolicyVersion as FritzPolicyVersion,
      });
      if (!terminalVerified.terminalState.gameOver) {
        const previousHands = Array.isArray(attempt.result?.authority_hands) ? attempt.result.authority_hands : [];
        const result: Record<string, unknown> = {
          ...(attempt.result ?? {}),
          active_game: {
            game_number: gameNumber,
            you: terminalVerified.result.playerScoreAfter,
            fritz: terminalVerified.result.fritzScoreAfter,
          },
          authority_hands: [...previousHands, terminalVerified.result],
          last_transcript_digest: digestDailyFritzTranscript(terminalVerified.transcript),
        };
        const command = await deps.commitCommand({
          userId, attemptId, operationId: `hand:${gameNumber}:${terminalHandIndex}`,
          commandType: 'accept_verified_hand', expectedRevision: attempt.revision,
          next: {
            status: 'started', currentGameNumber: gameNumber as 1 | 2 | 3,
            currentHandIndex: terminalHandIndex + 1, result,
            movesUsed: (attempt.movesUsed ?? 0) + terminalVerified.result.actionCount,
            handsPlayed: (attempt.handsPlayed ?? 0) + 1,
          },
          handReceipt: terminalVerified.result,
          outbox: { eventType: 'hand_verified', payload: { gameNumber, handIndex: terminalHandIndex } },
        });
        if (command.outcome !== 'committed') {
          res.status(409).json({ error: 'Challenge advanced on another session. Resume from the authoritative state.', code: command.errorCode, recoverable: command.errorCode === 'stale_revision', authority_revision: command.committedRevision });
          return;
        }
        const saved = await deps.getAttempt({ challengeId: challenge.id, userId });
        if (!saved) throw new FritzChallengeError('Challenge hand commit was not readable.', 'persistence_failed');
        const nextHand = await deps.getOrCreateHand({
          challenge,
          gameNumber: gameNumber as 1 | 2 | 3,
          handIndex: saved.currentHandIndex,
        });
        const drawWinner = getFritzChallengeDrawWinner(challenge.seed, gameNumber as 1 | 2 | 3);
        const drawTiles = getFritzChallengeDrawTiles(challenge.seed, gameNumber as 1 | 2 | 3);
        res.json({
          ok: true,
          hand_advanced: true,
          run_date: challenge.createdAt.slice(0, 10),
          game_number: gameNumber,
          current_game_number: gameNumber,
          current_hand_index: saved.currentHandIndex,
          current_game_scores: {
            you: terminalVerified.result.playerScoreAfter,
            fritz: terminalVerified.result.fritzScoreAfter,
          },
          authority_revision: saved.revision,
          hand: nextHand,
          draw_winner: drawWinner,
          draw_player_tile: drawTiles.playerTile,
          draw_fritz_tile: drawTiles.fritzTile,
        });
        return;
      }
      const finalScore = terminalVerified.result.playerScoreAfter;
      const opponentScore = terminalVerified.result.fritzScoreAfter;
      if (!Number.isFinite(finalScore) || !Number.isFinite(opponentScore) || finalScore === opponentScore || Math.max(finalScore, opponentScore) < challenge.config.winningScore) { res.status(409).json({ error: 'Challenge game is not complete.' }); return; }
      const set = (existingSet ?? { version: 2, format: 'best_of_3', playerGamesWon: 0, fritzGamesWon: 0, totalPointDiff: 0, games: [] }) as Record<string, any>;
      const games = Array.isArray(set.games) ? set.games : [];
      if (games.some((game) => Number(game.gameNumber) === gameNumber)) { res.json({ ok: true, replayed: true, set_result: set, next_game_number: set.setWinner ? null : games.length + 1 }); return; }
      const playerWon = finalScore > opponentScore;
      const game = { gameNumber, seed: `${challenge.seed}:game:${gameNumber}`, playerWon, playerScore: finalScore, fritzScore: opponentScore, pointDiff: finalScore - opponentScore, movesUsed: attempt.movesUsed ?? 0, handsPlayed: attempt.handsPlayed ?? 0, completedAt: new Date().toISOString() };
      const nextSet: Record<string, any> = { ...set, games: [...games, game], playerGamesWon: Number(set.playerGamesWon ?? 0) + (playerWon ? 1 : 0), fritzGamesWon: Number(set.fritzGamesWon ?? 0) + (playerWon ? 0 : 1), totalPointDiff: Number(set.totalPointDiff ?? 0) + game.pointDiff };
      const setWinner = nextSet.playerGamesWon >= 2 ? 'player' : nextSet.fritzGamesWon >= 2 ? 'fritz' : undefined;
      if (setWinner) nextSet.setWinner = setWinner;
      const completed = Boolean(setWinner);
      const previousHands = Array.isArray(attempt.result?.authority_hands) ? attempt.result.authority_hands : [];
      const result: Record<string, unknown> = {
        ...(attempt.result ?? {}),
        set_result: nextSet,
        authority_hands: [...previousHands, terminalVerified.result],
        last_transcript_digest: digestDailyFritzTranscript(terminalVerified.transcript),
      };
      const movesUsed = (attempt.movesUsed ?? 0) + terminalVerified.result.actionCount;
      const handsPlayed = (attempt.handsPlayed ?? 0) + 1;
      const command = await deps.commitCommand({
        userId, attemptId, operationId: `game:${gameNumber}:record`,
        commandType: 'record_verified_game', expectedRevision: attempt.revision,
        next: {
          status: completed ? 'completed' : 'started',
          currentGameNumber: completed ? gameNumber as 1 | 2 | 3 : (gameNumber + 1) as 1 | 2 | 3,
          currentHandIndex: completed ? terminalHandIndex : 0, result,
          finalScore: completed ? finalScore : null, opponentScore: completed ? opponentScore : null,
          pointDiff: completed ? game.pointDiff : null, won: completed ? playerWon : null,
          movesUsed, handsPlayed,
        },
        handReceipt: terminalVerified.result,
        gameReceipt: {
          gameNumber, playerScore: finalScore, fritzScore: opponentScore,
          pointDiff: game.pointDiff, playerWon, actionCount: movesUsed,
          handsPlayed, resultDigest: digestDailyFritzTranscript(terminalVerified.transcript),
        },
        outbox: {
          eventType: completed ? 'attempt_completed' : 'game_recorded',
          payload: { gameNumber, completed },
        },
      });
      if (command.outcome !== 'committed') {
        res.status(409).json({ error: 'Challenge game advanced on another session. Resume from the authoritative state.', code: command.errorCode, recoverable: command.errorCode === 'stale_revision', authority_revision: command.committedRevision });
        return;
      }
      const saved = await deps.getAttempt({ challengeId: challenge.id, userId });
      if (!saved) throw new FritzChallengeError('Challenge game commit was not readable.', 'persistence_failed');
      res.json({
        ok: true,
        set_result: saved.result?.set_result ?? nextSet,
        next_game_number: completed ? null : gameNumber + 1,
        authority_revision: saved.revision,
      });
    } catch (error) { sendChallengeError(res, error); }
  });
}
