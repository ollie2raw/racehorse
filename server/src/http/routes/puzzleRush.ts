import * as Sentry from '@sentry/node';
import type { Application } from 'express';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { PUZZLE_RUSH_CONFIG, isPuzzleRushStageKey } from '../../puzzleRush/config';
import { selectRunPuzzles, summarizeSelectionFallbacks } from '../../puzzleRush/difficulty';
import { gradeRun, type ReportedPuzzle } from '../../puzzleRush/grading';
import {
  buildDailyPuzzleRushLeaderboard,
  buildPuzzleRushLeaderboard,
  findPersonalBestRun,
} from '../../puzzleRush/leaderboard';
import { buildHomeDailySummary, createHomeDailyCompletionMap } from '../../homeDailySummary';
import { listCompletedPuzzleRushDatesForUser } from '../stores/homeCompletionDates';
import {
  createRushRun,
  finalizeRushRun,
  hasOfficialRushRunForDate,
  getRushRunById,
  incrementPuzzlePoolPlayCounts,
  listCompletedRushRuns,
  listCompletedRushRunsForUser,
  listOfficialRushRunsForDate,
  listPuzzlePoolCandidates,
  listPuzzlePoolEntriesByIds,
  listRushRunPuzzles,
  persistGradedRushPuzzles,
  recordReportedRushPuzzle,
} from '../stores/puzzleRushStore';
import { getUsernameForUserId } from '../stores/dailyPuzzleStore';
import { getPacificDateKey } from '../../shared/pacificDate';

function prodSafeError(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : String(error);
}

