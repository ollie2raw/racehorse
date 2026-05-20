import type { Move, PlacementPosition, Tile } from '../../types';
import { computeOpenEndsSum, type BotActionResult, type BotMatchState } from '../../bot/botEngine';
import type {
  GuidedMatchDrawEvent,
  GuidedMatchEvent,
  GuidedMatchFritzTilePlayEvent,
  GuidedMatchHandEndEvent,
  GuidedMatchHandStartEvent,
  GuidedMatchLesson,
  GuidedMatchNextHandEvent,
  GuidedMatchPassEvent,
  GuidedMatchPlayerTilePlayEvent,
  GuidedMatchRecorderCursor,
  GuidedMatchScoreAwardEvent,
  GuidedMatchTilePlayEvent,
} from './guidedMatchTypes';
import { GUIDED_MATCH_CANONICAL_VERSION } from './guidedMatchTypes';
import {
  GUIDED_MATCH_STANDARD_DEAL_SIZE,
  GUIDED_MATCH_STANDARD_LESSON_ID,
  GUIDED_MATCH_STANDARD_ROOT_SEED,
  GUIDED_MATCH_STANDARD_TARGET_SCORE,
  serializeGuidedMatchRecorderState,
  tileId,
} from './guidedMatchRecorderEngine';

function makeEventId(
  eventCounter: number,
  handNumber: number,
  turnNumber: number,
  chainIndex: number,
  actor: string,
  suffix: string,
): string {
  return `event-${String(eventCounter).padStart(4, '0')}-hand-${String(handNumber).padStart(2, '0')}-turn-${String(turnNumber).padStart(2, '0')}-chain-${String(chainIndex).padStart(2, '0')}-${actor}-${suffix}`;
}

function snapshotOpenCount(state: BotMatchState): number {
  return state.board ? computeOpenEndsSum(state.board) : 0;
}

function placementTarget(position: PlacementPosition): { side: 'left' | 'right'; branchId?: string | null; laneRef?: string | null } {
  if (position === 'left' || position === 'right') {
    return { side: position };
  }
  const branchMatch = position.match(/^branch-(\d+)-(\d+)$/);
  return {
    side: 'right',
    branchId: branchMatch ? branchMatch[1] : null,
    laneRef: position,
  };
}

function legalMoveMetadata(moves: Move[]) {
  return {
    legalMovesBeforeCount: moves.filter((move) => move.type === 'play').length,
    playableTileIdsBefore: Array.from(
      new Set(
        moves
          .filter((move) => move.type === 'play' && move.tile)
          .map((move) => tileId(move.tile as Tile)),
      ),
    ),
    openTargetsBefore: Array.from(
      new Set(
        moves
          .filter((move) => move.type === 'play' && move.position)
          .map((move) => String(move.position)),
      ),
    ),
  };
}

export function createGuidedMatchRecorderLesson(
  initialState: BotMatchState,
  rootSeed: string = GUIDED_MATCH_STANDARD_ROOT_SEED,
): GuidedMatchLesson {
  const initialSnapshot = serializeGuidedMatchRecorderState(initialState);
  return {
    version: GUIDED_MATCH_CANONICAL_VERSION,
    lessonId: GUIDED_MATCH_STANDARD_LESSON_ID,
    title: 'Guided Match · First to 60',
    opponent: 'standard-fritz',
    dealSize: GUIDED_MATCH_STANDARD_DEAL_SIZE,
    targetScore: GUIDED_MATCH_STANDARD_TARGET_SCORE,
    rootSeed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    initialMatchSnapshot: initialSnapshot,
    finalMatchSnapshot: initialSnapshot,
    events: [],
  };
}

export function appendGuidedMatchEvent(lesson: GuidedMatchLesson, event: GuidedMatchEvent): GuidedMatchLesson {
  return {
    ...lesson,
    updatedAt: new Date().toISOString(),
    finalMatchSnapshot: event.afterSnapshot,
    events: [...lesson.events, event],
  };
}

