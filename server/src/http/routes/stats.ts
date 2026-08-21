import type { Application, Request } from 'express';
import type { Server } from 'socket.io';
import { setPrivateShortCache, setPublicShortCache } from './cacheControl';
import type { HomeDailyCompletionMap, HomeDailySummaryPayload } from '../../homeDailySummary';
import type { recordUserMatch as RecordUserMatchFn } from '../../stats/recordUserMatch';

export type StatsRouteDeps = {
  io: Server;
  getRoomRuntimeStats: () => { roomCount: number; gamesInProgress: number };
  ROOM_CLEANUP_GRACE_MS: number;
  getPacificDateKey: (date?: Date) => string;
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  buildHomeDailySummary: (
    todayDateKey: string,
    completionMap: HomeDailyCompletionMap,
    now?: Date,
  ) => HomeDailySummaryPayload;
  createHomeDailyCompletionMap: (
    fritzDates: string[],
    puzzleDates: string[],
  ) => HomeDailyCompletionMap;
  listCompletedDailyFritzDatesForUser: (userId: string) => Promise<string[]>;
  listCompletedDailyPuzzleLadderDatesForUser: (userId: string) => Promise<string[]>;
  listCompletedLegacyDailyPuzzleDatesForUser: (userId: string) => Promise<string[]>;
  listCompletedPuzzleRushDatesForUser: (userId: string) => Promise<string[]>;
  recordUserMatch: typeof RecordUserMatchFn;
};

export function registerStatsRoutes(app: Application, deps: StatsRouteDeps): void {
  const {
    io,
    getRoomRuntimeStats,
    ROOM_CLEANUP_GRACE_MS,
    getPacificDateKey,
    getAuthenticatedUserId,
    buildHomeDailySummary,
    createHomeDailyCompletionMap,
    listCompletedDailyFritzDatesForUser,
    listCompletedDailyPuzzleLadderDatesForUser,
    listCompletedLegacyDailyPuzzleDatesForUser,
    listCompletedPuzzleRushDatesForUser,
    recordUserMatch,
  } = deps;

  app.get('/api/mp-stats', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { roomCount, gamesInProgress } = getRoomRuntimeStats();
    res.json({
      ok: true,
      pid: process.pid,
      roomCount,
      gamesInProgress,
      connectedSockets: io.sockets.sockets.size,
      roomCleanupGraceMs: ROOM_CLEANUP_GRACE_MS,
    });
  });

  app.get('/api/home/daily-summary', async (req, res) => {
    const today = getPacificDateKey();
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);

      if (!authenticatedUserId) {
        setPublicShortCache(res, 30, 120);
        res.json({
          ok: true,
          ...buildHomeDailySummary(today, {}, new Date()),
        });
        return;
      }

      const [fritzDates, ladderPuzzleDates, legacyPuzzleDates, rushDates] = await Promise.all([
        listCompletedDailyFritzDatesForUser(authenticatedUserId),
        listCompletedDailyPuzzleLadderDatesForUser(authenticatedUserId),
        listCompletedLegacyDailyPuzzleDatesForUser(authenticatedUserId),
        listCompletedPuzzleRushDatesForUser(authenticatedUserId),
      ]);

      // Three sources unioned: frozen ladder history, frozen pre-ladder
      // history, and Rush going forward. Purely additive — a streak in flight
      // when Rush shipped continues across the boundary without a gap.
      const puzzleDates = Array.from(
        new Set([...ladderPuzzleDates, ...legacyPuzzleDates, ...rushDates]),
      );
      const completionMap = createHomeDailyCompletionMap(fritzDates, puzzleDates);

      // Completion history changes at most once per finished run, so a repeat
      // home visit inside the window shouldn't re-run four Supabase reads.
      setPrivateShortCache(res, 60);
      res.json({
        ok: true,
        ...buildHomeDailySummary(today, completionMap, new Date()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load homepage daily summary.';
      const timedOut = error instanceof Error && /timed out|aborted/i.test(message);
      if (timedOut) {
        console.warn('[home:daily-summary] upstream timeout; returning anonymous fallback', { message });
        res.json({
          ok: true,
          warning: 'completion_history_unavailable',
          ...buildHomeDailySummary(today, {}, new Date()),
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/stats/record-match', async (req, res) => {
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const result = await recordUserMatch({
        authenticatedUserId,
        mode: req.body?.mode,
        opponentType: req.body?.opponentType,
        winnerUserId: req.body?.winnerUserId ?? null,
        loserUserId: req.body?.loserUserId ?? null,
        winnerScore: req.body?.winnerScore ?? null,
        loserScore: req.body?.loserScore ?? null,
        moveCount: req.body?.moveCount ?? null,
        avgMoveQuality: req.body?.avgMoveQuality ?? null,
        roomCode: req.body?.roomCode ?? null,
        metadata: req.body?.metadata ?? null,
      });

      if (!result.ok) {
        res.status(result.status ?? 500).json({ error: result.error });
        return;
      }

      res.json({ ok: true, replayed: result.replayed ?? false });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to record match.',
      });
    }
  });
}