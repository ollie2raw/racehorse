import type { Move } from '../../types';
import {
  getLegalMoves,
  type BotActionResult,
  type BotMatchState,
  type BotPlayerId,
} from '../../bot/botEngine';
import {
  type GuidedMatchCandidate,
  type GuidedMatchCandidateEvent,
} from './guidedMatchCandidateTypes';
import {
  GUIDED_MATCH_CANDIDATE_VERSION,
} from './guidedMatchCandidateTypes';
import {
  createGuidedMatchCandidateId,
} from './guidedMatchCandidateStorage';
import {
  createDrawEvent,
  createFritzTilePlayEvent,
  createGuidedMatchHandStartEvent,
  createHandEndEvent,
  createNextHandEvent,
  createPassEvent,
  createPlayerTilePlayEvent,
  createScoreAwardEvent,
} from './guidedMatchEventCapture';
import {
  GUIDED_MATCH_STANDARD_TARGET_SCORE,
  serializeGuidedMatchRecorderState,
} from './guidedMatchRecorderEngine';
import type {
  GuidedMatchCoachingContent,
  GuidedMatchPlayerTilePlayEvent,
  GuidedMatchRecorderCursor,
} from './guidedMatchTypes';

export interface GuidedMatchCaptureState {
  candidate: GuidedMatchCandidate;
  cursor: GuidedMatchRecorderCursor;
  lastEventId: string | null;
}

export interface GuidedMatchCaptureStatus {
  enabled: boolean;
  eventCount: number;
  candidateStatus: 'off' | 'incomplete' | 'complete';
  lastEventId: string | null;
}

export type GuidedMatchCapturedActionKind = 'tile-play' | 'draw' | 'pass';

function withNextEventCounter(cursor: GuidedMatchRecorderCursor): GuidedMatchRecorderCursor {
  return {
    ...cursor,
    eventCounter: cursor.eventCounter + 1,
  };
}

function currentActor(match: BotMatchState): 'player' | 'fritz' {
  return match.currentPlayer === 'you' ? 'player' : 'fritz';
}

function nextCursorAfterAction(
  cursor: GuidedMatchRecorderCursor,
  actor: 'player' | 'fritz',
  actionKind: GuidedMatchCapturedActionKind,
  nextState: BotMatchState,
): GuidedMatchRecorderCursor {
  if (nextState.handOver) return cursor;
  if (currentActor(nextState) === actor) {
    return {
      currentTurnNumber: cursor.currentTurnNumber,
      currentChainIndex: actionKind === 'tile-play' ? cursor.currentChainIndex + 1 : cursor.currentChainIndex,
      eventCounter: cursor.eventCounter,
    };
  }
  return {
    currentTurnNumber: cursor.currentTurnNumber + 1,
    currentChainIndex: 0,
    eventCounter: cursor.eventCounter,
  };
}

function stripPlayerCoaching(
  event: GuidedMatchPlayerTilePlayEvent,
): Omit<GuidedMatchPlayerTilePlayEvent, 'coaching'> & { coaching?: GuidedMatchCoachingContent } {
  const { coaching: _coaching, ...rawEvent } = event;
  return rawEvent;
}

function summarizeCandidate(candidate: GuidedMatchCandidate): GuidedMatchCandidate {
  const playerTileEventCount = candidate.events.filter(
    (event) => event.kind === 'tile-play' && event.actor === 'player',
  ).length;
  const handCount = new Set(candidate.events.map((event) => event.handNumber)).size;
  return {
    ...candidate,
    eventCount: candidate.events.length,
    playerTileEventCount,
    handCount,
  };
}

function finalizeIfGameOver(candidate: GuidedMatchCandidate, state: BotMatchState): GuidedMatchCandidate {
  if (!state.gameOver) return candidate;
  const playerWon = state.winnerId === 'you' || state.players.you.score > state.players.bot.score;
  return {
    ...candidate,
    result: playerWon ? 'won' : 'lost',
    finalScore: {
      player: state.players.you.score,
      fritz: state.players.bot.score,
    },
    finalMatchSnapshot: serializeGuidedMatchRecorderState(state),
  };
}

function repairContinuityIfNeeded(
  candidate: GuidedMatchCandidate,
  event: GuidedMatchCandidateEvent,
): GuidedMatchCandidateEvent {
  const previousEvent = candidate.events.at(-1);
  if (!previousEvent || event.beforeSnapshot === previousEvent.afterSnapshot) return event;
  if (import.meta.env.DEV) {
    console.warn('[guided-match-capture] repaired event beforeSnapshot continuity', {
      eventId: event.id,
      previousEventId: previousEvent.id,
    });
  }
  return {
    ...event,
    beforeSnapshot: previousEvent.afterSnapshot,
    captureContinuityRepair: {
      previousEventId: previousEvent.id,
      originalBeforeSnapshot: event.beforeSnapshot,
    },
  };
}

function appendCandidateEvent(
  capture: GuidedMatchCaptureState,
  event: GuidedMatchCandidateEvent,
): GuidedMatchCaptureState {
  const linkedEvent = repairContinuityIfNeeded(capture.candidate, event);
  const candidate = summarizeCandidate({
    ...capture.candidate,
    updatedAt: new Date().toISOString(),
    finalMatchSnapshot: linkedEvent.afterSnapshot,
    events: [...capture.candidate.events, linkedEvent],
  });
  return {
    ...capture,
    candidate,
    lastEventId: linkedEvent.id,
  };
}

