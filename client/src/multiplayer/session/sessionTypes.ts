export type SessionPhase =
  | 'idle'
  | 'connected'
  | 'in_lobby'
  | 'match_starting'
  | 'in_match'
  | 'match_ended'
  | 'leaving';

export type SessionContext = {
  roomCode: string | null;
  youId: string;
  seated: boolean;
  playerReadyEmitted: boolean;
  intentionalDisconnect: boolean;
};

export type SessionSnapshot = {
  phase: SessionPhase;
  context: SessionContext;
};

export const INITIAL_SESSION_CONTEXT: SessionContext = {
  roomCode: null,
  youId: '',
  seated: false,
  playerReadyEmitted: false,
  intentionalDisconnect: false,
};

export const INITIAL_SESSION_SNAPSHOT: SessionSnapshot = {
  phase: 'idle',
  context: INITIAL_SESSION_CONTEXT,
};

export type SessionEvent =
  | { type: 'SOCKET_CONNECTED' }
  | { type: 'SOCKET_DISCONNECTED' }
  | { type: 'INTENTIONAL_DISCONNECT'; value: boolean }
  | {
      type: 'ROOM_JOIN_OK';
      roomCode: string;
      youId: string;
      seated: boolean;
      matchStarted: boolean;
    }
  | { type: 'ROOM_LEFT' }
  | { type: 'ROOM_SESSION_SUPERSEDED' }
  | { type: 'ROOM_REQUEST_READY' }
  | { type: 'PLAYER_READY_EMITTED' }
  | { type: 'PLAYER_READY_ACK'; matchStarted: boolean }
  | {
      type: 'STATE_UPDATE_LIFECYCLE';
      matchStarted?: boolean;
      seatedClear?: boolean;
      playerReadyEmitted?: boolean;
      gameOver?: boolean;
    }
  | { type: 'GAME_REMATCH_STARTED' }
  | { type: 'SESSION_RESET_GAME' };

export type SessionRuntime = {
  getSnapshot: () => SessionSnapshot;
  dispatch: (event: SessionEvent) => SessionSnapshot;
};