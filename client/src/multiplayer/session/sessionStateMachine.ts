import { reduceSession } from './sessionReducer';
import {
  INITIAL_SESSION_SNAPSHOT,
  type SessionEvent,
  type SessionRuntime,
  type SessionSnapshot,
} from './sessionTypes';

export function createSessionStateMachine(
  initial: SessionSnapshot = INITIAL_SESSION_SNAPSHOT,
): SessionRuntime {
  let snapshot = initial;
  return {
    getSnapshot: () => snapshot,
    dispatch: (event: SessionEvent) => {
      snapshot = reduceSession(snapshot, event);
      return snapshot;
    },
  };
}

export function selectJoinedRoomCode(session: SessionSnapshot): string | null {
  return session.context.roomCode;
}

export function selectIsSeated(session: SessionSnapshot): boolean {
  return session.context.seated;
}

export function selectPlayerReadyEmitted(session: SessionSnapshot): boolean {
  return session.context.playerReadyEmitted;
}

export function selectIntentionalDisconnect(session: SessionSnapshot): boolean {
  return session.context.intentionalDisconnect;
}

export function selectMatchStarted(session: SessionSnapshot): boolean {
  return (
    session.phase === 'in_match' ||
    session.phase === 'match_ended' ||
    (session.phase === 'match_starting' && session.context.playerReadyEmitted)
  );
}

export function selectIsInMatch(session: SessionSnapshot): boolean {
  return session.phase === 'in_match' || session.phase === 'match_ended';
}

export function selectIsInLobby(session: SessionSnapshot): boolean {
  return session.phase === 'in_lobby' || session.phase === 'match_starting';
}

export function selectCanSendReady(session: SessionSnapshot): boolean {
  return (
    session.context.seated &&
    !session.context.playerReadyEmitted &&
    Boolean(session.context.roomCode) &&
    (session.phase === 'in_lobby' || session.phase === 'match_starting')
  );
}

export function selectShouldShowMatchScreen(session: SessionSnapshot): boolean {
  return selectIsInMatch(session) || session.phase === 'match_starting';
}