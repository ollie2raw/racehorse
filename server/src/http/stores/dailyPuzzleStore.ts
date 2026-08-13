import express from 'express';
import {
  buildDailyPuzzleLeaderboard,
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleAttempt,
  normalizeDailyPuzzleSlot,
  normalizeDailyPuzzleSlotResult,
  sortDailyPuzzleSlots,
  type DailyPuzzleAttempt,
  type DailyPuzzleAttemptRow,
  type DailyPuzzleLeaderboardEntry,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotResult,
  type DailyPuzzleSlotResultRow,
  type DailyPuzzleSlotRow,
} from '../../dailyPuzzle';
import { scrubPartialPublishedLadderForDate } from '../../dailyPuzzleLadderPublish';
import { ensureDailyPuzzleLadderForDate } from '../../seedDailyPuzzleLadder';
import { constantTimeEqualSecret } from '../../platform/auth/adminSecret';
import { supabaseFetch } from '../../supabaseUtils';
import { getPacificDateKey, getPacificDateKeyDaysFromNow } from '../../shared/pacificDate';
import { listCompletedDailyPuzzleLadderDatesForUser } from './homeCompletionDates';

export function isRequestPuzzleGenerationEnabled(): boolean {
  const raw = process.env.ENABLE_REQUEST_PUZZLE_GENERATION?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}
export async function listDailyPuzzleSlotsForDate(runDate: string): Promise<DailyPuzzleSlot[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&published=eq.true&puzzle_date=eq.${encodeURIComponent(runDate)}&order=set_version.asc,slot_index.asc,id.asc`,
    { method: 'GET' },
  );
  return sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
}

export async function listDailyPuzzleSlotsForDateAndVersion(
  runDate: string,
  setVersion: number,
): Promise<DailyPuzzleSlot[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&published=eq.true&puzzle_date=eq.${encodeURIComponent(runDate)}&set_version=eq.${setVersion}&order=slot_index.asc,id.asc`,
    { method: 'GET' },
  );
  return sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
}

/** Slots bound to an in-flight or completed attempt (never today's latest ready set). */
export async function listDailyPuzzleSlotsForAttempt(attempt: DailyPuzzleAttempt): Promise<DailyPuzzleSlot[]> {
  return listDailyPuzzleSlotsForDateAndVersion(attempt.puzzleDate, attempt.setVersion);
}

