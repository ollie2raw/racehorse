import type { RecoveryEvent } from './recoveryMachine';
import { isTerminalJoinError } from './recoveryMachine';
import type { RoomAckResponse, RoomTerminalJoinPayload } from './roomTransport';
import {
  recoverPrivateMatchResult,
  type RecoveredPrivateMatchUi,
} from './terminalRoomArchiveRecovery';

export function isRecoverableTerminalJoinResponse(resp: RoomAckResponse | null | undefined): boolean {
  if (!resp || resp.ok !== false) return false;
  if (resp.terminal?.recoverable === true) return true;
  const error = String(resp.error ?? '');
  if (error === 'match_terminal') return true;
  return isTerminalJoinError(error);
}

export type HandleTerminalJoinFailureParams = {
  resp: RoomAckResponse;
  roomCode: string;
  serverUrl: string;
  authToken: string | null;
  lastRoomStorageKey?: string;
  clearSavedRoomOnAttempt?: boolean;
  restoreSavedRoomOnDegraded?: boolean;
  setRecoveredPrivateMatch?: (recovered: RecoveredPrivateMatchUi) => void;
  onNavigateMultiplayer?: () => void;
  dispatchRecovery?: (event: RecoveryEvent) => void;
};

export type HandleTerminalJoinFailureResult = 'handled' | 'not_terminal';

function terminalJoinErrorText(resp: RoomAckResponse): string {
  return String(resp.error ?? 'match_terminal');
}

function maybeDisableRecoveryPolicy(
  resp: RoomAckResponse,
  dispatchRecovery: HandleTerminalJoinFailureParams['dispatchRecovery'],
): void {
  const error = terminalJoinErrorText(resp).toLowerCase();
  const terminal = resp.terminal as RoomTerminalJoinPayload | undefined;
  if (error.includes('completed') || terminal?.status === 'completed') {
    dispatchRecovery?.({ type: 'SET_POLICY', policy: 'disabled' });
  }
}

export async function handleTerminalJoinFailure(
  params: HandleTerminalJoinFailureParams,
): Promise<HandleTerminalJoinFailureResult> {
  if (!isRecoverableTerminalJoinResponse(params.resp)) {
    return 'not_terminal';
  }

  const roomCode = params.roomCode.trim().toUpperCase();
  maybeDisableRecoveryPolicy(params.resp, params.dispatchRecovery);

  if (
    params.clearSavedRoomOnAttempt &&
    params.lastRoomStorageKey &&
    typeof window !== 'undefined'
  ) {
    window.localStorage.removeItem(params.lastRoomStorageKey);
  }

  const recovered = await recoverPrivateMatchResult({
    serverUrl: params.serverUrl,
    roomCode,
    matchId: params.resp.terminal?.matchId,
    authToken: params.authToken,
  });

  if (
    (recovered.kind === 'syncing' || recovered.kind === 'unauthorized') &&
    params.restoreSavedRoomOnDegraded &&
    params.lastRoomStorageKey &&
    typeof window !== 'undefined'
  ) {
    window.localStorage.setItem(params.lastRoomStorageKey, roomCode);
  }

  params.setRecoveredPrivateMatch?.(recovered);
  params.onNavigateMultiplayer?.();
  params.dispatchRecovery?.({
    type: 'ROOM_JOIN_TERMINAL',
    error: terminalJoinErrorText(params.resp),
  });
  return 'handled';
}