export function createGuidedMatchCapture(initialState: BotMatchState): GuidedMatchCaptureState {
  const now = new Date().toISOString();
  const initialSnapshot = serializeGuidedMatchRecorderState(initialState);
  const cursor: GuidedMatchRecorderCursor = {
    currentTurnNumber: 1,
    currentChainIndex: 0,
    eventCounter: 1,
  };
  const handStart = createGuidedMatchHandStartEvent(initialState, cursor);
  const candidate = summarizeCandidate({
    version: GUIDED_MATCH_CANDIDATE_VERSION,
    candidateId: createGuidedMatchCandidateId(),
    createdAt: now,
    updatedAt: now,
    title: 'Untitled Guided Match Candidate',
    notes: '',
    opponent: 'standard-fritz',
    fritzTier: 'standard',
    dealSize: 7,
    targetScore: GUIDED_MATCH_STANDARD_TARGET_SCORE,
    rootSeed: null,
    result: 'incomplete',
    finalScore: {
      player: initialState.players.you.score,
      fritz: initialState.players.bot.score,
    },
    eventCount: 0,
    playerTileEventCount: 0,
    handCount: 0,
    initialMatchSnapshot: initialSnapshot,
    finalMatchSnapshot: '',
    events: [],
  });
  return appendCandidateEvent(
    {
      candidate,
      cursor: withNextEventCounter(cursor),
      lastEventId: null,
    },
    handStart,
  );
}

export function getGuidedMatchCaptureStatus(
  capture: GuidedMatchCaptureState | null,
): GuidedMatchCaptureStatus {
  if (!capture) {
    return {
      enabled: false,
      eventCount: 0,
      candidateStatus: 'off',
      lastEventId: null,
    };
  }
  return {
    enabled: true,
    eventCount: capture.candidate.events.length,
    candidateStatus: capture.candidate.result === 'incomplete' ? 'incomplete' : 'complete',
    lastEventId: capture.lastEventId,
  };
}

export function recordGuidedMatchCandidateAction(
  capture: GuidedMatchCaptureState,
  actor: 'player' | 'fritz',
  actionKind: GuidedMatchCapturedActionKind,
  beforeState: BotMatchState,
  result: BotActionResult,
  move?: Move | null,
): GuidedMatchCaptureState {
  let nextCapture = capture;
  const legalBefore = getLegalMoves(beforeState, actor === 'player' ? 'you' : 'bot');

  if (actionKind === 'tile-play' && move) {
    const event =
      actor === 'player'
        ? stripPlayerCoaching(createPlayerTilePlayEvent(beforeState, result, move, legalBefore, nextCapture.cursor))
        : createFritzTilePlayEvent(beforeState, result, move, legalBefore, nextCapture.cursor);
    nextCapture = appendCandidateEvent(nextCapture, event);
  } else if (actionKind === 'draw') {
    nextCapture = appendCandidateEvent(nextCapture, createDrawEvent(actor, beforeState, result, nextCapture.cursor));
  } else if (actionKind === 'pass') {
    nextCapture = appendCandidateEvent(nextCapture, createPassEvent(actor, beforeState, result, nextCapture.cursor));
  }

  let nextCursor = withNextEventCounter(nextCapture.cursor);
  if (result.handEnded) {
    nextCapture = appendCandidateEvent(nextCapture, createHandEndEvent(result.state, result, nextCursor));
    nextCursor = withNextEventCounter(nextCursor);
    nextCapture = appendCandidateEvent(nextCapture, createScoreAwardEvent(result.state, result, nextCursor));
    nextCursor = withNextEventCounter(nextCursor);
  }

  const advancedCursor = result.handEnded
    ? nextCursor
    : nextCursorAfterAction(nextCursor, actor, actionKind, result.state);

  return {
    ...nextCapture,
    cursor: advancedCursor,
    candidate: summarizeCandidate(finalizeIfGameOver(nextCapture.candidate, result.state)),
  };
}

export function recordGuidedMatchCandidateNextHand(
  capture: GuidedMatchCaptureState,
  previousState: BotMatchState,
  nextState: BotMatchState,
): GuidedMatchCaptureState {
  let nextCapture = appendCandidateEvent(
    capture,
    createNextHandEvent(previousState, nextState, capture.cursor),
  );
  const handStartCursor: GuidedMatchRecorderCursor = {
    currentTurnNumber: 1,
    currentChainIndex: 0,
    eventCounter: nextCapture.cursor.eventCounter + 1,
  };
  nextCapture = {
    ...nextCapture,
    cursor: handStartCursor,
  };
  nextCapture = appendCandidateEvent(
    nextCapture,
    createGuidedMatchHandStartEvent(nextState, handStartCursor),
  );
  return {
    ...nextCapture,
    cursor: withNextEventCounter(handStartCursor),
  };
}

export function serializeGuidedMatchCandidate(candidate: GuidedMatchCandidate): string {
  return JSON.stringify(candidate, null, 2);
}

export async function copyGuidedMatchCandidateJson(candidate: GuidedMatchCandidate): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(serializeGuidedMatchCandidate(candidate));
    return true;
  } catch {
    return false;
  }
}
