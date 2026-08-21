import './loadEnv';
import {
  DAILY_PUZZLE_SLOT_COUNT,
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleSlot,
  sortDailyPuzzleSlots,
} from './dailyPuzzle';
import {
  isLadderReadyFromDatabase,
  listPublishedLadderSlotRows,
  publishGeneratedLadderSlots,
  scrubPartialPublishedLadderForDate,
  type GeneratedLadderSlot,
} from './dailyPuzzleLadderPublish';
import {
  computeBestPossiblePuzzleScore,
  createHighScorePuzzle,
  generateSetupAndStrikePuzzle,
} from './generatePuzzles';

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

/**
 * Three-slot progressive ladder.
 *
 * Slot 1 keeps the short opener hand of the five-slot era *and* its easier
 * best-score band — the opener complaint was about difficulty, not length, so
 * the pre-August `[25, 50]` floor is deliberately not restored. Slot 2 is the
 * pre-August tactical rung. Slot 3 is the master chain, unchanged in every
 * version of this ladder.
 */
export const DAILY_PUZZLE_LADDER_PROFILES: LadderSlotGenerationProfile[] = [
  {
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Hit',
    slotMaxPoints: 150,
    targetHandSizeRange: [3, 4],
    targetBestScoreRange: [5, 25],
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
    targetBestScoreRange: [30, 120],
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
    maxMsPerSlot: 180_000,
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

function generationPlansForProfile(profile: LadderSlotGenerationProfile): GenerationPlan[] {
  const [minHandSize, maxHandSize] = profile.targetHandSizeRange;
  const targetMinBestScore = profile.targetBestScoreRange?.[0];
  if (profile.preferredPuzzleTypes.includes('setup_and_strike')) {
    return [
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'primary',
        minHandSize,
        maxHandSize,
        minBestScore: targetMinBestScore ?? 25,
        enforceTargetBestScoreRange: Boolean(profile.targetBestScoreRange),
      },
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'relax_score',
        minHandSize,
        maxHandSize,
        minBestScore: Math.max(10, Math.round((targetMinBestScore ?? 20) * 0.7)),
        enforceTargetBestScoreRange: false,
      },
      {
        puzzleType: 'setup_and_strike',
        fallbackTier: 'wider_hand',
        minHandSize: Math.max(5, minHandSize),
        maxHandSize: Math.min(8, maxHandSize + 2),
        minBestScore: Math.max(10, Math.round((targetMinBestScore ?? 20) * 0.5)),
        enforceTargetBestScoreRange: false,
      },
      {
        puzzleType: 'one_turn_high_score',
        fallbackTier: 'fallback_type',
        minHandSize,
        maxHandSize,
        minBestScore: Math.max(10, Math.round((targetMinBestScore ?? 20) * 0.75)),
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
      minBestScore: targetMinBestScore ?? 35,
      enforceTargetBestScoreRange: Boolean(profile.targetBestScoreRange),
    },
    {
      puzzleType: 'one_turn_high_score',
      fallbackTier: 'relax_score',
      minHandSize,
      maxHandSize,
      minBestScore: Math.max(5, Math.round((targetMinBestScore ?? 35) * 0.7)),
      enforceTargetBestScoreRange: false,
    },
    {
      puzzleType: 'one_turn_high_score',
      fallbackTier: 'wider_hand',
      minHandSize,
      maxHandSize,
      minBestScore: Math.max(5, Math.round((targetMinBestScore ?? 35) * 0.45)),
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
          reason === 'validation_exception' &&
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
      if (slot.slotIndex < 1 || slot.slotIndex > DAILY_PUZZLE_SLOT_COUNT) missing.push('slot_index');
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

/**
 * Idempotently writes the published `daily_puzzles` rows (one per ladder slot)
 * for the Pacific calendar date.
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
    const alreadyReady = await isLadderReadyFromDatabase(date);
    if (!options?.force && alreadyReady) {
      return 'skipped';
    }
    if (!alreadyReady) {
      const scrub = await scrubPartialPublishedLadderForDate(date);
      if (scrub.scrubbed > 0) {
        console.warn('[daily-puzzle-ladder] scrubbed-partial-before-generation', {
          date,
          purpose,
          scrubbed: scrub.scrubbed,
          missingSlotIndexes: scrub.readiness.missingSlotIndexes,
        });
      }
    }

    console.log('[daily-puzzle-ladder] generation-start', JSON.stringify({
      date,
      purpose,
      budget: GENERATION_BUDGETS[purpose],
    }));

    const generated: GeneratedLadderSlot[] = [];
    const generationMeta: Array<{
      slotIndex: number;
      slotTitle: string;
      attemptsTried: number;
      elapsedMs: number;
      strategy: string;
      fallbackTier: GenerationPlan['fallbackTier'];
      topRejectionReasons: Array<{ reason: string; count: number }>;
    }> = [];

    for (const profile of DAILY_PUZZLE_LADDER_PROFILES) {
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
      generated.push({
        profile,
        puzzle: result.puzzle,
        bestPossibleScore: result.bestPossibleScore,
      });
      generationMeta.push({
        slotIndex: profile.slotIndex,
        slotTitle: profile.slotTitle,
        attemptsTried: result.attemptsTried,
        elapsedMs: result.elapsedMs,
        strategy: result.strategy,
        fallbackTier: result.fallbackTier,
        topRejectionReasons: result.topRejectionReasons,
      });
    }

    const publishedRowIds = await publishGeneratedLadderSlots(date, generated);

    console.log('[daily-puzzle-ladder] seeded', JSON.stringify({
      date,
      purpose,
      totalMs: Date.now() - startedAt,
      publishedRowIds,
      slots: generationMeta.map((meta, index) => ({
        ...meta,
        puzzleType: generated[index]?.puzzle.puzzleType,
        handSize: generated[index]?.puzzle.startingHand.length,
        bestPossibleScore: generated[index]?.bestPossibleScore,
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
