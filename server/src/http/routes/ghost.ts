import type { Application, Request } from 'express';
import type { BotMatchPendingRow } from '../../supabaseTypes';
import {
  completeGhostGame as completeGhostGameDefault,
  getGhostProfileSummary,
  getGhostProfileSummaryByUsername,
  type GhostMoveLogEntry,
} from '../../ghost/service';
import {
  createRankedDealSnapshot,
  isRankedDealSnapshot,
  isSafeRankedMoveSequence,
  rankedDealStartPayload,
  replayRankedMoveLog,
  type RankedDealSnapshot,
} from '../../ghost/rankedDealAuthority';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';
import { setPublicShortCache } from './cacheControl';
import { verifyPlayerMoveLog } from '../../ghost/verifier';

export type GhostRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  isFritzId: (id: string) => boolean;
  getVerifiedSinglePlayerMatch: (matchId: string) => Promise<VerifiedSinglePlayerMatch | null>;
  persistVerifiedSinglePlayerMatch: (record: VerifiedSinglePlayerMatch) => Promise<VerifiedSinglePlayerMatch>;
  startVerifiedSinglePlayerMatch: (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
    dealSnapshot?: RankedDealSnapshot | null;
  }) => Promise<VerifiedSinglePlayerMatch>;
  isSafeGhostMoveLog: (raw: unknown) => raw is Array<Record<string, unknown>>;
  buildGhostCompletionHash: (params: {
    userId: string;
    localMatchId: string | null;
    matchId: string;
    opponentUserId: string | null;
    finalScore: number;
    opponentScore: number;
    moveLog: GhostMoveLogEntry[];
    playerMoveLog?: GhostMoveLogEntry[];
  }) => string;
  writeMatchActivity: (params: {
    winnerUserId: string | null;
    loserUserId: string | null;
    winnerUsername: string;
    loserUsername: string;
    mode: string;
    winnerScore: number | null;
    loserScore: number | null;
    fritzTier?: string | null;
  }) => Promise<unknown>;
  formatFritzActivityOpponentLabel: (rawTier: string) => string;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  completeGhostGame?: typeof completeGhostGameDefault;
};