export function createGuidedMatchHandStartEvent(
  state: BotMatchState,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchHandStartEvent {
  const snapshot = serializeGuidedMatchRecorderState(state);
  return {
    id: makeEventId(cursor.eventCounter, state.handNumber, cursor.currentTurnNumber, 0, 'system', 'hand-start'),
    kind: 'hand-start',
    actor: 'system',
    handNumber: state.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: snapshot,
    afterSnapshot: snapshot,
    openCountBefore: snapshotOpenCount(state),
    openCountAfter: snapshotOpenCount(state),
    dealer: 'player',
    boneyardCountAfterDeal: state.boneyard.length,
  };
}

function createTilePlayBase(
  actor: 'player' | 'fritz',
  beforeState: BotMatchState,
  result: BotActionResult,
  move: Move,
  legalMovesBefore: Move[],
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchTilePlayEvent {
  const tile = move.tile as Tile;
  const scored = (result.scored?.points ?? 0) > 0;
  return {
    id: makeEventId(cursor.eventCounter, beforeState.handNumber, cursor.currentTurnNumber, cursor.currentChainIndex, actor, 'tile'),
    kind: 'tile-play',
    actor,
    handNumber: beforeState.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: cursor.currentChainIndex,
    beforeSnapshot: serializeGuidedMatchRecorderState(beforeState),
    afterSnapshot: serializeGuidedMatchRecorderState(result.state),
    openCountBefore: snapshotOpenCount(beforeState),
    openCountAfter: snapshotOpenCount(result.state),
    tileId: tileId(tile),
    tile: {
      low: Math.min(tile.low, tile.high),
      high: Math.max(tile.low, tile.high),
    },
    placement: placementTarget(move.position as PlacementPosition),
    legalMoveMetadata: legalMoveMetadata(legalMovesBefore),
    scored,
    pointsScored: result.scored?.points ?? 0,
    continuedTurnReason: result.handEnded ? 'hand-ended' : scored ? 'score' : tile.low === tile.high ? 'double' : 'none',
  };
}

export function createPlayerTilePlayEvent(
  beforeState: BotMatchState,
  result: BotActionResult,
  move: Move,
  legalMovesBefore: Move[],
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchPlayerTilePlayEvent {
  return {
    ...createTilePlayBase('player', beforeState, result, move, legalMovesBefore, cursor),
    actor: 'player',
    coaching: {
      title: '',
      body: '',
      tags: [],
    },
  };
}

export function createFritzTilePlayEvent(
  beforeState: BotMatchState,
  result: BotActionResult,
  move: Move,
  legalMovesBefore: Move[],
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchFritzTilePlayEvent {
  return {
    ...createTilePlayBase('fritz', beforeState, result, move, legalMovesBefore, cursor),
    actor: 'fritz',
  };
}

export function createDrawEvent(
  actor: 'player' | 'fritz',
  beforeState: BotMatchState,
  result: BotActionResult,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchDrawEvent {
  return {
    id: makeEventId(cursor.eventCounter, beforeState.handNumber, cursor.currentTurnNumber, 0, actor, 'draw'),
    kind: 'draw',
    actor,
    handNumber: beforeState.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: serializeGuidedMatchRecorderState(beforeState),
    afterSnapshot: serializeGuidedMatchRecorderState(result.state),
    openCountBefore: snapshotOpenCount(beforeState),
    openCountAfter: snapshotOpenCount(result.state),
    drawnTileId: result.drew?.tile ? tileId(result.drew.tile) : undefined,
    continuedTurnReason: 'none',
  };
}

export function createPassEvent(
  actor: 'player' | 'fritz',
  beforeState: BotMatchState,
  result: BotActionResult,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchPassEvent {
  return {
    id: makeEventId(cursor.eventCounter, beforeState.handNumber, cursor.currentTurnNumber, 0, actor, 'pass'),
    kind: 'pass',
    actor,
    handNumber: beforeState.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: serializeGuidedMatchRecorderState(beforeState),
    afterSnapshot: serializeGuidedMatchRecorderState(result.state),
    openCountBefore: snapshotOpenCount(beforeState),
    openCountAfter: snapshotOpenCount(result.state),
    continuedTurnReason: result.handEnded ? 'hand-ended' : 'none',
  };
}

export function createHandEndEvent(
  state: BotMatchState,
  result: BotActionResult,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchHandEndEvent {
  const snapshot = serializeGuidedMatchRecorderState(state);
  return {
    id: makeEventId(cursor.eventCounter, state.handNumber, cursor.currentTurnNumber, 0, 'system', 'hand-end'),
    kind: 'hand-end',
    actor: 'system',
    handNumber: state.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: snapshot,
    afterSnapshot: snapshot,
    openCountBefore: snapshotOpenCount(state),
    openCountAfter: snapshotOpenCount(state),
    winner: result.handEnded?.winner === 'you' ? 'player' : result.handEnded?.winner === 'bot' ? 'fritz' : null,
    reason: result.handEnded?.reason ?? 'blocked',
    pointsAwarded: result.handEnded?.pointsAwarded ?? 0,
    pointsAwardedTo: result.handEnded?.winner === 'you' ? 'player' : result.handEnded?.winner === 'bot' ? 'fritz' : null,
    scoredFrom: result.handEnded?.winner === 'you' ? 'fritz' : result.handEnded?.winner === 'bot' ? 'player' : null,
    leftoverPips: result.handEnded?.loserPips ?? 0,
  };
}

export function createScoreAwardEvent(
  state: BotMatchState,
  result: BotActionResult,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchScoreAwardEvent {
  const snapshot = serializeGuidedMatchRecorderState(state);
  return {
    id: makeEventId(cursor.eventCounter, state.handNumber, cursor.currentTurnNumber, 0, 'system', 'score-award'),
    kind: 'score-award',
    actor: 'system',
    handNumber: state.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: snapshot,
    afterSnapshot: snapshot,
    openCountBefore: snapshotOpenCount(state),
    openCountAfter: snapshotOpenCount(state),
    awardedTo: result.handEnded?.winner === 'you' ? 'player' : 'fritz',
    pointsAwarded: result.handEnded?.pointsAwarded ?? 0,
    source: result.handEnded?.reason ?? 'blocked',
  };
}

export function createNextHandEvent(
  previousState: BotMatchState,
  nextState: BotMatchState,
  cursor: GuidedMatchRecorderCursor,
): GuidedMatchNextHandEvent {
  return {
    id: makeEventId(cursor.eventCounter, previousState.handNumber, cursor.currentTurnNumber, 0, 'system', 'next-hand'),
    kind: 'next-hand',
    actor: 'system',
    handNumber: previousState.handNumber,
    turnNumber: cursor.currentTurnNumber,
    chainIndex: 0,
    beforeSnapshot: serializeGuidedMatchRecorderState(previousState),
    afterSnapshot: serializeGuidedMatchRecorderState(nextState),
    openCountBefore: snapshotOpenCount(previousState),
    openCountAfter: snapshotOpenCount(nextState),
    nextHandNumber: nextState.handNumber,
  };
}
