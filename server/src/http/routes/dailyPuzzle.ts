import type { Application } from 'express';
import {
  calculateDailyPuzzleAwardedPoints,
  calculateServerAuthoritativeElapsedSeconds,
  DAILY_PUZZLE_SLOT_COUNT,
  DAILY_PUZZLE_SLOT_INDICES,
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
import {
  failureEventTypeForDailyPuzzleCode,
  isDailyPuzzleClientEventType,
  normalizeDailyPuzzleFailureCode,
} from '../../dailyPuzzleTelemetry';
import { getAuthenticatedUserId } from '../../platform/auth/supabaseAuth';
import { recordOperationalFailure } from '../../operationalTelemetry';
import { writePuzzleActivity } from '../../social/activityWriter';
import { getPacificDateKey } from '../../shared/pacificDate';
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
import {
  recordDailyPuzzleEvent,
  type DailyPuzzleEventInput,
} from '../stores/dailyPuzzleEventStore';

async function recordDailyPuzzleEventBestEffort(event: DailyPuzzleEventInput): Promise<void> {
  try {
    await recordDailyPuzzleEvent(event);
  } catch (error) {
    recordOperationalFailure('daily_puzzle.telemetry_write', error, {
      attemptId: event.attemptId ?? null,
      runDate: event.runDate,
      eventType: event.eventType,
    });
  }
}

function recordDailyPuzzleFailureBestEffort(input: {
  attempt: DailyPuzzleAttempt;
  userId: string;
  slotIndex?: number | null;
  failureCode: string;
}): void {
  const eventType = failureEventTypeForDailyPuzzleCode(input.failureCode);
  void recordDailyPuzzleEventBestEffort({
    attemptId: input.attempt.id,
    runDate: input.attempt.puzzleDate,
    userId: input.userId,
    eventType,
    slotIndex: input.slotIndex ?? null,
    failureCode: input.failureCode,
    idempotencyKey: [
      'daily-puzzle',
      input.attempt.id,
      eventType,
      input.slotIndex ?? 'run',
      input.failureCode,
    ].join(':'),
  });
}

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
      void recordDailyPuzzleEventBestEffort({
        attemptId: attempt?.id ?? null,
        runDate,
        userId: authenticatedUserId,
        eventType: 'mode_impression',
        idempotencyKey: `daily-puzzle:${runDate}:${authenticatedUserId}:mode-impression`,
      });
    }
    const finalizeReady = attempt ? isDailyPuzzleAttemptFinalizeReady(attempt) : false;
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load today’s Daily Puzzle ladder.',
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
    const replayed = Boolean(attempt);
    if (!attempt) {
      const readySlots = findReadyDailyPuzzleLadderSlots(slots);
      if (!readySlots) {
        res.status(409).json({ error: 'Daily Puzzle ladder is not published for this date yet.', runDate });
        return;
      }
      attempt = await createDailyPuzzleAttempt({
        runDate,
        userId: authenticatedUserId,
        username,
        setVersion: readySlots[0].setVersion,
      });
    }
    void recordDailyPuzzleEventBestEffort({
      attemptId: attempt.id,
      runDate,
      userId: authenticatedUserId,
      eventType: replayed ? 'attempt_resumed' : 'attempt_started',
      idempotencyKey: replayed
        ? `daily-puzzle:${attempt.id}:attempt-resumed:${attempt.updatedAt}`
        : `daily-puzzle:${attempt.id}:attempt-started`,
    });
    const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
    const activeSlot = resolveActiveSlotForAttempt(attempt, versionSlots);
    if (!activeSlot) {
      res.status(409).json({ error: 'Daily Puzzle ladder content is incomplete for this attempt.', runDate });
      return;
    }
    const finalizeReady = isDailyPuzzleAttemptFinalizeReady(attempt);
    const nextAvailableSlotIndex = attempt.status === 'completed'
      ? (Math.min(Math.max(attempt.result.slots.length, 1), DAILY_PUZZLE_SLOT_COUNT) as DailyPuzzleSlotIndex)
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Daily Puzzle ladder.',
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
      recordDailyPuzzleFailureBestEffort({
        attempt,
        userId: authenticatedUserId,
        failureCode: 'attempt_completed',
      });
      res.status(409).json({ error: 'Daily Puzzle attempt is already completed.' });
      return;
    }
    const slotIndex = slotIndexRaw >= 1 && slotIndexRaw <= DAILY_PUZZLE_SLOT_COUNT
      ? slotIndexRaw as DailyPuzzleSlotIndex
      : 1;
    const existing = attempt.result.slots.find((slot) => slot.slotIndex === slotIndex);
    if (existing) {
      const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
      const ladderCompleted = attempt.result.slots.length >= DAILY_PUZZLE_SLOT_COUNT;
      const nextExpectedSlotIndex = DAILY_PUZZLE_SLOT_INDICES.find(
        (index) => !attempt.result.slots.some((slot) => slot.slotIndex === index),
      ) ?? attempt.currentSlotIndex;
      const nextSlot = ladderCompleted
        ? null
        : versionSlots.find((slot) => slot.slotIndex === nextExpectedSlotIndex) ?? null;
      res.json({
        ok: true,
        runDate: attempt.puzzleDate,
        attempt,
        slotResult: existing,
        nextAvailableSlotIndex: ladderCompleted ? null : nextExpectedSlotIndex,
        nextSlot,
        ladderCompleted,
        requiresCompleteCall: ladderCompleted,
        replayed: true,
      });
      return;
    }
    const expectedSlotIndex = DAILY_PUZZLE_SLOT_INDICES.find(
      (index) => !attempt.result.slots.some((slot) => slot.slotIndex === index),
    ) ?? attempt.currentSlotIndex;
    if (slotIndex !== expectedSlotIndex) {
      recordDailyPuzzleFailureBestEffort({
        attempt,
        userId: authenticatedUserId,
        slotIndex,
        failureCode: 'slot_order_invalid',
      });
      res.status(409).json({ error: 'Daily Puzzle slot order is invalid.' });
      return;
    }
    const versionSlots = await listDailyPuzzleSlotsForAttempt(attempt);
    const ladderSlots = findLadderSlotsForAttemptSet(versionSlots);
    if (!ladderSlots) {
      recordDailyPuzzleFailureBestEffort({
        attempt,
        userId: authenticatedUserId,
        slotIndex,
        failureCode: 'version_mismatch',
      });
      res.status(409).json({
        error: 'Daily Puzzle ladder content is unavailable for this attempt version.',
      });
      return;
    }
    const slot = ladderSlots.find((entry) => entry.slotIndex === slotIndex && entry.id === puzzleId);
    if (!slot) {
      recordDailyPuzzleFailureBestEffort({
        attempt,
        userId: authenticatedUserId,
        slotIndex,
        failureCode: 'puzzle_mismatch',
      });
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
      recordDailyPuzzleFailureBestEffort({
        attempt,
        userId: authenticatedUserId,
        slotIndex,
        failureCode: normalizeDailyPuzzleFailureCode(error),
      });
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
    const nextCurrentSlotIndex = Math.min(DAILY_PUZZLE_SLOT_COUNT, slot.slotIndex + 1) as DailyPuzzleSlotIndex;
    const nextAttempt: DailyPuzzleAttempt = {
      ...attempt,
      currentSlotIndex: nextCurrentSlotIndex,
      puzzlesCompleted: Math.min(DAILY_PUZZLE_SLOT_COUNT, attempt.puzzlesCompleted + 1),
      totalScore: attempt.totalScore + slotResult.awardedPoints,
      masterChainScore:
        slot.slotIndex === DAILY_PUZZLE_SLOT_COUNT ? slotResult.awardedPoints : attempt.masterChainScore,
      updatedAt: new Date().toISOString(),
      result: {
        ...attempt.result,
        slots: [...attempt.result.slots, slotResult].sort((a, b) => a.slotIndex - b.slotIndex),
      },
    };
    const saved = await persistDailyPuzzleAttempt(nextAttempt);
    void recordDailyPuzzleEventBestEffort({
      attemptId: saved.id,
      runDate: saved.puzzleDate,
      userId: authenticatedUserId,
      eventType: 'slot_submitted',
      slotIndex,
      idempotencyKey: `daily-puzzle:${saved.id}:slot-submitted:${slotIndex}`,
      payload: {
        awardedPoints: slotResult.awardedPoints,
        solved: slotResult.solved,
        perfect: slotResult.perfect,
      },
    });
    const ladderCompleted = saved.result.slots.length >= DAILY_PUZZLE_SLOT_COUNT;
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to submit Daily Puzzle slot.',
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
    if (attempt.result.slots.length < DAILY_PUZZLE_SLOT_COUNT) {
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
      void recordDailyPuzzleEventBestEffort({
        attemptId: saved.id,
        runDate: saved.puzzleDate,
        userId: authenticatedUserId,
        eventType: 'attempt_completed',
        idempotencyKey: `daily-puzzle:${saved.id}:attempt-completed`,
        payload: { totalScore: saved.totalScore, leaderboardRank },
      });
      void getDailyPuzzleLadderStreak(authenticatedUserId, saved.puzzleDate)
        .then((streak) => writePuzzleActivity({ userId: authenticatedUserId, score: saved.totalScore ?? null, streak }))
        .catch((error) => {
          recordOperationalFailure('daily_puzzle.activity_write', error, {
            attemptId: saved.id,
            puzzleDate: saved.puzzleDate,
            userId: authenticatedUserId,
          });
        });
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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete Daily Puzzle ladder.',
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
    res.json({
      ok: true,
      runDate,
      rows,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Daily Puzzle leaderboard.',
    });
  }
});

  app.post('/api/daily-puzzle/telemetry', async (req, res) => {
    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const eventType = req.body?.eventType;
      const runDate = typeof req.body?.runDate === 'string' ? req.body.runDate.trim() : '';
      const eventId = typeof req.body?.eventId === 'string' ? req.body.eventId.trim().slice(0, 160) : '';
      if (!isDailyPuzzleClientEventType(eventType) || !runDate || !eventId) {
        res.status(400).json({ error: 'eventType, runDate, and eventId are required.' });
        return;
      }
      await recordDailyPuzzleEvent({
        attemptId: typeof req.body?.attemptId === 'string' ? req.body.attemptId : null,
        runDate,
        userId: authenticatedUserId,
        eventType,
        slotIndex: Number.isInteger(req.body?.slotIndex) ? Number(req.body.slotIndex) : null,
        requestId: typeof req.body?.requestId === 'string' ? req.body.requestId : null,
        failureCode: typeof req.body?.failureCode === 'string' ? req.body.failureCode : null,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : null,
        clientRelease: typeof req.body?.clientRelease === 'string' ? req.body.clientRelease : null,
        durationMs: Number.isFinite(req.body?.durationMs) ? Math.max(0, Math.round(req.body.durationMs)) : null,
        source: 'client',
        idempotencyKey: `daily-puzzle-client:${authenticatedUserId}:${eventId}`,
        payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
      });
      res.json({ ok: true });
    } catch (error) {
      recordOperationalFailure('daily_puzzle.client_telemetry', error, {});
      res.status(503).json({ error: 'Daily Puzzle telemetry is temporarily unavailable.' });
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
