/**
 * Generated legal-game coverage harness + soak (Parts F/G).
 *
 * PR CI: default 8 games.
 * Large soak: use sharded CLI for real multi-process parallelism:
 *   REVIEW_COVERAGE_SOAK_GAMES=10000 REVIEW_COVERAGE_SHARDS=8 \
 *     node --import tsx src/devtools/runCoverageSoakShards.mjs
 */
import { describe, expect, it } from 'vitest';
import { analyzeGame, type PlayOptions } from './coverageSoakLib';

const CI_GAMES = Number(process.env.REVIEW_COVERAGE_SOAK_GAMES ?? 8);
const MAX_TIER = (Number(process.env.REVIEW_COVERAGE_MAX_TIER ?? 4) || 4) as 1 | 2 | 3 | 4;
const ADVERSARIAL = process.env.REVIEW_COVERAGE_ADVERSARIAL === '1';

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

describe('generated legal-game coverage harness', () => {
  it(
    `completes ${CI_GAMES} seeded games with forced+scored==total (maxTier=${MAX_TIER})`,
    () => {
      let totalForced = 0;
      let totalScored = 0;
      let totalDecisions = 0;
      let totalHands = 0;
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
      const feasibleStates: number[] = [];
      const failures: Array<{ seed: number; detail: string; positionHash?: string }> = [];

      for (let i = 0; i < CI_GAMES; i += 1) {
        const seed = 1000 + i * 97;
        const opts: PlayOptions = ADVERSARIAL
          ? {
              preferDraw: i % 3 === 0,
              preferPass: i % 5 === 0,
              winningScore: i % 7 === 0 ? 30 : 50,
            }
          : {};
        const r = analyzeGame(seed, opts, MAX_TIER);
        totalHands += r.hands;
        totalDecisions += r.decisions;
        totalForced += r.forced;
        totalScored += r.scored;
        estimates += r.estimates;
        unavailable += r.unavailable;
        pending += r.pending;
        retryable += r.retryable;
        fatal += r.fatal;
        evidenceInvalidations += r.evidenceInvalidations;
        samples.push(...r.samples);
        nodes.push(...r.nodes);
        wallMs.push(...r.wallMs);
        feasibleStates.push(...r.feasibleStates);
        failures.push(...r.failures);
        for (const [k, v] of Object.entries(r.tierNeed)) {
          tierNeed[Number(k)] = (tierNeed[Number(k)] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(r.convergenceReasons)) {
          convergenceReasons[k] = (convergenceReasons[k] ?? 0) + v;
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            games: CI_GAMES,
            adversarial: ADVERSARIAL,
            hands: totalHands,
            totalDecisions,
            forced: totalForced,
            scored: totalScored,
            estimates,
            unavailable,
            pending,
            retryable,
            fatal,
            tierNeed,
            convergenceReasons,
            samples: dist(samples),
            nodes: dist(nodes),
            wallMsPerDecision: dist(wallMs),
            feasibleStates: dist(feasibleStates),
            evidenceInvalidations,
            failures: failures.length,
            failureSamples: failures.slice(0, 8),
            worstFeasibleState: Math.max(0, ...feasibleStates),
          },
          null,
          2,
        ),
      );

      expect(failures, JSON.stringify(failures.slice(0, 3), null, 2)).toEqual([]);
      // Vacuous empty-capture games contribute 0+0==0; non-empty must balance.
      expect(totalForced + totalScored).toBe(totalDecisions);
      if (CI_GAMES >= 8) {
        expect(totalDecisions).toBeGreaterThan(0);
      }
      expect(estimates).toBe(0);
      expect(unavailable).toBe(0);
      expect(pending).toBe(0);
      expect(retryable).toBe(0);
      expect(fatal).toBe(0);
      if (ADVERSARIAL || CI_GAMES >= 8) {
        expect(evidenceInvalidations).toBeGreaterThan(0);
      }
    },
    CI_GAMES > 100 ? 3_600_000 : 900_000,
  );
});
