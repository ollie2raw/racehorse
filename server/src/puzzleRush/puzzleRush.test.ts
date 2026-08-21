/**
 * Puzzle Rush phase 1 — pool seeding, run selection, grading/anti-cheat, and
 * the personal-best board.
 *
 * The grading tests run real generated puzzles through the real engine rather
 * than fixtures, so a change to move legality or scoring shows up here.
 */
import { describe, expect, it } from 'vitest';
import { createHighScorePuzzle, computeBestPossiblePuzzleScore } from '../generatePuzzles';
import { getLegalMoves } from '../game/engine';
import { DEFAULT_CONFIG, type BoardState, type GameState, type PlayMove, type Tile } from '../game/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PUZZLE_RUSH_CONFIG,
  assertStagesCoverRun,
  isPuzzleRushStageKey,
  isStageStartOrdinal,
  maxLegitimateRunSeconds,
  stageForOrdinal,
} from './config';
import { deriveDifficultyScore, selectRunPuzzles, summarizeSelectionFallbacks } from './difficulty';
import {
  calculateRushAwardedPoints,
  calculateRushBonusSeconds,
  gradeRun,
  type ReportedPuzzle,
} from './grading';
import { buildPuzzleRushLeaderboard, findPersonalBestRun } from './leaderboard';
import { buildPoolSeedCandidates } from '../seedPuzzlePool';
import type { PuzzlePoolEntry, PuzzleRushRun } from './types';

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * A real generated puzzle, cheap band (~1ms per the scoping benchmark).
 * Generation legitimately rejects some seeds, so retry across attempts —
 * the same thing `choosePuzzleForSlot` does.
 */
function makeRealPuzzle(seed: string): { board: unknown; hand: Tile[]; bestPossibleScore: number } {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const puzzle = createHighScorePuzzle(`${seed}:${attempt}`, attempt, 3, 4, 5);
      const bestPossibleScore = computeBestPossiblePuzzleScore(puzzle);
      if (bestPossibleScore > 0) {
        return { board: puzzle.startingBoard, hand: puzzle.startingHand, bestPossibleScore };
      }
    } catch {
      /* rejected candidate; try the next attempt */
    }
  }
  throw new Error(`Could not generate a test puzzle for seed ${seed}`);
}

function poolEntry(overrides: Partial<PuzzlePoolEntry> & { id: string }): PuzzlePoolEntry {
  return {
    source: 'daily_puzzles',
    sourcePuzzleId: null,
    startingBoard: {},
    startingHand: [{ low: 1, high: 1 }],
    maxMoves: 1,
    puzzleType: 'one_turn_high_score',
    tier: 'quick_line',
    dealSize: 14,
    targetScore: 999,
    bestPossibleScore: 20,
    difficultyScore: 100,
    playCount: 0,
    enabled: true,
    ...overrides,
  };
}

/** The single best first move for a puzzle, as a submitted line. */
function bestSingleMoveLine(board: unknown, hand: Tile[]): Array<Record<string, unknown>> {
  const state: GameState = {
    config: { ...DEFAULT_CONFIG, tilesPerPlayer: Math.max(1, hand.length), deadTileCount: 0, winningScore: 999 },
    playerIds: ['you', 'bot'],
    players: { you: { id: 'you', hand, score: 0 }, bot: { id: 'bot', hand: [], score: 0 } },
    board: board as BoardState,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  } as GameState;
  const moves = getLegalMoves(state, 'you').filter((move): move is PlayMove => move.type === 'play');
  if (moves.length === 0) return [];
  return [{ tile: moves[0].tile, position: moves[0].position }];
}

function run(overrides: Partial<PuzzleRushRun> & { id: string; userId: string }): PuzzleRushRun {
  return {
    username: 'Player',
    status: 'completed',
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T10:02:00.000Z',
    totalScore: 0,
    puzzlesSolved: 0,
    clientReportedScore: 0,
    invalidatedReason: null,
    configVersion: 1,
    ...overrides,
  };
}

// ─── pool seeding ────────────────────────────────────────────────────────

