/**
 * Worker thread for reviewColdCorpusRun.ts: replays the recorded corpus once, then evaluates one non-forced decision per message exactly as the server's durable
 * pass calls the evaluator. The parent kills this thread after the server's per-position limit (180 s), as ReviewSearchRunner does.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { WALL_CLOCK_CEILING_DIAGNOSTIC } from '../evaluateReviewPosition';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const positions = replayRecordedSelfPlay(dir).filter(({ evaluation }) => evaluation.candidates.length > 1);
const startTier = (workerData as { startTier: 1 | 2 | 3 | 4 }).startTier;

parentPort!.on('message', (index: number) => {
  const { snapshot } = positions[index]!;
  const started = performance.now();
  const result = adaptiveEvaluateReviewPosition(snapshot, { startTier, maxTier: 4, phase: 'completion', allowProgressiveBeyondTier: true, progressiveSampleOffset: 0 });
  const ms = performance.now() - started;
  const search = result.evaluation.search;
  parentPort!.postMessage({
    index,
    gameId: snapshot.identifiers.gameId,
    moveNumber: snapshot.identifiers.actionNumber,
    drawable: snapshot.preAction.boneyard.drawableCount,
    legalActions: snapshot.legalActions.length,
    handSize: snapshot.preAction.actorHand.length,
    opponentTiles: snapshot.preAction.opponentTileCount,
    tier: result.tier,
    lifecycle: result.lifecycle,
    source: result.evaluation.evidence.source,
    estimatedStateSpace: result.estimatedStateSpace,
    convergence: result.convergenceReason ?? null,
    samples: search.hiddenStateSamples,
    nodes: search.nodes,
    depth: search.depth,
    coverage: search.coverage,
    complete: search.complete,
    ceilingHit: result.evaluation.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC),
    lossPoints: result.evaluation.loss.expectedPointDifferential,
    ms: Math.round(ms * 100) / 100,
  });
});
parentPort!.postMessage({ ready: true, count: positions.length });
