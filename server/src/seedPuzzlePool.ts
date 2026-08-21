import './loadEnv';
import { supabaseFetch } from './supabaseUtils';
import { computeBestPossiblePuzzleScore } from './generatePuzzles';
import { deriveDifficultyScore } from './puzzleRush/difficulty';
import type { PuzzleRushTier } from './puzzleRush/config';

/**
 * Backfill `puzzle_pool` from `daily_puzzles`.
 *
 * Copies published *and* unpublished rows: an unpublished row is still valid,
 * fully-validated puzzle content — it was only ever unpublished because a
 * ladder day was partially assembled, which says nothing about the puzzle.
 *
 * Idempotent via the `(source, source_puzzle_id)` unique constraint, so this is
 * safe to re-run as the daily ladder keeps producing new rows.
 *
 *   npx tsx src/seedPuzzlePool.ts [--dry-run] [--limit N]
 */

type DailyPuzzleSourceRow = {
  id: string;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number | null;
  puzzle_type: string | null;
  tier: string | null;
  deal_size: number | null;
  target_score: number | null;
  objective_payload: { best_possible_score?: unknown } | null;
};

export type PoolSeedCandidate = {
  source: 'daily_puzzles';
  source_puzzle_id: string;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number;
  puzzle_type: string;
  tier: PuzzleRushTier;
  deal_size: number;
  target_score: number;
  best_possible_score: number;
  difficulty_score: number;
  play_count: number;
  enabled: boolean;
};

export type PoolSeedSkip = { sourcePuzzleId: string; reason: string };

function normalizeTier(value: string | null | undefined): PuzzleRushTier {
  if (value === 'quick_line' || value === 'tactical_setup' || value === 'master_chain') return value;
  return 'master_chain';
}

function int(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
}

/**
 * Pure transform: daily rows in, pool rows out. Separated from IO so the seed
 * contract is testable without a database.
 *
 * `best_possible_score` is taken from `objective_payload.best_possible_score`
 * when present and positive, and recomputed from the board + hand otherwise —
 * the pool constraint requires it to be > 0, and a rush score has no
 * denominator without it.
 */
export function buildPoolSeedCandidates(
  rows: DailyPuzzleSourceRow[],
  options: { recomputeMissingBestScore?: boolean } = {},
): { candidates: PoolSeedCandidate[]; skipped: PoolSeedSkip[] } {
  const recompute = options.recomputeMissingBestScore !== false;
  const candidates: PoolSeedCandidate[] = [];
  const skipped: PoolSeedSkip[] = [];

  for (const row of rows) {
    if (!row?.id) continue;
    const startingHand = row.starting_hand;
    if (!row.starting_board || !Array.isArray(startingHand) || startingHand.length === 0) {
      skipped.push({ sourcePuzzleId: row.id, reason: 'missing_board_or_hand' });
      continue;
    }

    let bestPossibleScore = int(row.objective_payload?.best_possible_score, 0);
    if (bestPossibleScore <= 0 && recompute) {
      try {
        bestPossibleScore = computeBestPossiblePuzzleScore({
          startingBoard: row.starting_board,
          startingHand,
        } as never);
      } catch {
        bestPossibleScore = 0;
      }
    }
    if (bestPossibleScore <= 0) {
      skipped.push({ sourcePuzzleId: row.id, reason: 'no_best_possible_score' });
      continue;
    }

    const tier = normalizeTier(row.tier);
    candidates.push({
      source: 'daily_puzzles',
      source_puzzle_id: row.id,
      starting_board: row.starting_board,
      starting_hand: startingHand,
      max_moves: Math.max(1, int(row.max_moves, 1)),
      puzzle_type: row.puzzle_type?.trim() || 'one_turn_high_score',
      tier,
      deal_size: Math.max(1, int(row.deal_size, 14)),
      target_score: int(row.target_score, 999),
      best_possible_score: bestPossibleScore,
      difficulty_score: deriveDifficultyScore({ tier, bestPossibleScore }),
      play_count: 0,
      enabled: true,
    });
  }

  return { candidates, skipped };
}

/**
 * PostgREST caps a single response at 1000 rows regardless of `limit`, and
 * `daily_puzzles` is already well past that. Paginate explicitly, or the seed
 * silently copies only the oldest 1000 puzzles and reports success.
 */
const POSTGREST_MAX_ROWS = 1000;

async function listDailyPuzzleSourceRows(limit: number): Promise<DailyPuzzleSourceRow[]> {
  const all: DailyPuzzleSourceRow[] = [];
  let offset = 0;
  while (all.length < limit) {
    const pageSize = Math.min(POSTGREST_MAX_ROWS, limit - all.length);
    const page = await supabaseFetch<DailyPuzzleSourceRow[]>(
      '/rest/v1/daily_puzzles?select=id,starting_board,starting_hand,max_moves,puzzle_type,tier,deal_size,target_score,objective_payload' +
        `&order=created_at.asc,id.asc&offset=${offset}&limit=${pageSize}`,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    offset += page.length;
    if (page.length < pageSize) break;
  }
  return all;
}

async function upsertPoolRows(candidates: PoolSeedCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    await supabaseFetch('/rest/v1/puzzle_pool?on_conflict=source,source_puzzle_id', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify(candidates.slice(i, i + CHUNK)),
    });
  }
}

/** Per-tier counts, so a dry run shows whether any tier is under-supplied. */
export function summarizeCandidatesByTier(
  candidates: PoolSeedCandidate[],
): Record<PuzzleRushTier, number> {
  const byTier: Record<PuzzleRushTier, number> = {
    quick_line: 0,
    tactical_setup: 0,
    master_chain: 0,
  };
  for (const candidate of candidates) byTier[candidate.tier] += 1;
  return byTier;
}

export async function seedPuzzlePoolFromDailyPuzzles(options: {
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<{
  scanned: number;
  seeded: number;
  skipped: PoolSeedSkip[];
  byTier: Record<PuzzleRushTier, number>;
  difficultyRange: { min: number; max: number } | null;
}> {
  const limit = Math.max(1, Math.round(options.limit ?? 100_000));
  const rows = await listDailyPuzzleSourceRows(limit);
  const { candidates, skipped } = buildPoolSeedCandidates(rows);
  if (!options.dryRun) {
    await upsertPoolRows(candidates);
  }
  const difficulties = candidates.map((candidate) => candidate.difficulty_score);
  return {
    scanned: rows.length,
    seeded: candidates.length,
    skipped,
    byTier: summarizeCandidatesByTier(candidates),
    difficultyRange: difficulties.length
      ? { min: Math.min(...difficulties), max: Math.max(...difficulties) }
      : null,
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : undefined;

  seedPuzzlePoolFromDailyPuzzles({ dryRun, limit })
    .then((result) => {
      console.log('[puzzle-pool-seed]', {
        dryRun,
        scanned: result.scanned,
        seeded: result.seeded,
        byTier: result.byTier,
        difficultyRange: result.difficultyRange,
        skipped: result.skipped.length,
        skipReasons: result.skipped.reduce<Record<string, number>>((acc, entry) => {
          acc[entry.reason] = (acc[entry.reason] ?? 0) + 1;
          return acc;
        }, {}),
      });
      process.exit(0);
    })
    .catch((error) => {
      console.error('[puzzle-pool-seed] failed', error);
      process.exit(1);
    });
}
