/**
 * What one post-game review decision costs on REAL game positions (the recorded self-play corpus), under the production completion settings:
 * the adaptive evaluation (tier escalation) plus the second opinion, which is what the server does per decision.
 *   npx tsx packages/review-engine/src/devtools/measureRealGameReviewCost.ts [count=40]
 * measureReviewPositionCost.ts uses the small hand-picked fixture corpus, which understates real games (early positions have large hidden pools).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { computeSecondOpinion } from '../secondOpinion';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const wanted = Number(process.argv[2] ?? '40');
const pool = replayRecordedSelfPlay(dir).filter(({ snapshot }) => snapshot.legalActions.length > 1);
const stride = Math.max(1, Math.floor(pool.length / wanted));
const chosen = pool.filter((_, i) => i % stride === 0).slice(0, wanted);

const search: number[] = [];
const second: number[] = [];
const tiers = new Map<string, number>();
for (const { snapshot } of chosen) {
  const t0 = performance.now();
  const result = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion' });
  const t1 = performance.now();
  if (result.lifecycle !== 'FAILED_FATAL') computeSecondOpinion(snapshot, result.evaluation);
  const t2 = performance.now();
  search.push(t1 - t0);
  second.push(t2 - t1);
  const key = `tier ${result.tier ?? '-'}`;
  tiers.set(key, (tiers.get(key) ?? 0) + 1);
}

const stats = (values: number[]): string => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.toFixed(0);
  const mean = (values.reduce((s, x) => s + x, 0) / values.length).toFixed(0);
  return `mean ${mean} ms, p50 ${pick(0.5)}, p90 ${pick(0.9)}, max ${sorted[sorted.length - 1]!.toFixed(0)}`;
};
process.stdout.write(`${chosen.length} real decisions\n`);
process.stdout.write(`search      ${stats(search)}\n`);
process.stdout.write(`secondopin  ${stats(second)}\n`);
process.stdout.write(`tiers       ${[...tiers.entries()].map(([k, v]) => `${k}: ${v}`).join(', ')}\n`);
const total = search.reduce((s, x) => s + x, 0) + second.reduce((s, x) => s + x, 0);
process.stdout.write(`a ${chosen.length}-decision game: ${(total / 1000).toFixed(1)} s on this machine, one decision at a time\n`);
