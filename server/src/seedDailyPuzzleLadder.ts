import './loadEnv';
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

export type DailyPuzzleGenerationPurpose = 'request' | 'scheduled' | 'startup' | 'manual';

export type DailyPuzzleGenerationRejectionReason =
  | 'null_candidate'
  | 'missing_tiles'
  | 'illegal_start'
  | 'insufficient_playable_options'
  | 'score_below_threshold'
  | 'no_solution'
  | 'validation_exception'
  | 'structural_failure'
  | 'timeout'
  | 'attempt_limit';

export type LadderSlotGenerationProfile = {
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

type PuzzleBuilder = (
  seed: string,
  attempt: number,
  minHandSize: number,
  maxHandSize: number,
  minBestScore: number,
) => CuratedDailyPuzzle | null;

type PuzzleBuilders = {
  oneTurnHighScore: PuzzleBuilder;
  setupAndStrike: PuzzleBuilder;
};

type GenerationBudgetConfig = {
  purpose: DailyPuzzleGenerationPurpose;
  maxAttemptsPerSlot: number;
  maxMsPerSlot: number;
  setupAndStrikeAttempts: number;
  highScoreAttempts: number;
  structuralFailureThreshold: number;
  yieldEveryAttempts: number;
};

type GenerationPlan = {
  puzzleType: 'one_turn_high_score' | 'setup_and_strike';
  fallbackTier: 'primary' | 'relax_score' | 'wider_hand' | 'fallback_type';
  minHandSize: number;
  maxHandSize: number;
  minBestScore: number;
  enforceTargetBestScoreRange: boolean;
};

export type SlotGenerationSuccess = {
  ok: true;
  puzzle: CuratedDailyPuzzle;
  bestPossibleScore: number;
  attemptsTried: number;
  elapsedMs: number;
  strategy: string;
  fallbackTier: GenerationPlan['fallbackTier'];
  topRejectionReasons: Array<{ reason: string; count: number }>;
};

export type SlotGenerationFailure = {
  ok: false;
  reason: DailyPuzzleGenerationRejectionReason;
  attemptsTried: number;
  elapsedMs: number;
  strategy: string | null;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  message: string;
};

export type SlotGenerationOutcome = SlotGenerationSuccess | SlotGenerationFailure;

const GENERATION_BUDGETS: Record<DailyPuzzleGenerationPurpose, GenerationBudgetConfig> = {
  request: {
    purpose: 'request',
    maxAttemptsPerSlot: 18,
    maxMsPerSlot: 1_200,
    setupAndStrikeAttempts: 8,
    highScoreAttempts: 10,
    structuralFailureThreshold: 4,
    yieldEveryAttempts: 3,
  },
  scheduled: {
    purpose: 'scheduled',
    maxAttemptsPerSlot: 90,
    maxMsPerSlot: 8_000,
    setupAndStrikeAttempts: 30,
    highScoreAttempts: 60,
    structuralFailureThreshold: 8,
    yieldEveryAttempts: 5,
  },
  startup: {
    purpose: 'startup',
    maxAttemptsPerSlot: 45,
    maxMsPerSlot: 4_000,
    setupAndStrikeAttempts: 15,
    highScoreAttempts: 30,
    structuralFailureThreshold: 6,
    yieldEveryAttempts: 5,
  },
  manual: {
    purpose: 'manual',
    maxAttemptsPerSlot: 2_100,
    maxMsPerSlot: 60_000,
    setupAndStrikeAttempts: 100,
    highScoreAttempts: 2_000,
    structuralFailureThreshold: 25,
    yieldEveryAttempts: 10,
  },
};

function defaultPuzzleBuilders(): PuzzleBuilders {
  return {
    oneTurnHighScore: createHighScorePuzzle,
    setupAndStrike: generateSetupAndStrikePuzzle,
  };
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function parseCliArgs(argv: string[]): { date: string; force: boolean; diagnose: boolean } {
  const dateArgIndex = argv.findIndex((value) => value === '--date');
  const date =
    dateArgIndex >= 0 && typeof argv[dateArgIndex + 1] === 'string'
      ? argv[dateArgIndex + 1]
      : getPacificDateKey();
  if (!isIsoDate(date)) {
    throw new Error(`Invalid --date value: ${date}`);
  }
  const force = argv.includes('--force');
  const diagnose = argv.includes('--diagnose');
  return { date, force, diagnose };
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

function topRejectionReasons(counts: Map<string, number>): Array<{ reason: string; count: number }> {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function classifyGenerationError(error: unknown): DailyPuzzleGenerationRejectionReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot read properties of (null|undefined) \(reading 'tiles'\)/.test(message)) return 'missing_tiles';
  if (/missing|tiles|pool|hand/i.test(message)) return 'missing_tiles';
  if (/Playable options|legal|open end|start/i.test(message)) return 'illegal_start';
  if (/Best score|below|score/i.test(message)) return 'score_below_threshold';
  if (/Unable to find|Could not synthesize|No setup\+strike|construct/i.test(message)) return 'no_solution';
  return 'validation_exception';
}

function isCuratedPuzzle(value: unknown): value is CuratedDailyPuzzle {
  if (!value || typeof value !== 'object') return false;
  const puzzle = value as Partial<CuratedDailyPuzzle>;
  return (
    Array.isArray(puzzle.startingHand) &&
    Boolean(puzzle.startingBoard) &&
    typeof puzzle.maxMoves === 'number' &&
    typeof puzzle.targetScore === 'number' &&
    (puzzle.puzzleType === 'one_turn_high_score' || puzzle.puzzleType === 'setup_and_strike')
  );
}

function minScoreForProfile(profile: LadderSlotGenerationProfile): number {
  if (profile.slotIndex === 1) return 15;
  if (profile.slotIndex === 2) return 25;
  return 35;
}

function generationPlansForProfile(profile: LadderSlotGenerationProfile): GenerationPlan[] {
  const [minHandSize, maxHandSize] = profile.targetHandSizeRange;
  if (profile.slotIndex === 1) {
    return [
      {
        puzzleType: 'one_turn_high_score',
        fallbackTier: 'primary',
        minHandSize,
        maxHandSize,
        minBestScore: 15,
        enforceTargetBestScoreRange: true,
      },
      {
        puzzleType: 'one_turn_high_score',
        fallbackTier: 'relax_score',
        minHandSize,
        maxHandSize,
        minBestScore: 10,
        enforceTargetBestScoreRange: false,
      },
      {
        puzzleType: 'one_turn_high_score',
        fallbackTier: 'wider_hand',
        minHandSize: Math.max(3, minHandSize - 1),
        maxHandSize: Math.min(6, maxHandSize + 1),
        minBestScore: 10,
        enforceTargetBestScoreRange: false,
      },
    ];
  }
  if (profile.slotIndex === 2) {
    return [
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'primary',
        minHandSize,
        maxHandSize,
        minBestScore: 25,
        enforceTargetBestScoreRange: true,
      },
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'relax_score',
        minHandSize,
        maxHandSize,
        minBestScore: 15,
        enforceTargetBestScoreRange: false,
      },
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'wider_hand',
        minHandSize: Math.max(5, minHandSize),
        maxHandSize: Math.min(8, maxHandSize + 2),
        minBestScore: 15,
        enforceTargetBestScoreRange: false,
      },
      {
        puzzleType: 'one_turn_high_score',
        fallbackTier: 'fallback_type',
        minHandSize: Math.max(5, minHandSize),
        maxHandSize: Math.min(7, maxHandSize + 1),
        minBestScore: 20,
        enforceTargetBestScoreRange: false,
      },
    ];
  }
  return [
    {
      puzzleType: 'one_turn_high_score',
      fallbackTier: 'primary',
      minHandSize,
      maxHandSize,
      minBestScore: minScoreForProfile(profile),
      enforceTargetBestScoreRange: Boolean(profile.targetBestScoreRange),
    },
    {
      puzzleType: 'one_turn_high_score',
      fallbackTier: 'relax_score',
      minHandSize,
      maxHandSize,
      minBestScore: 25,
      enforceTargetBestScoreRange: false,
    },
    {
      puzzleType: 'one_turn_high_score',
      fallbackTier: 'wider_hand',
      minHandSize: Math.max(6, minHandSize - 2),
      maxHandSize: Math.min(10, maxHandSize),
      minBestScore: 15,
      enforceTargetBestScoreRange: false,
    },
  ];
}

