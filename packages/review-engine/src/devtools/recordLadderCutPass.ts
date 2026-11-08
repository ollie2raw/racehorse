/**
 * What is a verdict cut by a wall-clock ceiling worth? (docs/review-single-depth-design-2026-11-08.md, item (b)/(c)). For every LADDER decision (hidden-hand space above 8,000) record
 * the per-sample values of the two streams the production ladder actually searches, at 2 plies, and an independent 2-ply reference:
 *   tier1   seed 'racehorse-review-tier-1', 100 samples (tier 1; a ceiling hit keeps a PREFIX of this stream)
 *   tier2   seed 'racehorse-review-tier-2', 2,500 samples (tier 2; ditto)
 *   refA2, refB2   seeds 'bp2-ref-a' / 'bp2-ref-b', 1,000 samples each, node budget lifted: pooled, the reference
 * Bot play only. Shards split the decisions by index.
 *   npx tsx packages/review-engine/src/devtools/recordLadderCutPass.ts <out.jsonl> <shard> <shards>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHandUniverse } from '../boundedExactSearch';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { runSamplePass } from './reviewSamplingStudyLib';

const out = resolve(process.argv[2] ?? '/tmp/ladder-cut.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
writeFileSync(out, '');
const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1 && buildHandUniverse(snapshot) === null);
positions.forEach(({ snapshot }, index) => {
  if (index % shards !== shard) return;
  const row = {
    gameId: snapshot.identifiers.gameId, seat: snapshot.identifiers.actorId, move: snapshot.identifiers.actionNumber,
    tier1: runSamplePass(snapshot, 'racehorse-review-tier-1', 100, 6, 2),
    tier2: runSamplePass(snapshot, 'racehorse-review-tier-2', 2500, 6, 2),
    refA2: runSamplePass(snapshot, 'bp2-ref-a', 1000, 6, 2, true),
    refB2: runSamplePass(snapshot, 'bp2-ref-b', 1000, 6, 2, true),
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
});
process.stdout.write(`shard ${shard} done\n`);