describe('pool seeding from daily_puzzles', () => {
  it('produces valid pool rows from published and unpublished daily rows alike', () => {
    const { board, hand, bestPossibleScore } = makeRealPuzzle('seed-valid');
    const { candidates, skipped } = buildPoolSeedCandidates([
      {
        id: 'daily-1',
        starting_board: board,
        starting_hand: hand,
        max_moves: 1,
        puzzle_type: 'one_turn_high_score',
        tier: 'quick_line',
        deal_size: 14,
        target_score: 999,
        objective_payload: { best_possible_score: bestPossibleScore },
      },
    ]);

    expect(skipped).toEqual([]);
    expect(candidates).toHaveLength(1);
    const row = candidates[0];
    expect(row.source).toBe('daily_puzzles');
    expect(row.source_puzzle_id).toBe('daily-1');
    expect(row.best_possible_score).toBe(bestPossibleScore);
    expect(row.best_possible_score).toBeGreaterThan(0);
    expect(row.difficulty_score).toBeGreaterThanOrEqual(0);
    expect(row.difficulty_score).toBeLessThanOrEqual(1000);
    expect(row.play_count).toBe(0);
    expect(row.enabled).toBe(true);
  });

  it('recomputes a missing best_possible_score rather than dropping the puzzle', () => {
    const { board, hand, bestPossibleScore } = makeRealPuzzle('seed-recompute');
    const { candidates, skipped } = buildPoolSeedCandidates([
      {
        id: 'daily-2',
        starting_board: board,
        starting_hand: hand,
        max_moves: 1,
        puzzle_type: 'one_turn_high_score',
        tier: 'master_chain',
        deal_size: 14,
        target_score: 999,
        objective_payload: {},
      },
    ]);

    expect(skipped).toEqual([]);
    expect(candidates[0].best_possible_score).toBe(bestPossibleScore);
  });

  it('skips rows with no usable content instead of writing invalid pool rows', () => {
    const { candidates, skipped } = buildPoolSeedCandidates([
      {
        id: 'daily-bad',
        starting_board: null,
        starting_hand: [],
        max_moves: 1,
        puzzle_type: 'one_turn_high_score',
        tier: 'quick_line',
        deal_size: 14,
        target_score: 999,
        objective_payload: { best_possible_score: 30 },
      },
    ]);

    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ sourcePuzzleId: 'daily-bad', reason: 'missing_board_or_hand' }]);
  });

  it('derives difficulty inside each tier band', () => {
    expect(deriveDifficultyScore({ tier: 'quick_line', bestPossibleScore: 5 })).toBeLessThan(
      deriveDifficultyScore({ tier: 'tactical_setup', bestPossibleScore: 5 }),
    );
    expect(deriveDifficultyScore({ tier: 'tactical_setup', bestPossibleScore: 5 })).toBeLessThan(
      deriveDifficultyScore({ tier: 'master_chain', bestPossibleScore: 5 }),
    );
    // Higher scoring headroom is harder within a tier.
    expect(deriveDifficultyScore({ tier: 'quick_line', bestPossibleScore: 100 })).toBeGreaterThan(
      deriveDifficultyScore({ tier: 'quick_line', bestPossibleScore: 10 }),
    );
    expect(deriveDifficultyScore({ tier: 'master_chain', bestPossibleScore: 10_000 })).toBeLessThanOrEqual(1000);
  });
});

// ─── run selection / start payload ───────────────────────────────────────

