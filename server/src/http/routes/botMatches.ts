import type { Application, Request } from 'express';
import type { BotMatchPendingRow } from '../../supabaseTypes';
import type { RankedDealSnapshot } from '../../ghost/rankedDealAuthority';
import { createRankedDealSnapshot, rankedDealStartPayload } from '../../ghost/rankedDealAuthority';
import type { VerifiedSinglePlayerMatch } from '../../shared/verifiedSinglePlayerMatch';

export type BotMatchesRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  getAuthenticatedUserIdFromToken: (token: string | null) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  startVerifiedSinglePlayerMatch: (params: {
    userId: string;
    localMatchId: string;
    mode: 'ghost' | 'fritz';
    opponentUserId: string | null;
    fritzTier?: string | null;
    dealSnapshot?: RankedDealSnapshot | null;
  }) => Promise<VerifiedSinglePlayerMatch>;
  abandonVerifiedSinglePlayerMatch: (userId: string, localMatchId: string) => Promise<void>;
  getFritzIdentityForTier: (rawTier: unknown) => { fritzId: string; gameType: string };
  finalizeFritzForfeit: (params: {
    userId: string;
    fritzTier: unknown;
    source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
    youScore?: number | null;
    botScore?: number | null;
  }) => Promise<void>;
  parseOptionalActivityScore: (value: unknown) => number | null;
};

export function registerBotMatchesRoutes(app: Application, deps: BotMatchesRouteDeps): void {
  const {
    getAuthenticatedUserId,
    getAuthenticatedUserIdFromToken,
    supabaseFetch,
    isAdminSecret,
    startVerifiedSinglePlayerMatch,
    abandonVerifiedSinglePlayerMatch,
    getFritzIdentityForTier,
    finalizeFritzForfeit,
    parseOptionalActivityScore,
  } = deps;

  app.post('/bot-matches/cleanup-stale', async (req, res) => {
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const staleRows = await supabaseFetch<BotMatchPendingRow[]>(
        `/rest/v1/bot_match_pending?select=id,user_id,room_code,fritz_tier,started_at,resolved&resolved=eq.false&started_at=lt.${encodeURIComponent(threshold)}&order=started_at.asc`,
      );

      let processed = 0;
      for (const row of staleRows ?? []) {
        if (!row?.id || !row?.user_id) continue;
        await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        });
        await finalizeFritzForfeit({
          userId: row.user_id,
          fritzTier: row.fritz_tier,
          // RK-1: a roomCode alone is not per-match-unique (a rematch reuses
          // the same room code), so anchor the ranked-game sourceMatchId to
          // this bot_match_pending row's own PK instead — one row per Fritz
          // match, guaranteed distinct even after the in-memory Room is gone.
          source: {
            roomCode: typeof row.room_code === 'string' ? row.room_code : null,
            verifiedMatchId: `bot-match-pending:${row.id}:forfeit`,
          },
        });
        processed += 1;
      }

      res.json({ ok: true, processed });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clean stale bot matches.',
      });
    }
  });

  app.post('/api/bot-matches/local/start', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const fritzTier = typeof req.body?.fritzTier === 'string' ? req.body.fritzTier.trim().toLowerCase() : 'elite';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';

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
      const roomCode = `local:${localMatchId}`;

      const fritzIdentity = getFritzIdentityForTier(fritzTier);
      const { snapshot } = createRankedDealSnapshot({
        dealSize: Number(req.body?.dealSize),
        winningScore: Number(req.body?.winningScore),
        matchStarter: typeof req.body?.matchStarter === 'string' ? req.body.matchStarter : null,
      });

      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: fritzIdentity.fritzId,
        fritzTier,
        dealSnapshot: snapshot,
      });

      const existing = await supabaseFetch<BotMatchPendingRow[]>(
        `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
      );

      if (!existing?.[0]?.id) {
        await supabaseFetch('/rest/v1/bot_match_pending', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: userId,
            fritz_tier: fritzTier,
            room_code: roomCode,
            resolved: false,
          }),
        });
      }
      res.json({ ...rankedDealStartPayload(verifiedMatch), roomCode });
    } catch (error) {
      console.error('[Local Fritz Start] error', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/resolve', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
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
      const roomCode = `local:${localMatchId}`;
      await supabaseFetch(
        `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        },
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve pending bot match.',
      });
    }
  });

  app.post('/api/bot-matches/local/abandon', async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
    const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!userId || !localMatchId) {
      res.status(400).json({ error: 'userId and localMatchId are required.' });
      return;
    }
    try {
      const authenticatedUserId =
        (await getAuthenticatedUserId(req)) || (await getAuthenticatedUserIdFromToken(bodyToken || null));
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (authenticatedUserId !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await abandonVerifiedSinglePlayerMatch(userId, localMatchId);
      const roomCode = `local:${localMatchId}`;
      const pendingRows = await supabaseFetch<BotMatchPendingRow[]>(
        `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
      );
      const pending = pendingRows?.[0];
      if (!pending?.id) {
        res.json({ ok: true, processed: false });
        return;
      }
      await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await finalizeFritzForfeit({
        userId,
        fritzTier: pending.fritz_tier,
        source: { localMatchId, roomCode },
        youScore: parseOptionalActivityScore(req.body?.youScore ?? req.body?.score),
        botScore: parseOptionalActivityScore(req.body?.botScore ?? req.body?.opponentScore),
      });
      res.json({ ok: true, processed: true });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to abandon bot match.',
      });
    }
  });
}