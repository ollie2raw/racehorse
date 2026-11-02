import type { Application } from 'express';
import { childLogger } from '../../logger';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { loadDailyFritzHandRecords, listDailyFritzHandDigests } from '../../dailyFritzHandRecords';
import { deriveDailyFritzSavedGame, listDailyFritzGames } from '../../dailyFritzSavedGame';
import { sendServerError } from '../errors';
import { getDailyFritzAttemptById, getDailyFritzRun, listDailyFritzAttemptsForUser, normalizeDailyFritzSetGameNumber } from '../stores/dailyFritzStore';
import { loadDailyFritzPublishedAuthority } from './dailyFritzPublishedAuthority';

const log = childLogger('daily-fritz-saved-games');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The Daily Fritz post-game review's read side (docs/daily-fritz-review-design.md, DF-3b). Read-only, owner-only, derived on request:
 *
 *   GET /api/daily-fritz/games                    the signed-in player's verified games, newest first, each marked reviewable or not
 *   GET /api/daily-fritz/game-record?attempt_id=&game_number=   one game in full (the multiplayer record format), or why it is not available
 *
 * Nothing here writes, and nothing in the existing Daily Fritz routes calls it. Someone else's attempt id reads as not found.
 */
export function registerDailyFritzGameRecordRoutes(app: Application): void {
  app.get('/api/daily-fritz/games', async (req, res) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const attempts = await listDailyFritzAttemptsForUser(userId, 30);
      const digests = await listDailyFritzHandDigests(userId, attempts.map((attempt) => attempt.id));
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json({ games: listDailyFritzGames(attempts, digests) });
    } catch (error) {
      sendServerError(res, error, 'Failed to list games.', { context: { userId } });
    }
  });

  app.get('/api/daily-fritz/game-record', async (req, res) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attemptId = typeof req.query.attempt_id === 'string' ? req.query.attempt_id.trim() : '';
    const gameNumber = normalizeDailyFritzSetGameNumber(Number(req.query.game_number));
    if (!UUID.test(attemptId) || !gameNumber) {
      res.status(400).json({ error: 'attempt_id and game_number are required.' });
      return;
    }
    try {
      const attempt = await getDailyFritzAttemptById(attemptId, userId);
      if (!attempt || attempt.id !== attemptId) {
        res.status(404).json({ error: 'Daily Fritz game not found.' });
        return;
      }
      const run = await getDailyFritzRun(attempt.runDate);
      if (!run) {
        res.status(404).json({ error: 'Review is not available for this game.', reason: 'run_not_found' });
        return;
      }
      const publishedChallenge = await loadDailyFritzPublishedAuthority({ attempt, run });
      const handRecords = await loadDailyFritzHandRecords(userId, attemptId, gameNumber);
      const derived = deriveDailyFritzSavedGame({ attempt, run, publishedChallenge, gameNumber, handRecords });
      if (!derived.ok) {
        // Declining is normal (a game from before hands were kept, a retired policy); it is logged at info and the player is told it is unavailable.
        log.info({ attemptId, gameNumber, reason: derived.reason }, 'daily fritz game not reviewable');
        res.status(404).json({ error: 'Review is not available for this game.', reason: derived.reason });
        return;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(derived.game);
    } catch (error) {
      sendServerError(res, error, 'Failed to read the game.', { context: { userId, attemptId, gameNumber } });
    }
  });
}
