/**
 * Shared coverage-soak library (vitest harness + sharded CLI worker).
 */
import {
  applyGameCommand,
  canDraw,
  createInitialState,
  DEFAULT_CONFIG,
  getLegalMoves,
  getOpenEnds,
  startNewHand,
  type GameCommand,
  type GameState,
  type Move,
} from '@racehorse/game-core';
import {
  createReviewPositionSnapshotV2,
  isForcedDecision,
  type ReviewKnownMissingPipEvidence,
  type ReviewPublicActionEvent,
} from '@racehorse/game-core/review';
import { createDeterministicRandom, generateFullSet, shuffleDeterministically } from '@racehorse/game-core';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition, type ReviewDispatchBudget } from '../evaluateReviewPosition';
import { resolveCausalEvidence, type EvidenceInvalidationReason } from '../evidenceLifecycle';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';

export type PlayOptions = {
  readonly preferDraw?: boolean;
  readonly preferPass?: boolean;
  readonly winningScore?: number;
  /** Prefer depleting high tiles to increase draw/pass pressure. */
  readonly depleteHighTiles?: boolean;
  /** Cap hands for soak throughput while still accumulating evidence. */
  readonly maxHands?: number;
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function dealDeck(seed: string) {
  return shuffleDeterministically(generateFullSet(DEFAULT_CONFIG.maxPips), createDeterministicRandom(seed));
}

function openEnds(state: GameState): number[] {
  return [...new Set(getOpenEnds(state.board).map((end) => end.matchValue))].sort((a, b) => a - b);
}

/** Same semantics as reviewFixtureCorpus.recordMissingPipEvidence / live accumulate. */
function recordMissingPipEvidence(
  state: GameState,
  command: GameCommand,
  bag: ReviewKnownMissingPipEvidence[],
): void {
  if (command.kind !== 'draw' && command.kind !== 'pass') return;
  const ends = openEnds(state);
  if (ends.length === 0) return;
  for (const pip of ends) {
    bag.push({
      opponentId: command.actorId,
      pip,
      reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end',
      observedHandNumber: state.handNumber,
      observedSequence: state.sequence,
      openEnds: ends,
    });
  }
}

/**
 * Choose next command using the same legal/draw/pass rules as the fixture
 * corpus (`chooseFixtureCommand`) so missing-pip evidence accumulates.
 * getLegalMoves does not return draws — canDraw gates the draw command.
 */
function chooseSoakCommand(
  state: GameState,
  rng: () => number,
  options: PlayOptions,
): GameCommand {
  const actorId = state.playerIds[state.currentPlayerIndex]!;
  const legal: Move[] = getLegalMoves(state, actorId);
  const plays = legal.filter((m) => m.type === 'play');

  if (plays.length > 0) {
    let move = pick(rng, plays);
    if (options.depleteHighTiles ?? true) {
      const ranked = [...plays].sort(
        (a, b) => b.tile.high + b.tile.low - (a.tile.high + a.tile.low),
      );
      move = rng() < 0.7 ? ranked[0]! : pick(rng, plays);
    }
    return {
      version: 1,
      commandId: `soak:${state.sequence}`,
      kind: 'play',
      actorId,
      sequence: state.sequence,
      tile: move.tile,
      position: move.position,
    };
  }

  if (legal.some((m) => m.type === 'pass')) {
    return {
      version: 1,
      commandId: `soak:${state.sequence}`,
      kind: 'pass',
      actorId,
      sequence: state.sequence,
    };
  }

  if (!canDraw(state, actorId)) {
    throw new Error(`soak: no legal action at sequence ${state.sequence}`);
  }
  return {
    version: 1,
    commandId: `soak:${state.sequence}`,
    kind: 'draw',
    actorId,
    sequence: state.sequence,
  };
}

export function playRandomGame(seed: number, options: PlayOptions = {}): {
  readonly seed: number;
  readonly snapshots: ReturnType<typeof createReviewPositionSnapshotV2>[];
  readonly hands: number;
  readonly evidenceItemsCreated: number;
} {
  const rng = mulberry32(seed);
  let state: GameState = createInitialState(['player', 'opponent'], {
    ...DEFAULT_CONFIG,
    winningScore: options.winningScore ?? 50,
  });
  state = startNewHand(state, dealDeck(`${seed}:hand1`));
  const snapshots: ReturnType<typeof createReviewPositionSnapshotV2>[] = [];
  let actionNumber = 0;
  let guard = 0;
  let publicHistory: ReviewPublicActionEvent[] = [];
  let evidenceBag: ReviewKnownMissingPipEvidence[] = [];
  let evidenceItemsCreated = 0;
  let maxHand = 1;

  while (!state.gameOver && guard < 800) {
    guard += 1;
    if (state.handOver) {
      if (options.maxHands != null && state.handNumber >= options.maxHands) {
        break;
      }
      state = startNewHand(state, dealDeck(`${seed}:hand${state.handNumber + 1}`));
      publicHistory = [];
      evidenceBag = [];
      maxHand = Math.max(maxHand, state.handNumber);
      continue;
    }

    const command = chooseSoakCommand(state, rng, options);
    const actorId = command.actorId;

    const beforeLen = evidenceBag.length;
    recordMissingPipEvidence(state, command, evidenceBag);
    evidenceItemsCreated += evidenceBag.length - beforeLen;

    if (actorId === 'player') {
      actionNumber += 1;
      const opponentId = state.playerIds.find((id) => id !== actorId)!;
      snapshots.push(
        createReviewPositionSnapshotV2({
          authorityPreState: state,
          command,
          identifiers: {
            sessionId: `soak:${seed}`,
            gameId: `soak-game:${seed}`,
            handId: `soak-game:${seed}:hand-${state.handNumber}`,
            decisionId: `soak:${seed}:a${actionNumber}`,
            mode: 'fixture',
            gameNumber: 1,
            actionNumber,
          },
          knownMissingPipEvidence: evidenceBag.filter((item) => item.opponentId === opponentId),
          publicActionHistory: [...publicHistory],
        }),
      );
    }

    publicHistory = [
      ...publicHistory,
      {
        sequence: state.sequence,
        actorId,
        kind: command.kind,
        tile: command.kind === 'play' ? command.tile : undefined,
        position: command.kind === 'play' ? command.position : undefined,
        openEnds: openEnds(state),
      },
    ];

    state = applyGameCommand(state, command).state;
  }

  return { seed, snapshots, hands: maxHand, evidenceItemsCreated };
}

export type GameResult = {
  seed: number;
  hands: number;
  decisions: number;
  forced: number;
  scored: number;
  failures: Array<{
    seed: number;
    detail: string;
    positionHash?: string;
    publicActionHistory?: unknown;
    evidence?: unknown;
  }>;
  samples: number[];
  nodes: number[];
  wallMs: number[];
  feasibleStates: number[];
  tierNeed: Record<number, number>;
  convergenceReasons: Record<string, number>;
  evidenceItemsCreated: number;
  evidenceInvalidations: number;
  invalidationsByCause: Partial<Record<EvidenceInvalidationReason, number>>;
  snapshotsWithMultiEpoch: number;
  snapshotsWithDrawAfterEvidence: number;
  feasibilityFailures: number;
  minimalConflictInvocations: number;
  estimates: number;
  unavailable: number;
  pending: number;
  retryable: number;
  fatal: number;
  /** Wall time for the whole game analysis (ms). */
  gameWallMs?: number;
};

export function analyzeGame(
  seed: number,
  opts: PlayOptions,
  maxTier: 1 | 2 | 3 | 4 = 4,
): GameResult {
  const gameT0 = performance.now();
  const { snapshots, hands, evidenceItemsCreated } = playRandomGame(seed, opts);
  const result: GameResult = {
    seed,
    hands,
    decisions: snapshots.length,
    forced: 0,
    scored: 0,
    failures: [],
    samples: [],
    nodes: [],
    wallMs: [],
    feasibleStates: [],
    tierNeed: { 1: 0, 2: 0, 3: 0, 4: 0 },
    convergenceReasons: {},
    evidenceItemsCreated,
    evidenceInvalidations: 0,
    invalidationsByCause: {},
    snapshotsWithMultiEpoch: 0,
    snapshotsWithDrawAfterEvidence: 0,
    feasibilityFailures: 0,
    minimalConflictInvocations: 0,
    estimates: 0,
    unavailable: 0,
    pending: 0,
    retryable: 0,
    fatal: 0,
  };

  if (snapshots.length === 0) {
    return result;
  }

  for (const snapshot of snapshots) {
    const evidence = resolveCausalEvidence(snapshot);
    result.evidenceInvalidations += evidence.invalidated.length;
    for (const inv of evidence.invalidated) {
      result.invalidationsByCause[inv.reason] =
        (result.invalidationsByCause[inv.reason] ?? 0) + 1;
    }
    if (evidence.opponentDrawSequences.length > 1) result.snapshotsWithMultiEpoch += 1;
    if (
      evidence.invalidated.some((i) => i.reason === 'superseded_by_later_opponent_draw')
    ) {
      result.snapshotsWithDrawAfterEvidence += 1;
    }
    if (evidence.policy === 'conflict-diagnosed') {
      result.minimalConflictInvocations += 1;
      result.failures.push({
        seed,
        detail: 'evidence conflict-diagnosed on fresh legal game',
        positionHash: snapshot.integrity.positionHash,
        publicActionHistory: snapshot.publicActionHistory,
        evidence,
      });
    }

    // Assert retained evidence is causally justified; feasibility for legal captures.
    const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot);
    if (eligibleForOpponent.length < snapshot.preAction.opponentTileCount) {
      result.feasibilityFailures += 1;
      result.failures.push({
        seed,
        detail: 'hidden pool infeasible after causal evidence',
        positionHash: snapshot.integrity.positionHash,
        evidence,
      });
    }

    const t0 = performance.now();
    const soakMode = process.env.REVIEW_COVERAGE_SOAK_MODE ?? 'logical';
    const soakCap = soakMode !== 'production';
    const cappedEvaluate = soakCap
      ? (
          snap: Parameters<typeof evaluateReviewPosition>[0],
          budget: ReviewDispatchBudget,
          threshold: number,
        ) =>
          evaluateReviewPosition(
            snap,
            {
              ...budget,
              // Logical soak: accelerate walls hard; samples/nodes still escalate
              // so completeness invariants remain meaningful.
              maxWallClockMs: Math.min(
                budget.maxWallClockMs ?? 120_000,
                budget.maxHiddenStateSamples <= 150
                  ? 800
                  : budget.maxHiddenStateSamples <= 1_000
                    ? 2_500
                    : budget.maxHiddenStateSamples <= 5_000
                      ? 8_000
                      : 30_000,
              ),
            },
            threshold,
          )
      : undefined;

    let adaptive = adaptiveEvaluateReviewPosition(snapshot, {
      startTier: 1,
      maxTier: Math.min(maxTier, 2) as 1 | 2,
      phase: 'completion',
      allowProgressiveBeyondTier: false,
      progressiveChunks: 0,
      evaluate: cappedEvaluate,
    });
    if (adaptive.lifecycle === 'FAILED_RETRYABLE' && maxTier > 2) {
      adaptive = adaptiveEvaluateReviewPosition(snapshot, {
        startTier: 3,
        maxTier,
        phase: 'completion',
        allowProgressiveBeyondTier: true,
        progressiveChunks: 4,
        evaluate: cappedEvaluate,
      });
    }
    let resumes = 0;
    while (adaptive.lifecycle === 'FAILED_RETRYABLE' && resumes < 8 && maxTier >= 4) {
      resumes += 1;
      adaptive = adaptiveEvaluateReviewPosition(snapshot, {
        startTier: 4,
        maxTier: 4,
        phase: 'completion',
        allowProgressiveBeyondTier: true,
        progressiveChunks: 4,
        progressiveSampleOffset: resumes * 10_000,
        evaluate: cappedEvaluate,
      });
    }
    result.wallMs.push(performance.now() - t0);
    result.samples.push(adaptive.evaluation.search.hiddenStateSamples);
    result.nodes.push(adaptive.evaluation.search.nodes);
    result.feasibleStates.push(adaptive.estimatedStateSpace);
    if (adaptive.tier) result.tierNeed[adaptive.tier] = (result.tierNeed[adaptive.tier] ?? 0) + 1;
    if (adaptive.convergenceReason) {
      result.convergenceReasons[adaptive.convergenceReason] =
        (result.convergenceReasons[adaptive.convergenceReason] ?? 0) + 1;
    }

    if (adaptive.lifecycle === 'FORCED' || isForcedDecision(adaptive.evaluation.candidates)) {
      result.forced += 1;
    } else if (adaptive.lifecycle === 'SCORED') {
      result.scored += 1;
    } else if (adaptive.lifecycle === 'FAILED_RETRYABLE') {
      result.retryable += 1;
      result.failures.push({
        seed,
        detail: `FAILED_RETRYABLE ${adaptive.evaluation.evaluationProvenance?.failureReason}`,
        positionHash: adaptive.positionHash,
        publicActionHistory: snapshot.publicActionHistory,
        evidence,
      });
    } else if (adaptive.lifecycle === 'FAILED_FATAL') {
      result.fatal += 1;
      result.failures.push({
        seed,
        detail: `FAILED_FATAL ${adaptive.evaluation.evaluationProvenance?.detail}`,
        positionHash: adaptive.positionHash,
        publicActionHistory: snapshot.publicActionHistory,
        evidence,
      });
    } else if (adaptive.evaluation.evidence.source === 'heuristic') {
      result.estimates += 1;
      result.failures.push({
        seed,
        detail: 'finalized ESTIMATE',
        positionHash: adaptive.positionHash,
      });
    } else {
      result.pending += 1;
      result.failures.push({
        seed,
        detail: `lifecycle=${adaptive.lifecycle}`,
        positionHash: adaptive.positionHash,
      });
    }
  }

  result.gameWallMs = performance.now() - gameT0;
  return result;
}
