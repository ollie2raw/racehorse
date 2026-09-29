import type { Application } from 'express';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { childLogger } from '../../logger';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { parseGameReviewRequestBody } from '../../reviewPersistence/gameReviewPayload';
import { insertGameReviewIdempotent } from '../../reviewPersistence/insertGameReviewIdempotent';
import {
  queryGameReviewById,
  queryLatestGameReview,
  queryRecentGameReviews,
  toGameReviewListEntry,
  toGameReviewReadResult,
} from '../../reviewPersistence/queryLatestGameReview';
import { reconcileAccuracyModelResult } from '../../reviewPersistence/reconcileAccuracyModel';
import { isGameReviewCohortUser } from '../../reviewPersistence/gameReviewCohort';

const log = childLogger('game-reviews');

/**
 * E0c/E0d + F1e-5: server-side versioned review persistence — write, latest
 * digest read, exact review-id read, and recent-list for history entry.
 *
 * TRUST BOUNDARY unchanged: client-asserted rows; every read stamps
 * `source: 'client-asserted'`. Replay artifacts are never recomputed on read.
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
    if (parsed.mode !== 'pvf' && !isGameReviewCohortUser(authenticatedUserId)) {
      res.status(403).json({ error: 'Post-game review is not enabled for this account.' });
      return;
    }

    let result;
    try {
      result = await insertGameReviewIdempotent(parsed);
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'insert failed');
      res.status(500).json({ error: 'Failed to persist game review.' });
      return;
    }

    res.status(result.isNew ? 201 : 200).json({
      isNew: result.isNew,
      review: result.review,
    });

    const reconciliation = reconcileAccuracyModelResult(
      parsed.evaluations as readonly ReviewEvaluationV1[],
      parsed.accuracyModelResult,
    );
    if (reconciliation.reconciliationError) {
      log.warn(
        {
          gameDigest: parsed.gameDigest,
          userId: authenticatedUserId,
          err: reconciliation.reconciliationError,
        },
        'accuracy model reconciliation failed',
      );
    } else if (reconciliation.mismatches.length > 0 && reconciliation.serverDerived) {
      log.warn(
        {
          gameDigest: parsed.gameDigest,
          userId: authenticatedUserId,
          clientAssertedAccuracyModelResult: parsed.accuracyModelResult,
          serverDerivedAccuracyModelResult: reconciliation.serverDerived,
          mismatches: reconciliation.mismatches,
        },
        'client/server accuracy model mismatch',
      );
    }
  });

  /**
   * Exact review-id read. Prefer this for historical reopen when the client
   * holds a stable review id — does not silently upgrade to a newer row.
   */
  app.get('/api/game-reviews/by-id/:reviewId', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const reviewId = typeof req.params.reviewId === 'string' ? req.params.reviewId.trim() : '';
    if (!reviewId) {
      res.status(400).json({ error: 'reviewId is required.' });
      return;
    }

    try {
      const row = await queryGameReviewById(authenticatedUserId, reviewId);
      if (!row) {
        res.status(404).json({ error: 'This game has not been analyzed yet.' });
        return;
      }
      if (row.mode !== 'pvf' && !isGameReviewCohortUser(authenticatedUserId)) {
        res.status(404).json({ error: 'This game has not been analyzed yet.' });
        return;
      }
      res.status(200).json(toGameReviewReadResult(row));
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'read-by-id failed');
      res.status(500).json({ error: 'Failed to read game review.' });
    }
  });

  app.get('/api/game-reviews/recent', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!isGameReviewCohortUser(authenticatedUserId)) {
      res.status(403).json({ error: 'Post-game review is not enabled for this account.' });
      return;
    }

    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

    try {
      const rows = await queryRecentGameReviews(authenticatedUserId, limit);
      res.status(200).json({ reviews: rows.map(toGameReviewListEntry) });
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'list recent failed');
      res.status(500).json({ error: 'Failed to list game reviews.' });
    }
  });

  /**
   * E0d: returns the latest (by created_at) game_reviews row for a given
   * gameDigest. Prefer `/by-id/:reviewId` for exact historical replay.
   */
  app.get('/api/game-reviews', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const gameDigest = typeof req.query.gameDigest === 'string' ? req.query.gameDigest.trim() : '';
    if (!gameDigest) {
      res.status(400).json({ error: 'gameDigest is required.' });
      return;
    }

    try {
      const row = await queryLatestGameReview(authenticatedUserId, gameDigest);
      if (!row) {
        res.status(404).json({ error: 'This game has not been analyzed yet.' });
        return;
      }
      if (row.mode !== 'pvf' && !isGameReviewCohortUser(authenticatedUserId)) {
        res.status(404).json({ error: 'This game has not been analyzed yet.' });
        return;
      }
      res.status(200).json(toGameReviewReadResult(row));
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'read failed');
      res.status(500).json({ error: 'Failed to read game review.' });
    }
  });

  app.get('/api/game-reviews/access', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.status(200).json({ enabled: isGameReviewCohortUser(authenticatedUserId) });
  });
}
