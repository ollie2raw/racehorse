import './loadEnv';
import { spawnSync } from 'child_process';
import {
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
  type DailyPuzzleSlotRow,
} from './dailyPuzzle';
import {
  computeBestPossiblePuzzleScore,
  createHighScorePuzzle,
  generateSetupAndStrikePuzzle,
} from './generatePuzzles';

const LADDER_SLOT_SELECT =
  'id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published';

type LadderSlotGenerationProfile = {
  slotIndex: 1 | 2 | 3;
  tier: 'quick_line' | 'tactical_setup' | 'master_chain';
  slotTitle: string;
  slotMaxPoints: number;
  targetHandSizeRange: [number, number];
  targetBestScoreRange?: [number, number];
  preferredPuzzleTypes: ('one_turn_high_score' | 'setup_and_strike')[];
};

const LADDER_PROFILES: LadderSlotGenerationProfile[] = [
  {
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Line',
    slotMaxPoints: 150,
    targetHandSizeRange: [3, 4],
    targetBestScoreRange: [25, 50],
    preferredPuzzleTypes: ['one_turn_high_score'],
  },
  {
    slotIndex: 2,
    tier: 'tactical_setup',
    slotTitle: 'Tactical Setup',
    slotMaxPoints: 250,
    targetHandSizeRange: [5, 6],
    targetBestScoreRange: [35, 75],
    preferredPuzzleTypes: ['setup_and_strike', 'one_turn_high_score'],
  },
  {
    slotIndex: 3,
    tier: 'master_chain',
    slotTitle: 'Master Chain',
    slotMaxPoints: 400,
    targetHandSizeRange: [8, 10],
    preferredPuzzleTypes: ['one_turn_high_score'],
  },
];

type CuratedDailyPuzzle = ReturnType<typeof createHighScorePuzzle>;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseCliArgs(argv: string[]): { date: string; force: boolean } {
  const dateArgIndex = argv.findIndex((value) => value === '--date');
  const date =
    dateArgIndex >= 0 && typeof argv[dateArgIndex + 1] === 'string'
      ? argv[dateArgIndex + 1]
      : getPacificDateKey();
  if (!isIsoDate(date)) {
    throw new Error(`Invalid --date value: ${date}`);
  }
  const force = argv.includes('--force');
  return { date, force };
}

function clonePuzzleForDate(
  puzzle: CuratedDailyPuzzle,
  date: string,
  title: string,
): CuratedDailyPuzzle {
  return {
    ...puzzle,
    id: `${puzzle.id}-${title.toLowerCase().replace(/\s+/g, '-')}`,
    puzzleDate: date,
    title,
  };
}

function summarizeErrors(errors: string[]): string {
  const counts = new Map<string, number>();
  for (const error of errors) {
    counts.set(error, (counts.get(error) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => `${count}x ${message}`)
    .join(' | ');
}

function choosePuzzleForSlot(
  date: string,
  profile: LadderSlotGenerationProfile,
): {
  puzzle: CuratedDailyPuzzle;
  bestPossibleScore: number;
  attemptsTried: number;
  strategy: string;
} {
  const errors: string[] = [];
  let attemptsTried = 0;

  for (const puzzleType of profile.preferredPuzzleTypes) {
    const maxAttempts = puzzleType === 'setup_and_strike' ? 100 : 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      attemptsTried += 1;
      try {
        let puzzle: CuratedDailyPuzzle;

        // Ladder-specific score targets
        let minScore = 35; // Default global MIN_BEST_SCORE
        if (profile.slotIndex === 1) minScore = 15;
        else if (profile.slotIndex === 2) minScore = 25;

        if (puzzleType === 'setup_and_strike') {
          puzzle = generateSetupAndStrikePuzzle(
            `${date}:slot${profile.slotIndex}`,
            attempt,
            profile.targetHandSizeRange[0],
            profile.targetHandSizeRange[1],
            minScore,
          );
        } else {
          puzzle = createHighScorePuzzle(
            `${date}:slot${profile.slotIndex}`,
            attempt,
            profile.targetHandSizeRange[0],
            profile.targetHandSizeRange[1],
            minScore,
          );
        }

        const bestPossibleScore = computeBestPossiblePuzzleScore(puzzle);

        // Ladder-specific validation (moved from global generator)
        const handSize = puzzle.startingHand.length;
        const [minH, maxH] = profile.targetHandSizeRange;
        if (handSize < minH || handSize > maxH) continue;

        // If specific target range is defined in profile, try to stay within it
        if (profile.targetBestScoreRange) {
          const [min, max] = profile.targetBestScoreRange;
          if (bestPossibleScore < min || bestPossibleScore > max) {
            // Keep trying if we have attempts left
            if (attempt < maxAttempts - 20) {
              continue;
            }
          }
        }

        return {
          puzzle: clonePuzzleForDate(puzzle, date, profile.slotTitle),
          bestPossibleScore,
          attemptsTried,
          strategy: puzzleType,
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(
    `Unable to generate ${profile.slotTitle} candidate after ${attemptsTried} attempts. ${summarizeErrors(errors)}`,
  );
}

type PostgrestResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

function curlPostgrestFallback(
  url: string,
  serviceKey: string,
  init?: RequestInit,
): PostgrestResponseLike {
  const args = [
    '-sS',
    '-X',
    init?.method ?? 'GET',
    '-H',
    `apikey: ${serviceKey}`,
    '-H',
    `Authorization: Bearer ${serviceKey}`,
    '-H',
    'Content-Type: application/json',
  ];
  const preferHeader =
    init?.headers && typeof init.headers === 'object' && 'Prefer' in init.headers
      ? (init.headers as Record<string, string>).Prefer
      : undefined;
  if (preferHeader) {
    args.push('-H', `Prefer: ${preferHeader}`);
  }
  if (typeof init?.body === 'string') {
    args.push('--data', init.body);
  }
  args.push(url, '-w', '\n__STATUS__:%{http_code}');

  const result = spawnSync('curl', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'curl fallback failed');
  }

  const stdout = result.stdout ?? '';
  const markerIndex = stdout.lastIndexOf('\n__STATUS__:');
  const bodyText = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const statusText = markerIndex >= 0 ? stdout.slice(markerIndex + '\n__STATUS__:'.length).trim() : '0';
  const status = Number.parseInt(statusText, 10) || 0;

  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return bodyText;
    },
    async json() {
      return bodyText ? JSON.parse(bodyText) : null;
    },
  };
}

async function postgrestFetch(path: string, init?: RequestInit): Promise<PostgrestResponseLike> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is required.');
  const url = new URL(path, supabaseUrl);
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
    });
  } catch {
    return curlPostgrestFallback(url.toString(), serviceKey, {
      ...init,
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
        ...(init?.headers ?? {}),
      },
    });
  }
}

