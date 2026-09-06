import type { Application, Request, Response } from 'express';
import type { PersistedRoomMatchLogRow } from '../../multiplayer/roomMatchLogPersistence';
import {
  buildPrivateMatchResult,
  type RankedGameRatingRow,
} from '../../multiplayer/buildPrivateMatchResult';
import { emitMpAuthorityFunnel } from '../../multiplayer/mpAuthorityTelemetry';
import { supabaseFetch } from '../../supabaseUtils';

export type PrivateMatchResultRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  queryPersistedRoomMatchLog: (matchId: string) => Promise<PersistedRoomMatchLogRow | null>;
  queryLatestPersistedRoomMatchLogByRoomCode: (
    roomCode: string,
  ) => Promise<PersistedRoomMatchLogRow | null>;
  isRoomMatchLogsPersistenceAvailable: () => boolean;
  queryRankedGameForMatch?: (
    playerId: string,
    sourceMatchId: string,
  ) => Promise<RankedGameRatingRow | null>;
};

export async function queryRankedGameForMatch(
  playerId: string,
  sourceMatchId: string,
): Promise<RankedGameRatingRow | null> {
  try {
    const rows = await supabaseFetch<RankedGameRatingRow[]>(
      `/rest/v1/ranked_games?select=player_id,rating_before,rating_after,delta,source_match_id&player_id=eq.${encodeURIComponent(playerId)}&source_match_id=eq.${encodeURIComponent(sourceMatchId)}&limit=1`,
      { method: 'GET' },
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function firstQueryValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

export function registerPrivateMatchResultRoutes(
  app: Application,
  deps: PrivateMatchResultRouteDeps,
): void {
  const {
    getAuthenticatedUserId,
    queryPersistedRoomMatchLog,
    queryLatestPersistedRoomMatchLogByRoomCode,
    isRoomMatchLogsPersistenceAvailable,
    queryRankedGameForMatch: queryRankedGame = queryRankedGameForMatch,
  } = deps;

  app.get('/api/private-match/result', async (req: Request, res: Response) => {
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const matchId = firstQueryValue(req.query.matchId);
      const roomCode = firstQueryValue(req.query.roomCode);
      if (!matchId && !roomCode) {
        res.status(400).json({ error: 'matchId or roomCode is required.' });
        return;
      }

      const log = matchId
        ? await queryPersistedRoomMatchLog(matchId)
        : await queryLatestPersistedRoomMatchLogByRoomCode(roomCode);

      if (!log) {
        if (!isRoomMatchLogsPersistenceAvailable()) {
          res.status(503).json({ error: 'Room event persistence is not configured.' });
          return;
        }
        res.status(404).json({ error: 'Match result not found.' });
        return;
      }

      if (!log.participant_user_ids.includes(authenticatedUserId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const rankedGame = await queryRankedGame(authenticatedUserId, log.match_id);
      const built = buildPrivateMatchResult({
        log,
        viewerUserId: authenticatedUserId,
        rankedGame,
      });
      if (!built.ok) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=3600');
      emitMpAuthorityFunnel('private_terminal_recovery', {
        roomCode: log.room_code,
        extra: {
          source: 'result_ok',
          matchId: log.match_id,
          status: log.status,
        },
      });
      res.json({ ok: true, result: built.result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load match result.',
      });
    }
  });
}
