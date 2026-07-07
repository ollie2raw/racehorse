import { useCallback } from 'react';
import type { MutableRefObject, SetStateAction } from 'react';
import type { GameState, Move, Tile } from '../types';
import type { MultiplayerShellDelegates } from './multiplayerGameShellTypes';

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
  shellDelegatesRef: MutableRefObject<MultiplayerShellDelegates | null>,
) {
  const setState = useCallback(
    (value: SetStateAction<GameState | null>) => {
      shellDelegatesRef.current?.setState(value);
    },
    [shellDelegatesRef],
  );

  const setLegalMoves = useCallback(
    (value: SetStateAction<Move[]>) => {
      shellDelegatesRef.current?.setLegalMoves(value);
    },
    [shellDelegatesRef],
  );

  const setCanDraw = useCallback(
    (value: SetStateAction<boolean>) => {
      shellDelegatesRef.current?.setCanDraw(value);
    },
    [shellDelegatesRef],
  );

  const setRematchRequested = useCallback(
    (value: SetStateAction<boolean>) => {
      shellDelegatesRef.current?.setRematchRequested(value);
    },
    [shellDelegatesRef],
  );

  const setRematchReadyIds = useCallback(
    (value: SetStateAction<string[]>) => {
      shellDelegatesRef.current?.setRematchReadyIds(value);
    },
    [shellDelegatesRef],
  );

  const setOpponentDragging = useCallback(
    (value: SetStateAction<boolean>) => {
      shellDelegatesRef.current?.setOpponentDragging(value);
    },
    [shellDelegatesRef],
  );

  const setHandReveal = useCallback(
    (value: SetStateAction<HandEndedPayload | null>) => {
      shellDelegatesRef.current?.setHandReveal(value);
    },
    [shellDelegatesRef],
  );

  const setSelectedTile = useCallback(
    (value: SetStateAction<Tile | null>) => {
      shellDelegatesRef.current?.setSelectedTile(value);
    },
    [shellDelegatesRef],
  );

  const setPendingUiAction = useCallback(
    (
      value: SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>,
    ) => {
      shellDelegatesRef.current?.setPendingUiAction(value);
    },
    [shellDelegatesRef],
  );

  const setActionError = useCallback(
    (value: SetStateAction<string>) => {
      shellDelegatesRef.current?.setActionError(value);
    },
    [shellDelegatesRef],
  );

  const clearTransientRoomUi = useCallback(() => {
    shellDelegatesRef.current?.clearTransientRoomUi();
  }, [shellDelegatesRef]);

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
  stateRef: import('react').MutableRefObject<GameState | null>;
  draggingStateRef: import('react').MutableRefObject<boolean>;
  handRevealShownRef: import('react').MutableRefObject<number | null>;
  handRevealTimerRef: import('react').MutableRefObject<ReturnType<typeof setTimeout> | null>;
  rematchAwaitingStateRef: import('react').MutableRefObject<boolean>;
};