describe('run selection', () => {
  // Shaped like the real pool: each tier clusters inside its own band.
  const candidates: PuzzlePoolEntry[] = [
    ...Array.from({ length: 12 }, (_, i) =>
      poolEntry({ id: `q-${i}`, tier: 'quick_line', difficultyScore: 20 + i * 5 })),
    ...Array.from({ length: 14 }, (_, i) =>
      poolEntry({ id: `t-${i}`, tier: 'tactical_setup', difficultyScore: 370 + i * 5 })),
    ...Array.from({ length: 14 }, (_, i) =>
      poolEntry({ id: `m-${i}`, tier: 'master_chain', difficultyScore: 745 + i * 5 })),
  ];

  it('never includes bestPossibleScore in the start payload', () => {
    const { puzzles } = selectRunPuzzles({ candidates });
    expect(puzzles.length).toBe(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun);
    for (const puzzle of puzzles) {
      // The whole difficulty of the mode is not knowing the optimum.
      expect(puzzle).not.toHaveProperty('bestPossibleScore');
      expect(puzzle).not.toHaveProperty('difficultyScore');
      expect(puzzle).not.toHaveProperty('playCount');
      expect(JSON.stringify(puzzle)).not.toContain('bestPossible');
    }
  });

  it('ramps tier as the run progresses', () => {
    const { puzzles, fallbacks } = selectRunPuzzles({ candidates });
    expect(puzzles[0].tier).toBe('quick_line');
    expect(puzzles[4].tier).toBe('tactical_setup');
    expect(puzzles[12].tier).toBe('master_chain');
    expect(puzzles.map((puzzle) => puzzle.stageKey)).toEqual([
      ...Array(3).fill('warm_up'),
      ...Array(5).fill('building'),
      ...Array(7).fill('master'),
    ]);
    // Points per puzzle are non-decreasing across the run.
    const points = puzzles.map((puzzle) => puzzle.maxPoints);
    expect(points).toEqual([...points].sort((a, b) => a - b));
    // 12/14/14 per tier covers the 3/5/7 the ramp needs, with no degrading.
    expect(fallbacks).toEqual([]);
  });

  it('assigns unique sequential ordinals', () => {
    const { puzzles } = selectRunPuzzles({ candidates });
    expect(puzzles.map((puzzle) => puzzle.ordinal)).toEqual(
      Array.from({ length: PUZZLE_RUSH_CONFIG.run.puzzlesPerRun }, (_, i) => i + 1),
    );
  });

  it('never serves the same puzzle twice inside one run', () => {
    const { puzzles } = selectRunPuzzles({ candidates });
    const ids = puzzles.map((puzzle) => puzzle.puzzleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to an adjacent band instead of repeating when a tier is too thin', () => {
    // Only 1 quick_line puzzle, but Warm-Up wants 3. Thin easy tiers are
    // exactly the shape of the real pool (~106 quick_line rows).
    const thin: PuzzlePoolEntry[] = [
      ...Array.from({ length: 1 }, (_, i) =>
        poolEntry({ id: `q-${i}`, tier: 'quick_line', difficultyScore: 30 + i * 10 })),
      ...Array.from({ length: 20 }, (_, i) =>
        poolEntry({ id: `t-${i}`, tier: 'tactical_setup', difficultyScore: 371 + i * 3 })),
      ...Array.from({ length: 20 }, (_, i) =>
        poolEntry({ id: `m-${i}`, tier: 'master_chain', difficultyScore: 745 + i * 3 })),
    ];

    const selection = selectRunPuzzles({ candidates: thin });

    // No repeats, full run length.
    const ids = selection.puzzles.map((puzzle) => puzzle.puzzleId);
    expect(ids).toHaveLength(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun);
    expect(new Set(ids).size).toBe(ids.length);
    expect(selection.shortfall).toBe(false);

    // The single quick_line puzzle is used exactly once...
    expect(ids.filter((id) => id.startsWith('q-'))).toHaveLength(1);

    // ...and the degradation is observable, attributed to the thin tier.
    expect(selection.fallbacks.length).toBeGreaterThan(0);
    const quickLineFallbacks = selection.fallbacks.filter(
      (fallback) => fallback.requestedTier === 'quick_line',
    );
    // Warm-Up needs 3, the pool has 1 — the other 2 borrow from tactical_setup.
    expect(quickLineFallbacks.length).toBe(2);
    expect(quickLineFallbacks.every((fallback) => fallback.reason === 'tier_exhausted')).toBe(true);
    // Borrowed from the nearest tier, not the far one.
    expect(quickLineFallbacks.every((fallback) => fallback.usedTier === 'tactical_setup')).toBe(true);
    expect(summarizeSelectionFallbacks(selection)['quick_line:tier_exhausted']).toBe(2);
  });

  it('reports band_exhausted when the tier has content but the band does not', () => {
    // Right tier, all sitting outside the early ordinals' 0-250 band.
    const outOfBand: PuzzlePoolEntry[] = Array.from({ length: 40 }, (_, i) =>
      poolEntry({ id: `q-${i}`, tier: 'quick_line', difficultyScore: 300 + i }));

    const selection = selectRunPuzzles({ candidates: outOfBand });

    expect(selection.fallbacks.length).toBeGreaterThan(0);
    expect(selection.fallbacks[0]).toMatchObject({
      ordinal: 1,
      requestedTier: 'quick_line',
      usedTier: 'quick_line',
      reason: 'band_exhausted',
    });
  });

  it('serves a short run rather than repeating when the pool is smaller than one run', () => {
    const tiny = Array.from({ length: 4 }, (_, i) => poolEntry({ id: `only-${i}` }));
    const selection = selectRunPuzzles({ candidates: tiny });

    expect(selection.puzzles).toHaveLength(4);
    expect(selection.shortfall).toBe(true);
    expect(selection.requestedCount).toBe(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun);
    const ids = selection.puzzles.map((puzzle) => puzzle.puzzleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns nothing when the pool is empty', () => {
    const selection = selectRunPuzzles({ candidates: [] });
    expect(selection.puzzles).toEqual([]);
    expect(selection.shortfall).toBe(true);
  });

  it('survives the real pool shape: thin easy tiers, huge master_chain', () => {
    // Proportions measured from production on 2026-08-20:
    // quick_line 106, tactical_setup 104, master_chain 2074.
    // Counts and difficulty windows measured from production on 2026-08-20.
    const realistic: PuzzlePoolEntry[] = [
      ...Array.from({ length: 106 }, (_, i) =>
        poolEntry({ id: `q-${i}`, tier: 'quick_line', difficultyScore: 17 + (i % 64) })),
      ...Array.from({ length: 104 }, (_, i) =>
        poolEntry({ id: `t-${i}`, tier: 'tactical_setup', difficultyScore: 371 + (i % 70) })),
      ...Array.from({ length: 300 }, (_, i) =>
        poolEntry({ id: `m-${i}`, tier: 'master_chain', difficultyScore: 743 + (i % 86) })),
    ];

    const selection = selectRunPuzzles({ candidates: realistic });
    const ids = selection.puzzles.map((puzzle) => puzzle.puzzleId);

    expect(ids).toHaveLength(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun);
    expect(new Set(ids).size).toBe(ids.length);
    expect(selection.shortfall).toBe(false);
    // The configured bands are set from exactly this distribution, so a real
    // pool must ramp cleanly. A failure here means config drifted from content.
    expect(selection.fallbacks).toEqual([]);
  });
});

// ─── stages ──────────────────────────────────────────────────────────────

describe('run stages', () => {
  const stages = PUZZLE_RUSH_CONFIG.run.stages;

  it('are exactly three, named, and structurally sound', () => {
    // Three because the pool has three tiers with no within-tier difficulty
    // spread. If this becomes four, the pool changed — check the ops runbook.
    expect(stages).toHaveLength(3);
    expect(stages.map((stage) => stage.key)).toEqual(['warm_up', 'building', 'master']);
    expect(stages.map((stage) => stage.label)).toEqual(['Warm-Up', 'Building', 'Master']);
    expect(assertStagesCoverRun()).toEqual([]);
  });

  it('cover every ordinal of the run contiguously, with no gap or overlap', () => {
    const covered: string[] = [];
    for (let ordinal = 1; ordinal <= PUZZLE_RUSH_CONFIG.run.puzzlesPerRun; ordinal++) {
      const owning = stages.filter(
        (stage) => ordinal >= stage.fromOrdinal && ordinal <= stage.toOrdinal,
      );
      // Exactly one stage owns each ordinal.
      expect(owning).toHaveLength(1);
      covered.push(owning[0].key);
    }
    expect(covered).toHaveLength(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun);
    expect(new Set(covered).size).toBe(3);
  });

  it('reports real boundaries: stageForOrdinal agrees with the declared ranges', () => {
    for (const stage of stages) {
      expect(stageForOrdinal(stage.fromOrdinal).key).toBe(stage.key);
      expect(stageForOrdinal(stage.toOrdinal).key).toBe(stage.key);
      expect(isStageStartOrdinal(stage.fromOrdinal)).toBe(true);
      // Only the first ordinal of a stage is a start.
      if (stage.toOrdinal > stage.fromOrdinal) {
        expect(isStageStartOrdinal(stage.fromOrdinal + 1)).toBe(false);
      }
    }
    // The exact transition points the client renders a beat on.
    const starts = Array.from(
      { length: PUZZLE_RUSH_CONFIG.run.puzzlesPerRun },
      (_, i) => i + 1,
    ).filter((ordinal) => isStageStartOrdinal(ordinal));
    expect(starts).toEqual([1, 4, 9]);
  });

  it('each stage draws its own tier, with points flat inside a stage', () => {
    expect(stages.map((stage) => stage.tier)).toEqual([
      'quick_line',
      'tactical_setup',
      'master_chain',
    ]);
    // Points change only at a stage boundary — never mid-stage, because
    // difficulty does not sub-ramp inside a tier.
    expect(stages.map((stage) => stage.maxPointsPerPuzzle)).toEqual([100, 250, 500]);
    for (const stage of stages) {
      for (let ordinal = stage.fromOrdinal; ordinal <= stage.toOrdinal; ordinal++) {
        expect(stageForOrdinal(ordinal).maxPointsPerPuzzle).toBe(stage.maxPointsPerPuzzle);
      }
    }
  });

  it('each stage band contains its own tier, so no stage degrades by construction', () => {
    // The drift guard: a band that no longer contains its tier's real
    // difficulty window is exactly the bug the original five-band config had.
    const tierWindows: Record<string, [number, number]> = {
      // Measured from production on 2026-08-20.
      quick_line: [17, 80],
      tactical_setup: [371, 440],
      master_chain: [743, 828],
    };
    for (const stage of stages) {
      const [windowLow, windowHigh] = tierWindows[stage.tier];
      const [bandLow, bandHigh] = stage.difficultyRange;
      expect(bandLow).toBeLessThanOrEqual(windowLow);
      expect(bandHigh).toBeGreaterThanOrEqual(windowHigh);
    }
  });

  it('labels every served puzzle with its stage and marks the transition ordinals', () => {
    const candidates: PuzzlePoolEntry[] = [
      ...Array.from({ length: 12 }, (_, i) =>
        poolEntry({ id: `q-${i}`, tier: 'quick_line', difficultyScore: 20 + i * 5 })),
      ...Array.from({ length: 14 }, (_, i) =>
        poolEntry({ id: `t-${i}`, tier: 'tactical_setup', difficultyScore: 370 + i * 5 })),
      ...Array.from({ length: 14 }, (_, i) =>
        poolEntry({ id: `m-${i}`, tier: 'master_chain', difficultyScore: 745 + i * 5 })),
    ];
    const { puzzles } = selectRunPuzzles({ candidates });

    for (const puzzle of puzzles) {
      const stage = stageForOrdinal(puzzle.ordinal);
      expect(puzzle.stageKey).toBe(stage.key);
      expect(puzzle.stageLabel).toBe(stage.label);
      expect(puzzle.maxPoints).toBe(stage.maxPointsPerPuzzle);
    }

    // The client detects a transition purely from the payload — no polling.
    const transitions = puzzles.filter((puzzle) => puzzle.isStageStart).map((p) => p.ordinal);
    expect(transitions).toEqual([1, 4, 9]);
    const labelsAtTransitions = puzzles
      .filter((puzzle) => puzzle.isStageStart)
      .map((puzzle) => puzzle.stageLabel);
    expect(labelsAtTransitions).toEqual(['Warm-Up', 'Building', 'Master']);
  });

  it('flags a misconfigured stage set instead of silently serving it', () => {
    const broken = {
      ...PUZZLE_RUSH_CONFIG,
      run: {
        ...PUZZLE_RUSH_CONFIG.run,
        stages: [
          { ...stages[0], toOrdinal: 2 },
          { ...stages[1] }, // starts at 4 — leaves ordinal 3 uncovered
          { ...stages[2] },
        ],
      },
    };
    expect(assertStagesCoverRun(broken)).toContain('stage building starts at 4, expected 3');
  });
});

// ─── scoring ─────────────────────────────────────────────────────────────

describe('rush scoring', () => {
  it('is convex: a near-optimal line beats a merely legal one by more than the score ratio', () => {
    const half = calculateRushAwardedPoints({ rawScore: 10, bestPossibleScore: 20, maxPoints: 100 });
    const full = calculateRushAwardedPoints({ rawScore: 20, bestPossibleScore: 20, maxPoints: 100 });
    expect(half).toBeLessThan(full / 2);
    expect(full).toBe(100 + PUZZLE_RUSH_CONFIG.scoring.perfectBonusPoints);
  });

  it('awards nothing for a zero score or an unknown best score', () => {
    expect(calculateRushAwardedPoints({ rawScore: 0, bestPossibleScore: 20, maxPoints: 100 })).toBe(0);
    expect(calculateRushAwardedPoints({ rawScore: 10, bestPossibleScore: 0, maxPoints: 100 })).toBe(0);
  });

  it('banks bonus seconds between the configured min and max', () => {
    const { minBonusSeconds, maxBonusSeconds } = PUZZLE_RUSH_CONFIG.clock;
    expect(calculateRushBonusSeconds({ rawScore: 20, bestPossibleScore: 20 })).toBe(maxBonusSeconds);
    expect(calculateRushBonusSeconds({ rawScore: 1, bestPossibleScore: 1000 })).toBe(minBonusSeconds);
    expect(calculateRushBonusSeconds({ rawScore: 0, bestPossibleScore: 20 })).toBe(
      -PUZZLE_RUSH_CONFIG.clock.missPenaltySeconds,
    );
  });

  it('exposes the ramp step and the legitimate-duration ceiling', () => {
    expect(stageForOrdinal(1).tier).toBe('quick_line');
    expect(stageForOrdinal(999).tier).toBe('master_chain');
    expect(maxLegitimateRunSeconds(0)).toBe(
      PUZZLE_RUSH_CONFIG.clock.baseSeconds + PUZZLE_RUSH_CONFIG.antiCheat.durationGraceSeconds,
    );
    // Banked time is capped by maxSeconds.
    expect(maxLegitimateRunSeconds(100_000)).toBe(
      PUZZLE_RUSH_CONFIG.clock.maxSeconds + PUZZLE_RUSH_CONFIG.antiCheat.durationGraceSeconds,
    );
  });
});

// ─── grading / anti-cheat ────────────────────────────────────────────────

describe('end-of-run grading', () => {
  function buildHonestRun(count: number) {
    const poolById = new Map<string, PuzzlePoolEntry>();
    const reported: ReportedPuzzle[] = [];
    for (let i = 0; i < count; i++) {
      const { board, hand, bestPossibleScore } = makeRealPuzzle(`grade-${i}`);
      const id = `pool-${i}`;
      poolById.set(id, poolEntry({ id, startingBoard: board, startingHand: hand, bestPossibleScore }));
      reported.push({
        ordinal: i + 1,
        puzzleId: id,
        submittedLine: bestSingleMoveLine(board, hand),
        clientRawScore: 0,
      });
    }
    return { poolById, reported };
  }

  it('happy path: computes the authoritative total from real replayed lines', () => {
    const { poolById, reported } = buildHonestRun(3);
    const firstPass = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 60 });

    // Recompute the expected total independently of the aggregate under test.
    const expectedTotal = firstPass.puzzles.reduce((sum, puzzle) => {
      const entry = poolById.get(puzzle.puzzleId)!;
      return sum + calculateRushAwardedPoints({
        rawScore: puzzle.rawScore,
        bestPossibleScore: entry.bestPossibleScore,
        maxPoints: stageForOrdinal(puzzle.ordinal).maxPointsPerPuzzle,
      });
    }, 0);

    expect(firstPass.valid).toBe(true);
    expect(firstPass.invalidatedReason).toBeNull();
    expect(firstPass.totalScore).toBe(expectedTotal);
    expect(firstPass.puzzles).toHaveLength(3);
    expect(firstPass.puzzles.every((puzzle) => puzzle.gradingError === null)).toBe(true);
    expect(firstPass.puzzlesSolved).toBe(firstPass.puzzles.filter((p) => p.solved).length);
    expect(firstPass.bankedBonusSeconds).toBeGreaterThan(0);
  });

  it('a client reporting the true score stays valid', () => {
    const { poolById, reported } = buildHonestRun(2);
    const truth = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 60 });
    const honest = gradeRun({
      reported,
      poolById,
      clientReportedScore: truth.totalScore,
      runDurationSeconds: 60,
    });
    expect(honest.valid).toBe(true);
    expect(honest.totalScore).toBe(truth.totalScore);
  });

  it('invalidates a tampered client score and still records the server total', () => {
    const { poolById, reported } = buildHonestRun(2);
    const truth = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 60 });

    const tampered = gradeRun({
      reported,
      poolById,
      clientReportedScore: truth.totalScore + 5_000,
      runDurationSeconds: 60,
    });

    expect(tampered.valid).toBe(false);
    expect(tampered.invalidatedReason).toBe('client_score_mismatch');
    // Server truth is what gets recorded — never the inflated client number.
    expect(tampered.totalScore).toBe(truth.totalScore);
  });

  it('scores an impossible line as zero rather than trusting the client', () => {
    const { board, hand, bestPossibleScore } = makeRealPuzzle('grade-illegal');
    const poolById = new Map([['p1', poolEntry({ id: 'p1', startingBoard: board, startingHand: hand, bestPossibleScore })]]);

    const grade = gradeRun({
      reported: [{
        ordinal: 1,
        puzzleId: 'p1',
        // A tile that is not in the starting hand at a position that cannot be legal.
        submittedLine: [{ tile: { low: 6, high: 6 }, position: 'left' }, { tile: { low: 6, high: 6 }, position: 'right' }],
        clientRawScore: 500,
      }],
      poolById,
      clientReportedScore: 500,
      runDurationSeconds: 60,
    });

    expect(grade.totalScore).toBe(0);
    expect(grade.puzzles[0].gradingError).toBeTruthy();
    expect(grade.valid).toBe(false);
    expect(grade.invalidatedReason).toBe('client_score_mismatch');
  });

  it('invalidates a run reporting a puzzle it was never served', () => {
    const grade = gradeRun({
      reported: [{ ordinal: 1, puzzleId: 'never-served', submittedLine: [], clientRawScore: 0 }],
      poolById: new Map(),
      clientReportedScore: 0,
      runDurationSeconds: 60,
    });

    expect(grade.puzzles[0].gradingError).toBe('unknown_puzzle');
    expect(grade.valid).toBe(false);
    expect(grade.invalidatedReason).toBe('unknown_puzzle_reported');
  });

  it('invalidates a run that lasted longer than its banked clock allows', () => {
    const { poolById, reported } = buildHonestRun(1);
    const truth = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 10 });

    const stretched = gradeRun({
      reported,
      poolById,
      clientReportedScore: truth.totalScore,
      runDurationSeconds: maxLegitimateRunSeconds(truth.bankedBonusSeconds) + 1,
    });

    expect(stretched.valid).toBe(false);
    expect(stretched.invalidatedReason).toBe('run_duration_exceeded');
  });

  it('does not punish a client that under-reports its score', () => {
    const { poolById, reported } = buildHonestRun(2);
    const truth = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 60 });
    const under = gradeRun({
      reported,
      poolById,
      clientReportedScore: Math.max(0, truth.totalScore - 10),
      runDurationSeconds: 60,
    });

    expect(under.valid).toBe(true);
    expect(under.totalScore).toBe(truth.totalScore);
  });

  it('ignores a duplicated ordinal rather than double-counting it', () => {
    const { poolById, reported } = buildHonestRun(1);
    const duplicated = gradeRun({
      reported: [...reported, { ...reported[0] }],
      poolById,
      clientReportedScore: 0,
      runDurationSeconds: 60,
    });
    const single = gradeRun({ reported, poolById, clientReportedScore: 0, runDurationSeconds: 60 });

    expect(duplicated.totalScore).toBe(single.totalScore);
    expect(duplicated.puzzles[1].gradingError).toBe('duplicate_ordinal');
  });
});

