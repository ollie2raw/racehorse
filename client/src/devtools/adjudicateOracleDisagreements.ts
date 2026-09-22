/**
 * Offline F1c / D2: adjudicate oracle vs Fritz disagreements on the recorded
 * 100-game corpus (self-play + client-policy).
 *
 * SIGN CONVENTION (locked):
 *   gap = oracleValue - fritzValue
 *   Positive gap favors the oracle; negative favors Fritz.
 *   Exact path uses expectedPointDifferential from a complete exact solve.
 *   Rollout path uses (actorScore - opponentScore) after hand end for each
 *   frozen action under identical seeded continuations, then subtracts.
 *
 * ACTION FREEZING (post-#289 consistency):
 *   For each adjudicated decision, resolve oracle action once (from the
 *   recorded evaluation.best) and Fritz action once (computeFritzReferenceMove),
 *   then reuse those frozen actions across every continuation policy and
 *   paired rollout. Fritz is never re-invoked per sample.
 *
 * CONTINUATION POLICIES (D2 independence):
 *   - uniform-legal: uniform random among legal moves (game-core only)
 *   - immediate-score: max immediate play-score, ties broken uniformly
 *   Neither imports Fritz botHeuristics nor oracle review ranking/search.
 *
 * Recovered scaffold provenance: af04e762 / 647e8942 / 1dd791ee on
 * devtools/f1c-disagreement-adjudication; selectively ported onto main
 * after #289 (facts consistency).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import {
  applyGameCommand,
  canDraw,
  computePlayScore,
  createDeterministicRandom,
  DEFAULT_CONFIG,
  getLegalMoves,
  simulatePlacement,
  type GameState,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { sampleHiddenAllocation, solveExactEndgame } from '@racehorse/review-engine';
import { replayRecordedSelfPlay } from '../../../packages/review-engine/src/devtools/replayRecordedSelfPlay.ts';
import { computeFritzReferenceMove } from '../analyzer/reviewFritzSecondOpinion.ts';
import { replayRecordedClientPolicy } from './replayRecordedClientPolicy.ts';

export type ContinuationPolicy = 'uniform-legal' | 'immediate-score';

export const CONTINUATION_POLICIES: readonly ContinuationPolicy[] = ['uniform-legal', 'immediate-score'];

/** Paired rollouts per policy per disagreement (precommitted in recovered scaffold). */
export const PAIRED_ROLLOUTS_PER_POLICY = 128;

export type ContinuationPolicyProvenance = {
  readonly name: ContinuationPolicy;
  readonly implementation: string;
  readonly importsFritzLogic: boolean;
  readonly importsOracleReviewRankingOrSearch: boolean;
};

export const CONTINUATION_POLICY_AUDIT: readonly ContinuationPolicyProvenance[] = [
  {
    name: 'uniform-legal',
    implementation: 'rollout() → getLegalMoves + uniform createDeterministicRandom pick',
    importsFritzLogic: false,
    importsOracleReviewRankingOrSearch: false,
  },
  {
    name: 'immediate-score',
    implementation: 'rollout() → computePlayScore(simulatePlacement) max, uniform among ties',
    importsFritzLogic: false,
    importsOracleReviewRankingOrSearch: false,
  },
];

export function assertContinuationPolicyIndependence(
  audit: readonly ContinuationPolicyProvenance[] = CONTINUATION_POLICY_AUDIT,
): void {
  const hasNonFritz = audit.some((row) => !row.importsFritzLogic);
  const hasNonOracle = audit.some((row) => !row.importsOracleReviewRankingOrSearch);
  if (!hasNonFritz || !hasNonOracle) {
    throw new Error('D2 requires ≥1 non-Fritz and ≥1 non-oracle continuation policy.');
  }
}

/** Stable action identity distinguishing same tile / different end. */
export function actionKey(action: ReviewAction): string {
  return action.kind === 'play'
    ? `${Math.min(action.tile.low, action.tile.high)}-${Math.max(action.tile.low, action.tile.high)}@${action.position}`
    : action.kind;
}

export type FrozenDisagreementActions = {
  readonly decisionId: string;
  readonly oracleAction: ReviewAction;
  readonly fritzAction: ReviewAction;
};

/**
 * Resolve and freeze the two competing actions once for this decision.
 * Callers must reuse the returned actions for all rollouts/exact lookups.
 */
