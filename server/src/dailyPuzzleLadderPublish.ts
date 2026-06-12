import {
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
  type DailyPuzzleSlotRow,
} from './dailyPuzzle';
import {
  assessDailyPuzzleLadderReadiness,
  normalizePublishedSlotRows,
} from './dailyPuzzleLadderReadiness';
import type { LadderSlotGenerationProfile } from './seedDailyPuzzleLadder';

const LADDER_SLOT_SELECT =
  'id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published';

type PostgrestResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export type CuratedDailyPuzzlePayload = {
  startingBoard: unknown;
  startingHand: unknown[];
  maxMoves: number;
  targetScore: number;
  puzzleType: string;
  dealSize: number;
};

export type GeneratedLadderSlot = {
  profile: LadderSlotGenerationProfile;
  puzzle: CuratedDailyPuzzlePayload;
  bestPossibleScore: number;
};

async function postgrestFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 8_000,
): Promise<PostgrestResponseLike> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is required.');
  const url = new URL(path, supabaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Supabase request timed out after ${timeoutMs}ms: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listPublishedLadderSlotRows(date: string): Promise<DailyPuzzleSlotRow[]> {
  const response = await postgrestFetch(
    `/rest/v1/daily_puzzles?select=${LADDER_SLOT_SELECT}&published=eq.true&puzzle_date=eq.${encodeURIComponent(date)}&order=set_version.asc,slot_index.asc,id.asc`,
  );
  if (!response.ok) return [];
  const rows = (await response.json()) as DailyPuzzleSlotRow[];
  return Array.isArray(rows) ? rows : [];
}

export async function isLadderReadyFromDatabase(date: string): Promise<boolean> {
  try {
    const rawRows = await listPublishedLadderSlotRows(date);
    return isDailyPuzzleLadderReady(normalizePublishedSlotRows(rawRows));
  } catch {
    return false;
  }
}

export async function unpublishLadderSlotsByIds(ids: string[]): Promise<number> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const filter = uniqueIds.map((id) => encodeURIComponent(id)).join(',');
  const response = await postgrestFetch(`/rest/v1/daily_puzzles?id=in.(${filter})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ published: false }),
  });
  if (!response.ok) {
    throw new Error(`Failed to unpublish ladder slots: ${response.status} ${await response.text()}`);
  }
  return uniqueIds.length;
}

/**
 * Unpublish published rows that do not form a complete ready ladder.
 * Prevents players from seeing a broken 1–2 slot day.
 */
export async function scrubPartialPublishedLadderForDate(date: string): Promise<{
  scrubbed: number;
  ready: boolean;
  readiness: ReturnType<typeof assessDailyPuzzleLadderReadiness>;
}> {
  const rawRows = await listPublishedLadderSlotRows(date);
  const slots = normalizePublishedSlotRows(rawRows);
  const readiness = assessDailyPuzzleLadderReadiness(date, slots);
  if (readiness.ready) {
    return { scrubbed: 0, ready: true, readiness };
  }
  if (slots.length === 0) {
    return { scrubbed: 0, ready: false, readiness };
  }
  const scrubbed = await unpublishLadderSlotsByIds(slots.map((slot) => slot.id));
  console.warn('[daily-puzzle-ladder] scrubbed-partial-publish', {
    date,
    scrubbed,
    slotIndexes: slots.map((slot) => slot.slotIndex),
    missingSlotIndexes: readiness.missingSlotIndexes,
  });
  return {
    scrubbed,
    ready: false,
    readiness: assessDailyPuzzleLadderReadiness(date, []),
  };
}

async function upsertPublishedSlot(
  date: string,
  config: {
    slotIndex: number;
    slotTitle: string;
    tier: string;
    slotMaxPoints: number;
    puzzleType: string;
  },
  puzzle: CuratedDailyPuzzlePayload,
  bestPossibleScore: number,
): Promise<string[]> {
  const response = await postgrestFetch('/rest/v1/daily_puzzles?on_conflict=puzzle_date,slot_index,set_version', {
    method: 'POST',
    body: JSON.stringify([
      {
        puzzle_date: date,
        title: config.slotTitle,
        starting_board: puzzle.startingBoard,
        starting_hand: puzzle.startingHand,
        max_moves: puzzle.maxMoves,
        target_score: puzzle.targetScore,
        puzzle_type: puzzle.puzzleType,
        deal_size: puzzle.dealSize,
        slot_index: config.slotIndex,
        slot_title: config.slotTitle,
        tier: config.tier,
        slot_max_points: config.slotMaxPoints,
        objective_type: puzzle.puzzleType,
        objective_payload: {
          best_possible_score: bestPossibleScore,
        },
        set_version: 1,
        published: true,
      },
    ]),
  });
  if (!response.ok) {
    throw new Error(`Failed to upsert slot ${config.slotIndex}: ${response.status} ${await response.text()}`);
  }
  const rows = (await response.json()) as Array<{ id?: string }> | null;
  return Array.isArray(rows) ? rows.map((row) => row.id).filter((id): id is string => Boolean(id)) : [];
}

export async function publishGeneratedLadderSlots(
  date: string,
  generated: GeneratedLadderSlot[],
): Promise<string[]> {
  const publishedIds: string[] = [];
  try {
    for (const entry of generated) {
      const ids = await upsertPublishedSlot(
        date,
        {
          slotIndex: entry.profile.slotIndex,
          slotTitle: entry.profile.slotTitle,
          tier: entry.profile.tier,
          slotMaxPoints: entry.profile.slotMaxPoints,
          puzzleType: entry.puzzle.puzzleType,
        },
        entry.puzzle,
        entry.bestPossibleScore,
      );
      publishedIds.push(...ids);
    }
    const rows = await listPublishedLadderSlotRows(date);
    const slots = sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
    if (!isDailyPuzzleLadderReady(slots)) {
      throw new Error('Ladder publish verification failed after upsert.');
    }
    return publishedIds;
  } catch (error) {
    if (publishedIds.length > 0) {
      await unpublishLadderSlotsByIds(publishedIds).catch((rollbackError) => {
        console.warn('[daily-puzzle-ladder] rollback-failed', {
          date,
          publishedIds,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      });
    }
    throw error;
  }
}
