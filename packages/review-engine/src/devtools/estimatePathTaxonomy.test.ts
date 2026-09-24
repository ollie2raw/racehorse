import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isForcedDecision } from '@racehorse/game-core/review';
import { deserializeReviewCaptureRecordsFromJsonl } from '../reviewCaptureSchema';

/**
 * Part A taxonomy: prove why ESTIMATE decisions enter the heuristic path
 * on the production-style (default budget) recorded corpus.
 *
 * Root cause (not "by design" as a product endpoint): evaluateReviewPosition
 * falls through to solveHeuristicOpening when midgame coverage < 0.02 under
 * maxHiddenStateSamples=100. That is the live-budget gate — post-game
 * completion must re-evaluate with COMPLETION_REVIEW_DISPATCH_BUDGET.
 */
describe('estimate path taxonomy (recorded corpus)', () => {
  it('attributes nearly all non-forced heuristics to coverage-below-threshold', () => {
    const dirs = [
      join(__dirname, '../../fixtures/recorded-self-play'),
      join(__dirname, '../../fixtures/recorded-client-policy'),
    ];
    const reasons: Record<string, number> = {};
    let total = 0;
    let forced = 0;
    let heuristic = 0;
    let exact = 0;
    let search = 0;

    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
        const records = deserializeReviewCaptureRecordsFromJsonl(
          readFileSync(join(dir, file), 'utf8'),
        );
        for (const record of records) {
          total += 1;
          const ev = record.evaluation;
          if (isForcedDecision(ev.candidates)) {
            forced += 1;
            continue;
          }
          const src = ev.evidence.source;
          if (src === 'exact') exact += 1;
          else if (src === 'search') search += 1;
          else if (src === 'heuristic') {
            heuristic += 1;
            const reason = ev.heuristicFallbackReason ?? 'MISSING_REASON';
            reasons[reason] = (reasons[reason] ?? 0) + 1;
          }
        }
      }
    }

    expect(total).toBeGreaterThan(10_000);
    expect(reasons['coverage-below-threshold'] ?? 0).toBeGreaterThan(3000);
    // Dominant cause: search ran but coverage < 0.02 under live sample budget
    expect(reasons['coverage-below-threshold']! / heuristic).toBeGreaterThan(0.98);
    // Rare genuine infeasibility — must become UNAVAILABLE after completion, not ESTIMATE
    expect((reasons['globally-infeasible'] ?? 0) + (reasons['locked-yard-infeasible'] ?? 0)).toBeLessThan(50);
    // No silent missing-reason path
    expect(reasons['MISSING_REASON'] ?? 0).toBe(0);

    // Production-analog ratio: heuristics are a large share of non-forced
    const nonForced = total - forced;
    expect(heuristic / nonForced).toBeGreaterThan(0.3);
    expect(exact + search + heuristic).toBe(nonForced);
  });
});
