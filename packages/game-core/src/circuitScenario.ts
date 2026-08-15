/**
 * Canonical Circuit scenario contract + deterministic validators (schema v2).
 *
 * Model A grading: every legal move must be explicitly authored into exactly one
 * of: optimal | strong | inaccurate | blunder.
 */

import { applyMove, getLegalMoves } from './engine';
import { canPlaceTileAt, getOpenEnds, simulatePlacement } from './scoring';
import {
  DEFAULT_CONFIG,
  generateFullSet,
  tileEquals,
  tileId,
  type BoardState,
  type Config,
  type GameState,
  type PlacementPosition,
  type PlayMove,
  type Tile,
} from './types';

export const CIRCUIT_SCENARIO_SCHEMA_VERSION = 2 as const;

export type CircuitStrategyCategory =
  | 'scoring'
  | 'board_control'
  | 'blocking'
  | 'counting'
  | 'opening'
  | 'endgame'
  | 'tempo'
  | 'risk_management';

export type CircuitCertification = 'certified' | 'candidate';
export type CircuitDifficulty = 1 | 2 | 3 | 4 | 5;
export type CircuitDecisionGrade = 'optimal' | 'strong' | 'inaccurate' | 'blunder';

export type CircuitMoveRef = {
  readonly tile: Tile;
  readonly position: PlacementPosition;
};

export type CircuitMoveClassifications = {
  readonly optimal: CircuitMoveRef;
  readonly strong: readonly CircuitMoveRef[];
  readonly inaccurate: readonly CircuitMoveRef[];
  readonly blunder: readonly CircuitMoveRef[];
};

export type CircuitExplanationMeta = {
  readonly optimal: string;
  readonly impact?: string;
  /** Per-move strategic why, keyed as `low-high@position`. */
  readonly byMove?: Readonly<Record<string, string>>;
};

export type CircuitPositionSnapshot = {
  readonly board: BoardState;
  readonly playerHand: readonly Tile[];
  readonly opponentHand?: readonly Tile[];
  readonly playerScore?: number;
  readonly opponentScore?: number;
};

export type CircuitSingleGateScenario = CircuitPositionSnapshot & {
  readonly schemaVersion: typeof CIRCUIT_SCENARIO_SCHEMA_VERSION;
  readonly kind: 'single_gate';
  readonly id: string;
  readonly certification: CircuitCertification;
  readonly difficulty: CircuitDifficulty;
  readonly categories: readonly CircuitStrategyCategory[];
  readonly title: string;
  readonly prompt: string;
  readonly explanation: CircuitExplanationMeta;
  readonly moveClassifications: CircuitMoveClassifications;
  /** Convenience mirrors of moveClassifications.optimal / .strong */
  readonly optimalMove: CircuitMoveRef;
  readonly strongAlternatives?: readonly CircuitMoveRef[];
};

export type CircuitCheckpointStep = {
  readonly id: string;
  readonly prompt: string;
  readonly explanation: CircuitExplanationMeta;
  readonly moveClassifications: CircuitMoveClassifications;
  readonly optimalMove: CircuitMoveRef;
  readonly strongAlternatives?: readonly CircuitMoveRef[];
  readonly position: CircuitPositionSnapshot;
  /** Optional Pressure Gate bridge copy shown when entering this step. */
  readonly transitionIn?: string | null;
};

export type CircuitCheckpointTransitionModel = 'authored_linked_states';

export type CircuitCheckpointHandScenario = CircuitPositionSnapshot & {
  readonly schemaVersion: typeof CIRCUIT_SCENARIO_SCHEMA_VERSION;
  readonly kind: 'checkpoint_hand';
  readonly id: string;
  readonly certification: CircuitCertification;
  readonly difficulty: CircuitDifficulty;
  readonly categories: readonly CircuitStrategyCategory[];
  readonly title: string;
  readonly objective: string;
  readonly explanation: { readonly summary: string };
  readonly pressureTitle: string;
  readonly entranceLine: string;
  readonly stakesLine: string;
  readonly completionLine: string;
  readonly failureLine: string;
  readonly transitionModel: CircuitCheckpointTransitionModel;
  readonly steps: readonly CircuitCheckpointStep[];
};

