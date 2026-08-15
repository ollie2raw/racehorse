import type {
  BoardState,
  CircuitMoveRef,
  CircuitScenario,
  CircuitStrategyCategory,
} from '@racehorse/game-core';
import { CIRCUIT_MAX_STRIKES, computeCircuitDecisionPoints } from '@racehorse/game-core';
import {
  advanceCheckpointDecision,
  createActiveDecisionFromScenario,
  evaluateCircuitDecision,
  type CircuitActiveDecision,
  type CircuitDecisionGrade,
} from './circuitEvaluate';
import {
  buildDefaultCircuitRunManifest,
  getCertifiedCircuitScenarioById,
  type CircuitRunManifestGate,
} from '../scenarioBank';

export type CircuitRunPhase = 'ready' | 'deciding' | 'feedback' | 'results';

export type CircuitCategoryStat = {
  decisions: number;
  optimal: number;
  optimalOrStrong: number;
};

export type CircuitDecisionRecord = {
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
  readonly gateNumber: number;
  readonly pointsAwarded: number;
  readonly comboBefore: number;
  readonly comboAfter: number;
  readonly resultingBoard: BoardState;
  readonly remainingHand: readonly { low: number; high: number }[];
};

export type CircuitDecisionQuality = {
  readonly committed: number;
  readonly perfect: number;
  readonly sound: number;
  readonly inaccurate: number;
  readonly blunders: number;
  readonly mistakes: number;
  /** Perfect decisions / committed (0–100). */
  readonly perfectPct: number;
  /** (optimal + strong) / committed (0–100). */
  readonly soundPct: number;
};

export type CircuitImprovementTarget = {
  readonly kind: 'category' | 'blunders' | 'combo_break' | 'perfect' | 'cleared';
  readonly message: string;
};

export type CircuitRunState = {
  readonly phase: CircuitRunPhase;
  readonly manifest: readonly CircuitRunManifestGate[];
  readonly gateIndex: number;
  readonly score: number;
  readonly combo: number;
  readonly strikes: number;
  readonly maxStrikes: number;
  readonly decisionHistory: readonly CircuitDecisionRecord[];
  readonly categoryStats: Readonly<Record<CircuitStrategyCategory, CircuitCategoryStat>>;
  readonly active: CircuitActiveDecision | null;
  readonly lastOutcome: CircuitDecisionRecord | null;
  /** Soft UI feedback for rejected illegal interactions — never affects score/strikes. */
  readonly interactionNotice: string | null;
  readonly endReason: 'completed' | 'strikes' | null;
  readonly personalBest: number;
  readonly priorPersonalBest: number;
  readonly isNewPersonalBest: boolean;
  readonly startedAtMs: number | null;
  /** Transient pressure-gate entrance flash for the first step of a gate. */
  readonly pressureEntrancePending: boolean;
};

const CATEGORY_LABEL: Record<CircuitStrategyCategory, string> = {
  scoring: 'Scoring',
  board_control: 'Board Control',
  blocking: 'Blocking',
  counting: 'Counting',
  opening: 'Opening',
  endgame: 'Endgame',
  tempo: 'Tempo',
  risk_management: 'Risk',
};

/** Minimum decisions before strongest/weakest category claims are shown. */
export const CIRCUIT_CATEGORY_SAMPLE_MIN = 2;

function emptyCategoryStats(): Record<CircuitStrategyCategory, CircuitCategoryStat> {
  return {
    scoring: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    board_control: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    blocking: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    counting: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    opening: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    endgame: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    tempo: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
    risk_management: { decisions: 0, optimal: 0, optimalOrStrong: 0 },
  };
}

export function createIdleCircuitRun(personalBest = 0): CircuitRunState {
  return {
    phase: 'ready',
    manifest: [],
    gateIndex: 0,
    score: 0,
    combo: 0,
    strikes: 0,
    maxStrikes: CIRCUIT_MAX_STRIKES,
    decisionHistory: [],
    categoryStats: emptyCategoryStats(),
    active: null,
    lastOutcome: null,
    interactionNotice: null,
    endReason: null,
    personalBest,
    priorPersonalBest: personalBest,
    isNewPersonalBest: false,
    startedAtMs: null,
    pressureEntrancePending: false,
  };
}