function attemptsForPlan(
  budget: GenerationBudgetConfig,
  plan: GenerationPlan,
  plans: GenerationPlan[],
  attemptsRemaining: number,
): number {
  const typeBudget =
    plan.puzzleType === 'setup_and_strike'
      ? budget.setupAndStrikeAttempts
      : budget.highScoreAttempts;
  const plansForType = Math.max(1, plans.filter((entry) => entry.puzzleType === plan.puzzleType).length);
  return Math.min(Math.max(1, Math.ceil(typeBudget / plansForType)), attemptsRemaining);
}

export async function choosePuzzleForSlot(
  date: string,
  profile: LadderSlotGenerationProfile,
  options?: {
    purpose?: DailyPuzzleGenerationPurpose;
    budget?: Partial<GenerationBudgetConfig>;
    builders?: Partial<PuzzleBuilders>;
    now?: () => number;
  },
): Promise<SlotGenerationOutcome> {
  const budget = {
    ...GENERATION_BUDGETS[options?.purpose ?? 'scheduled'],
    ...(options?.budget ?? {}),
  };
  const builders = {
    ...defaultPuzzleBuilders(),
    ...(options?.builders ?? {}),
  };
  const now = options?.now ?? Date.now;
  const startedAt = now();
  const rejectionCounts = new Map<string, number>();
  let attemptsTried = 0;
  let lastStrategy: string | null = null;

  const recordRejection = (reason: DailyPuzzleGenerationRejectionReason): void => {
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  };

  const elapsedMs = (): number => Math.max(0, now() - startedAt);

  const fail = (
    reason: DailyPuzzleGenerationRejectionReason,
    message: string,
  ): SlotGenerationFailure => ({
    ok: false,
    reason,
    attemptsTried,
    elapsedMs: elapsedMs(),
    strategy: lastStrategy,
    topRejectionReasons: topRejectionReasons(rejectionCounts),
    message,
  });

  const plans = generationPlansForProfile(profile).filter((plan) =>
    profile.preferredPuzzleTypes.includes(plan.puzzleType),
  );

  for (const [planIndex, plan] of plans.entries()) {
    const puzzleType = plan.puzzleType;
    const maxAttempts = attemptsForPlan(
      budget,
      plan,
      plans,
      budget.maxAttemptsPerSlot - attemptsTried,
    );
    if (maxAttempts <= 0) break;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (elapsedMs() >= budget.maxMsPerSlot) {
        recordRejection('timeout');
        return fail('timeout', `${profile.slotTitle} generation timed out after ${elapsedMs()}ms.`);
      }
      if (attemptsTried >= budget.maxAttemptsPerSlot) {
        recordRejection('attempt_limit');
        return fail('attempt_limit', `${profile.slotTitle} generation hit attempt limit.`);
      }
      if (attemptsTried > 0 && attemptsTried % budget.yieldEveryAttempts === 0) {
        await yieldEventLoop();
      }

      attemptsTried += 1;
      lastStrategy = puzzleType;
      try {
        const seed = `${date}:slot${profile.slotIndex}`;
        const builder =
          puzzleType === 'setup_and_strike'
            ? builders.setupAndStrike
            : builders.oneTurnHighScore;
        const puzzle = builder(
          seed,
          attempt,
          plan.minHandSize,
          plan.maxHandSize,
          plan.minBestScore,
        );
        if (!isCuratedPuzzle(puzzle)) {
          recordRejection('null_candidate');
          if ((rejectionCounts.get('null_candidate') ?? 0) >= budget.structuralFailureThreshold) {
            if (planIndex < plans.length - 1) break;
            return fail('structural_failure', `${profile.slotTitle} produced repeated null candidates.`);
          }
          continue;
        }

        const bestPossibleScore = computeBestPossiblePuzzleScore(puzzle);

        const handSize = puzzle.startingHand.length;
        const [minH, maxH] = [plan.minHandSize, plan.maxHandSize];
        if (handSize < minH || handSize > maxH) {
          recordRejection('missing_tiles');
          continue;
        }

        if (plan.enforceTargetBestScoreRange && profile.targetBestScoreRange) {
          const [min, max] = profile.targetBestScoreRange;
          if (bestPossibleScore < min || bestPossibleScore > max) {
            if (attempt < maxAttempts - 20) {
              recordRejection('score_below_threshold');
              continue;
            }
          }
        }

        return {
          ok: true,
          puzzle: clonePuzzleForDate(puzzle, date, profile.slotTitle),
          bestPossibleScore,
          attemptsTried,
          elapsedMs: elapsedMs(),
          strategy: puzzleType,
          fallbackTier: plan.fallbackTier,
          topRejectionReasons: topRejectionReasons(rejectionCounts),
        };
      } catch (error) {
        const reason = classifyGenerationError(error);
        recordRejection(reason);
        if (
          (reason === 'missing_tiles' || reason === 'validation_exception') &&
          (rejectionCounts.get(reason) ?? 0) >= budget.structuralFailureThreshold
        ) {
          if (planIndex < plans.length - 1) break;
          return fail(
            'structural_failure',
            `${profile.slotTitle} aborted after repeated ${reason} failures.`,
          );
        }
      }
    }
  }

  recordRejection('attempt_limit');
  return fail(
    'attempt_limit',
    `Unable to generate ${profile.slotTitle} candidate after ${attemptsTried} attempts.`,
  );
}

type PostgrestResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

async function postgrestFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 5_000,
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

export async function diagnoseDailyPuzzleLadderForDate(date: string): Promise<{
  date: string;
  publishable: boolean;
  slotCount: number;
  slots: Array<{
    id: string;
    slotIndex: number;
    slotTitle: string;
    setVersion: number;
    published: boolean;
    slotMaxPoints: number;
    bestPossibleScore: number | null;
    missing: string[];
  }>;
  command: string;
}> {
  if (!isIsoDate(date)) throw new Error(`Invalid date key: ${date}`);
  const rawRows = await listPublishedLadderSlotRows(date);
  const slots = sortDailyPuzzleSlots(rawRows.map(normalizeDailyPuzzleSlot));
  return {
    date,
    publishable: isDailyPuzzleLadderReady(slots),
    slotCount: slots.length,
    slots: slots.map((slot) => {
      const missing: string[] = [];
      if (!slot.published) missing.push('published');
      if (slot.slotIndex < 1 || slot.slotIndex > 3) missing.push('slot_index');
      if (slot.slotMaxPoints <= 0) missing.push('slot_max_points');
      if ((slot.bestPossibleScore ?? 0) <= 0) missing.push('best_possible_score');
      if (!slot.startingBoard) missing.push('starting_board');
      if (!Array.isArray(slot.startingHand) || slot.startingHand.length === 0) missing.push('starting_hand');
      return {
        id: slot.id,
        slotIndex: slot.slotIndex,
        slotTitle: slot.slotTitle,
        setVersion: slot.setVersion,
        published: slot.published,
        slotMaxPoints: slot.slotMaxPoints,
        bestPossibleScore: slot.bestPossibleScore,
        missing,
      };
    }),
    command: `npm run seed:daily-ladder --prefix server -- --date ${date} --force`,
  };
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
): Promise<string[]> {
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
  const rows = (await response.json()) as Array<{ id?: string }> | null;
  return Array.isArray(rows) ? rows.map((row) => row.id).filter((id): id is string => Boolean(id)) : [];
}

