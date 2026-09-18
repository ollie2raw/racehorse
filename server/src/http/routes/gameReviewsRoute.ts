import type { Application } from 'express';
import { childLogger } from '../../logger';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { parseGameReviewRequestBody } from '../../reviewPersistence/gameReviewPayload';
import { insertGameReviewIdempotent } from '../../reviewPersistence/insertGameReviewIdempotent';

const log = childLogger('game-reviews');

/**
 * E0c (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E): the
 * idempotent write side of server-side versioned review persistence. Auth
 * follows dailyFritzRecordGameRoute.ts's getAuthenticatedUserId gate; the
 * insert itself follows insertRankedGameIdempotent.ts's on_conflict pattern
 * (ENGINEERING_GUARDRAILS.md §3) via insertGameReviewIdempotent.
 *
 * This route only persists a caller-supplied, already-computed review
 * (evaluations + accuracyModelResult, per E0b) -- it does not run the review
 * engine itself. Wiring a real PVF post-game write call site is E1's job,
 * not this one's.
 *
 * TRUST BOUNDARY: this route does not verify the request body against any
 * server-side recomputation -- evaluations/accuracyModelResult are exactly
 * what the client asserts them to be, the same trust level as any other
 * client-submitted jsonb blob. Persisted game_reviews rows must never be
 * treated as authoritative for anything competitive or comparative
 * (leaderboards, rankings, achievements, public-facing stats) unless/until a
 * server-side verification step is added. This is a personal review record,
 * not a verified result like ranked_games.
 */
export function registerGameReviewsRoute(app: Application): void {
  app.post('/api/game-reviews', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = parseGameReviewRequestBody(req.body, authenticatedUserId);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      const result = await insertGameReviewIdempotent(parsed);
      res.status(result.isNew ? 201 : 200).json({
        isNew: result.isNew,
        review: result.review,
      });
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'insert failed');
      res.status(500).json({ error: 'Failed to persist game review.' });
    }
  });
}