export function startCircuitRun(input?: {
  personalBest?: number;
  manifest?: readonly CircuitRunManifestGate[];
  nowMs?: number;
}): CircuitRunState {
  const personalBest = input?.personalBest ?? 0;
  const manifest = input?.manifest ?? buildDefaultCircuitRunManifest();
  const nowMs = input?.nowMs ?? Date.now();
  const active = loadGateDecision(manifest, 0);
  return {
    ...createIdleCircuitRun(personalBest),
    phase: 'deciding',
    manifest,
    active,
    startedAtMs: nowMs,
    priorPersonalBest: personalBest,
    pressureEntrancePending: isPressureGate(active),
  };
}

/**
 * Commit a legal decision, or return unchanged run state with a soft notice
 * when the placement is illegal / rejected by shared authority.
 */
export function submitCircuitDecision(
  state: CircuitRunState,
  chosen: CircuitMoveRef,
): CircuitRunState {
  if (state.phase !== 'deciding' || !state.active) return state;

  const evaluation = evaluateCircuitDecision(state.active, chosen);
  if (evaluation.kind === 'rejected') {
    return {
      ...state,
      interactionNotice: evaluation.reason,
    };
  }

  const { points, nextCombo } = computeCircuitDecisionPoints({
    grade: evaluation.grade,
    difficulty: evaluation.difficulty,
    comboBefore: state.combo,
  });

  const record: CircuitDecisionRecord = {
    grade: evaluation.grade,
    strike: evaluation.strike,
    explanation: evaluation.explanation,
    impact: evaluation.impact,
    optimalMove: evaluation.optimalMove,
    chosenMove: evaluation.chosenMove,
    categories: evaluation.categories,
    difficulty: evaluation.difficulty,
    scenarioId: evaluation.scenarioId,
    stepId: evaluation.stepId,
    title: evaluation.title,
    pointsAwarded: points,
    comboBefore: state.combo,
    comboAfter: nextCombo,
    gateNumber: state.gateIndex + 1,
    resultingBoard: evaluation.resultingBoard,
    remainingHand: evaluation.remainingHand,
  };

  return {
    ...state,
    score: state.score + points,
    combo: nextCombo,
    strikes: evaluation.strike ? state.strikes + 1 : state.strikes,
    decisionHistory: [...state.decisionHistory, record],
    categoryStats: updateCategoryStats(state.categoryStats, evaluation.categories, evaluation.grade),
    lastOutcome: record,
    interactionNotice: null,
    phase: 'feedback',
    pressureEntrancePending: false,
  };
}

export function clearCircuitInteractionNotice(state: CircuitRunState): CircuitRunState {
  if (!state.interactionNotice) return state;
  return { ...state, interactionNotice: null };
}

export function dismissCircuitPressureEntrance(state: CircuitRunState): CircuitRunState {
  if (!state.pressureEntrancePending) return state;
  return { ...state, pressureEntrancePending: false };
}

export function continueAfterCircuitFeedback(state: CircuitRunState): CircuitRunState {
  if (state.phase !== 'feedback' || !state.active || !state.lastOutcome) return state;

  if (state.strikes >= state.maxStrikes) {
    return finishRun(state, 'strikes');
  }

  if (isPressureGate(state.active)) {
    const scenario = getCertifiedCircuitScenarioById(state.active.scenarioId);
    if (scenario?.kind === 'checkpoint_hand') {
      const nextStep = state.active.stepIndex + 1;
      if (nextStep < scenario.steps.length) {
        const nextActive = advanceCheckpointDecision(scenario, nextStep);
        if (nextActive) {
          return {
            ...state,
            phase: 'deciding',
            active: nextActive,
            lastOutcome: null,
            interactionNotice: null,
            pressureEntrancePending: false,
          };
        }
      }
    }
  }

  const nextGateIndex = state.gateIndex + 1;
  if (nextGateIndex >= state.manifest.length) {
    return finishRun(state, 'completed');
  }

  const nextActive = loadGateDecision(state.manifest, nextGateIndex);
  return {
    ...state,
    phase: 'deciding',
    gateIndex: nextGateIndex,
    active: nextActive,
    lastOutcome: null,
    interactionNotice: null,
    pressureEntrancePending: isPressureGate(nextActive),
  };
}

