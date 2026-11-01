import type { Application } from 'express';
import { childLogger } from '../../logger';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { parseGameRecordRequestBody } from '../../gameRecords/gameRecordPayload';
import { verifyGameRecord } from '../../gameRecords/verifyGameRecord';
import { insertGameRecordIdempotent } from '../../gameRecords/insertGameRecord';

const log = childLogger('game-records');

/**
 * Saved game record (docs/review-game-record-architecture.md, Phase 2). The client sends the finished game once, from
 * a durable outbox that retries until this answers 2xx; the server stores it idempotently and says how much of it
 * it could verify. Review is derived from the saved record later.
 */
export function registerGameRecordsRoute(app: Application): void {
  app.post('/api/game-records', async (req, res) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseGameRecordRequestBody(req.body, authenticatedUserId);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      const verification = await verifyGameRecord(parsed);
      const result = await insertGameRecordIdempotent(parsed, verification);
      if (verification === 'replay_mismatch') {
        log.warn(
          { userId: authenticatedUserId, sourceMatchId: parsed.sourceMatchId, moves: parsed.moves.length },
          'game record does not replay to the submitted result',
        );
      }
      res.status(result.isNew ? 201 : 200).json({
        isNew: result.isNew,
        sourceMatchId: parsed.sourceMatchId,
        verification: result.isNew ? result.record.verification : null,
      });
    } catch (error) {
      log.error({ err: error, userId: authenticatedUserId }, 'game record save failed');
      res.status(500).json({ error: 'Failed to save the game.' });
    }
  });
}
