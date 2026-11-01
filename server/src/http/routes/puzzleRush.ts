import * as Sentry from '@sentry/node';
import type { Application } from 'express';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { PUZZLE_RUSH_CONFIG, isPuzzleRushStageKey } from '../../puzzleRush/config';
import type { PuzzleRushLeaderboardEntry } from '../../puzzleRush/types';
import { materializeAssignedPuzzles, selectRunPuzzles, summarizeSelectionFallbacks } from '../../puzzleRush/difficulty';
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
  claimRushRunCompletion,
  finalizeRushRun,
  hasOfficialRushRunForDate,
  getRushRunById,
  invalidateUnassignedRushRun,
  incrementPuzzlePoolPlayCounts,
  fetchRankedRushLeaderboard,
  listCompletedRushRuns,
  listCompletedRushRunsForUser,
  listOfficialRushRunsForDate,
  listPuzzlePoolCandidates,
  listPuzzlePoolEntriesByIds,
  listRushRunPuzzles,
  recordReportedRushPuzzle,
} from '../stores/puzzleRushStore';
import { getUsernameForUserId } from '../stores/dailyPuzzleStore';
import { getPacificDateKey } from '../../shared/pacificDate';
import {
  listPuzzleRushDayResultsForUser,
  listLegacyDailyPuzzleDayResultsForUser,
} from '../stores/puzzleStatsStore';
import { buildPuzzleStatsSummary } from '../../puzzleRush/puzzleStatsSummary';

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
      const selection = selectRunPuzzles({ candidates });
      if (selection.puzzles.length === 0) {
        res.status(409).json({ error: 'Puzzle Rush could not assemble a run.' });
        return;
      }
      const { run, created } = await createRushRun({
        userId,
        username,
        runDate,
        isOfficial: !alreadyOfficial,
        assignedPuzzleIds: selection.puzzles.map((puzzle) => puzzle.puzzleId),
      });
      if (run.assignedPuzzleIds.length === 0) throw new Error('Puzzle Rush run has no durable assignment.');
      const puzzles = created
        ? selection.puzzles
        : materializeAssignedPuzzles(run.assignedPuzzleIds, await listPuzzlePoolEntriesByIds(run.assignedPuzzleIds));

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

      if (created) void incrementPuzzlePoolPlayCounts(puzzles.map((puzzle) => puzzle.puzzleId));

      res.json({
        ok: true,
        replayed: !created,
        run,
        puzzles,
        selection: {
          requested: selection.requestedCount,
          served: puzzles.length,
          shortfall: selection.shortfall,
          fallbackCount: created ? selection.fallbacks.length : 0,
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
      if (run.assignedPuzzleIds.length === 0) {
        await invalidateUnassignedRushRun(runId, userId);
        res.status(409).json({ error: 'This older run cannot be verified. Start a new run.' });
        return;
      }

      const recorded = await recordReportedRushPuzzle({
        runId,
        userId,
        puzzleId,
        ordinal,
        clientRawScore,
        submittedLine,
        stageReachedKey,
      });
      res.json({ ok: true, recorded: { ordinal: recorded.ordinal, puzzleId: recorded.puzzleId } });
    } catch (error) {
      if (/rush_assignment_mismatch|rush_duplicate_ordinal|rush_run_closed/.test(String(error))) {
        res.status(409).json({ error: 'Puzzle Rush report conflicts with this run.' });
        return;
      }
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
      if (run.assignedPuzzleIds.length === 0) {
        await invalidateUnassignedRushRun(runId, userId);
        res.status(409).json({ error: 'This older run cannot be verified. Start a new run.' });
        return;
      }

      const claim = await claimRushRunCompletion({ runId, userId, clientReportedScore });
      if (claim.outcome === 'already_completed') {
        res.json({ ok: true, replayed: true, run: claim.run });
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

      const endedAt = new Date(claim.run.completionClaimedAt ?? new Date().toISOString());
      const runDurationSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - new Date(run.startedAt).getTime()) / 1000),
      );

      const grade = gradeRun({
        reported,
        poolById,
        clientReportedScore: claim.run.completionClientScore ?? clientReportedScore,
        runDurationSeconds,
      });

      const finalization = await finalizeRushRun({
        runId,
        userId,
        status: grade.valid ? 'completed' : 'invalidated',
        totalScore: grade.totalScore,
        puzzlesSolved: grade.puzzlesSolved,
        invalidatedReason: grade.invalidatedReason,
        gradedPuzzles: grade.puzzles,
      });
      const finalized = finalization.run;

      res.json({
        ok: true,
        replayed: !finalization.applied,
        run: finalized,
        // The server total is authoritative even when it disagrees with the
        // client; the client score is echoed back only so the UI can explain.
        authoritativeScore: finalized.totalScore,
        clientReportedScore: finalized.clientReportedScore,
        invalidated: finalized.status === 'invalidated',
        invalidatedReason: finalized.invalidatedReason,
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

  /**
   * "Daily Puzzle" statistics for `/stats` (own) and `/players/:username`.
   *
   * Computed from `rush_runs` unioned with the frozen Ladder-era history, since
   * `rush_runs` has deny-all RLS and the browser cannot read it directly.
   * Replaces a client read of `daily_puzzle_completions`, a table that no longer
   * exists in production (FEATURE_COMPLETENESS_AUDIT.md P1-1).
   */
  app.get('/api/puzzle-rush/stats-summary', async (req, res) => {
    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const [rushDays, legacyDays] = await Promise.all([
        listPuzzleRushDayResultsForUser(userId),
        listLegacyDailyPuzzleDayResultsForUser(userId),
      ]);

      const summary = buildPuzzleStatsSummary({
        todayDateKey: getPacificDateKey(),
        rushDays,
        legacyDays,
      });

      res.json({ ok: true, ...summary });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/stats-summary' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to load Puzzle Rush stats.') });
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

      const pageSize = PUZZLE_RUSH_CONFIG.leaderboard.pageSize;
      const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit)) || pageSize));
      const offset = Math.max(0, Math.floor(Number(req.query.offset)) || 0);

      const runDate = getPacificDateKey();
      // Ranked in the database when that function is applied (paging, the board's length, the caller's own rank); otherwise
      // the in-memory ranking over a bounded scan, which can only show the first page and the caller's rank within it.
      const [ranked, todayOfficial] = await Promise.all([
        fetchRankedRushLeaderboard({ limit, offset, userId }),
        listOfficialRushRunsForDate(runDate),
      ]);
      let leaderboard: PuzzleRushLeaderboardEntry[];
      let totalPlayers: number | null = null;
      let selfRank: number | null = null;
      if (ranked) {
        leaderboard = ranked.rows;
        totalPlayers = ranked.totalPlayers;
        selfRank = ranked.self?.rank ?? null;
      } else {
        leaderboard = buildPuzzleRushLeaderboard(await listCompletedRushRuns());
        if (userId) selfRank = leaderboard.find((entry) => entry.userId === userId)?.rank ?? null;
      }
      const daily = buildDailyPuzzleRushLeaderboard(todayOfficial);

      let personalBest = null;
      if (userId) {
        const own = await listCompletedRushRunsForUser(userId);
        personalBest = findPersonalBestRun(own, userId);
      }

      res.json({ ok: true, runDate, leaderboard, daily, personalBest, offset: ranked ? offset : 0, limit, totalPlayers, selfRank });
    } catch (error) {
      capture500(error, { route: 'puzzle-rush/leaderboard' });
      res.status(500).json({ error: prodSafeError(error, 'Failed to load Puzzle Rush leaderboard.') });
    }
  });
}
