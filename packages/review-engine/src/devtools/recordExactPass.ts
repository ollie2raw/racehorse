/**
 * Records, for every exact-path decision of the corpus (drawable tiles > 0, hidden-hand space C(n,k) between 1 and 8,000: the branch at
 * adaptiveEvaluateReviewPosition.ts:239), two things, one JSON line per decision:
 *   ref    what production computes today: solveMidgameDeterminization with C(n,k) seeded random draws (WITH replacement) at 3 plies, seed 'racehorse-review-exact-enum',
 *          exactly the exactBudget; its verdict (top move, loss of the played move, grade), its cost and its coverage.
 *   hands  one full pass over every DISTINCT hidden hand in a seeded random order (variant A visited to the end): every hand's per-action value, per-action game-tree
 *          nodes and wall ms, so every bounded variant can be replayed offline (boundedExactStudy.ts) and its cost read off the recording.
 * Bot play only. Shards split the decisions by index.
 *   npx tsx packages/review-engine/src/devtools/recordExactPass.ts <outJsonl> [shard=0] [shards=1] [limit=100000]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { solveMidgameDeterminization } from '../solveMidgameDeterminization';
import { splitOf } from './corpusSplit';
import { buildHandUniverse, liveHandSource, type HandValues } from './boundedExactSolver';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { canonicalActionKey, gradeOfLoss } from './reviewSamplingStudyLib';

export const ORDER_SEED = 'bx-v1';

const outPath = resolve(process.argv[2] ?? '/tmp/exact-pass.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const limit = Number(process.argv[5] ?? '100000');
/** 3 (default) records production's reference and the 3-ply pass; 2 records only the 2-ply pass over every distinct hand (Q1 to Q3 of the doc). */
const plyDepth = Number(process.argv[6] ?? '3');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');

const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
writeFileSync(outPath, '');
let done = 0;
positions.forEach(({ snapshot }, index) => {
  if (index % shards !== shard || done >= limit) return;
  const universe = buildHandUniverse(snapshot);
  if (!universe) return;
  const C = universe.combinations.length;

  // production, as today (3-ply recording only)
  const refStarted = performance.now();
  const ref = plyDepth === 3 ? solveMidgameDeterminization(snapshot, { maxNodes: 100_000_000, maxHiddenStateSamples: Math.max(C, 1) }, 'racehorse-review-exact-enum', 3) : null;
  const refMs = performance.now() - refStarted;
  if (plyDepth === 3 && !ref) return;
  const playedKey = canonicalActionKey(snapshot.actualAction);
  const best = ref ? ref.candidates[0]! : null;
  const played = ref && best ? (ref.candidates.find((c) => canonicalActionKey(c.action) === playedKey) ?? best) : null;
  const refLoss = best && played ? best.value.expectedPointDifferential - played.value.expectedPointDifferential : 0;

  // one full pass over every distinct hand
  const source = liveHandSource(universe, ORDER_SEED, 6, plyDepth);
  const all = new Array<boolean>(source.actions).fill(true);
  const hands: HandValues[] = [];
  for (let i = 0; i < source.total; i += 1) hands.push(source.hand(i, all));

  appendFileSync(outPath, `${JSON.stringify({
    index,
    gameId: snapshot.identifiers.gameId,
    split: splitOf(snapshot.identifiers.gameId),
    move: snapshot.identifiers.actionNumber,
    drawable: snapshot.preAction.boneyard.drawableCount,
    handSize: snapshot.preAction.actorHand.length,
    legal: snapshot.legalActions.length,
    C,
    actionKeys: universe.actionKeys,
    playedIndex: universe.playedIndex,
    plyDepth,
    ref: ref && best
      ? {
          topKey: canonicalActionKey(best.action),
          loss: refLoss,
          grade: gradeOfLoss(refLoss),
          ms: refMs,
          samples: ref.hiddenStateSamples,
          coverage: ref.coverage,
          values: Object.fromEntries(ref.candidates.map((c) => [canonicalActionKey(c.action), c.value.expectedPointDifferential])),
        }
      : null,
    hands: hands.map((h) => ({ d: h.d, n: h.nodes, ms: Math.round(h.ms * 1000) / 1000 })),
  })}\n`);
  done += 1;
  if (done % 20 === 0) process.stderr.write(`shard ${shard}: ${done} decisions\n`);
});
process.stdout.write(`shard ${shard}/${shards}: ${done} decisions -> ${outPath}\n`);
