import { reduceSession } from './sessionReducer';
import {
  selectCanSendReady,
  selectIsInLobby,
  selectIsInMatch,
  selectJoinedRoomCode,
} from './sessionStateMachine';
import { INITIAL_SESSION_SNAPSHOT } from './sessionTypes';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function assertFalse(value: boolean, label: string): void {
  assertEqual(value, false, label);
}

let snapshot = INITIAL_SESSION_SNAPSHOT;

function dispatch(event: Parameters<typeof reduceSession>[1]): void {
  snapshot = reduceSession(snapshot, event);
}

dispatch({ type: 'SOCKET_CONNECTED' });
assertEqual(snapshot.phase, 'connected', 'connect -> connected');

dispatch({
  type: 'ROOM_JOIN_OK',
  roomCode: 'ABCD',
  youId: 'p1',
  seated: true,
  matchStarted: false,
});
assertEqual(snapshot.phase, 'in_lobby', 'join -> in_lobby');
assertTrue(selectIsInLobby(snapshot), 'in lobby');
assertTrue(selectCanSendReady(snapshot), 'can send ready in lobby');
assertEqual(selectJoinedRoomCode(snapshot), 'ABCD', 'room code set');

dispatch({ type: 'PLAYER_READY_EMITTED' });
assertEqual(snapshot.phase, 'match_starting', 'ready emitted -> match_starting');
assertFalse(selectCanSendReady(snapshot), 'cannot send ready twice');

dispatch({ type: 'PLAYER_READY_ACK', matchStarted: true });
assertEqual(snapshot.phase, 'in_match', 'ready ack started -> in_match');
assertTrue(selectIsInMatch(snapshot), 'in match');

dispatch({
  type: 'STATE_UPDATE_LIFECYCLE',
  gameOver: true,
});
assertEqual(snapshot.phase, 'match_ended', 'game over -> match_ended');

dispatch({ type: 'GAME_REMATCH_STARTED' });
assertEqual(snapshot.phase, 'match_starting', 'rematch -> match_starting');

dispatch({ type: 'SESSION_RESET_GAME' });
assertEqual(snapshot.phase, 'in_lobby', 'session reset -> in_lobby');

dispatch({ type: 'INTENTIONAL_DISCONNECT', value: true });
assertEqual(snapshot.phase, 'leaving', 'intentional disconnect -> leaving');

dispatch({ type: 'SOCKET_DISCONNECTED' });
assertEqual(snapshot.phase, 'idle', 'disconnect while leaving -> idle');

console.log('sessionStateMachine.behaviorTests: all passed');