/**
 * Pre-report support (docs/review-bounded-path-prereport-2026-11-07.md). Records, for every LADDER-path decision of the recorded corpus (a decision with tiles still to draw
 * whose hidden-hand space is above 8,000, so it does not take the exact-enumeration branch), the per-sample values of
 *   test3   3 plies, seed 'bp-test'  (the first TEST_CAP samples: the N = 100 and N = 200 prefixes the report costs)
 *   test2   2 plies, the same seed    (the 2-ply quick pass: N = 100 is the device quick review, tier 1)
 *   refA3   3 plies, seed 'bp-ref-a'  (REF_CAP samples)
 *   refB3   3 plies, seed 'bp-ref-b'  (REF_CAP samples)
 * The pooled reference is refA3 and refB3 together; the test passes use an independent seed, so agreement is not inflated by shared samples.
 * One JSON line per decision. Bot play only. Shards split the decisions by index.
 *   npx tsx packages/review-engine/src/devtools/recordLadderPass.ts <outJsonl> [shard=0] [shards=1] [limit=100000] [refCap=1000]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHandUniverse } from './boundedExactSolver';
import { splitOf } from './corpusSplit';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { runSamplePass } from './reviewSamplingStudyLib';

export const TEST_CAP = 200;

const outPath = resolve(process.argv[2] ?? '/tmp/ladder-pass.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const limit = Number(process.argv[5] ?? '100000');
const refCap = Number(process.argv[6] ?? '1000');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');

const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1 && buildHandUniverse(snapshot) === null);
writeFileSync(outPath, '');
let done = 0;
positions.forEach(({ snapshot }, index) => {
  if (index % shards !== shard || done >= limit) return;
  const test3 = runSamplePass(snapshot, 'bp-test', TEST_CAP, 6, 3);
  if (!test3) return;
  const test2 = runSamplePass(snapshot, 'bp-test', TEST_CAP, 6, 2);
  const refA3 = runSamplePass(snapshot, 'bp-ref-a', refCap, 6, 3);
  const refB3 = runSamplePass(snapshot, 'bp-ref-b', refCap, 6, 3);
  appendFileSync(outPath, `${JSON.stringify({
    index,
    gameId: snapshot.identifiers.gameId,
    split: splitOf(snapshot.identifiers.gameId),
    move: snapshot.identifiers.actionNumber,
    drawable: snapshot.preAction.boneyard.drawableCount,
    handSize: snapshot.preAction.actorHand.length,
    legal: snapshot.legalActions.length,
    test3, test2, refA3, refB3,
  })}\n`);
  done += 1;
});
process.stdout.write(`shard ${shard}: ${done} ladder decisions -> ${outPath}\n`);