// ─── stage telemetry ─────────────────────────────────────────────────────

describe('stage-reached telemetry', () => {
  it('accepts only real stage keys', () => {
    expect(isPuzzleRushStageKey('warm_up')).toBe(true);
    expect(isPuzzleRushStageKey('building')).toBe(true);
    expect(isPuzzleRushStageKey('master')).toBe(true);
    expect(isPuzzleRushStageKey('not_a_stage')).toBe(false);
    expect(isPuzzleRushStageKey(null)).toBe(false);
    expect(isPuzzleRushStageKey(7)).toBe(false);
  });

  it('is dropped rather than rejected by the report route', () => {
    // Telemetry must never be able to fail a live report, so the route
    // coerces an unknown value to null instead of returning 400.
    const routeSource = readFileSync(resolve(__dirname, '../http/routes/puzzleRush.ts'), 'utf8');
    expect(routeSource).toContain('isPuzzleRushStageKey(req.body?.stageReachedKey)');
    expect(routeSource).toMatch(/stageReachedKey[\s\S]{0,120}: null;/);
  });

  it('never reaches grading, scoring, or invalidation', () => {
    // The guarantee that this is observational: the grading module has no
    // reference to it at all, in any spelling.
    const gradingSource = readFileSync(resolve(__dirname, './grading.ts'), 'utf8');
    expect(gradingSource).not.toContain('stageReached');
    expect(gradingSource).not.toContain('stage_reached');

    // And the graded write-back does not carry the column, so its upsert
    // preserves whatever the report recorded.
    const storeSource = readFileSync(
      resolve(__dirname, '../http/stores/puzzleRushStore.ts'),
      'utf8',
    );
    const persistBlock = storeSource.slice(
      storeSource.indexOf('export async function persistGradedRushPuzzles'),
      storeSource.indexOf('export async function finalizeRushRun'),
    );
    expect(persistBlock.length).toBeGreaterThan(0);
    expect(persistBlock).not.toContain('stage_reached_key');
  });

  it('is not part of the run-start payload', () => {
    // Stage identity ships as stageKey on each puzzle; the telemetry field is
    // client -> server only.
    const entry = {
      id: 'pool-1', source: 'daily_puzzles', sourcePuzzleId: null,
      startingBoard: {}, startingHand: [{ low: 1, high: 1 }], maxMoves: 1,
      puzzleType: 'one_turn_high_score', tier: 'quick_line' as const, dealSize: 14,
      targetScore: 999, bestPossibleScore: 20, difficultyScore: 40, playCount: 0, enabled: true,
    };
    const wire = JSON.stringify(selectRunPuzzles({ candidates: [entry] }).puzzles);
    expect(wire).not.toContain('stageReachedKey');
    expect(wire).toContain('stageKey');
  });
});

