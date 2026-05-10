import './loadEnv';
import { spawnSync } from 'child_process';
import {
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
  type DailyPuzzleSlotRow,
} from './dailyPuzzle';

function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseCliArgs(argv: string[]): { date: string } {
  const dateArgIndex = argv.findIndex((value) => value === '--date');
  const date =
    dateArgIndex >= 0 && typeof argv[dateArgIndex + 1] === 'string'
      ? argv[dateArgIndex + 1]
      : getPacificDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date value: ${date}`);
  }
  return { date };
}

function curlPostgrestJson(url: string, serviceKey: string): unknown {
  const result = spawnSync(
    'curl',
    [
      '-sS',
      '-H',
      `apikey: ${serviceKey}`,
      '-H',
      `Authorization: Bearer ${serviceKey}`,
      '-H',
      'Content-Type: application/json',
      url,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'curl fallback failed');
  }
  return JSON.parse(result.stdout ?? 'null');
}

async function postgrestFetch<T>(path: string): Promise<T> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is required.');
  const url = new URL(path, supabaseUrl);
  try {
    const response = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`PostgREST ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  } catch {
    return curlPostgrestJson(url.toString(), serviceKey) as T;
  }
}

async function main(): Promise<void> {
  const { date } = parseCliArgs(process.argv.slice(2));
  const rows = await postgrestFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&puzzle_date=eq.${encodeURIComponent(date)}&order=set_version.asc,slot_index.asc,id.asc`,
  );

  const allSlots = rows.map(normalizeDailyPuzzleSlot);
  const publishedSlots = allSlots.filter((slot) => slot.published);
  const sortedPublished = sortDailyPuzzleSlots(publishedSlots);
  const ready = isDailyPuzzleLadderReady(publishedSlots);

  const output = {
    date_key: date,
    slot_count: sortedPublished.length,
    published_count: publishedSlots.length,
    total_rows_for_date: allSlots.length,
    set_versions: [...new Set(sortedPublished.map((slot) => slot.setVersion))],
    best_scores: sortedPublished.map((slot) => ({
      slot_index: slot.slotIndex,
      title: slot.slotTitle,
      best_possible_score: slot.bestPossibleScore ?? 0,
      hand_size: Array.isArray(slot.startingHand) ? slot.startingHand.length : null,
      set_version: slot.setVersion,
      published: slot.published,
    })),
    legacySinglePuzzleDay: !ready,
  };

  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
