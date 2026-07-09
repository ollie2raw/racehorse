import {
  INITIAL_SESSION_CONTEXT,
  type SessionContext,
  type SessionEvent,
  type SessionPhase,
  type SessionSnapshot,
} from './sessionTypes';

function withContext(
  snapshot: SessionSnapshot,
  context: Partial<SessionContext>,
  phase?: SessionPhase,
): SessionSnapshot {
  return {
    phase: phase ?? snapshot.phase,
    context: { ...snapshot.context, ...context },
  };
}

function phaseFromMatchStarted(matchStarted: boolean, seated: boolean): SessionPhase {
  if (matchStarted) return 'in_match';
  if (seated) return 'in_lobby';
  return 'in_lobby';
}

/** Pure session lifecycle reducer — no sockets, React, projection, or recovery. */
export function reduceSession(
  snapshot: SessionSnapshot,
  event: SessionEvent,
): SessionSnapshot {
  switch (event.type) {
    case 'SOCKET_CONNECTED': {
      if (snapshot.phase === 'leaving') {
        return withContext(snapshot, { intentionalDisconnect: false }, 'connected');
      }
      if (snapshot.phase === 'idle') {
        return withContext(snapshot, { intentionalDisconnect: false }, 'connected');
      }
      return withContext(snapshot, { intentionalDisconnect: false });
    }

    case 'SOCKET_DISCONNECTED': {
      if (snapshot.context.intentionalDisconnect) {
        return { phase: 'idle', context: { ...INITIAL_SESSION_CONTEXT } };
      }
      if (snapshot.context.roomCode) {
        return snapshot;
      }
      return { phase: 'idle', context: { ...INITIAL_SESSION_CONTEXT } };
    }

    case 'INTENTIONAL_DISCONNECT': {
      if (event.value) {
        return withContext(snapshot, { intentionalDisconnect: true }, 'leaving');
      }
      return withContext(snapshot, { intentionalDisconnect: false });
    }

    case 'ROOM_JOIN_OK': {
      const phase = phaseFromMatchStarted(event.matchStarted, event.seated);
      return {
        phase,
        context: {
          roomCode: event.roomCode,
          youId: event.youId,
          seated: event.seated,
          playerReadyEmitted: event.matchStarted,
          intentionalDisconnect: false,
        },
      };
    }

    case 'ROOM_LEFT': {
      return { phase: 'connected', context: { ...INITIAL_SESSION_CONTEXT } };
    }

    case 'ROOM_SESSION_SUPERSEDED':
      return { phase: 'connected', context: { ...INITIAL_SESSION_CONTEXT } };

    case 'ROOM_REQUEST_READY':
      return withContext(
        snapshot,
        { playerReadyEmitted: false },
        snapshot.phase === 'in_match' || snapshot.phase === 'match_ended' ? 'in_lobby' : snapshot.phase,
      );

    case 'PLAYER_READY_EMITTED':
      return withContext(snapshot, { playerReadyEmitted: true }, 'match_starting');

    case 'PLAYER_READY_ACK': {
      if (event.matchStarted) {
        return withContext(snapshot, { playerReadyEmitted: true }, 'in_match');
      }
      return withContext(snapshot, { playerReadyEmitted: true }, 'match_starting');
    }

    case 'STATE_UPDATE_LIFECYCLE': {
      let next = snapshot;
      if (event.seatedClear) {
        next = withContext(next, { seated: false, playerReadyEmitted: false });
      }
      if (event.playerReadyEmitted) {
        next = withContext(next, { playerReadyEmitted: true });
      }
      if (event.matchStarted) {
        next = {
          ...next,
          phase: 'in_match',
          context: { ...next.context, playerReadyEmitted: true },
        };
      }
      if (event.gameOver) {
        next = { ...next, phase: 'match_ended' };
      }
      return next;
    }

    case 'GAME_REMATCH_STARTED':
      return withContext(
        snapshot,
        { playerReadyEmitted: false },
        snapshot.context.roomCode ? 'match_starting' : snapshot.phase,
      );

    case 'SESSION_RESET_GAME':
      return withContext(
        snapshot,
        { playerReadyEmitted: false },
        snapshot.context.roomCode ? 'in_lobby' : snapshot.phase,
      );

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
