import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GameState, Move, Tile } from '../types';
import type { MultiplayerGameShellBridge } from './multiplayerGameShellTypes';

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export function useMultiplayerShellDelegates(
  shellBridgeRef: MutableRefObject<MultiplayerGameShellBridge | null>,
) {
  const setState = useCallback(
    (value: SetStateAction<GameState | null>) => {
      shellBridgeRef.current?.setState(value);
    },
    [shellBridgeRef],
  );

  const setLegalMoves = useCallback(
    (value: SetStateAction<Move[]>) => {
      shellBridgeRef.current?.setLegalMoves(value);
    },
    [shellBridgeRef],
  );

  const setCanDraw = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setCanDraw(value);
    },
    [shellBridgeRef],
  );

  const setRematchRequested = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setRematchRequested(value);
    },
    [shellBridgeRef],
  );

  const setRematchReadyIds = useCallback(
    (value: SetStateAction<string[]>) => {
      shellBridgeRef.current?.setRematchReadyIds(value);
    },
    [shellBridgeRef],
  );

  const setOpponentDragging = useCallback(
    (value: SetStateAction<boolean>) => {
      shellBridgeRef.current?.setOpponentDragging(value);
    },
    [shellBridgeRef],
  );

  const setHandReveal = useCallback(
    (value: SetStateAction<HandEndedPayload | null>) => {
      shellBridgeRef.current?.setHandReveal(value);
    },
    [shellBridgeRef],
  );

  const setSelectedTile = useCallback(
    (value: SetStateAction<Tile | null>) => {
      shellBridgeRef.current?.setSelectedTile(value);
    },
    [shellBridgeRef],
  );

  const setPendingUiAction = useCallback(
    (
      value: SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>,
    ) => {
      shellBridgeRef.current?.setPendingUiAction(value);
    },
    [shellBridgeRef],
  );

  const setActionError = useCallback(
    (value: SetStateAction<string>) => {
      shellBridgeRef.current?.setActionError(value);
    },
    [shellBridgeRef],
  );

  const clearTransientRoomUi = useCallback(() => {
    shellBridgeRef.current?.clearTransientRoomUi();
  }, [shellBridgeRef]);

  return {
    setState,
    setLegalMoves,
    setCanDraw,
    setRematchRequested,
    setRematchReadyIds,
    setOpponentDragging,
    setHandReveal,
    setSelectedTile,
    setPendingUiAction,
    setActionError,
    clearTransientRoomUi,
  };
}

export type SharedGameplayRefs = {
  stateRef: MutableRefObject<GameState | null>;
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
};