export type CircuitScenario = CircuitSingleGateScenario | CircuitCheckpointHandScenario;

export type CircuitValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type CircuitValidationResult =
  | { readonly ok: true; readonly scenarioId: string }
  | { readonly ok: false; readonly scenarioId: string; readonly issues: readonly CircuitValidationIssue[] };

export type CircuitLegalMoveGradeRow = {
  readonly moveKey: string;
  readonly move: CircuitMoveRef;
  readonly grade: CircuitDecisionGrade;
};

const PLAYER_ID = 'player';
const OPPONENT_ID = 'opponent';

const STRATEGY_CATEGORIES: ReadonlySet<string> = new Set([
  'scoring',
  'board_control',
  'blocking',
  'counting',
  'opening',
  'endgame',
  'tempo',
  'risk_management',
]);

export function circuitMoveKey(move: CircuitMoveRef): string {
  return `${move.tile.low}-${move.tile.high}@${move.position}`;
}

export function circuitMovesEqual(a: CircuitMoveRef, b: CircuitMoveRef): boolean {
  return tileEquals(a.tile, b.tile) && a.position === b.position;
}

export function toPlayMove(ref: CircuitMoveRef): PlayMove {
  return { type: 'play', tile: ref.tile, position: ref.position };
}

export function createCircuitPositionState(
  snapshot: CircuitPositionSnapshot,
  config: Partial<Config> = {},
): GameState {
  return {
    config: { ...DEFAULT_CONFIG, winningScore: 999, skipPregameDraw: true, ...config },
    playerIds: [PLAYER_ID, OPPONENT_ID],
    players: {
      [PLAYER_ID]: {
        id: PLAYER_ID,
        hand: snapshot.playerHand.map((t) => ({ ...t })),
        score: snapshot.playerScore ?? 0,
      },
      [OPPONENT_ID]: {
        id: OPPONENT_ID,
        hand: (snapshot.opponentHand ?? []).map((t) => ({ ...t })),
        score: snapshot.opponentScore ?? 0,
      },
    },
    board: cloneBoard(snapshot.board),
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

/** Apply a legal play via shared engine (for reveal boards). Does not force-retain turn. */
export function applyCircuitPlay(state: GameState, move: CircuitMoveRef): GameState {
  return applyMove(state, PLAYER_ID, toPlayMove(move)).state;
}

export function previewCircuitBoard(state: GameState, move: CircuitMoveRef): BoardState {
  if (!state.board) throw new Error('No board');
  return simulatePlacement(state.board, move.tile, move.position);
}

export function listLegalCircuitPlays(state: GameState): PlayMove[] {
  return getLegalMoves(state, PLAYER_ID).filter((m): m is PlayMove => m.type === 'play');
}

export function resolveGradeFromClassifications(
  chosen: CircuitMoveRef,
  classifications: CircuitMoveClassifications,
): CircuitDecisionGrade | null {
  if (circuitMovesEqual(chosen, classifications.optimal)) return 'optimal';
  if (classifications.strong.some((m) => circuitMovesEqual(chosen, m))) return 'strong';
  if (classifications.inaccurate.some((m) => circuitMovesEqual(chosen, m))) return 'inaccurate';
  if (classifications.blunder.some((m) => circuitMovesEqual(chosen, m))) return 'blunder';
  return null;
}

export function enumerateClassifiedLegalMoves(
  state: GameState,
  classifications: CircuitMoveClassifications,
): { ok: true; rows: CircuitLegalMoveGradeRow[] } | { ok: false; issues: CircuitValidationIssue[] } {
  const issues: CircuitValidationIssue[] = [];
  const legal = listLegalCircuitPlays(state);
  const rows: CircuitLegalMoveGradeRow[] = [];
  const seen = new Set<string>();

  const allAuthored: Array<{ move: CircuitMoveRef; grade: CircuitDecisionGrade }> = [
    { move: classifications.optimal, grade: 'optimal' },
    ...classifications.strong.map((move) => ({ move, grade: 'strong' as const })),
    ...classifications.inaccurate.map((move) => ({ move, grade: 'inaccurate' as const })),
    ...classifications.blunder.map((move) => ({ move, grade: 'blunder' as const })),
  ];

  for (const entry of allAuthored) {
    const key = circuitMoveKey(entry.move);
    if (seen.has(key)) {
      issues.push({ code: 'duplicate_classification', message: `Move ${key} classified more than once`, path: 'moveClassifications' });
      continue;
    }
    seen.add(key);
    const legalHit = legal.some((m) => tileEquals(m.tile, entry.move.tile) && m.position === entry.move.position);
    if (!legalHit) {
      issues.push({
        code: 'classified_not_legal',
        message: `Classified move ${key} is not legal in position`,
        path: 'moveClassifications',
      });
    }
  }

  for (const m of legal) {
    const ref: CircuitMoveRef = { tile: { low: m.tile.low, high: m.tile.high }, position: m.position };
    const grade = resolveGradeFromClassifications(ref, classifications);
    if (!grade) {
      issues.push({
        code: 'unclassified_legal_move',
        message: `Legal move ${circuitMoveKey(ref)} has no authored grade`,
        path: 'moveClassifications',
      });
      continue;
    }
    rows.push({ moveKey: circuitMoveKey(ref), move: ref, grade });
  }

  const optimalCount = allAuthored.filter((a) => a.grade === 'optimal').length;
  if (optimalCount !== 1) {
    issues.push({ code: 'bad_optimal_count', message: `Expected exactly one optimal move, found ${optimalCount}` });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, rows };
}

export function validateCircuitScenario(scenario: CircuitScenario): CircuitValidationResult {
  const issues: CircuitValidationIssue[] = [];
  const push = (code: string, message: string, path?: string) => {
    issues.push({ code, message, path });
  };

  if (scenario.schemaVersion !== CIRCUIT_SCENARIO_SCHEMA_VERSION) {
    push(
      'stale_schema',
      `Unsupported schemaVersion ${String((scenario as { schemaVersion?: unknown }).schemaVersion)}; expected ${CIRCUIT_SCENARIO_SCHEMA_VERSION}`,
      'schemaVersion',
    );
    return { ok: false, scenarioId: scenario.id ?? 'unknown', issues };
  }

  if (!scenario.id || typeof scenario.id !== 'string') push('missing_id', 'Scenario id is required', 'id');
  if (scenario.certification !== 'certified' && scenario.certification !== 'candidate') {
    push('bad_certification', 'certification must be certified|candidate', 'certification');
  }
  if (![1, 2, 3, 4, 5].includes(scenario.difficulty)) {
    push('bad_difficulty', 'difficulty must be 1–5', 'difficulty');
  }
  if (!Array.isArray(scenario.categories) || scenario.categories.length === 0) {
    push('missing_categories', 'At least one strategy category is required', 'categories');
  } else {
    for (const cat of scenario.categories) {
      if (!STRATEGY_CATEGORIES.has(cat)) push('bad_category', `Unknown strategy category: ${cat}`, 'categories');
    }
  }

  validatePositionInventory(scenario, push);

  if (scenario.kind === 'single_gate') {
    validateSingleGate(scenario, push);
  } else if (scenario.kind === 'checkpoint_hand') {
    validateCheckpointHand(scenario, push);
  } else {
    push('bad_kind', `Unknown scenario kind: ${String((scenario as { kind?: unknown }).kind)}`, 'kind');
  }

  if (issues.length > 0) return { ok: false, scenarioId: scenario.id || 'unknown', issues };
  return { ok: true, scenarioId: scenario.id };
}

export function validateCircuitScenarioBank(
  scenarios: readonly CircuitScenario[],
): { ok: boolean; results: CircuitValidationResult[] } {
  const results = scenarios.map(validateCircuitScenario);
  return { ok: results.every((r) => r.ok), results };
}

export function buildCircuitGradingManifest(
  scenarios: readonly CircuitScenario[],
): Array<{
  scenarioId: string;
  stepId: string | null;
  legalMoveCount: number;
  grades: CircuitLegalMoveGradeRow[];
}> {
  const out: Array<{
    scenarioId: string;
    stepId: string | null;
    legalMoveCount: number;
    grades: CircuitLegalMoveGradeRow[];
  }> = [];

  for (const scenario of scenarios) {
    if (scenario.kind === 'single_gate') {
      const state = createCircuitPositionState(scenario);
      const enumerated = enumerateClassifiedLegalMoves(state, scenario.moveClassifications);
      if (!enumerated.ok) throw new Error(`Manifest failed for ${scenario.id}`);
      out.push({
        scenarioId: scenario.id,
        stepId: null,
        legalMoveCount: enumerated.rows.length,
        grades: enumerated.rows,
      });
    } else {
      for (const step of scenario.steps) {
        const state = createCircuitPositionState(step.position);
        const enumerated = enumerateClassifiedLegalMoves(state, step.moveClassifications);
        if (!enumerated.ok) throw new Error(`Manifest failed for ${scenario.id}:${step.id}`);
        out.push({
          scenarioId: scenario.id,
          stepId: step.id,
          legalMoveCount: enumerated.rows.length,
          grades: enumerated.rows,
        });
      }
    }
  }
  return out;
}

function validateSingleGate(
  scenario: CircuitSingleGateScenario,
  push: (code: string, message: string, path?: string) => void,
): void {
  if (!scenario.title?.trim()) push('missing_title', 'title is required', 'title');
  if (!scenario.prompt?.trim()) push('missing_prompt', 'prompt is required', 'prompt');
  if (!scenario.explanation?.optimal?.trim()) {
    push('missing_explanation', 'explanation.optimal is required', 'explanation.optimal');
  }
  if (isVagueExplanation(scenario.explanation.optimal)) {
    push('vague_explanation', 'explanation.optimal is too vague', 'explanation.optimal');
  }

  let state: GameState;
  try {
    state = createCircuitPositionState(scenario);
  } catch (err) {
    push('bad_state', `Failed to reconstruct state: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  validateTurnAndBoard(state, push);
  validateClassifications(state, scenario.moveClassifications, push, 'moveClassifications');
}

function validateCheckpointHand(
  scenario: CircuitCheckpointHandScenario,
  push: (code: string, message: string, path?: string) => void,
): void {
  if (!scenario.title?.trim()) push('missing_title', 'title is required', 'title');
  if (!scenario.objective?.trim()) push('missing_objective', 'objective is required', 'objective');
  if (!scenario.pressureTitle?.trim()) push('missing_pressure_title', 'pressureTitle is required', 'pressureTitle');
  if (!scenario.entranceLine?.trim()) push('missing_entrance', 'entranceLine is required', 'entranceLine');
  if (!scenario.stakesLine?.trim()) push('missing_stakes', 'stakesLine is required', 'stakesLine');
  if (scenario.transitionModel !== 'authored_linked_states') {
    push('bad_transition_model', 'checkpoint hands must declare authored_linked_states', 'transitionModel');
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length < 3 || scenario.steps.length > 5) {
    push('bad_checkpoint_length', 'checkpoint hands require 3–5 steps', 'steps');
    return;
  }

  for (let i = 0; i < scenario.steps.length; i += 1) {
    const step = scenario.steps[i]!;
    const path = `steps[${i}]`;
    if (!step.id?.trim()) push('missing_step_id', 'step id is required', `${path}.id`);
    if (!step.prompt?.trim()) push('missing_step_prompt', 'step prompt is required', `${path}.prompt`);
    if (!step.explanation?.optimal?.trim()) {
      push('missing_step_explanation', 'step explanation.optimal is required', `${path}.explanation.optimal`);
    }
    if (!step.position?.board || !step.position.playerHand) {
      push('missing_step_position', 'each checkpoint step requires an authored position', `${path}.position`);
      continue;
    }

    validatePositionInventory(
      { id: `${scenario.id}:${step.id}`, board: step.position.board, playerHand: step.position.playerHand, opponentHand: step.position.opponentHand },
      (code, message, issuePath) => push(code, message, `${path}.${issuePath ?? 'position'}`),
    );

    let state: GameState;
    try {
      state = createCircuitPositionState(step.position);
    } catch (err) {
      push('bad_state', `Failed to reconstruct step: ${err instanceof Error ? err.message : String(err)}`, path);
      continue;
    }
    validateTurnAndBoard(state, (code, message, issuePath) =>
      push(code, message, issuePath ? `${path}.${issuePath}` : path),
    );
    validateClassifications(state, step.moveClassifications, push, `${path}.moveClassifications`);
  }

  const first = scenario.steps[0]?.position;
  if (first) {
    if (
      first.board.leftEnd !== scenario.board.leftEnd ||
      first.board.rightEnd !== scenario.board.rightEnd ||
      first.board.mainLine.length !== scenario.board.mainLine.length ||
      first.playerHand.length !== scenario.playerHand.length
    ) {
      push('checkpoint_root_mismatch', 'top-level position must equal steps[0].position', 'board');
    }
  }
}

function validateClassifications(
  state: GameState,
  classifications: CircuitMoveClassifications,
  push: (code: string, message: string, path?: string) => void,
  path: string,
): void {
  if (!classifications?.optimal) {
    push('missing_classifications', 'moveClassifications.optimal is required', path);
    return;
  }
  const enumerated = enumerateClassifiedLegalMoves(state, {
    optimal: classifications.optimal,
    strong: classifications.strong ?? [],
    inaccurate: classifications.inaccurate ?? [],
    blunder: classifications.blunder ?? [],
  });
  if (!enumerated.ok) {
    for (const issue of enumerated.issues) push(issue.code, issue.message, path);
  }
}

function validatePositionInventory(
  scenario: CircuitPositionSnapshot & { id: string },
  push: (code: string, message: string, path?: string) => void,
): void {
  const boardTiles = collectBoardTiles(scenario.board);
  const handTiles = [...scenario.playerHand, ...(scenario.opponentHand ?? [])];
  const all = [...boardTiles, ...handTiles];
  const seen = new Map<string, number>();
  for (const tile of all) {
    if (!isValidPip(tile.low) || !isValidPip(tile.high) || tile.low > tile.high) {
      push('invalid_tile', `Invalid tile ${tileId(tile)}`, 'tiles');
      continue;
    }
    const id = `${tile.low}-${tile.high}`;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) push('duplicate_tile', `Tile ${id} appears ${count} times across board/hands`, 'tiles');
  }
  if (all.length > generateFullSet(6).length) {
    push('impossible_hand', 'More tiles than a double-six set allows', 'tiles');
  }
  if (!scenario.board?.mainLine?.length) {
    push('illegal_board', 'Board mainLine must be non-empty for Circuit positions', 'board');
  }
}

function validateTurnAndBoard(
  state: GameState,
  push: (code: string, message: string, path?: string) => void,
): void {
  if (state.playerIds[state.currentPlayerIndex] !== PLAYER_ID) {
    push('invalid_turn', 'Player must own the decision turn', 'currentPlayer');
  }
  if (!state.handOpen || !state.board) {
    push('illegal_board', 'Circuit positions require an open hand with a board', 'board');
    return;
  }
  try {
    getOpenEnds(state.board);
  } catch (err) {
    push('illegal_board', `Board open-ends failed: ${err instanceof Error ? err.message : String(err)}`, 'board');
  }
  if (listLegalCircuitPlays(state).length === 0) {
    push('no_legal_moves', 'Position has no legal plays for the player', 'board');
  }
}

function isVagueExplanation(text: string): boolean {
  const t = text.trim().toLowerCase();
  const banned = [
    'controls the board better',
    'maintains flexibility',
    'is the strongest move',
    'best move',
  ];
  if (t.length < 24) return true;
  return banned.some((b) => t === b || t.startsWith(b));
}

function collectBoardTiles(board: BoardState): Tile[] {
  const tiles: Tile[] = board.mainLine.map((p) => p.tile);
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      if (!arm) continue;
      for (const placed of arm.tiles) tiles.push(placed.tile);
    }
  }
  return tiles;
}

function cloneBoard(board: BoardState): BoardState {
  return {
    mainLine: board.mainLine.map((p) => ({ tile: { ...p.tile }, orientation: p.orientation })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubDoubles: board.hubDoubles.map((hub) => ({
      ...hub,
      branches: hub.branches.map((arm) =>
        arm
          ? {
              openEnd: arm.openEnd,
              openEndIsDouble: arm.openEndIsDouble,
              tiles: arm.tiles.map((p) => ({ tile: { ...p.tile }, orientation: p.orientation })),
            }
          : null,
      ),
    })),
  };
}

function isValidPip(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

// Re-export canPlaceTileAt for callers that need end checks without duplicating rules.
export { canPlaceTileAt };
