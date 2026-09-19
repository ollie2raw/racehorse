import type { Application } from 'express';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { childLogger } from '../../logger';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { parseGameReviewRequestBody } from '../../reviewPersistence/gameReviewPayload';
import { insertGameReviewIdempotent } from '../../reviewPersistence/insertGameReviewIdempotent';
import {
  queryLatestGameReview,
  toGameReviewReadResult,
} from '../../reviewPersistence/queryLatestGameReview';
import { reconcileAccuracyModelResult } from '../../reviewPersistence/reconcileAccuracyModel';

const log = childLogger('game-reviews');

/**
 * E0c/E0d (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E):
 * server-side versioned review persistence -- write (E0c) and read/reopen
 * (E0d) sides. Auth follows dailyFritzRecordGameRoute.ts's
 * getAuthenticatedUserId gate on both routes; the insert follows
 * insertRankedGameIdempotent.ts's on_conflict pattern (ENGINEERING_GUARDRAILS.md
 * §3) via insertGameReviewIdempotent, and the read follows
 * getDailyFritzAttemptById's explicit-ownership-filter pattern
 * (dailyFritzStore.ts:581-591) via queryLatestGameReview -- see that
 * function's own doc comment for why the filter, not RLS, is what actually
 * enforces ownership here.
 *
 * This module persists/returns a caller-supplied, already-computed review
 * (evaluations + accuracyModelResult, per E0b). E2 adds an observability-only
 * server-side accuracy-model reconciliation after a successful write; it
 * does not make the persisted review authoritative or block the write.
 *
 * TRUST BOUNDARY: the write still persists the client assertion and the
 * reconciliation is observability-only; neither route treats a row as
 * verified. Persisted game_reviews rows must never be treated as authoritative
 * for anything competitive or comparative (leaderboards, rankings,
 * achievements, public-facing stats) unless/until a server-side
 * verification step is added. This is a personal review record, not a
 * verified result like ranked_games. The read response carries this
 * forward structurally, not just as a comment: every response stamps
 * `source: 'client-asserted'` (queryLatestGameReview.ts), so a future UI
 * consumer has a signal it can't accidentally drop.
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

      try {
        const reconciliation = reconcileAccuracyModelResult(
          parsed.evaluations as readonly ReviewEvaluationV1[],
          parsed.accuracyModelResult,
        );
        if (reconciliation.mismatches.length > 0 && reconciliation.serverDerived) {
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
      } catch {
        // Reconciliation is strictly observability-only; never alter a success response.
      }
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'insert failed');
      res.status(500).json({ error: 'Failed to persist game review.' });
    }
  });

  /**
   * E0d: returns the latest (by created_at) game_reviews row for a given
   * gameDigest, scoped to the authenticated user. Query param surface is
   * deliberately just `gameDigest` today -- an optional exact-version-match
   * (reviewEngineVersion/accuracyModelVersion query params, falling back to
   * "latest" when omitted) is additive to add later, not built here.
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
      res.status(200).json(toGameReviewReadResult(row));
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'read failed');
      res.status(500).json({ error: 'Failed to read game review.' });
    }
  });
}
