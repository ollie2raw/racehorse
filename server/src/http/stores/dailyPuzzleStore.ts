import express from 'express';
import {
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotRow,
} from '../../dailyPuzzle';
import { ensureDailyPuzzleLadderForDate } from '../../seedDailyPuzzleLadder';
import { constantTimeEqualSecret } from '../../platform/auth/adminSecret';
import { supabaseFetch } from '../../supabaseUtils';
import { getPacificDateKeyDaysFromNow } from '../../shared/pacificDate';

export async function listDailyPuzzleSlotsForDate(runDate: string): Promise<DailyPuzzleSlot[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&published=eq.true&puzzle_date=eq.${encodeURIComponent(runDate)}&order=set_version.asc,slot_index.asc,id.asc`,
    { method: 'GET' },
  );
  return sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
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

export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const profileRows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const username = profileRows[0]?.username?.trim();
  return username || null;
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