export function deepestGateReached(state: CircuitRunState): number {
  if (state.decisionHistory.length === 0) return 0;
  return Math.max(...state.decisionHistory.map((d) => d.gateNumber));
}

/** @deprecated Prefer circuitDecisionQuality().soundPct — kept for progress storage compat. */
export function circuitAccuracy(state: CircuitRunState): number {
  return circuitDecisionQuality(state).soundPct;
}

export function circuitDecisionQuality(state: CircuitRunState): CircuitDecisionQuality {
  const committed = state.decisionHistory.length;
  if (committed === 0) {
    return {
      committed: 0,
      perfect: 0,
      sound: 0,
      inaccurate: 0,
      blunders: 0,
      mistakes: 0,
      perfectPct: 0,
      soundPct: 0,
    };
  }
  const perfect = state.decisionHistory.filter((d) => d.grade === 'optimal').length;
  const strong = state.decisionHistory.filter((d) => d.grade === 'strong').length;
  const inaccurate = state.decisionHistory.filter((d) => d.grade === 'inaccurate').length;
  const blunders = state.decisionHistory.filter((d) => d.grade === 'blunder').length;
  const sound = perfect + strong;
  return {
    committed,
    perfect,
    sound,
    inaccurate,
    blunders,
    mistakes: inaccurate + blunders,
    perfectPct: Math.round((perfect / committed) * 100),
    soundPct: Math.round((sound / committed) * 100),
  };
}

export function personalBestDelta(state: CircuitRunState): number {
  return state.score - state.priorPersonalBest;
}

export function mostCostlyDecision(state: CircuitRunState): CircuitDecisionRecord | null {
  const mistakes = state.decisionHistory.filter(
    (d) => d.grade === 'inaccurate' || d.grade === 'blunder',
  );
  if (mistakes.length === 0) return null;
  return [...mistakes].sort((a, b) => {
    const lostA = a.comboBefore;
    const lostB = b.comboBefore;
    if (lostA !== lostB) return lostB - lostA;
    if (a.grade !== b.grade) return a.grade === 'blunder' ? -1 : 1;
    return b.gateNumber - a.gateNumber;
  })[0]!;
}

export function strongestCategory(state: CircuitRunState): CircuitStrategyCategory | null {
  return pickCategory(state, 'strong');
}

export function weakestCategory(state: CircuitRunState): CircuitStrategyCategory | null {
  return pickCategory(state, 'weak');
}

export function categoryClaimCopy(
  state: CircuitRunState,
  mode: 'strong' | 'weak',
): string | null {
  const cat = mode === 'strong' ? strongestCategory(state) : weakestCategory(state);
  if (!cat) return null;
  const stat = state.categoryStats[cat];
  if (stat.decisions < CIRCUIT_CATEGORY_SAMPLE_MIN) {
    return mode === 'strong'
      ? `${CATEGORY_LABEL[cat]} looked sharp (${stat.decisions} decision)`
      : `${CATEGORY_LABEL[cat]} needs reps (${stat.decisions} decision)`;
  }
  return CATEGORY_LABEL[cat];
}

export function buildImprovementTarget(state: CircuitRunState): CircuitImprovementTarget {
  const quality = circuitDecisionQuality(state);
  const costly = mostCostlyDecision(state);
  const weak = weakestCategory(state);
  const weakStat = weak ? state.categoryStats[weak] : null;

  if (state.endReason === 'completed' && quality.mistakes === 0) {
    return { kind: 'cleared', message: 'Perfect decisions — chase a higher score next run' };
  }
  if (costly && costly.comboBefore >= 2) {
    return {
      kind: 'combo_break',
      message: `One ${costly.grade} ended your combo at Gate ${costly.gateNumber}`,
    };
  }
  if (weak && weakStat && weakStat.decisions >= CIRCUIT_CATEGORY_SAMPLE_MIN) {
    const nextPb = Math.max(state.priorPersonalBest + 1, state.score + 200);
    return {
      kind: 'category',
      message: `Improve ${CATEGORY_LABEL[weak]} to break ${nextPb.toLocaleString()}`,
    };
  }
  if (quality.blunders > 0) {
    return {
      kind: 'blunders',
      message: `${quality.blunders} blunder${quality.blunders === 1 ? '' : 's'} — review those boards first`,
    };
  }
  if (quality.perfectPct < 80) {
    return {
      kind: 'perfect',
      message: `Lift perfect decisions above ${quality.perfectPct}% to push your best`,
    };
  }
  return { kind: 'cleared', message: 'Run again and protect your combo deeper' };
}

