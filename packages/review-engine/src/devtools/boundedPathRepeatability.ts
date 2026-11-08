/**
 * Repeatability of the exact-path methods (docs/review-bounded-path-prereport-2026-11-07.md, section 3). Every method here estimates the same expectation over
 * (opponent hand, boneyard order), and every one of them sees a random draw of it: a full enumeration of the distinct opponent hands still gets ONE boneyard order per hand.
 * So "agreement with a full enumeration" is bounded by how well two full enumerations agree with each other. This runs each method twice with different seeds on the
 * 501 exact-path midgame decisions, and compares every pair:
 *
 *   P  production today: solveMidgameDeterminization with C(n,k) seeded draws WITH replacement at 3 plies (two seeds)
 *   B  the bounded path, tuned defaults (two decision-id salts)
 *   F  the same engine run to completion: every distinct hand once (two salts)
 *
 * Bot play only. Shards split the decisions by index.
 *   npx tsx packages/review-engine/src/devtools/boundedPathRepeatability.ts <shard> <shards> <out.jsonl>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildHandUniverse, evaluateBoundedExact } from '../boundedExactSearch';
import { solveMidgameDeterminization } from '../solveMidgameDeterminization';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { splitOf } from './corpusSplit';
import { canonicalActionKey, gradeOfLoss } from './reviewSamplingStudyLib';

const shard = Number(process.argv[2] ?? '0');
const shards = Number(process.argv[3] ?? '1');
const out = resolve(process.argv[4] ?? '/tmp/repeatability.jsonl');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
writeFileSync(out, '');

const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
positions.forEach(({ snapshot }, index) => {
  if (index % shards !== shard) return;
  const universe = buildHandUniverse(snapshot);
  if (!universe) return;
  const C = universe.combinations.length;
  const salted = (salt: string) => ({ ...snapshot, identifiers: { ...snapshot.identifiers, decisionId: `${snapshot.identifiers.decisionId}${salt}` } });
  const playedKey = canonicalActionKey(snapshot.actualAction);
  const verdict = (candidates: readonly { action: Parameters<typeof canonicalActionKey>[0]; value: { expectedPointDifferential: number } }[]) => {
    const best = candidates[0]!;
    const played = candidates.find((c) => canonicalActionKey(c.action) === playedKey) ?? best;
    const loss = best.value.expectedPointDifferential - played.value.expectedPointDifferential;
    return { top: canonicalActionKey(best.action), grade: gradeOfLoss(loss), loss };
  };
  const row: Record<string, unknown> = { index, gameId: snapshot.identifiers.gameId, move: snapshot.identifiers.actionNumber, split: splitOf(snapshot.identifiers.gameId), C };
  for (const [name, seed] of [['P1', 'racehorse-review-exact-enum'], ['P2', 'racehorse-review-exact-enum-2']] as const) {
    const started = performance.now();
    const result = solveMidgameDeterminization(snapshot, { maxNodes: 100_000_000, maxHiddenStateSamples: Math.max(C, 1) }, seed, 3);
    row[name] = { ...verdict(result!.candidates), ms: performance.now() - started };
  }
  for (const [name, salt] of [['B1', ''], ['B2', '#2']] as const) {
    const started = performance.now();
    const evaluation = evaluateBoundedExact(salted(salt))!;
    row[name] = { ...verdict(evaluation.candidates), ms: performance.now() - started, hands: evaluation.boundedSearch!.handsVisited, reason: evaluation.boundedSearch!.stopReason };
  }
  for (const [name, salt] of [['F1', ''], ['F2', '#2']] as const) {
    const started = performance.now();
    const evaluation = evaluateBoundedExact(salted(salt), { minHands: 1_000_000 })!;
    row[name] = { ...verdict(evaluation.candidates), ms: performance.now() - started };
  }
  appendFileSync(out, `${JSON.stringify(row)}\n`);
});
