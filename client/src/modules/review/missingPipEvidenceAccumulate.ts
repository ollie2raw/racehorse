import {
  getMatchableOpenEnds,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import type { LiveMissingPipObservation } from './missingPipEvidenceAdapter.ts';

function uniqueOpenEnds(state: BotMatchState): number[] {
  if (!state.board) return [];
  return [...new Set(getMatchableOpenEnds(state.board).map((end) => end.matchValue))];
}

function observationKey(observation: LiveMissingPipObservation): string {
  return `${observation.actorId}|${observation.reason}|${observation.observedHandNumber}|${observation.observedSequence}`;
}

/** Append one live observation to the review bag (no-op when openEnds empty or duplicate). */
export function appendReviewMissingPipObservation(
  state: BotMatchState,
  observation: LiveMissingPipObservation,
): BotMatchState {
  if (observation.openEnds.length === 0) return state;
  const prev = state.reviewMissingPipObservations ?? [];
  const key = observationKey(observation);
  if (prev.some((row) => observationKey(row) === key)) return state;
  return {
    ...state,
    reviewMissingPipObservations: [...prev, observation],
  };
}

function observeActorMissingPips(
  state: BotMatchState,
  actorId: BotPlayerId,
  reason: LiveMissingPipObservation['reason'],
): BotMatchState {
  const openEnds = uniqueOpenEnds(state);
  if (openEnds.length === 0) return state;
  return appendReviewMissingPipObservation(state, {
    actorId,
    reason,
    observedHandNumber: state.handNumber,
    observedSequence: state.turnIndex ?? 0,
    openEnds,
  });
}

/** Record that `actorId` is drawing past the current open ends (public missing-pip evidence). */
export function observeActorDrawPastOpenEnds(
  state: BotMatchState,
  actorId: BotPlayerId,
): BotMatchState {
  return observeActorMissingPips(state, actorId, 'drew_past_open_end');
}

/** Record that `actorId` passed with the current open ends (public missing-pip evidence). */
export function observeActorPassOnOpenEnds(
  state: BotMatchState,
  actorId: BotPlayerId,
): BotMatchState {
  return observeActorMissingPips(state, actorId, 'passed_on_open_end');
}
