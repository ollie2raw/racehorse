import { Router } from 'express';
import { childLogger } from '../logger';
import { requireAuth } from '../social/socialAuth';
import { supabaseFetch } from '../supabaseUtils';
import { createBlock, deleteBlock, listBlockedByUser } from './blockStore';
import {
  MAX_REPORTS_PER_REPORTER_PER_DAY,
  isReportCategory,
  isReportSource,
  isUserId,
} from './moderationPolicy';

const log = childLogger('moderation');

async function profileExists(userId: string): Promise<boolean> {
  const rows = await supabaseFetch<Array<{ id: string }>>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function reportsFiledSince(reporterUserId: string, sinceIso: string): Promise<number> {
  const rows = await supabaseFetch<Array<{ id: string }>>(
    `/rest/v1/user_reports?reporter_user_id=eq.${encodeURIComponent(reporterUserId)}` +
      `&created_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=${MAX_REPORTS_PER_REPORTER_PER_DAY + 1}`,
  );
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Player reporting and blocking — the minimum moderation model for App Store
 * Guideline 1.2.
 *
 * The reporter / blocker is always the verified bearer-token user; nothing in
 * the request body can name someone else. There is no endpoint that reads
 * reports: they are reviewed by the owner with the service role. The block
 * list endpoint returns only the caller's own blocks, never who has blocked
 * them.
 */
export function registerModerationRoutes(router: Router): void {
  router.post('/reports', async (req, res) => {
    const reporterUserId = await requireAuth(req, res);
    if (!reporterUserId) return;

    const { reportedUserId, category, source } = (req.body ?? {}) as Record<string, unknown>;
    if (!isUserId(reportedUserId)) { res.status(400).json({ error: 'reportedUserId is required.' }); return; }
    if (!isReportCategory(category)) { res.status(400).json({ error: 'Unknown report category.' }); return; }
    if (!isReportSource(source)) { res.status(400).json({ error: 'Unknown report source.' }); return; }
    if (reportedUserId === reporterUserId) { res.status(400).json({ error: 'You cannot report yourself.' }); return; }

    try {
      if (!(await profileExists(reportedUserId))) { res.status(404).json({ error: 'Player not found.' }); return; }

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      if ((await reportsFiledSince(reporterUserId, since)) >= MAX_REPORTS_PER_REPORTER_PER_DAY) {
        res.status(429).json({ error: 'Too many reports today. Try again tomorrow.' });
        return;
      }

      await supabaseFetch('/rest/v1/user_reports?on_conflict=reporter_user_id,reported_user_id,category', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({
          reporter_user_id: reporterUserId,
          reported_user_id: reportedUserId,
          category,
          source,
        }),
      });
      log.info({ category, source }, 'player report filed');
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'player report failed');
      res.status(500).json({ error: 'Unable to send the report.' });
    }
  });

  router.get('/blocks', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      res.json({ ok: true, blockedUserIds: await listBlockedByUser(userId) });
    } catch (err) {
      log.error({ err }, 'block list failed');
      res.status(500).json({ error: 'Unable to load blocked players.' });
    }
  });

  router.post('/blocks/:userId', async (req, res) => {
    const blockerUserId = await requireAuth(req, res);
    if (!blockerUserId) return;
    const blockedUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!isUserId(blockedUserId)) { res.status(400).json({ error: 'userId is required.' }); return; }
    if (blockedUserId === blockerUserId) { res.status(400).json({ error: 'You cannot block yourself.' }); return; }
    try {
      if (!(await profileExists(blockedUserId))) { res.status(404).json({ error: 'Player not found.' }); return; }
      await createBlock(blockerUserId, blockedUserId);
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'block failed');
      res.status(500).json({ error: 'Unable to block this player.' });
    }
  });

  router.delete('/blocks/:userId', async (req, res) => {
    const blockerUserId = await requireAuth(req, res);
    if (!blockerUserId) return;
    const blockedUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!isUserId(blockedUserId)) { res.status(400).json({ error: 'userId is required.' }); return; }
    try {
      await deleteBlock(blockerUserId, blockedUserId);
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'unblock failed');
      res.status(500).json({ error: 'Unable to unblock this player.' });
    }
  });
}

export const moderationRouter = Router();
registerModerationRoutes(moderationRouter);