async function listPublishedLadderSlotRows(date: string): Promise<DailyPuzzleSlotRow[]> {
  const response = await postgrestFetch(
    `/rest/v1/daily_puzzles?select=${LADDER_SLOT_SELECT}&published=eq.true&puzzle_date=eq.${encodeURIComponent(date)}&order=set_version.asc,slot_index.asc,id.asc`,
  );
  if (!response.ok) return [];
  const rows = (await response.json()) as DailyPuzzleSlotRow[];
  return Array.isArray(rows) ? rows : [];
}

/** Same readiness contract as `/api/daily-puzzle/today` (three published slots, scoring metadata). */
async function isLadderReadyFromDatabase(date: string): Promise<boolean> {
  try {
    const rawRows = await listPublishedLadderSlotRows(date);
    const slots = sortDailyPuzzleSlots(rawRows.map(normalizeDailyPuzzleSlot));
    return isDailyPuzzleLadderReady(slots);
  } catch {
    return false;
  }
}

async function upsertSlot(
  date: string,
  config: {
    slotIndex: number;
    slotTitle: string;
    tier: string;
    slotMaxPoints: number;
    puzzleType: string;
  },
  puzzle: CuratedDailyPuzzle,
  bestPossibleScore: number,
): Promise<void> {
  const response = await postgrestFetch(
    '/rest/v1/daily_puzzles?on_conflict=puzzle_date,slot_index,set_version',
    {
      method: 'POST',
      body: JSON.stringify([{
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
      }]),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to upsert slot ${config.slotIndex}: ${response.status} ${await response.text()}`);
  }
}

/**
 * Idempotently writes three published `daily_puzzles` rows for the Pacific calendar date.
 * Used by CLI, server startup/schedule, and lazy `/api/daily-puzzle/today` when missing.
 */
export async function ensureDailyPuzzleLadderForDate(
  date: string,
  options?: { force?: boolean },
): Promise<'skipped' | 'seeded' | 'failed'> {
  try {
    if (!isIsoDate(date)) {
      console.warn('[daily-puzzle-ladder-seed] invalid date key', date);
      return 'failed';
    }
    if (!options?.force && (await isLadderReadyFromDatabase(date))) {
      return 'skipped';
    }

    const results: Array<{
      profile: LadderSlotGenerationProfile;
      puzzle: CuratedDailyPuzzle;
      bestPossibleScore: number;
      attemptsTried: number;
      strategy: string;
    }> = [];

    for (const profile of LADDER_PROFILES) {
      const result = choosePuzzleForSlot(date, profile);
      await upsertSlot(
        date,
        {
          slotIndex: profile.slotIndex,
          slotTitle: profile.slotTitle,
          tier: profile.tier,
          slotMaxPoints: profile.slotMaxPoints,
          puzzleType: result.puzzle.puzzleType,
        },
        result.puzzle,
        result.bestPossibleScore,
      );
      results.push({ ...result, profile });
    }

    console.log(`[daily-puzzle-ladder] seeded ${date}`);
    for (const res of results) {
      const handSize = res.puzzle.startingHand.length;
      console.log(
        `[daily-puzzle-ladder] slot ${res.profile.slotIndex} | ${res.profile.slotTitle} | ${res.puzzle.puzzleType} | hand=${handSize} | best=${res.bestPossibleScore} | attempts=${res.attemptsTried} | strategy=${res.strategy}`,
      );
    }
    return 'seeded';
  } catch (error) {
    console.warn('[daily-puzzle-ladder-seed] ensure failed', {
      date,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

async function main(): Promise<void> {
  const { date, force } = parseCliArgs(process.argv.slice(2));
  const outcome = await ensureDailyPuzzleLadderForDate(date, { force });
  if (outcome === 'skipped') {
    console.log(`Daily Puzzle Ladder already ready for ${date}, skipping.`);
    return;
  }
  if (outcome === 'failed') {
    console.error(`Daily Puzzle Ladder seed failed for ${date}.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
