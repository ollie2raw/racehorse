import { emitRoomAbandonMatch, type RoomAbandonPayload, type RoomAckResponse, type SocketEmitter } from './roomTransport';

export type PostGameHomeTeardownHandlers = {
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  disconnect: (reason: string) => void;
};

export type MatchAbandonAttemptParams = {
  socket: { connected?: boolean } | null;
  activeRoomCode: string;
};

export type MatchAbandonFailureHandlers = {
  shellSetActionError: (message: string) => void;
  showToast: (message: string, duration?: number) => void;
};

export type MatchAbandonSuccessCleanupHandlers = {
  clearRecoverableRoomState: () => void;
  resetMultiplayerRoomState: (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void;
  shellSetActionError: (message: string) => void;
};

/** Non-tournament post-game transport: reset room/shell then disconnect socket. */
export function performPostGameHomeTeardown(handlers: PostGameHomeTeardownHandlers): void {
  handlers.resetMultiplayerRoomState({ keepPlayers: false, clearRoomCode: true });
  handlers.disconnect('post-game to home');
}

export function canAttemptMatchAbandon(params: MatchAbandonAttemptParams): boolean {
  return Boolean(params.socket?.connected && params.activeRoomCode);
}

export function emitMatchAbandonTransport(
  socket: SocketEmitter,
  payload: RoomAbandonPayload,
): Promise<RoomAckResponse> {
  return emitRoomAbandonMatch(socket, payload);
}

export function handleMatchAbandonFailure(
  errorMessage: string,
  handlers: MatchAbandonFailureHandlers,
): void {
  handlers.shellSetActionError(errorMessage);
  handlers.showToast(errorMessage, 2200);
}

/** Room-layer cleanup after a successful room:abandon_match ack (no navigation). */
export function performMatchAbandonSuccessCleanup(handlers: MatchAbandonSuccessCleanupHandlers): void {
  handlers.clearRecoverableRoomState();
  handlers.resetMultiplayerRoomState({ keepPlayers: true });
  handlers.shellSetActionError('');
}