function finishRun(state: CircuitRunState, endReason: 'completed' | 'strikes'): CircuitRunState {
  const isNewPersonalBest = state.score > state.priorPersonalBest;
  return {
    ...state,
    phase: 'results',
    endReason,
    isNewPersonalBest,
    personalBest: isNewPersonalBest ? state.score : state.priorPersonalBest,
    active: null,
    lastOutcome: null,
    interactionNotice: null,
    pressureEntrancePending: false,
  };
}

function loadGateDecision(
  manifest: readonly CircuitRunManifestGate[],
  gateIndex: number,
): CircuitActiveDecision {
  const gate = manifest[gateIndex];
  if (!gate) throw new Error(`[Circuit] Missing manifest gate ${gateIndex}`);
  const scenario = getCertifiedCircuitScenarioById(gate.scenarioId);
  if (!scenario) throw new Error(`[Circuit] Missing scenario ${gate.scenarioId}`);
  assertGateKind(scenario, gate.kind);
  return createActiveDecisionFromScenario(scenario);
}

function assertGateKind(scenario: CircuitScenario, kind: CircuitRunManifestGate['kind']): void {
  if (scenario.kind !== kind) {
    throw new Error(`[Circuit] Manifest kind ${kind} does not match scenario ${scenario.id}`);
  }
}

function isPressureGate(active: CircuitActiveDecision | null): boolean {
  return active?.gateKind === 'pressure_gate' || active?.gateKind === 'checkpoint_hand';
}

function updateCategoryStats(
  stats: Readonly<Record<CircuitStrategyCategory, CircuitCategoryStat>>,
  categories: readonly CircuitStrategyCategory[],
  grade: CircuitDecisionGrade,
): Record<CircuitStrategyCategory, CircuitCategoryStat> {
  const next = { ...stats };
  const good = grade === 'optimal' || grade === 'strong';
  const perfect = grade === 'optimal';
  for (const cat of categories) {
    const prev = next[cat] ?? { decisions: 0, optimal: 0, optimalOrStrong: 0 };
    next[cat] = {
      decisions: prev.decisions + 1,
      optimal: prev.optimal + (perfect ? 1 : 0),
      optimalOrStrong: prev.optimalOrStrong + (good ? 1 : 0),
    };
  }
  return next;
}

function pickCategory(
  state: CircuitRunState,
  mode: 'strong' | 'weak',
): CircuitStrategyCategory | null {
  const entries = (Object.entries(state.categoryStats) as Array<
    [CircuitStrategyCategory, CircuitCategoryStat]
  >).filter(([, stat]) => stat.decisions >= CIRCUIT_CATEGORY_SAMPLE_MIN);
  if (entries.length === 0) {
    // Fall back only for copy helpers that need *some* signal; UI should contextualize.
    const sparse = (Object.entries(state.categoryStats) as Array<
      [CircuitStrategyCategory, CircuitCategoryStat]
    >).filter(([, stat]) => stat.decisions > 0);
    if (sparse.length === 0) return null;
    sparse.sort((a, b) => {
      const rateA = a[1].optimalOrStrong / a[1].decisions;
      const rateB = b[1].optimalOrStrong / b[1].decisions;
      return mode === 'strong' ? rateB - rateA : rateA - rateB;
    });
    return sparse[0]![0];
  }
  entries.sort((a, b) => {
    const rateA = a[1].optimalOrStrong / a[1].decisions;
    const rateB = b[1].optimalOrStrong / b[1].decisions;
    if (rateA === rateB) {
      return mode === 'strong' ? b[1].decisions - a[1].decisions : a[1].decisions - b[1].decisions;
    }
    return mode === 'strong' ? rateB - rateA : rateA - rateB;
  });
  return entries[0]![0];
}