export function freezeDisagreementActions(
  snapshot: ReviewPositionSnapshotV2,
  evaluation: ReviewEvaluationV1,
  resolveFritz: (snap: ReviewPositionSnapshotV2) => { action: ReviewAction } | null = computeFritzReferenceMove,
): FrozenDisagreementActions | null {
  const fritz = resolveFritz(snapshot);
  if (!fritz) return null;
  const oracleAction = evaluation.best.action;
  if (actionKey(fritz.action) === actionKey(oracleAction)) return null;
  return {
    decisionId: snapshot.identifiers.decisionId,
    oracleAction,
    fritzAction: fritz.action,
  };
}

function stats(values: readonly number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  const se = Math.sqrt(variance / values.length);
  return { n: values.length, mean, ci95: [mean - 1.96 * se, mean + 1.96 * se] as [number, number] };
}

export function authority(snapshot: ReviewPositionSnapshotV2, seed: string): GameState | null {
  const allocation = sampleHiddenAllocation(snapshot, seed);
  if (!allocation) return null;
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const pre = snapshot.preAction;
  return {
    config: { ...DEFAULT_CONFIG, winningScore: pre.winningTarget, deadTileCount: pre.boneyard.deadCount },
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: pre.actorHand, score: pre.scores.actor },
      [opponentId]: { id: opponentId, hand: allocation.opponentHand, score: pre.scores.opponent },
    },
    board: pre.board,
    boneyard: [...allocation.boneyardDrawable, ...allocation.boneyardDead],
    deadTiles: allocation.boneyardDead,
    currentPlayerIndex: 0,
    handNumber,
    handOpen: pre.handOpen,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: pre.consecutivePasses,
    sequence: 0,
  };
}

function apply(state: GameState, action: ReviewAction): GameState {
  return applyGameCommand(state, {
    version: 1,
    commandId: `d2:${state.sequence}`,
    sequence: state.sequence,
    actorId: state.playerIds[state.currentPlayerIndex],
    ...action,
  }).state;
}

export function rollout(
  initial: GameState,
  action: ReviewAction,
  actorId: string,
  opponentId: string,
  policy: ContinuationPolicy,
  seed: string,
): number {
  let state = apply(initial, action);
  const random = createDeterministicRandom(seed);
  for (let step = 0; step < 2_000 && !state.handOver && !state.gameOver; step += 1) {
    const current = state.playerIds[state.currentPlayerIndex];
    const moves = getLegalMoves(state, current);
    let next: ReviewAction;
    if (moves.length === 0) next = { kind: canDraw(state, current) ? 'draw' : 'pass' };
    else {
      let choices = moves;
      if (policy === 'immediate-score') {
        const scores = moves.map((move) =>
          move.type === 'play'
            ? computePlayScore(simulatePlacement(state.board, move.tile, move.position), state.config)
            : 0,
        );
        const maximum = Math.max(...scores);
        choices = moves.filter((_, index) => scores[index] === maximum);
      }
      const move = choices[Math.floor(random.next() * choices.length)];
      next = move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' };
    }
    state = apply(state, next);
  }
  if (!state.handOver && !state.gameOver) {
    throw new Error('D2 rollout exceeded action cap; no truncated value admitted.');
  }
  // Actor-minus-opponent score at hand end (seat perspective preserved).
  return state.players[actorId].score - state.players[opponentId].score;
}

export type AdjudicationRow = {
  readonly decisionId: string;
  readonly gameId: string;
  readonly tier: string;
  readonly method: 'complete-exact' | 'paired-rollouts';
  readonly oracleAction: ReviewAction;
  readonly fritzAction: ReviewAction;
  /** Per-policy means of (oracleGap − fritzGap); index matches CONTINUATION_POLICIES. */
  readonly means: number[];
  readonly intervals: number[][];
  readonly indistinguishable: boolean;
  readonly samplesPerPolicy: number;
};

