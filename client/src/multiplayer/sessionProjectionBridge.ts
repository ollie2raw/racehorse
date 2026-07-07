import type { GameState } from '../types';
import type { SessionRefProjection } from './projection/projectionTypes';
import type { SessionEvent } from './session/sessionTypes';

/** Map projection session ref output to session events — lives outside session/ and projection/ layers. */
export function sessionEventsFromProjectionRefs(
  sessionRefs: Pick<
    SessionRefProjection,
    'isSeatedPlayerClear' | 'matchStarted' | 'playerReadyEmitted'
  >,
  nextState: GameState | null,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  const lifecycle: Extract<SessionEvent, { type: 'STATE_UPDATE_LIFECYCLE' }> = {
    type: 'STATE_UPDATE_LIFECYCLE',
  };
  let hasLifecycle = false;

  if (sessionRefs.isSeatedPlayerClear) {
    lifecycle.seatedClear = true;
    hasLifecycle = true;
  }
  if (sessionRefs.matchStarted) {
    lifecycle.matchStarted = true;
    hasLifecycle = true;
  }
  if (sessionRefs.playerReadyEmitted) {
    lifecycle.playerReadyEmitted = true;
    hasLifecycle = true;
  }
  if (nextState?.gameOver) {
    lifecycle.gameOver = true;
    hasLifecycle = true;
  }

  if (hasLifecycle) {
    events.push(lifecycle);
  }
  return events;
}

export function dispatchSessionEvents(
  dispatch: (event: SessionEvent) => void,
  events: SessionEvent[],
): void {
  for (const event of events) {
    dispatch(event);
  }
}