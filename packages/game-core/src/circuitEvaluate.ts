/**
 * Canonical Circuit grading — owned by @racehorse/game-core.
 * Every legal move grade comes from authored moveClassifications (Model A).
 */

import {
  applyCircuitPlay,
  circuitMoveKey,
  createCircuitPositionState,
  listLegalCircuitPlays,
  previewCircuitBoard,
  resolveGradeFromClassifications,
  type CircuitCheckpointHandScenario,
  type CircuitDecisionGrade,
  type CircuitExplanationMeta,
  type CircuitMoveClassifications,
  type CircuitMoveRef,
  type CircuitScenario,
  type CircuitSingleGateScenario,
  type CircuitStrategyCategory,
} from './circuitScenario';
import type { BoardState, GameState } from './types';

export type { CircuitDecisionGrade };

export type CircuitDecisionContext = {
  readonly scenarioId: string;
  readonly gateKind: 'single_gate' | 'checkpoint_hand' | 'pressure_gate';
  readonly stepId: string | null;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly title: string;
  readonly prompt: string;
  readonly objective: string | null;
  readonly pressureTitle: string | null;
  readonly entranceLine: string | null;
  readonly stakesLine: string | null;
  readonly completionLine: string | null;
  readonly failureLine: string | null;
  readonly transitionIn: string | null;
  readonly categories: readonly CircuitStrategyCategory[];
  readonly difficulty: number;
  readonly moveClassifications: CircuitMoveClassifications;
  readonly optimalMove: CircuitMoveRef;
  readonly strongAlternatives: readonly CircuitMoveRef[];
  readonly explanation: CircuitExplanationMeta;
  readonly gameState: GameState;
};

export type CircuitAcceptedDecision = {
  readonly kind: 'accepted';
  readonly grade: CircuitDecisionGrade;
  readonly strike: boolean;
  readonly explanation: string;
  readonly impact: string | null;
  readonly optimalMove: CircuitMoveRef;
  readonly chosenMove: CircuitMoveRef;
  readonly categories: readonly CircuitStrategyCategory[];
  readonly difficulty: number;
  readonly scenarioId: string;
  readonly stepId: string | null;
  readonly title: string;
  readonly resultingBoard: BoardState;
  readonly remainingHand: readonly { low: number; high: number }[];
};

export type CircuitRejectedDecision = {
  readonly kind: 'rejected';
  readonly reason: string;
  readonly chosenMove: CircuitMoveRef;
};

export type CircuitEvaluationResult = CircuitAcceptedDecision | CircuitRejectedDecision;

export function evaluateCircuitMove(
  context: CircuitDecisionContext,
  chosen: CircuitMoveRef,
): CircuitEvaluationResult {
  const legal = listLegalCircuitPlays(context.gameState);
  const chosenIsLegal = legal.some(
    (m) =>
      m.tile.low === chosen.tile.low &&
      m.tile.high === chosen.tile.high &&
      m.position === chosen.position,
  );

  if (!chosenIsLegal) {
    const endLabel = chosen.position === 'left' ? 'left' : chosen.position === 'right' ? 'right' : chosen.position;
    return {
      kind: 'rejected',
      reason: `Cannot play [${chosen.tile.low}|${chosen.tile.high}] on the ${endLabel} end — that destination does not match.`,
      chosenMove: chosen,
    };
  }

  const grade = resolveGradeFromClassifications(chosen, context.moveClassifications);
  if (!grade) {
    return {
      kind: 'rejected',
      reason: 'This legal move is missing a certified grade. Scenario content is invalid.',
      chosenMove: chosen,
    };
  }

  const strike = grade === 'inaccurate' || grade === 'blunder';
  const key = circuitMoveKey(chosen);
  const byMove = context.explanation.byMove?.[key];
  const optimalKey = circuitMoveKey(context.optimalMove);
  const optimalWhy =
    context.explanation.byMove?.[optimalKey] ?? context.explanation.optimal;

  let explanation: string;
  if (grade === 'optimal' || grade === 'strong') {
    explanation = byMove ?? context.explanation.optimal;
  } else {
    explanation = byMove
      ? `${byMove} Best was [${context.optimalMove.tile.low}|${context.optimalMove.tile.high}] → ${context.optimalMove.position}: ${optimalWhy}`
      : `Best was [${context.optimalMove.tile.low}|${context.optimalMove.tile.high}] → ${context.optimalMove.position}. ${optimalWhy}`;
  }

  const resultingBoard = previewCircuitBoard(context.gameState, chosen);
  const nextState = applyCircuitPlay(context.gameState, chosen);
  const remainingHand = nextState.players.player?.hand.map((t) => ({ low: t.low, high: t.high })) ?? [];

  return {
    kind: 'accepted',
    grade,
    strike,
    explanation,
    impact: context.explanation.impact ?? null,
    optimalMove: context.optimalMove,
    chosenMove: chosen,
    categories: context.categories,
    difficulty: context.difficulty,
    scenarioId: context.scenarioId,
    stepId: context.stepId,
    title: context.title,
    resultingBoard,
    remainingHand,
  };
}

export function createDecisionContextFromScenario(
  scenario: CircuitScenario,
  stepIndex = 0,
): CircuitDecisionContext {
  if (scenario.kind === 'single_gate') return fromSingle(scenario);
  return fromCheckpoint(scenario, stepIndex);
}

function fromSingle(scenario: CircuitSingleGateScenario): CircuitDecisionContext {
  const classifications = scenario.moveClassifications;
  return {
    scenarioId: scenario.id,
    gateKind: 'single_gate',
    stepId: null,
    stepIndex: 0,
    stepCount: 1,
    title: scenario.title,
    prompt: scenario.prompt,
    objective: null,
    pressureTitle: null,
    entranceLine: null,
    stakesLine: null,
    completionLine: null,
    failureLine: null,
    transitionIn: null,
    categories: scenario.categories,
    difficulty: scenario.difficulty,
    moveClassifications: classifications,
    optimalMove: classifications.optimal,
    strongAlternatives: classifications.strong,
    explanation: scenario.explanation,
    gameState: createCircuitPositionState(scenario),
  };
}

function fromCheckpoint(
  scenario: CircuitCheckpointHandScenario,
  stepIndex: number,
): CircuitDecisionContext {
  const step = scenario.steps[stepIndex];
  if (!step) throw new Error(`[Circuit] Missing checkpoint step ${stepIndex} on ${scenario.id}`);
  const classifications = step.moveClassifications;
  return {
    scenarioId: scenario.id,
    gateKind: 'pressure_gate',
    stepId: step.id,
    stepIndex,
    stepCount: scenario.steps.length,
    title: scenario.pressureTitle || scenario.title,
    prompt: step.prompt,
    objective: scenario.objective,
    pressureTitle: scenario.pressureTitle,
    entranceLine: stepIndex === 0 ? scenario.entranceLine : null,
    stakesLine: scenario.stakesLine,
    completionLine: scenario.completionLine,
    failureLine: scenario.failureLine,
    transitionIn: step.transitionIn ?? null,
    categories: scenario.categories,
    difficulty: scenario.difficulty,
    moveClassifications: classifications,
    optimalMove: classifications.optimal,
    strongAlternatives: classifications.strong,
    explanation: step.explanation,
    gameState: createCircuitPositionState(step.position),
  };
}