export function tierReport(
  rows: AdjudicationRow[],
  tier: string,
  encountered = rows.filter((row) => row.tier === tier).length,
) {
  const selected = rows.filter((row) => row.tier === tier);
  const counts = {
    disagreements: encountered,
    adjudicated: selected.length,
    excluded: encountered - selected.length,
  };
  if (!selected.length) {
    return {
      tier,
      ...counts,
      games: 0,
      winner: 'unresolved' as const,
      meanValueGap: null,
      ci95: null,
      indistinguishableShare: null,
      oracleWins: 0,
      fritzWins: 0,
      tiesOrIndistinguishable: 0,
    };
  }
  const gameIds = [...new Set(selected.map((row) => row.gameId))];
  const meanValueGap =
    selected.reduce((sum, row) => sum + (row.means[0] + row.means[1]) / 2, 0) / selected.length;
  const indistinguishableShare =
    selected.filter((row) => row.indistinguishable).length / selected.length;
  const oracleWins = selected.filter((row) => Math.min(...row.intervals.map((i) => i[0])) > 0).length;
  const fritzWins = selected.filter((row) => Math.max(...row.intervals.map((i) => i[1])) < 0).length;
  const tiesOrIndistinguishable = selected.filter((row) => row.indistinguishable).length;
  if (gameIds.length < 2) {
    return {
      tier,
      ...counts,
      games: gameIds.length,
      winner: 'unresolved' as const,
      meanValueGap,
      ci95: null,
      indistinguishableShare,
      oracleWins,
      fritzWins,
      tiesOrIndistinguishable,
      reason:
        'At least two independent game clusters are needed to estimate between-game uncertainty.',
    };
  }
  const random = createDeterministicRandom(`d2-cluster-bootstrap:${tier}`);
  const bootstrap: number[][] = CONTINUATION_POLICIES.map(() => []);
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const sampled = Array.from(
      { length: gameIds.length },
      () => gameIds[Math.floor(random.next() * gameIds.length)],
    );
    const cluster = sampled.flatMap((gameId) => selected.filter((row) => row.gameId === gameId));
    for (let policy = 0; policy < CONTINUATION_POLICIES.length; policy += 1) {
      bootstrap[policy].push(cluster.reduce((sum, row) => sum + row.means[policy], 0) / cluster.length);
    }
  }
  const intervals = bootstrap.map((values) => {
    values.sort((a, b) => a - b);
    return [values[49], values[1949]] as [number, number];
  });
  const ci95: [number, number] = [
    Math.min(...intervals.map((interval) => interval[0])),
    Math.max(...intervals.map((interval) => interval[1])),
  ];
  const winner =
    ci95[0] > 0 ? 'oracle' : ci95[1] < 0 ? 'fritz' : 'contested-cap-Inaccuracy';
  return {
    tier,
    ...counts,
    games: gameIds.length,
    meanValueGap,
    ci95,
    policyIntervals: intervals,
    winner,
    indistinguishableShare,
    oracleWins,
    fritzWins,
    tiesOrIndistinguishable,
  };
}

export type AdjudicationOutcome =
  | { readonly kind: 'row'; readonly row: AdjudicationRow; readonly sawIncompleteExact: boolean }
  | { readonly kind: 'infeasible'; readonly sawIncompleteExact: boolean };

export function adjudicateDisagreement(
  snapshot: ReviewPositionSnapshotV2,
  evaluation: ReviewEvaluationV1,
  frozen: FrozenDisagreementActions,
): AdjudicationOutcome {
  let means: number[] | undefined;
  let intervals: number[][] | undefined;
  let method: AdjudicationRow['method'] = 'paired-rollouts';
  let samplesPerPolicy = 0;
  let sawIncompleteExact = false;

  if (snapshot.preAction.boneyard.drawableCount === 0) {
    const exact = solveExactEndgame(snapshot, { maxNodes: 200_000 });
    if (exact?.complete) {
      const oracleValue = exact.candidates.find(
        (candidate) => actionKey(candidate.action) === actionKey(frozen.oracleAction),
      )?.value.expectedPointDifferential;
      const fritzValue = exact.candidates.find(
        (candidate) => actionKey(candidate.action) === actionKey(frozen.fritzAction),
      )?.value.expectedPointDifferential;
      if (oracleValue === undefined || fritzValue === undefined) {
        throw new Error('Reference action absent from exact candidates.');
      }
      const gap = oracleValue - fritzValue;
      means = [gap, gap];
      intervals = [
        [gap, gap],
        [gap, gap],
      ];
      method = 'complete-exact';
      samplesPerPolicy = 0;
    } else if (exact) {
      sawIncompleteExact = true;
    }
  }

  if (!means || !intervals) {
    const values: number[][] = CONTINUATION_POLICIES.map(() => []);
    for (let sampleIndex = 0; sampleIndex < PAIRED_ROLLOUTS_PER_POLICY; sampleIndex += 1) {
      const seed = `d2-v1:${frozen.decisionId}:${sampleIndex}`;
      const initial = authority(snapshot, seed);
      if (!initial) break;
      for (let policy = 0; policy < CONTINUATION_POLICIES.length; policy += 1) {
        const continuationSeed = `${seed}:${CONTINUATION_POLICIES[policy]}`;
        const { actorId, opponentId } = snapshot.identifiers;
        values[policy].push(
          rollout(initial, frozen.oracleAction, actorId, opponentId, CONTINUATION_POLICIES[policy], continuationSeed) -
            rollout(initial, frozen.fritzAction, actorId, opponentId, CONTINUATION_POLICIES[policy], continuationSeed),
        );
      }
    }
    if (values.some((valuesForPolicy) => valuesForPolicy.length !== PAIRED_ROLLOUTS_PER_POLICY)) {
      return { kind: 'infeasible', sawIncompleteExact };
    }
    means = values.map((valuesForPolicy) => stats(valuesForPolicy).mean);
    intervals = values.map((valuesForPolicy) => stats(valuesForPolicy).ci95);
    samplesPerPolicy = PAIRED_ROLLOUTS_PER_POLICY;
  }

  const low = Math.min(...intervals.map((interval) => interval[0]));
  const high = Math.max(...intervals.map((interval) => interval[1]));
  return {
    kind: 'row',
    sawIncompleteExact,
    row: {
      decisionId: frozen.decisionId,
      gameId: snapshot.identifiers.gameId,
      tier: evaluation.evidence.source,
      method,
      oracleAction: frozen.oracleAction,
      fritzAction: frozen.fritzAction,
      means,
      intervals,
      indistinguishable: low <= 0 && high >= 0,
      samplesPerPolicy,
    },
  };
}

