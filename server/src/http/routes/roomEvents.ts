import type { Application, Request, Response } from 'express';
import type { PersistedRoomMatchLogRow } from '../../multiplayer/roomMatchLogPersistence';

export type RoomEventsRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  queryPersistedRoomMatchLog: (matchId: string) => Promise<PersistedRoomMatchLogRow | null>;
  queryLatestPersistedRoomMatchLogByRoomCode: (
    roomCode: string,
  ) => Promise<PersistedRoomMatchLogRow | null>;
  isRoomMatchLogsPersistenceAvailable: () => boolean;
};

export function registerRoomEventsRoutes(app: Application, deps: RoomEventsRouteDeps): void {
  const {
    getAuthenticatedUserId,
    queryPersistedRoomMatchLog,
    queryLatestPersistedRoomMatchLogByRoomCode,
    isRoomMatchLogsPersistenceAvailable,
  } = deps;

  const sendLogResponse = async (
    req: Request,
    res: Response,
    loadLog: () => Promise<PersistedRoomMatchLogRow | null>,
  ) => {
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const log = await loadLog();
      if (!log) {
        if (!isRoomMatchLogsPersistenceAvailable()) {
          res.status(503).json({ error: 'Room event persistence is not configured.' });
          return;
        }
        res.status(404).json({ error: 'Room event log not found.' });
        return;
      }

      if (!log.participant_user_ids.includes(authenticatedUserId)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        ok: true,
        log: {
          matchId: log.match_id,
          roomCode: log.room_code,
          status: log.status,
          eventLogVersion: log.event_log_version,
          lastEventSequence: log.last_event_sequence,
          eventCount: log.event_count,
          startedAt: log.started_at,
          archivedAt: log.archived_at,
          participants: log.participants,
          summary: log.summary,
          stateSnapshot: log.state_snapshot,
          events: log.events,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load room event log.',
      });
    }
  };

  app.get('/api/room-events/:matchId', async (req, res) => {
    const matchId = typeof req.params.matchId === 'string' ? req.params.matchId.trim() : '';
    if (!matchId) {
      res.status(400).json({ error: 'matchId is required.' });
      return;
    }

    await sendLogResponse(req, res, () => queryPersistedRoomMatchLog(matchId));
  });

  app.get('/api/room-events/by-room/:roomCode', async (req, res) => {
    const roomCode = typeof req.params.roomCode === 'string' ? req.params.roomCode.trim().toUpperCase() : '';
    if (!roomCode) {
      res.status(400).json({ error: 'roomCode is required.' });
      return;
    }

    await sendLogResponse(req, res, () => queryLatestPersistedRoomMatchLogByRoomCode(roomCode));
  });
}
