/**
 * How long one post-game review decision really takes under the production completion settings, and which search tier it settles at.
 *
 *   npx tsx packages/review-engine/src/devtools/measureReviewPositionCost.ts [positions=8]
 *
 * The numbers behind docs/postgame-review-plan.md: a game has about 40 of the player's decisions, the server evaluates them one at a time, so the
 * per-decision cost is the length of the wait the player sits through.
 */
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';

const count = Math.min(Number(process.argv[2] ?? 8), REVIEW_FIXTURE_CORPUS.length);
const rows: Array<{ id: string; ms: number; tier: number | null; lifecycle: string }> = [];

for (const fixture of REVIEW_FIXTURE_CORPUS.slice(0, count)) {
  const started = performance.now();
  const result = adaptiveEvaluateReviewPosition(fixture.snapshot, { phase: 'completion' });
  const ms = Math.round(performance.now() - started);
  rows.push({ id: fixture.snapshot.identifiers.decisionId, ms, tier: result.tier, lifecycle: result.lifecycle });
  console.log(`${String(ms).padStart(7)} ms  tier ${result.tier ?? '-'}  ${result.lifecycle}  ${fixture.snapshot.identifiers.decisionId}`);
}

const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
const total = sorted.reduce((sum, ms) => sum + ms, 0);
console.log(`positions ${rows.length}, total ${total} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted[sorted.length - 1]} ms`);
console.log(`a 44-decision game at this mean: ${Math.round((total / rows.length) * 44 / 1000)} s of search, one decision at a time`);