async function main() {
  assertContinuationPolicyIndependence();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const out = resolve(process.argv[2] ?? '/private/tmp/racehorse-f1c-final-results.json');
  mkdirSync(dirname(out), { recursive: true });
  const records = [
    ...replayRecordedSelfPlay(resolve(root, 'packages/review-engine/fixtures/recorded-self-play')),
    ...replayRecordedClientPolicy(resolve(root, 'packages/review-engine/fixtures/recorded-client-policy')),
  ];
  const rows: AdjudicationRow[] = [];
  const encounteredByTier: Record<string, number> = {};
  let excludedInfeasible = 0;
  let incompleteExact = 0;
  let disagreements = 0;
  let fritzResolutions = 0;
  const samples: { at: string; loadavg: number[] }[] = [];
  const sample = () => samples.push({ at: new Date().toISOString(), loadavg: loadavg() });
  let lastLoad = Date.now();
  sample();
  const save = (status: string) =>
    writeFileSync(
      out,
      JSON.stringify(
        {
          status,
          pairedRolloutsPerPolicy: PAIRED_ROLLOUTS_PER_POLICY,
          policies: CONTINUATION_POLICIES,
          policyAudit: CONTINUATION_POLICY_AUDIT,
          policyProvenance:
            'Both continuations use game-core legal/scoring primitives only; neither is Fritz-derived nor oracle-derived.',
          metric:
            'SIGN: oracleValue − fritzValue (positive favors oracle). Exact uses expectedPointDifferential; rollouts use actor−opponent hand-end score under matched seeds.',
          actionFreezing:
            'Oracle action from recorded evaluation.best once; Fritz via computeFritzReferenceMove once per decision; reused across all policies/samples.',
          decisions: records.length,
          games: new Set(records.map((row) => row.snapshot.identifiers.gameId)).size,
          disagreements,
          fritzResolutions,
          excludedInfeasible,
          incompleteExact,
          exactAdjudicated: rows.filter((row) => row.method === 'complete-exact').length,
          rolloutAdjudicated: rows.filter((row) => row.method === 'paired-rollouts').length,
          totalRolloutSamples:
            rows
              .filter((row) => row.method === 'paired-rollouts')
              .reduce((sum, row) => sum + row.samplesPerPolicy * CONTINUATION_POLICIES.length * 2, 0),
          loadSamples: samples,
          loadExceeded: samples.some((row) => row.loadavg[0] > 6),
          tiers:
            status === 'complete'
              ? (['exact', 'search', 'heuristic'] as const).map((tier) =>
                  tierReport(rows, tier, encounteredByTier[tier] ?? 0),
                )
              : [],
          rows,
        },
        null,
        2,
      ),
    );
  save('running');
  for (const { snapshot, evaluation } of records) {
    if (snapshot.legalActions.length < 2) continue;
    const frozen = freezeDisagreementActions(snapshot, evaluation, (snap) => {
      fritzResolutions += 1;
      return computeFritzReferenceMove(snap);
    });
    if (!frozen) continue;
    disagreements += 1;
    encounteredByTier[evaluation.evidence.source] =
      (encounteredByTier[evaluation.evidence.source] ?? 0) + 1;
    const result = adjudicateDisagreement(snapshot, evaluation, frozen);
    if (result.kind === 'infeasible') {
      excludedInfeasible += 1;
      if (result.sawIncompleteExact) incompleteExact += 1;
      continue;
    }
    if (result.sawIncompleteExact) incompleteExact += 1;
    rows.push(result.row);
    if (Date.now() - lastLoad >= 300_000) {
      sample();
      save('running');
      lastLoad = Date.now();
    }
  }
  sample();
  save('complete');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