function capture500(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function registerPuzzleRushRoutes(app: Application): void {
  /**
   * Start a run. Ships the entire puzzle set in one payload so the client never
   * fetches mid-run — and never includes best_possible_score, which would let
   * the client derive optimal play without solving.
   */
  app.post('/api/puzzle-rush/start', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const candidates = await listPuzzlePoolCandidates();
      if (candidates.length === 0) {
        res.status(409).json({ error: 'Puzzle Rush pool is empty.' });
        return;
      }

      // Same Pacific day boundary the ladder and Daily Fritz use.
      const runDate = getPacificDateKey();
      // Both awaited together: the official check adds no round trip.
      const [username, alreadyOfficial] = await Promise.all([
        getUsernameForUserId(userId),
        hasOfficialRushRunForDate(userId, runDate),
      ]);
      const { run, created } = await createRushRun({
        userId,
        username,
        runDate,
        isOfficial: !alreadyOfficial,
      });
      const selection = selectRunPuzzles({ candidates });
      const puzzles = selection.puzzles;
      if (puzzles.length === 0) {
        res.status(409).json({ error: 'Puzzle Rush could not assemble a run.' });
        return;
      }

      // Observability for pool health: a tier that keeps falling back needs
      // more content, and we want to know before players feel the flattened
      // difficulty curve.
      if (selection.fallbacks.length > 0 || selection.shortfall) {
        console.warn('[puzzle-rush] run selection degraded', {
          runId: run.id,
          served: puzzles.length,
          requested: selection.requestedCount,
          shortfall: selection.shortfall,
          fallbacks: summarizeSelectionFallbacks(selection),
        });
      }

      void incrementPuzzlePoolPlayCounts(puzzles.map((puzzle) => puzzle.puzzleId));

      res.json({
        ok: true,
        replayed: !created,
        run,
        puzzles,
        selection: {
          requested: selection.requestedCount,
          served: puzzles.length,
          shortfall: selection.shortfall,
          fallbackCount: selection.fallbacks.length,
        },
        // The run's stage plan, known up front so the client can render the
        // whole arc (and its transitions) without a second request.
        stages: PUZZLE_RUSH_CONFIG.run.stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          fromOrdinal: stage.fromOrdinal,
          toOrdinal: stage.toOrdinal,
          maxPointsPerPuzzle: stage.maxPointsPerPuzzle,
          puzzleCount: puzzles.filter((puzzle) => puzzle.stageKey === stage.key).length,
        })),
        config: {
          version: PUZZLE_RUSH_CONFIG.version,
          baseSeconds: PUZZLE_RUSH_CONFIG.clock.baseSeconds,
          maxSeconds: PUZZLE_RUSH_CONFIG.clock.maxSeconds,
          minBonusSeconds: PUZZLE_RUSH_CONFIG.clock.minBonusSeconds,
          maxBonusSeconds: PUZZLE_RUSH_CONFIG.clock.maxBonusSeconds,
          puzzlesPerRun: PUZZLE_RUSH_CONFIG.run.puzzlesPerRun,
        },
      });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/start' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to start Puzzle Rush run.') });
    }
  });

  /**
   * Optimistic per-puzzle report. Records only — no engine replay — so the run
   * clock never waits on the server. Grading happens once at /complete.
   */
  app.post('/api/puzzle-rush/report', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      const puzzleId = typeof req.body?.puzzleId === 'string' ? req.body.puzzleId : '';
      const ordinal = Number(req.body?.ordinal);
      const clientRawScore = Number(req.body?.clientRawScore ?? 0);
      const submittedLine = Array.isArray(req.body?.submittedLine) ? req.body.submittedLine : [];
      // Observational only. An unrecognised value is dropped rather than
      // rejected — telemetry must never be able to fail a live report.
      const stageReachedKey = isPuzzleRushStageKey(req.body?.stageReachedKey)
        ? req.body.stageReachedKey
        : null;

      if (!runId || !puzzleId) {
        res.status(400).json({ error: 'runId and puzzleId are required.' });
        return;
      }
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > PUZZLE_RUSH_CONFIG.run.puzzlesPerRun) {
        res.status(400).json({ error: 'ordinal is out of range for this run.' });
        return;
      }

      const run = await getRushRunById(runId, userId);
      if (!run) {
        res.status(404).json({ error: 'Puzzle Rush run not found.' });
        return;
      }
      if (run.status !== 'in_progress') {
        res.status(409).json({ error: 'Puzzle Rush run is already finished.' });
        return;
      }

      const recorded = await recordReportedRushPuzzle({
        runId,
        puzzleId,
        ordinal,
        clientRawScore,
        submittedLine,
        stageReachedKey,
      });
      res.json({ ok: true, recorded: { ordinal: recorded.ordinal, puzzleId: recorded.puzzleId } });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/report' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to record Puzzle Rush report.') });
    }
  });

  /**
   * End of run: replay every reported line through the real engine, compute the
   * authoritative score, and record it. The server total is always what is
   * stored; a client that over-reported gets the run marked invalidated.
   */
  app.post('/api/puzzle-rush/complete', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const runId = typeof req.body?.runId === 'string' ? req.body.runId : '';
      const clientReportedScore = Number(req.body?.clientReportedScore ?? 0);
      if (!runId) {
        res.status(400).json({ error: 'runId is required.' });
        return;
      }

      const run = await getRushRunById(runId, userId);
      if (!run) {
        res.status(404).json({ error: 'Puzzle Rush run not found.' });
        return;
      }
      if (run.status !== 'in_progress') {
        // Idempotent replay: a duplicate complete returns the stored result.
        res.json({ ok: true, replayed: true, run });
        return;
      }

      const reportedRows = await listRushRunPuzzles(runId);
      const poolEntries = await listPuzzlePoolEntriesByIds(reportedRows.map((row) => row.puzzleId));
      const poolById = new Map(poolEntries.map((entry) => [entry.id, entry]));

      const reported: ReportedPuzzle[] = reportedRows.map((row) => ({
        ordinal: row.ordinal,
        puzzleId: row.puzzleId,
        submittedLine: row.submittedLine,
        clientRawScore: row.clientRawScore,
      }));

      const endedAt = new Date();
      const runDurationSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - new Date(run.startedAt).getTime()) / 1000),
      );

      const grade = gradeRun({
        reported,
        poolById,
        clientReportedScore,
        runDurationSeconds,
      });

      await persistGradedRushPuzzles(runId, grade.puzzles);
      const finalized = await finalizeRushRun({
        runId,
        status: grade.valid ? 'completed' : 'invalidated',
        totalScore: grade.totalScore,
        puzzlesSolved: grade.puzzlesSolved,
        clientReportedScore: Math.max(0, Math.round(clientReportedScore || 0)),
        invalidatedReason: grade.invalidatedReason,
        endedAt: endedAt.toISOString(),
      });

      res.json({
        ok: true,
        replayed: false,
        run: finalized,
        // The server total is authoritative even when it disagrees with the
        // client; the client score is echoed back only so the UI can explain.
        authoritativeScore: grade.totalScore,
        clientReportedScore: Math.max(0, Math.round(clientReportedScore || 0)),
        invalidated: !grade.valid,
        invalidatedReason: grade.invalidatedReason,
      });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/complete' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to complete Puzzle Rush run.') });
    }
  });

  /**
   * Hub state: personal best, streak, and whether today's official run is done.
   * Read-only; safe to call on every hub mount so a finished run is reflected
   * without a hard refresh.
   */
  app.get('/api/puzzle-rush/today', async (req, res) => {
    try {
      const runDate = getPacificDateKey();
      let userId: string | null = null;
      try {
        userId = await getAuthenticatedUserId(req);
      } catch {
        /* hub renders for signed-out visitors too */
      }

      if (!userId) {
        res.json({
          ok: true, runDate, personalBest: null, streakDays: 0,
          playedToday: false, officialRunComplete: false,
        });
        return;
      }

      const [ownRuns, rushDates] = await Promise.all([
        listCompletedRushRunsForUser(userId),
        listCompletedPuzzleRushDatesForUser(userId),
      ]);

      const best = findPersonalBestRun(ownRuns, userId);
      // Same union + walk the Home summary uses, so the hub and Home agree.
      const completionMap = createHomeDailyCompletionMap([], rushDates);
      const summary = buildHomeDailySummary(runDate, completionMap, new Date());
      const officialToday = ownRuns.find((run) => run.runDate === runDate && run.isOfficial) ?? null;

      res.json({
        ok: true,
        runDate,
        personalBest: best?.totalScore ?? null,
        streakDays: summary.currentStreakCount,
        playedToday: rushDates.includes(runDate),
        officialRunComplete: officialToday !== null,
      });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/today' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to load Puzzle Rush status.') });
    }
  });

  /** All-time personal-best board, plus the caller's own best when signed in. */
  app.get('/api/puzzle-rush/leaderboard', async (req, res) => {
    try {
      let userId: string | null = null;
      try {
        userId = await getAuthenticatedUserId(req);
      } catch {
        /* leaderboard is readable without auth */
      }

      const runDate = getPacificDateKey();
      const [runs, todayOfficial] = await Promise.all([
        listCompletedRushRuns(),
        listOfficialRushRunsForDate(runDate),
      ]);
      const leaderboard = buildPuzzleRushLeaderboard(runs);
      const daily = buildDailyPuzzleRushLeaderboard(todayOfficial);

      let personalBest = null;
      if (userId) {
        const own = await listCompletedRushRunsForUser(userId);
        personalBest = findPersonalBestRun(own, userId);
      }

      res.json({ ok: true, runDate, leaderboard, daily, personalBest });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/leaderboard' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to load Puzzle Rush leaderboard.') });
    }
  });
}