// ─── leaderboard ─────────────────────────────────────────────────────────

describe('all-time personal-best leaderboard', () => {
  it('keeps one row per player: their best run', () => {
    const board = buildPuzzleRushLeaderboard([
      run({ id: 'a1', userId: 'user-a', username: 'Ana', totalScore: 500, puzzlesSolved: 8 }),
      run({ id: 'a2', userId: 'user-a', username: 'Ana', totalScore: 900, puzzlesSolved: 12 }),
      run({ id: 'b1', userId: 'user-b', username: 'Bo', totalScore: 700, puzzlesSolved: 10 }),
    ]);

    expect(board.map((entry) => entry.userId)).toEqual(['user-a', 'user-b']);
    expect(board[0]).toMatchObject({ rank: 1, totalScore: 900, puzzlesSolved: 12, runId: 'a2' });
    expect(board[1]).toMatchObject({ rank: 2, totalScore: 700, runId: 'b1' });
  });

  it('breaks a score tie on puzzles solved, then on who got there first', () => {
    const board = buildPuzzleRushLeaderboard([
      run({ id: 'x', userId: 'u-x', totalScore: 600, puzzlesSolved: 9, endedAt: '2026-08-20T12:00:00.000Z' }),
      run({ id: 'y', userId: 'u-y', totalScore: 600, puzzlesSolved: 11, endedAt: '2026-08-20T12:00:00.000Z' }),
      run({ id: 'z', userId: 'u-z', totalScore: 600, puzzlesSolved: 11, endedAt: '2026-08-19T09:00:00.000Z' }),
    ]);

    expect(board.map((entry) => entry.userId)).toEqual(['u-z', 'u-y', 'u-x']);
    expect(board.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('excludes invalidated and in-progress runs', () => {
    const board = buildPuzzleRushLeaderboard([
      run({ id: 'cheat', userId: 'u-c', totalScore: 99_999, status: 'invalidated', invalidatedReason: 'client_score_mismatch' }),
      run({ id: 'open', userId: 'u-o', totalScore: 5_000, status: 'in_progress', endedAt: null }),
      run({ id: 'real', userId: 'u-r', totalScore: 400, puzzlesSolved: 6 }),
    ]);

    expect(board).toHaveLength(1);
    expect(board[0].runId).toBe('real');
  });

  it('caps the board at the configured page size', () => {
    const many = Array.from({ length: PUZZLE_RUSH_CONFIG.leaderboard.pageSize + 25 }, (_, i) =>
      run({ id: `r-${i}`, userId: `u-${i}`, totalScore: 1000 - i, puzzlesSolved: 10 }));
    expect(buildPuzzleRushLeaderboard(many)).toHaveLength(PUZZLE_RUSH_CONFIG.leaderboard.pageSize);
  });

  it('finds a single player&apos;s personal best, ignoring other players', () => {
    const runs = [
      run({ id: 'a1', userId: 'user-a', totalScore: 300, puzzlesSolved: 5 }),
      run({ id: 'a2', userId: 'user-a', totalScore: 800, puzzlesSolved: 11 }),
      run({ id: 'a3', userId: 'user-a', totalScore: 800, puzzlesSolved: 9 }),
      run({ id: 'b1', userId: 'user-b', totalScore: 9_000, puzzlesSolved: 30 }),
    ];

    expect(findPersonalBestRun(runs, 'user-a')?.id).toBe('a2');
    expect(findPersonalBestRun(runs, 'user-missing')).toBeNull();
  });
});