/**
 * Idempotently writes three published `daily_puzzles` rows for the Pacific calendar date.
 * Used by CLI, server startup/schedule, and lazy `/api/daily-puzzle/today` when missing.
 */
export async function ensureDailyPuzzleLadderForDate(
  date: string,
  options?: { force?: boolean; purpose?: DailyPuzzleGenerationPurpose },
): Promise<'skipped' | 'seeded' | 'failed'> {
  const purpose = options?.purpose ?? 'scheduled';
  const startedAt = Date.now();
  try {
    if (!isIsoDate(date)) {
      console.warn('[daily-puzzle-ladder-seed] invalid date key', date);
      return 'failed';
    }
    if (!options?.force && (await isLadderReadyFromDatabase(date))) {
      return 'skipped';
    }

    console.log('[daily-puzzle-ladder] generation-start', JSON.stringify({
      date,
      purpose,
      budget: GENERATION_BUDGETS[purpose],
    }));

    const results: Array<{
      profile: LadderSlotGenerationProfile;
      puzzle: CuratedDailyPuzzle;
      bestPossibleScore: number;
      attemptsTried: number;
      elapsedMs: number;
      strategy: string;
      fallbackTier: GenerationPlan['fallbackTier'];
      publishedRowIds: string[];
      topRejectionReasons: Array<{ reason: string; count: number }>;
    }> = [];

    for (const profile of LADDER_PROFILES) {
      await yieldEventLoop();
      const result = await choosePuzzleForSlot(date, profile, { purpose });
      if (!result.ok) {
        console.warn('[daily-puzzle-ladder] generation-failed', JSON.stringify({
          date,
          purpose,
          slotIndex: profile.slotIndex,
          slotTitle: profile.slotTitle,
          reason: result.reason,
          attempts: result.attemptsTried,
          elapsedMs: result.elapsedMs,
          topRejectionReasons: result.topRejectionReasons,
        }));
        return 'failed';
      }
      const publishedRowIds = await upsertSlot(
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
      results.push({ ...result, publishedRowIds, profile });
    }

    console.log('[daily-puzzle-ladder] seeded', JSON.stringify({
      date,
      purpose,
      totalMs: Date.now() - startedAt,
      slots: results.map((res) => ({
        slotIndex: res.profile.slotIndex,
        slotTitle: res.profile.slotTitle,
        puzzleType: res.puzzle.puzzleType,
        handSize: res.puzzle.startingHand.length,
        bestPossibleScore: res.bestPossibleScore,
        attempts: res.attemptsTried,
        elapsedMs: res.elapsedMs,
        strategy: res.strategy,
        fallbackTier: res.fallbackTier,
        publishedRowIds: res.publishedRowIds,
        topRejectionReasons: res.topRejectionReasons,
      })),
    }, null, 2));
    return 'seeded';
  } catch (error) {
    console.warn('[daily-puzzle-ladder-seed] ensure failed', {
      date,
      purpose,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

async function main(): Promise<void> {
  const { date, force, diagnose } = parseCliArgs(process.argv.slice(2));
  if (diagnose) {
    const diagnostics = await diagnoseDailyPuzzleLadderForDate(date);
    console.log(JSON.stringify(diagnostics, null, 2));
    if (!diagnostics.publishable) process.exitCode = 1;
    return;
  }
  const outcome = await ensureDailyPuzzleLadderForDate(date, { force, purpose: 'manual' });
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
