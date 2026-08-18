import * as Sentry from '@sentry/node';
import type { Application } from 'express';

function prodSafeError(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : String(error);
}

function capture500(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
import {
  calculateDailyPuzzleAwardedPoints,
  calculateServerAuthoritativeElapsedSeconds,
  DAILY_PUZZLE_SLOT_COUNT,
  LEGACY_DAILY_PUZZLE_SLOT_COUNT,
  findLadderSlotsForAttemptSet,
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleAttemptFinalizeReady,
  isDailyPuzzleLadderReady,
  resolveActiveSlotForAttempt,
  type DailyPuzzleAttempt,
  type DailyPuzzleLeaderboardEntry,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotIndex,
} from '../../dailyPuzzle';
import { validateDailyPuzzleSubmission } from '../../dailyPuzzleSubmissionValidation';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { writePuzzleActivity } from '../../social/activityWriter';
import { getPacificDateKey } from '../../shared/pacificDate';
import { setPublicDailyCache } from './cacheControl';
import {
  buildDailyPuzzleLeaderboardForDate,
  createDailyPuzzleAttempt,
  createDailyPuzzleSlotResult,
  getDailyPuzzleAttempt,
  getDailyPuzzleAttemptById,
  getDailyPuzzleLadderStreak,
  getUsernameForUserId,
  handleDailyPuzzleLadderCronWarm,
  listDailyPuzzleSlotsForAttempt,
  listDailyPuzzleSlotsForDateWithAutoSeed,
  persistDailyPuzzleAttempt,
} from '../stores/dailyPuzzleStore';

export function registerDailyPuzzleRoutes(app: Application): void {
  app.get('/api/daily-puzzle/today', async (req, res) => {
  try {
    let authenticatedUserId: string | null = null;
    try {
      authenticatedUserId = await getAuthenticatedUserId(req);
    } catch (authError) {
      console.warn('[daily-puzzle-today] auth lookup failed; continuing without user', {
        error: authError instanceof Error ? authError.message : String(authError),
      });
    }
    const runDate = getPacificDateKey();
    const allSlots = await listDailyPuzzleSlotsForDateWithAutoSeed(runDate);
    const ladderSlots = findReadyDailyPuzzleLadderSlots(allSlots);
    const ready = ladderSlots !== null;
    const slots = ladderSlots ?? allSlots;
    let leaderboard: DailyPuzzleLeaderboardEntry[] = [];
    try {
      leaderboard = await buildDailyPuzzleLeaderboardForDate(runDate);
    } catch (leaderboardError) {
      console.warn('[daily-puzzle-today] leaderboard load failed', {
        runDate,
        error: leaderboardError instanceof Error ? leaderboardError.message : String(leaderboardError),
      });
    }
    let attempt: DailyPuzzleAttempt | null = null;
    if (authenticatedUserId) {
      try {
        attempt = await getDailyPuzzleAttempt(runDate, authenticatedUserId);
      } catch (attemptError) {
        console.warn('[daily-puzzle-today] attempt load failed', {
          runDate,
          error: attemptError instanceof Error ? attemptError.message : String(attemptError),
        });
      }
    }
    const finalizeReady = attempt
      ? isDailyPuzzleAttemptFinalizeReady(attempt, ladderSlots?.length ?? DAILY_PUZZLE_SLOT_COUNT)
      : false;
    const nextAvailableSlotIndex = attempt
      ? attempt.status === 'completed' || finalizeReady
        ? null
        : attempt.currentSlotIndex
      : ready
        ? 1
        : null;
    let attemptSlots: DailyPuzzleSlot[] | undefined;
    if (attempt) {
      const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
      const bound = findLadderSlotsForAttemptSet(versionSlots);
      if (bound) attemptSlots = bound;
    }
    res.json({
      ok: true,
      runDate,
      setVersion: slots[0]?.setVersion ?? 1,
      slots,
      attemptSlots,
      attemptStatus: attempt?.status ?? 'none',
      attempt,
      nextAvailableSlotIndex,
      finalizeReady,
      leaderboardPreview: leaderboard.slice(0, 10),
      legacySinglePuzzleDay: !ready,
    });
  } catch (error) {
    capture500(error, { route: 'puzzle-today' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to load today’s Daily Puzzle ladder.'),
    });
  }
});

  app.post('/api/daily-puzzle/start', async (req, res) => {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDate =
      typeof req.body?.runDate === 'string' && req.body.runDate.trim()
        ? req.body.runDate.trim()
        : getPacificDateKey();
    const slots = await listDailyPuzzleSlotsForDateWithAutoSeed(runDate);
    if (!isDailyPuzzleLadderReady(slots)) {
      res.status(409).json({ error: 'Daily Puzzle ladder is not published for this date yet.', runDate });
      return;
    }
    let attempt = await getDailyPuzzleAttempt(runDate, authenticatedUserId);
    const username = await getUsernameForUserId(authenticatedUserId);
    let replayed = Boolean(attempt);
    if (!attempt) {
      const readySlots = findReadyDailyPuzzleLadderSlots(slots);
      if (!readySlots) {
        res.status(409).json({ error: 'Daily Puzzle ladder is not published for this date yet.', runDate });
        return;
      }
      const created = await createDailyPuzzleAttempt({
        runDate,
        userId: authenticatedUserId,
        username,
        setVersion: readySlots[0].setVersion,
      });
      attempt = created.attempt;
      replayed = !created.created;
    }
    const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
    const activeSlot = resolveActiveSlotForAttempt(attempt, versionSlots);
    if (!activeSlot) {
      res.status(409).json({ error: 'Daily Puzzle ladder content is incomplete for this attempt.', runDate });
      return;
    }
    const ladderSlots = findLadderSlotsForAttemptSet(versionSlots);
    const finalizeReady = isDailyPuzzleAttemptFinalizeReady(attempt, ladderSlots?.length);
    const nextAvailableSlotIndex = attempt.status === 'completed'
      ? (Math.min(Math.max(attempt.result.slots.length, 1), ladderSlots?.length ?? DAILY_PUZZLE_SLOT_COUNT) as DailyPuzzleSlotIndex)
      : finalizeReady
        ? null
        : attempt.currentSlotIndex;
    res.json({
      ok: true,
      runDate,
      attempt,
      activeSlot,
      nextAvailableSlotIndex,
      practiceMode: attempt.reviewUnlocked ? 'review' : 'none',
      replayed,
      finalizeReady,
    });
  } catch (error) {
    capture500(error, { route: 'puzzle-start' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to start Daily Puzzle ladder.'),
    });
  }
});

  app.post('/api/daily-puzzle/submit-slot', async (req, res) => {
  const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId.trim() : '';
  const puzzleDate = typeof req.body?.puzzleDate === 'string' ? req.body.puzzleDate.trim() : '';
  const puzzleId = typeof req.body?.puzzleId === 'string' ? req.body.puzzleId.trim() : '';
  const slotIndexRaw = Number(req.body?.slotIndex);
  const clientRawScore = Number(req.body?.rawScore);
  const clientMovesUsed = Number(req.body?.movesUsed);
  const elapsedSeconds = Number(req.body?.elapsedSeconds);
  const submittedLine = Array.isArray(req.body?.submittedLine)
    ? (req.body.submittedLine as Array<Record<string, unknown>>)
    : [];
  const clientResult =
    req.body?.clientResult && typeof req.body.clientResult === 'object'
      ? (req.body.clientResult as Record<string, unknown>)
      : {};

  if (!attemptId || !puzzleDate || !puzzleId || !Number.isInteger(slotIndexRaw)) {
    res.status(400).json({ error: 'attemptId, puzzleDate, puzzleId, and slotIndex are required.' });
    return;
  }
  if (!Number.isFinite(clientRawScore) || !Number.isFinite(clientMovesUsed) || !Number.isFinite(elapsedSeconds)) {
    res.status(400).json({ error: 'rawScore, movesUsed, and elapsedSeconds are required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyPuzzleAttemptById(attemptId, authenticatedUserId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Puzzle attempt not found.' });
      return;
    }
    if (attempt.puzzleDate !== puzzleDate) {
      res.status(400).json({ error: 'Daily Puzzle run date does not match this attempt.' });
      return;
    }
    if (attempt.status === 'completed') {
      res.status(409).json({ error: 'Daily Puzzle attempt is already completed.' });
      return;
    }
    const slotIndex = slotIndexRaw >= 1 && slotIndexRaw <= LEGACY_DAILY_PUZZLE_SLOT_COUNT
      ? slotIndexRaw as DailyPuzzleSlotIndex
      : 1;
    const existing = attempt.result.slots.find((slot) => slot.slotIndex === slotIndex);
    if (existing) {
      const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
      const ladderSlots = findLadderSlotsForAttemptSet(versionSlots);
      const ladderLength = ladderSlots?.length ?? DAILY_PUZZLE_SLOT_COUNT;
      const ladderCompleted = attempt.result.slots.length >= ladderLength;
      const nextSlot = ladderCompleted
        ? null
        : versionSlots.find((slot) => slot.slotIndex === attempt.currentSlotIndex) ?? null;
      res.json({
        ok: true,
        runDate: attempt.puzzleDate,
        attempt,
        slotResult: existing,
        nextAvailableSlotIndex: ladderCompleted ? null : attempt.currentSlotIndex,
        nextSlot,
        ladderCompleted,
        requiresCompleteCall: ladderCompleted,
        replayed: true,
      });
      return;
    }
    if (slotIndex !== attempt.currentSlotIndex) {
      res.status(409).json({ error: 'Daily Puzzle slot order is invalid.' });
      return;
    }
    const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
    const ladderSlots = findLadderSlotsForAttemptSet(versionSlots);
    if (!ladderSlots) {
      res.status(409).json({
        error: 'Daily Puzzle ladder content is unavailable for this attempt version.',
      });
      return;
    }
    const slot = ladderSlots.find((entry) => entry.slotIndex === slotIndex && entry.id === puzzleId);
    if (!slot) {
      res.status(404).json({ error: 'Daily Puzzle slot not found for this date.' });
      return;
    }
    const bestPossibleScore = slot.bestPossibleScore ?? 0;
    const now = new Date();
    const serverElapsedSeconds = calculateServerAuthoritativeElapsedSeconds(attempt, slotIndex, now);

    let validation;
    try {
      validation = validateDailyPuzzleSubmission({
        slot,
        submittedLine,
        elapsedSeconds: serverElapsedSeconds,
        clientRawScore,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Daily Puzzle submitted line is invalid.',
      });
      return;
    }
    const awardedPoints = calculateDailyPuzzleAwardedPoints(
      validation.rawScore,
      bestPossibleScore,
      slot.slotMaxPoints,
    );
    const slotResult = await createDailyPuzzleSlotResult({
      attempt,
      slot,
      rawScore: validation.rawScore,
      awardedPoints,
      solved: validation.solved,
      perfect: validation.perfect,
      movesUsed: validation.movesUsed,
      elapsedSeconds: validation.elapsedSeconds,
      submittedLine: validation.submittedLine,
      result: {
        ...clientResult,
        ...validation.result,
        clientMovesUsed: Number.isFinite(clientMovesUsed) ? Math.max(0, Math.round(clientMovesUsed)) : null,
      },
    });
    const nextCurrentSlotIndex = Math.min(ladderSlots.length, slot.slotIndex + 1) as DailyPuzzleSlotIndex;
    const nextAttempt: DailyPuzzleAttempt = {
      ...attempt,
      currentSlotIndex: nextCurrentSlotIndex,
      puzzlesCompleted: Math.min(ladderSlots.length, attempt.puzzlesCompleted + 1),
      totalScore: attempt.totalScore + slotResult.awardedPoints,
      masterChainScore:
        slot.slotIndex === ladderSlots.length ? slotResult.awardedPoints : attempt.masterChainScore,
      updatedAt: new Date().toISOString(),
      result: {
        ...attempt.result,
        slots: [...attempt.result.slots, slotResult].sort((a, b) => a.slotIndex - b.slotIndex),
      },
    };
    const saved = await persistDailyPuzzleAttempt(nextAttempt);
    const ladderCompleted = saved.result.slots.length >= ladderSlots.length;
    const nextSlot = ladderCompleted
      ? null
      : versionSlots.find((entry) => entry.slotIndex === saved.currentSlotIndex) ?? null;
    res.json({
      ok: true,
      runDate: saved.puzzleDate,
      attempt: saved,
      slotResult,
      nextAvailableSlotIndex: ladderCompleted ? null : saved.currentSlotIndex,
      nextSlot,
      ladderCompleted,
      requiresCompleteCall: ladderCompleted,
      replayed: false,
    });
  } catch (error) {
    capture500(error, { route: 'puzzle-submit' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to submit Daily Puzzle slot.'),
    });
  }
});

  app.post('/api/daily-puzzle/complete', async (req, res) => {
  const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId.trim() : '';
  const puzzleDate = typeof req.body?.puzzleDate === 'string' ? req.body.puzzleDate.trim() : '';
  if (!attemptId || !puzzleDate) {
    res.status(400).json({ error: 'attemptId and puzzleDate are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyPuzzleAttemptById(attemptId, authenticatedUserId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Puzzle attempt not found.' });
      return;
    }
    if (attempt.puzzleDate !== puzzleDate) {
      res.status(400).json({ error: 'Daily Puzzle run date does not match this attempt.' });
      return;
    }
    const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
    const ladderSlots = findLadderSlotsForAttemptSet(versionSlots);
    if (!ladderSlots || attempt.result.slots.length < ladderSlots.length) {
      res.status(409).json({ error: 'Daily Puzzle ladder is not complete yet.' });
      return;
    }
    let saved = attempt;
    let replayed = false;
    if (attempt.status === 'completed') {
      replayed = true;
    } else {
      saved = await persistDailyPuzzleAttempt({
        ...attempt,
        status: 'completed',
        completedAt: new Date().toISOString(),
        reviewUnlocked: true,
        updatedAt: new Date().toISOString(),
        result: {
          ...attempt.result,
          final: {
            puzzlesCompleted: attempt.puzzlesCompleted,
            totalScore: attempt.totalScore,
            masterChainScore: attempt.masterChainScore,
            completedAt: new Date().toISOString(),
          },
        },
      });
    }
    const leaderboard = await buildDailyPuzzleLeaderboardForDate(saved.puzzleDate);
    const leaderboardRank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
    if (!replayed) {
      void getDailyPuzzleLadderStreak(authenticatedUserId, saved.puzzleDate)
        .then((streak) => writePuzzleActivity({ userId: authenticatedUserId, score: saved.totalScore ?? null, streak }))
        .catch(() => {});
    }
    res.json({
      ok: true,
      runDate: saved.puzzleDate,
      attempt: saved,
      leaderboardRank,
      leaderboardPreview: leaderboard.slice(0, 10),
      replayed,
    });
  } catch (error) {
    capture500(error, { route: 'puzzle-complete' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to complete Daily Puzzle ladder.'),
    });
  }
});

  app.get('/api/daily-puzzle/leaderboard', async (req, res) => {
  const runDate =
    typeof req.query.date === 'string' && req.query.date.trim()
      ? req.query.date.trim()
      : getPacificDateKey();
  try {
    const rows = await buildDailyPuzzleLeaderboardForDate(runDate);
    setPublicDailyCache(res);
    res.json({
      ok: true,
      runDate,
      rows,
    });
  } catch (error) {
    capture500(error, { route: 'puzzle-leaderboard' });
    res.status(500).json({
      error: prodSafeError(error, 'Failed to load Daily Puzzle leaderboard.'),
    });
  }
});

/**
 * Optional: schedule a platform cron (Vercel, GitHub Actions, etc.) to hit this route
 * shortly after Pacific midnight so the ladder exists before the first player.
 * Set DAILY_PUZZLE_CRON_SECRET and send it as Authorization: Bearer <secret>
 * or header x-daily-puzzle-cron-secret: <secret>.
 */

  app.get('/api/cron/daily-puzzle-ladder-warm', handleDailyPuzzleLadderCronWarm);
  app.post('/api/cron/daily-puzzle-ladder-warm', handleDailyPuzzleLadderCronWarm);
}
