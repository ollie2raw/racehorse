import {
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotRow,
} from '../../dailyPuzzle';
import { supabaseFetch } from '../../supabaseUtils';

export async function listDailyPuzzleSlotsForDate(runDate: string): Promise<DailyPuzzleSlot[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&published=eq.true&puzzle_date=eq.${encodeURIComponent(runDate)}&order=set_version.asc,slot_index.asc,id.asc`,
    { method: 'GET' },
  );
  return sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
}

export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const profileRows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const username = profileRows[0]?.username?.trim();
  return username || null;
}
