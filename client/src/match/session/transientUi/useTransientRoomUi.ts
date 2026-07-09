import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { GameState } from '../../../types';
import type { FlyingTile, HandEndedPayload } from '../liveMatchSessionTypes';
import type { PreGameDrawState } from '../../preGameDraw/preGameDrawLogic';
import { mpPerfMarkPendingUiCleared, mpPerfResetAction } from '../../../multiplayer/mpPerf';

export type UseTransientRoomUiParams = {
  setSelectedTile: Dispatch<SetStateAction<import('../../../types').Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setActionError: Dispatch<SetStateAction<string>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  draggingStateRef: MutableRefObject<boolean>;
  pendingActionRef: MutableRefObject<boolean>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  drawSequenceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  drawSequenceActiveRef: MutableRefObject<boolean>;
  setDrawSequenceActive: Dispatch<SetStateAction<boolean>>;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setDrawStepMyHand: Dispatch<SetStateAction<import('../../../types').Tile[] | null>>;
  setDrawStepActorId: Dispatch<SetStateAction<string | null>>;
  setDrawStepOpponentHandCount: Dispatch<SetStateAction<number | null>>;
  setPreGameDraw: Dispatch<SetStateAction<PreGameDrawState | null>>;
  setFlyingTiles: Dispatch<SetStateAction<FlyingTile[]>>;
  lastPlayedTileTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setLastPlayedTile: Dispatch<SetStateAction<import('../../../types').Tile | null>>;
};

export type UseTransientRoomUiResult = {
  clearTransientRoomUi: () => void;
  clearPendingGameplayUiOnAuthoritativeState: (nextState: GameState | null) => void;
  setDrawSequenceActiveBoth: (value: boolean) => void;
  flashLastPlayed: (tile: import('../../../types').Tile | null) => void;
};

export function useTransientRoomUi(params: UseTransientRoomUiParams): UseTransientRoomUiResult {
  const {
    setSelectedTile,
    setPendingUiAction,
    setActionError,
    setOpponentDragging,
    draggingStateRef,
    pendingActionRef,
    pendingGameplayActionRef,
    drawSequenceTimeoutRef,
    drawSequenceActiveRef,
    setDrawSequenceActive,
    setHandReveal,
    setDrawStepMyHand,
    setDrawStepActorId,
    setDrawStepOpponentHandCount,
    setPreGameDraw,
    setFlyingTiles,
    lastPlayedTileTimerRef,
    setLastPlayedTile,
  } = params;

  const setDrawSequenceActiveBoth = useCallback(
    (val: boolean) => {
      drawSequenceActiveRef.current = val;
      setDrawSequenceActive(val);
    },
    [drawSequenceActiveRef, setDrawSequenceActive],
  );

  const flashLastPlayed = useCallback(
    (tile: import('../../../types').Tile | null) => {
      if (lastPlayedTileTimerRef.current) {
        clearTimeout(lastPlayedTileTimerRef.current);
      }
      setLastPlayedTile(tile);
      if (tile) {
        lastPlayedTileTimerRef.current = setTimeout(() => {
          setLastPlayedTile(null);
          lastPlayedTileTimerRef.current = null;
        }, 2400);
      }
    },
    [lastPlayedTileTimerRef, setLastPlayedTile],
  );

  const clearTransientRoomUi = useCallback(() => {
    setSelectedTile(null);
    setPendingUiAction(null);
    setActionError('');
    setOpponentDragging(false);
    draggingStateRef.current = false;
    pendingActionRef.current = false;
    pendingGameplayActionRef.current = null;
    mpPerfResetAction();
    setHandReveal(null);
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    // TEMP-DIAGNOSTIC
    console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
      path: 'useTransientRoomUi:clearTransientRoomUi',
      at: Date.now(),
    });
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepActorId(null);
    setDrawStepOpponentHandCount(null);
    setPreGameDraw(null);
    setFlyingTiles([]);
  }, [
    setSelectedTile,
    setPendingUiAction,
    setActionError,
    setOpponentDragging,
    draggingStateRef,
    pendingActionRef,
    pendingGameplayActionRef,
    drawSequenceTimeoutRef,
    setDrawSequenceActiveBoth,
    setHandReveal,
    setDrawStepMyHand,
    setDrawStepActorId,
    setDrawStepOpponentHandCount,
    setPreGameDraw,
    setFlyingTiles,
  ]);

  const clearPendingGameplayUiOnAuthoritativeState = useCallback(
    (nextState: GameState | null) => {
      const pending = pendingGameplayActionRef.current;
      if (!pending || !nextState) return;
      const sequence = nextState.sequence;
      if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return;
      if (sequence <= pending.baselineSequence) return;

      setPendingUiAction((prev) => (prev === pending.kind ? null : prev));
      mpPerfMarkPendingUiCleared();
    },
    [pendingGameplayActionRef, setPendingUiAction],
  );

  return {
    clearTransientRoomUi,
    clearPendingGameplayUiOnAuthoritativeState,
    setDrawSequenceActiveBoth,
    flashLastPlayed,
  };
}