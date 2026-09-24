/**
 * Part 4 — 100-game production-equivalent soak (exact production budgets).
 * Also reports per-game wall times for user-perceived latency (Part 5).
 *
 *   REVIEW_COVERAGE_SOAK_MODE=production REVIEW_COVERAGE_SOAK_GAMES=100 \
 *     REVIEW_COVERAGE_SHARDS=4 node --import tsx src/devtools/runCoverageSoakShards.mjs
 *
 * Or this focused vitest:
 *   REVIEW_PROD_SOAK_GAMES=100 npx vitest run src/devtools/productionEquivalentSoak.test.ts
 */
import { describe, expect, it } from 'vitest';
import { analyzeGame, type PlayOptions } from './coverageSoakLib';
import { SEARCH_ESCALATION_TIERS } from '../adaptiveEvaluateReviewPosition';

const GAMES = Number(process.env.REVIEW_PROD_SOAK_GAMES ?? 0);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function dist(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

describe('production-equivalent soak (exact budgets)', () => {
  it.skipIf(GAMES <= 0)(
    `completes ${GAMES} games with production config; reports game latency`,
    () => {
      // Force production mode — no soak wall-clock caps.
      process.env.REVIEW_COVERAGE_SOAK_MODE = 'production';

      let totalDecisions = 0;
      let forced = 0;
      let scored = 0;
      let estimates = 0;
      let unavailable = 0;
      let pending = 0;
      let retryable = 0;
      let fatal = 0;
      let evidenceInvalidations = 0;
      const tierNeed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      const convergenceReasons: Record<string, number> = {};
      const samples: number[] = [];
      const nodes: number[] = [];
      const wallMs: number[] = [];
      const gameWallMs: number[] = [];
      const failures: Array<{ seed: number; detail: string }> = [];

      for (let i = 0; i < GAMES; i += 1) {
        const seed = 7000 + i * 89;
        const opts: PlayOptions = {
          depleteHighTiles: i % 4 === 0,
          preferDraw: i % 5 === 0,
          preferPass: i % 7 === 0,
          winningScore: 50,
          maxHands: 3,
        };
        const t0 = performance.now();
        const r = analyzeGame(seed, opts, 4);
        gameWallMs.push(performance.now() - t0);

        totalDecisions += r.decisions;
        forced += r.forced;
        scored += r.scored;
        estimates += r.estimates;
        unavailable += r.unavailable;
        pending += r.pending;
        retryable += r.retryable;
        fatal += r.fatal;
        evidenceInvalidations += r.evidenceInvalidations;
        samples.push(...r.samples);
        nodes.push(...r.nodes);
        wallMs.push(...r.wallMs);
        failures.push(...r.failures);
        for (const [k, v] of Object.entries(r.tierNeed)) {
          tierNeed[Number(k)] = (tierNeed[Number(k)] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(r.convergenceReasons)) {
          convergenceReasons[k] = (convergenceReasons[k] ?? 0) + v;
        }
      }

      const tier1 = tierNeed[1] ?? 0;
      const tier2Plus = (tierNeed[2] ?? 0) + (tierNeed[3] ?? 0) + (tierNeed[4] ?? 0);
      const report = {
        mode: 'production-equivalent',
        games: GAMES,
        totalDecisions,
        forced,
        scored,
        estimates,
        unavailable,
        pending,
        retryable,
        fatal,
        evidenceInvalidations,
        tierNeed,
        tier1Share: totalDecisions > 0 ? tier1 / totalDecisions : 0,
        tier2PlusShare: totalDecisions > 0 ? tier2Plus / totalDecisions : 0,
        convergenceReasons,
        samples: dist(samples),
        nodes: dist(nodes),
        wallMsPerDecision: dist(wallMs),
        wallMsPerGame: dist(gameWallMs),
        productionTierBudgets: SEARCH_ESCALATION_TIERS.map((t) => ({
          tier: t.tier,
          maxHiddenStateSamples: t.budget.maxHiddenStateSamples,
          maxWallClockMs: t.budget.maxWallClockMs,
        })),
        concurrency: {
          browserDefaultPool: 'defaultReviewWorkerPoolSize() = min(cores, 8)',
          serverDurablePassConcurrency: 4,
          progressivePopulate: true,
        },
        failures: failures.length,
        failureSamples: failures.slice(0, 5),
      };

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));

      expect(failures).toEqual([]);
      expect(forced + scored).toBe(totalDecisions);
      expect(estimates).toBe(0);
      expect(unavailable).toBe(0);
      expect(pending).toBe(0);
      expect(retryable).toBe(0);
      expect(fatal).toBe(0);
    },
    Math.max(600_000, GAMES * 60_000),
  );
});