/** If no ready ladder exists for this Pacific date, generate and upsert three slots (idempotent). */
export async function listDailyPuzzleSlotsForDateWithAutoSeed(runDate: string): Promise<DailyPuzzleSlot[]> {
  try {
    let slots = await listDailyPuzzleSlotsForDate(runDate);
    if (isDailyPuzzleLadderReady(slots)) return slots;

    if (!isDailyPuzzleLadderReady(slots) && slots.length > 0) {
      const scrub = await scrubPartialPublishedLadderForDate(runDate);
      if (scrub.scrubbed > 0) {
        console.warn('[daily-puzzle-ladder] scrubbed-partial-on-read', {
          runDate,
          scrubbed: scrub.scrubbed,
          missingSlotIndexes: scrub.readiness.missingSlotIndexes,
        });
        slots = [];
      }
    }

    if (!isRequestPuzzleGenerationEnabled()) {
      console.warn('[daily-puzzle-ladder] request-time generation skipped', {
        runDate,
        reason: 'disabled',
      });
      return slots;
    }
    const outcome = await ensureDailyPuzzleLadderForDate(runDate, {
      force: false,
      purpose: 'request',
    });
    if (outcome === 'seeded') {
      slots = await listDailyPuzzleSlotsForDate(runDate);
    } else {
      console.warn('[daily-puzzle-ladder] request-time generation unavailable', {
        runDate,
        outcome,
      });
    }
    return slots;
  } catch (error) {
    console.warn('[daily-puzzle-ladder] listDailyPuzzleSlotsForDateWithAutoSeed failed', {
      runDate,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function isAuthorizedDailyPuzzleCronRequest(req: express.Request): boolean {
  const secret = process.env.DAILY_PUZZLE_CRON_SECRET?.trim();
  if (!secret) return false;
  const headerRaw = req.headers['x-daily-puzzle-cron-secret'];
  const fromHeader = typeof headerRaw === 'string' ? headerRaw.trim() : '';
  if (constantTimeEqualSecret(fromHeader, secret)) return true;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return constantTimeEqualSecret(m?.[1]?.trim(), secret);
}

export async function getDailyPuzzleAttempt(runDate: string, userId: string): Promise<DailyPuzzleAttempt | null> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&puzzle_date=eq.${encodeURIComponent(runDate)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

export async function getDailyPuzzleAttemptById(
  attemptId: string,
  userId: string,
): Promise<DailyPuzzleAttempt | null> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&id=eq.${encodeURIComponent(attemptId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

export async function listDailyPuzzleSlotResults(attemptId: string): Promise<DailyPuzzleSlotResult[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    `/rest/v1/daily_puzzle_slot_results?select=id,attempt_id,puzzle_id,puzzle_date,user_id,slot_index,tier,slot_title,puzzle_type,raw_score,awarded_points,best_possible_score,slot_max_points,solved,perfect,moves_used,elapsed_seconds,submitted_line,result,completed_at&attempt_id=eq.${encodeURIComponent(attemptId)}&order=slot_index.asc,completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  return rows.map(normalizeDailyPuzzleSlotResult);
}

export async function createDailyPuzzleAttempt(params: {
  runDate: string;
  userId: string;
  username: string | null;
  setVersion: number;
}): Promise<DailyPuzzleAttempt> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    '/rest/v1/daily_puzzle_attempts',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        puzzle_date: params.runDate,
        user_id: params.userId,
        username: params.username,
        status: 'started',
        set_version: params.setVersion,
        current_slot_index: 1,
        puzzles_completed: 0,
        total_score: 0,
        master_chain_score: 0,
        review_unlocked: false,
        result: {},
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create daily puzzle attempt.');
  return normalizeDailyPuzzleAttempt(row, []);
}

export async function persistDailyPuzzleAttempt(attempt: DailyPuzzleAttempt): Promise<DailyPuzzleAttempt> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    '/rest/v1/daily_puzzle_attempts?on_conflict=id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([{
        id: attempt.id,
        puzzle_date: attempt.puzzleDate,
        user_id: attempt.userId,
        username: attempt.username,
        status: attempt.status,
        set_version: attempt.setVersion,
        current_slot_index: attempt.currentSlotIndex,
        puzzles_completed: attempt.puzzlesCompleted,
        total_score: attempt.totalScore,
        master_chain_score: attempt.masterChainScore,
        completed_at: attempt.completedAt,
        started_at: attempt.startedAt,
        updated_at: new Date().toISOString(),
        review_unlocked: attempt.reviewUnlocked,
        result: {
          slots: attempt.result.slots,
          ...(attempt.result.final ? { final: attempt.result.final } : {}),
        },
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to persist daily puzzle attempt.');
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

export async function createDailyPuzzleSlotResult(input: {
  attempt: DailyPuzzleAttempt;
  slot: DailyPuzzleSlot;
  rawScore: number;
  awardedPoints: number;
  solved: boolean;
  perfect: boolean;
  movesUsed: number;
  elapsedSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}): Promise<DailyPuzzleSlotResult> {
  const rows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    '/rest/v1/daily_puzzle_slot_results',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        attempt_id: input.attempt.id,
        puzzle_id: input.slot.id,
        puzzle_date: input.attempt.puzzleDate,
        user_id: input.attempt.userId,
        slot_index: input.slot.slotIndex,
        tier: input.slot.tier,
        slot_title: input.slot.slotTitle,
        puzzle_type: input.slot.puzzleType,
        raw_score: input.rawScore,
        awarded_points: input.awardedPoints,
        best_possible_score: input.slot.bestPossibleScore ?? 0,
        slot_max_points: input.slot.slotMaxPoints,
        solved: input.solved,
        perfect: input.perfect,
        moves_used: input.movesUsed,
        elapsed_seconds: input.elapsedSeconds,
        submitted_line: input.submittedLine,
        result: input.result,
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to persist daily puzzle slot result.');
  return normalizeDailyPuzzleSlotResult(row);
}

/** Maximum attempts fetched for leaderboard display. Prevents unbounded full-table scans
 *  at scale; raise only after adding server-side pagination to the leaderboard API. */
export const LEADERBOARD_ATTEMPT_LIMIT = 200;

async function fetchAttemptsForDate(runDate: string, limit: number | null): Promise<DailyPuzzleAttempt[]> {
  const limitClause = limit !== null ? `&limit=${limit}` : '';
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&puzzle_date=eq.${encodeURIComponent(runDate)}&order=completed_at.asc.nullslast,id.asc${limitClause}`,
    { method: 'GET' },
  );
  if (rows.length === 0) return [];
  const attemptIds = rows.map((row) => row.id);
  const idClause = attemptIds.map((id) => `"${id}"`).join(',');
  const resultRows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    `/rest/v1/daily_puzzle_slot_results?select=id,attempt_id,puzzle_id,puzzle_date,user_id,slot_index,tier,slot_title,puzzle_type,raw_score,awarded_points,best_possible_score,slot_max_points,solved,perfect,moves_used,elapsed_seconds,submitted_line,result,completed_at&attempt_id=in.(${encodeURIComponent(idClause)})&order=slot_index.asc,completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  const resultsByAttempt = new Map<string, DailyPuzzleSlotResult[]>();
  for (const row of resultRows) {
    const result = normalizeDailyPuzzleSlotResult(row);
    const list = resultsByAttempt.get(result.attemptId);
    if (list) list.push(result);
    else resultsByAttempt.set(result.attemptId, [result]);
  }
  return rows.map((row) => normalizeDailyPuzzleAttempt(row, resultsByAttempt.get(row.id) ?? []));
}

/** Capped at LEADERBOARD_ATTEMPT_LIMIT rows — safe for leaderboard display and completion rank lookups. */
export async function listDailyPuzzleAttemptsForDate(runDate: string): Promise<DailyPuzzleAttempt[]> {
  return fetchAttemptsForDate(runDate, LEADERBOARD_ATTEMPT_LIMIT);
}

/** Unbounded — only for admin export/analysis. Do not call from user-facing request handlers. */
export async function listAllDailyPuzzleAttemptsForDate(runDate: string): Promise<DailyPuzzleAttempt[]> {
  return fetchAttemptsForDate(runDate, null);
}

export async function buildDailyPuzzleLeaderboardForDate(runDate: string): Promise<DailyPuzzleLeaderboardEntry[]> {
  const attempts = await listDailyPuzzleAttemptsForDate(runDate);
  return buildDailyPuzzleLeaderboard(attempts);
}

export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const profileRows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const username = profileRows[0]?.username?.trim();
  return username || null;
}

export async function getDailyPuzzleLadderStreak(userId: string, todayPuzzleDate: string): Promise<number> {
  const dates = await listCompletedDailyPuzzleLadderDatesForUser(userId);
  const sortedUnique = [...new Set(dates)].sort((a, b) => b.localeCompare(a));
  if (!sortedUnique.includes(todayPuzzleDate)) return 0;
  let streak = 0;
  let cursor = new Date(`${todayPuzzleDate}T00:00:00-08:00`);
  while (true) {
    const key = getPacificDateKey(cursor);
    if (!sortedUnique.includes(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}
export const handleDailyPuzzleLadderCronWarm: express.RequestHandler = async (_req, res) => {
  try {
    if (!isAuthorizedDailyPuzzleCronRequest(_req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
    const results: Array<{ runDate: string; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, {
        force: false,
        purpose: 'scheduled',
      });
      results.push({ runDate, outcome });
    }
    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Daily Puzzle ladder cron warm failed.',
    });
  }
};
