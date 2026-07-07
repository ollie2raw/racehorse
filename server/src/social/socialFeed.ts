import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds, requireAuth } from './socialAuth';

export function registerSocialFeedRoutes(socialRouter: Router): void {
  socialRouter.get('/feed', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const friendIds = await getFriendIds(userId).catch(() => [] as string[]);
      const allIds = [userId, ...friendIds];
      const inFilter = allIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; type: string;
        metadata: Record<string, unknown>; created_at: string;
      }>>(
        `/rest/v1/activity_feed?or=(${inFilter})&order=created_at.desc&limit=50` +
        `&select=id,user_id,type,metadata,created_at`,
      );

      const feedUserIds = [...new Set(rows.map((r) => r.user_id))];
      const profileFilter = feedUserIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = profileFilter
        ? await supabaseFetch<Array<{ id: string; username: string }>>(
            `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
          )
        : [];
      const usernameMap = new Map((profiles as Array<{ id: string; username: string }>).map((p) => [p.id, p.username]));

      res.json({
        ok: true,
        feed: rows.map((r) => ({ ...r, username: usernameMap.get(r.user_id) ?? 'player' })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Feed unavailable.' });
    }
  });

  socialRouter.get('/feed/user/:userId', async (req, res) => {
    const requestorId = await requireAuth(req, res);
    if (!requestorId) return;
    const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
    try {
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; type: string;
        metadata: Record<string, unknown>; created_at: string;
      }>>(
        `/rest/v1/activity_feed?user_id=eq.${encodeURIComponent(targetId)}` +
        `&order=created_at.desc&limit=10&select=id,user_id,type,metadata,created_at`,
      );
      const profileRows = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&select=id,username&limit=1`,
      );
      const username = profileRows?.[0]?.username ?? 'player';
      res.json({ ok: true, feed: rows.map((r) => ({ ...r, username })) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Activity unavailable.' });
    }
  });
}