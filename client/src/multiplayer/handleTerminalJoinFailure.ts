import type { RecoveryEvent } from './recoveryMachine';
import { isTerminalJoinError } from './recoveryMachine';
import type { RoomAckResponse, RoomTerminalJoinPayload } from './roomTransport';
import {
  buildTerminalArchiveFallbackNotice,
  recoverTerminalMatchArchive,
  type RecoveredTerminalMatchNotice,
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
  setRecoveredTerminalMatchNotice?: (notice: RecoveredTerminalMatchNotice) => void;
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

  const archiveResult = await recoverTerminalMatchArchive({
    serverUrl: params.serverUrl,
    roomCode,
    authToken: params.authToken,
  });

  const finishTerminalRecovery = (notice: RecoveredTerminalMatchNotice) => {
    params.setRecoveredTerminalMatchNotice?.(notice);
    params.onNavigateMultiplayer?.();
    params.dispatchRecovery?.({
      type: 'ROOM_JOIN_TERMINAL',
      error: terminalJoinErrorText(params.resp),
    });
  };

  if (archiveResult.status === 'found') {
    finishTerminalRecovery(archiveResult.notice);
    return 'handled';
  }

  if (archiveResult.status === 'temporarily_unavailable' || archiveResult.status === 'unauthorized') {
    if (
      params.restoreSavedRoomOnDegraded &&
      params.lastRoomStorageKey &&
      typeof window !== 'undefined'
    ) {
      window.localStorage.setItem(params.lastRoomStorageKey, roomCode);
    }
    finishTerminalRecovery(buildTerminalArchiveFallbackNotice(archiveResult.status, roomCode));
    return 'handled';
  }

  finishTerminalRecovery(buildTerminalArchiveFallbackNotice('absent', roomCode));
  return 'handled';
}
