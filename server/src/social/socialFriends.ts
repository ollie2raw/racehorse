import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { friendIdsFromRows, getFriendRows, requireAuth } from './socialAuth';
import { getPresenceBatch } from './presenceRegistry';

export function registerSocialFriendsRoutes(socialRouter: Router): void {
  socialRouter.get('/friends/requests', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{
        id: string; user_id: string; friend_user_id: string; created_at: string;
      }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
        `&status=eq.pending&select=id,user_id,friend_user_id,created_at`,
      );
      const otherIds = [...new Set(rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id)))];
      const profileMap = new Map<string, string>();
      if (otherIds.length) {
        const filter = otherIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
        const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${filter})&select=id,username`,
        );
        for (const p of profiles) profileMap.set(p.id, p.username);
      }
      const incoming = rows
        .filter((r) => r.friend_user_id === userId)
        .map((r) => ({ id: r.id, userId: r.user_id, username: profileMap.get(r.user_id) ?? 'player', created_at: r.created_at }));
      const outgoing = rows
        .filter((r) => r.user_id === userId)
        .map((r) => ({ id: r.id, userId: r.friend_user_id, username: profileMap.get(r.friend_user_id) ?? 'player', created_at: r.created_at }));
      res.json({ ok: true, incoming, outgoing });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Requests unavailable.' });
    }
  });

  socialRouter.get('/friends/with-presence', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    try {
      // One friends read, not two: this handler used to call getFriendIds and
      // then re-run the same query just to also select `id`.
      const rows = await getFriendRows(userId);
      const friendIds = friendIdsFromRows(userId, rows);
      if (!friendIds.length) { res.json({ ok: true, friends: [] }); return; }

      const profileFilter = friendIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
      );
      // Synchronous: presence is an in-memory lookup, not a query. This handler
      // is now down to two Supabase round-trips from the original four.
      const presenceMap = getPresenceBatch(friendIds);
      const profileMap = new Map(profiles.map((p) => [p.id, p.username]));

      const friends = friendIds.map((fId) => {
        const row = rows.find((r) => r.user_id === fId || r.friend_user_id === fId);
        const presence = presenceMap.get(fId) ?? { status: 'offline', current_mode: null };
        return {
          id: row?.id ?? fId,
          userId: fId,
          username: profileMap.get(fId) ?? 'player',
          presence_status: presence.status as 'online' | 'in_game' | 'offline',
          current_mode: presence.current_mode,
        };
      });

      res.json({ ok: true, friends });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Friends unavailable.' });
    }
  });

  socialRouter.post('/friends/request/:userId', async (req, res) => {
    const requestorId = await requireAuth(req, res);
    if (!requestorId) return;
    const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
    if (targetId === requestorId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
    try {
      const reqEnc = encodeURIComponent(requestorId);
      const tgtEnc = encodeURIComponent(targetId);
      const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
      );
      if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
      if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
      await supabaseFetch('/rest/v1/friends', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: requestorId, friend_user_id: targetId, status: 'pending' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
    }
  });

  socialRouter.post('/friends/request', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const targetUsername = typeof req.body?.targetUsername === 'string'
      ? req.body.targetUsername.trim().replace(/^@/, '')
      : '';
    if (!targetUsername) { res.status(400).json({ error: 'targetUsername is required.' }); return; }
    try {
      const targetProfiles = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/profiles?username=ilike.${encodeURIComponent(targetUsername)}&select=id&limit=1`,
      );
      const targetId = targetProfiles?.[0]?.id;
      if (!targetId) { res.status(404).json({ error: 'User not found.' }); return; }
      if (targetId === userId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
      const reqEnc = encodeURIComponent(userId);
      const tgtEnc = encodeURIComponent(targetId);
      const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
      );
      if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
      if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
      await supabaseFetch('/rest/v1/friends', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId, friend_user_id: targetId, status: 'pending' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
    }
  });

  socialRouter.post('/friends/accept/:requestId', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const rEnc = encodeURIComponent(req.params.requestId);
    const uEnc = encodeURIComponent(userId);
    try {
      await supabaseFetch(`/rest/v1/friends?id=eq.${rEnc}&friend_user_id=eq.${uEnc}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to accept request.' });
    }
  });

  socialRouter.delete('/friends/:recordId', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;
    const rEnc = encodeURIComponent(req.params.recordId);
    const uEnc = encodeURIComponent(userId);
    try {
      await supabaseFetch(
        `/rest/v1/friends?id=eq.${rEnc}&or=(user_id.eq.${uEnc},friend_user_id.eq.${uEnc})`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove friend.' });
    }
  });
}