/**
 * How much does the second opinion add per decision? Times `computeSecondOpinion` over a stride sample of the recorded corpus's search decisions.
 *   npx tsx src/devtools/secondOpinionCost.ts [count=60]
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { computeSecondOpinion } from '../secondOpinion';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const wanted = Number(process.argv[2] ?? '60');
const pool = replayRecordedSelfPlay(dir).filter(
  ({ snapshot, evaluation }) => evaluation.evidence.source === 'search' && evaluation.candidates.length > 1 && snapshot.preAction.boneyard.drawableCount > 0,
);
const stride = Math.max(1, Math.floor(pool.length / wanted));
const chosen = pool.filter((_, i) => i % stride === 0).slice(0, wanted);
const times: number[] = [];
for (const { snapshot, evaluation } of chosen) {
  const t = performance.now();
  computeSecondOpinion(snapshot, evaluation);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const pick = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!.toFixed(0);
const mean = (times.reduce((s, x) => s + x, 0) / times.length).toFixed(0);
process.stdout.write(`${times.length} decisions: mean ${mean} ms, p50 ${pick(0.5)} ms, p90 ${pick(0.9)} ms, max ${times[times.length - 1]!.toFixed(0)} ms\n`);