export function registerGhostRoutes(app: Application, deps: GhostRouteDeps): void {
  const {
    getAuthenticatedUserId,
    isFritzId,
    getVerifiedSinglePlayerMatch,
    persistVerifiedSinglePlayerMatch,
    startVerifiedSinglePlayerMatch,
    isSafeGhostMoveLog,
    buildGhostCompletionHash,
    writeMatchActivity,
    formatFritzActivityOpponentLabel,
    supabaseFetch,
    completeGhostGame = completeGhostGameDefault,
  } = deps;

  app.get('/api/ghost/profile/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const summary = await getGhostProfileSummary(userId);
      setPublicShortCache(res, 60, 300);
      res.json({ ok: true, summary });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
      });
    }
  });

  app.get('/api/ghost/profile-by-username/:username', async (req, res) => {
    const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
    if (!username) {
      res.status(400).json({ error: 'username is required.' });
      return;
    }

    try {
      const result = await getGhostProfileSummaryByUsername(username);
      setPublicShortCache(res, 60, 300);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
      });
    }
  });

  app.post('/api/ghost/complete', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const matchId =
      typeof req.body?.matchId === 'string' && req.body.matchId.trim() ? req.body.matchId.trim() : '';
    const opponentUserId =
      typeof req.body?.opponentUserId === 'string' && req.body.opponentUserId.trim()
        ? req.body.opponentUserId.trim()
        : null;
    const localMatchId =
      typeof req.body?.localMatchId === 'string' && req.body.localMatchId.trim()
        ? req.body.localMatchId.trim()
        : null;
    const finalScore = Number(req.body?.finalScore);
    const opponentScore = Number(req.body?.opponentScore);
    const moveLog = Array.isArray(req.body?.moveLog) ? req.body.moveLog : null;
    const playerMoveLog = Array.isArray(req.body?.playerMoveLog) ? req.body.playerMoveLog : undefined;

    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }
    if (!matchId) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }
    if (!Number.isFinite(finalScore) || !Number.isFinite(opponentScore)) {
      res.status(400).json({ error: 'finalScore and opponentScore are required.' });
      return;
    }
    if (
      !Number.isInteger(finalScore) ||
      !Number.isInteger(opponentScore) ||
      finalScore < 0 ||
      opponentScore < 0 ||
      finalScore > 200 ||
      opponentScore > 200
    ) {
      res.status(400).json({ error: 'Scores must be integers between 0 and 200.' });
      return;
    }
    const isFritzMatch = Boolean(opponentUserId && isFritzId(opponentUserId));
    if (!isFritzMatch && (!moveLog || !isSafeGhostMoveLog(moveLog))) {
      res.status(400).json({ error: 'moveLog is required.' });
      return;
    }
    if (playerMoveLog && !isFritzMatch && !isSafeGhostMoveLog(playerMoveLog)) {
      res.status(400).json({ error: 'playerMoveLog is invalid.' });
      return;
    }
    if (opponentUserId && opponentUserId === userId) {
      res.status(400).json({ error: 'opponentUserId must refer to another player.' });
      return;
    }
    if (localMatchId && localMatchId.length > 128) {
      res.status(400).json({ error: 'localMatchId is invalid.' });
      return;
    }
    const safeMoveLog = (moveLog ?? []) as GhostMoveLogEntry[];
    const safePlayerMoveLog = playerMoveLog as GhostMoveLogEntry[] | undefined;
    const rankedSequence = isSafeRankedMoveSequence(moveLog)
      ? moveLog
      : isSafeRankedMoveSequence(playerMoveLog)
        ? playerMoveLog
        : null;
    if (isFritzMatch && !rankedSequence && (!safePlayerMoveLog || safePlayerMoveLog.length === 0)) {
      res.status(400).json({ error: 'moveLog is required for Fritz matches.' });
      return;
    }
    if (!isFritzMatch && !rankedSequence) {
      const trainingMoveLog =
        safePlayerMoveLog && safePlayerMoveLog.length > 0 ? safePlayerMoveLog : safeMoveLog;
      const playerScoredPoints = trainingMoveLog.reduce(
        (sum, entry) => sum + Math.max(0, Number(entry.score_delta ?? 0)),
        0,
      );
      if (playerScoredPoints > finalScore) {
        res.status(400).json({ error: 'player scoring log exceeds finalScore.' });
        return;
      }
      const opponentScoredPoints = safeMoveLog
        .filter((entry) => entry.actor === 'ghost')
        .reduce((sum, entry) => sum + Math.max(0, Number(entry.score_delta ?? 0)), 0);
      if (opponentScoredPoints > opponentScore) {
        res.status(400).json({ error: 'ghost scoring log exceeds opponentScore.' });
        return;
      }
      // RT-2 (HARDENING_PLAN §9.3): strict, matching the live-room path
      // (gameOverPersistence.ts). Root cause of the historical lenient-only
      // failures fixed client-side (playerGhostSync.ts / botGhostSync.ts —
      // a multi-draw turn now logs one entry per real draw instead of one
      // entry standing in for the whole sequence), so this no longer needs
      // the "unlogged boneyard draws" tolerance going forward.
      const moveLogVerification = verifyPlayerMoveLog(trainingMoveLog, { strictHandContinuity: true });
      if (!moveLogVerification.ok) {
        res.status(400).json({
          error: `Invalid move log: ${moveLogVerification.reason}`,
          entryIndex: moveLogVerification.entryIndex,
        });
        return;
      }
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const verifiedMatch = await getVerifiedSinglePlayerMatch(matchId);
      if (!verifiedMatch) {
        res.status(404).json({ error: 'Verified match not found.' });
        return;
      }
      if (verifiedMatch.userId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (verifiedMatch.localMatchId !== (localMatchId ?? verifiedMatch.localMatchId)) {
        res.status(409).json({ error: 'localMatchId does not match verified session.' });
        return;
      }
      if (verifiedMatch.opponentUserId !== opponentUserId) {
        res.status(409).json({ error: 'opponentUserId does not match verified session.' });
        return;
      }
      if (verifiedMatch.mode !== (isFritzMatch ? 'fritz' : 'ghost')) {
        res.status(409).json({ error: 'verified session mode mismatch.' });
        return;
      }

      // Ranked-write parity: every mode that can move a rating (Fritz Glicko or
      // non-Fritz ghost_rating) is scored the same way — exact replay against a
      // server-owned deal snapshot from /start, never the client-submitted
      // finalScore/opponentScore. A match with no snapshot to replay against
      // fails closed (applyGlicko: false) rather than trusting the client value.
      let scoredFinal = finalScore;
      let scoredOpponent = opponentScore;
      let applyGlicko = false;
      if (isRankedDealSnapshot(verifiedMatch.dealSnapshot)) {
        if (!rankedSequence) {
          res.status(400).json({ error: 'moveLog is required to verify a ranked completion.' });
          return;
        }
        const replayed = replayRankedMoveLog(verifiedMatch.dealSnapshot, rankedSequence);
        if (!replayed.ok) {
          res.status(409).json({
            error: replayed.reason,
            entryIndex: replayed.entryIndex,
          });
          return;
        }
        scoredFinal = replayed.playerScore;
        scoredOpponent = replayed.opponentScore;
        applyGlicko = true;
      } else {
        console.warn('[ranked-ghost] missing deal snapshot; completing unranked', {
          matchId,
          userId,
          mode: isFritzMatch ? 'fritz' : 'ghost',
        });
      }

      const completionHash = buildGhostCompletionHash({
        userId,
        localMatchId,
        matchId,
        opponentUserId,
        finalScore: scoredFinal,
        opponentScore: scoredOpponent,
        moveLog: safeMoveLog,
        playerMoveLog: safePlayerMoveLog,
      });
      if (verifiedMatch.status === 'completed') {
        if (verifiedMatch.completionHash === completionHash && verifiedMatch.completionResult) {
          res.json({ ok: true, result: verifiedMatch.completionResult, replayed: true });
          return;
        }
        res.status(409).json({ error: 'Match result already finalized.' });
        return;
      }
      if (verifiedMatch.status === 'abandoned') {
        res.status(409).json({ error: 'Verified match was already abandoned.' });
        return;
      }
      if (isFritzMatch && localMatchId) {
        const roomCode = `local:${localMatchId}`;
        const pendingRows = await supabaseFetch<any[]>(
          `/rest/v1/bot_match_pending?select=id,resolved&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&order=started_at.desc,id.desc&limit=1`,
        );
        if (!pendingRows?.[0]?.id) {
          res.status(409).json({ error: 'No pending Fritz match found for this local match.' });
          return;
        }
      }

      const result = await completeGhostGame({
        userId,
        opponentUserId,
        finalScore: scoredFinal,
        opponentScore: scoredOpponent,
        moveLog: safeMoveLog,
        playerMoveLog: safePlayerMoveLog,
        matchId,
        applyGlicko,
      });
      verifiedMatch.status = 'completed';
      verifiedMatch.completedAt = new Date().toISOString();
      verifiedMatch.completionHash = completionHash;
      verifiedMatch.completionResult = result;
      await persistVerifiedSinglePlayerMatch(verifiedMatch);
      if (isFritzMatch && localMatchId) {
        const roomCode = `local:${localMatchId}`;
        await supabaseFetch(
          `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ resolved: true }),
          },
        );
      }
      if (isFritzMatch) {
        const playerWon = Math.round(scoredFinal) > Math.round(scoredOpponent);
        const fritzLabel = formatFritzActivityOpponentLabel(verifiedMatch.fritzTier ?? 'elite');
        const roundedPlayerScore = Math.round(scoredFinal);
        const roundedFritzScore = Math.round(scoredOpponent);
        void writeMatchActivity({
          winnerUserId: playerWon ? userId : null,
          loserUserId: playerWon ? null : userId,
          winnerUsername: playerWon ? 'Player' : fritzLabel,
          loserUsername: playerWon ? fritzLabel : 'Player',
          mode: 'bot',
          winnerScore: playerWon ? roundedPlayerScore : roundedFritzScore,
          loserScore: playerWon ? roundedFritzScore : roundedPlayerScore,
          fritzTier: verifiedMatch.fritzTier ?? 'elite',
        }).catch(() => {});
      }
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to complete ghost game.',
      });
    }
  });

  app.post('/api/ghost/start', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    const opponentUserId =
      typeof req.body?.opponentUserId === 'string' && req.body.opponentUserId.trim()
        ? req.body.opponentUserId.trim()
        : null;
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { snapshot } = createRankedDealSnapshot({
        dealSize: Number(req.body?.dealSize),
        winningScore: Number(req.body?.winningScore),
        matchStarter: typeof req.body?.matchStarter === 'string' ? req.body.matchStarter : null,
      });
      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId,
        localMatchId,
        mode: 'ghost',
        opponentUserId,
        dealSnapshot: snapshot,
      });
      res.json(rankedDealStartPayload(verifiedMatch));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start verified ghost match.',
      });
    }
  });
}