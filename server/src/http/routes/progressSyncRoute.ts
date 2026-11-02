import type { Application, Request, Response } from 'express';
import { childLogger } from '../../logger';
import { apiGeneralLimiter } from '../../middleware/rateLimiter';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import {
  isMissingTableError,
  loadJourneyProgress,
  mergeStoredJourneyProgress,
  parseJourneyProgress,
  progressSyncEnabled,
} from '../../playerProgress';
import { sendServerError } from '../errors';

const log = childLogger('progress-sync');

/** A missing table (the flag set before the SQL was applied) would otherwise warn on every request. */
const WARN_EVERY_MS = 60_000;
let lastMissingTableWarnAt = 0;
export function resetProgressSyncWarningThrottleForTests(): void {
  lastMissingTableWarnAt = 0;
}

function noteMissingTable(): void {
  const now = Date.now();
  if (now - lastMissingTableWarnAt < WARN_EVERY_MS) return;
  lastMissingTableWarnAt = now;
  log.warn('progress sync is enabled but public.player_progress does not exist; apply supabase/migrations/2026-11-02_player_progress.sql');
}

function notEnabled(res: Response, reason: 'disabled' | 'unavailable'): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ enabled: false, reason });
}

/**
 * Journey progress that follows the account (docs/progress-sync.md). Owner only (the signed-in user's id is the only key), never cached.
 *
 *   GET  /api/progress/journey                  { enabled, progress | null }
 *   POST /api/progress/journey { progress }     union it into what is stored, answer with the union: { enabled, progress }
 *
 * "Not enabled" is a normal 200 and not an error, so a client simply does nothing: the flag is off (PROGRESS_SYNC_ENABLED), or the table has not been created.
 */
export function registerProgressSyncRoutes(app: Application): void {
  async function guard(req: Request, res: Response): Promise<string | null> {
    if (!progressSyncEnabled()) {
      notEnabled(res, 'disabled');
      return null;
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return userId;
  }

  app.get('/api/progress/journey', apiGeneralLimiter, async (req, res) => {
    const userId = await guard(req, res);
    if (!userId) return;
    try {
      const progress = await loadJourneyProgress(userId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json({ enabled: true, progress });
    } catch (error) {
      if (isMissingTableError(error)) {
        noteMissingTable();
        notEnabled(res, 'unavailable');
        return;
      }
      sendServerError(res, error, 'Failed to read progress.', { context: { userId } });
    }
  });

  app.post('/api/progress/journey', apiGeneralLimiter, async (req, res) => {
    const userId = await guard(req, res);
    if (!userId) return;
    const incoming = parseJourneyProgress((req.body as { progress?: unknown } | undefined)?.progress);
    if (!incoming) {
      res.status(400).json({ error: 'progress is malformed.' });
      return;
    }
    try {
      const progress = await mergeStoredJourneyProgress(userId, incoming);
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json({ enabled: true, progress });
    } catch (error) {
      if (isMissingTableError(error)) {
        noteMissingTable();
        notEnabled(res, 'unavailable');
        return;
      }
      sendServerError(res, error, 'Failed to save progress.', { context: { userId } });
    }
  });
}
