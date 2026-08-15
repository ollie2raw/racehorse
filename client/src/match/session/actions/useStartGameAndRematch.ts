import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import { emitGameRematch, emitGameStart } from '../../../multiplayer/roomTransport';
import type { SessionEvent } from '../../../multiplayer/session/sessionTypes';

export type UseStartGameAndRematchParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  state: GameState | null;
  rematchRequested: boolean;
  dispatchSession: (event: SessionEvent) => void;
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string, duration?: number) => void;
  onGameStart: () => void;
};

export type UseStartGameAndRematchResult = {
  startGame: () => Promise<void>;
  requestRematch: () => void;
};

/**
 * startGame / requestRematch handlers, extracted verbatim from
 * useLiveMatchActions. These don't touch the gameplay-action idempotency
 * machinery (requestId/logicalGameplayActionRef), so they're independent of
 * the DRAW/PASS/MOVE flows.
 */
export function useStartGameAndRematch(
  params: UseStartGameAndRematchParams,
): UseStartGameAndRematchResult {
  const {
    socket,
    joinedRoom,
    state,
    rematchRequested,
    dispatchSession,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    setError,
    setActionError,
    setPendingUiAction,
    setRematchRequested,
    showToast,
    onGameStart,
  } = params;

  const startGame = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket || !joinedRoom) return setError('Not in a room.');
    setPendingUiAction('start');
    onGameStart();
    try {
      const resp = await emitGameStart(socket, joinedRoom);
      if (!resp?.ok) {
        if (resp?.error === 'waiting_for_ready') {
          dispatchSession({ type: 'ROOM_REQUEST_READY' });
          void schedulePlayerReadyRef.current();
          trySchedulePlayerReadyRef.current();
          return setError('waiting_for_ready');
        }
        return setError(resp?.error ?? 'Unable to start game.');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'start' ? null : prev));
    }
  }, [
    socket,
    joinedRoom,
    setError,
    showToast,
    onGameStart,
    dispatchSession,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    setActionError,
    setPendingUiAction,
  ]);

  const requestRematch = useCallback(() => {
    if (!socket || !joinedRoom || !state?.gameOver || rematchRequested) return;
    setRematchRequested(true);
    emitGameRematch(socket, joinedRoom, (resp) => {
      if (!resp?.ok) {
        setRematchRequested(false);
        showToast(resp?.error ?? 'Rematch failed.');
        return;
      }
      if (resp?.started) {
        setRematchRequested(false);
      }
    });
  }, [socket, joinedRoom, state?.gameOver, rematchRequested, showToast, setRematchRequested]);

  return { startGame, requestRematch };
}
