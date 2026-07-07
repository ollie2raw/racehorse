import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Tile } from '../../../types';
import { tileEquals } from '../../../game/tileUtils';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';
import { emitDraggingState } from '../actions/emitDraggingState';

export type UseTileSelectionParams = {
  you: string;
  state: GameState | null;
  joinedRoom: string | null;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  isMyTurn: boolean;
  socket: Socket | null;
  pendingActionRef: MutableRefObject<boolean>;
  draggingStateRef: MutableRefObject<boolean>;
};

export type UseTileSelectionResult = {
  selectedTile: Tile | null;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  selectedTileRef: MutableRefObject<Tile | null>;
  handleTileTap: (tile: Tile) => void;
  onPregameTileTap: (tileId: string) => void;
};

export function useTileSelection(params: UseTileSelectionParams): UseTileSelectionResult {
  const {
    you,
    state,
    joinedRoom,
    roomRecoveryState,
    isRecoveringConnection,
    isMyTurn,
    socket,
    pendingActionRef,
    draggingStateRef,
  } = params;

  const [selectedTileRaw, setSelectedTileRaw] = useState<Tile | null>(null);
  const selectedTileRef = useRef<Tile | null>(null);

  const setSelectedTile = useCallback((value: SetStateAction<Tile | null>) => {
    const nextVal =
      typeof value === 'function'
        ? (value as (prev: Tile | null) => Tile | null)(selectedTileRef.current)
        : value;
    selectedTileRef.current = nextVal;
    setSelectedTileRaw(nextVal);
  }, []);

  const selectedTile = selectedTileRaw;

  const emitDragging = useCallback(
    (dragging: boolean) => {
      emitDraggingState({
        socket,
        joinedRoom,
        state,
        you,
        dragging,
        draggingStateRef,
      });
    },
    [socket, joinedRoom, state, you, draggingStateRef],
  );

  const handleTileTap = useCallback(
    (tile: Tile) => {
      if (
        !isMyTurn ||
        state?.handOver ||
        state?.gameOver ||
        roomRecoveryState !== 'idle' ||
        isRecoveringConnection ||
        pendingActionRef.current
      ) {
        return;
      }
      if (selectedTile && tileEquals(selectedTile, tile)) {
        setSelectedTile(null);
        emitDragging(false);
        return;
      }
      setSelectedTile(tile);
      emitDragging(true);
    },
    [
      isMyTurn,
      state?.handOver,
      state?.gameOver,
      roomRecoveryState,
      isRecoveringConnection,
      selectedTile,
      emitDragging,
      pendingActionRef,
      setSelectedTile,
    ],
  );

  const onPregameTileTap = useCallback(
    (tileId: string) => {
      if (!socket) return;
      socket.emit('game:pregame_draw_pick', { slotId: tileId });
    },
    [socket],
  );

  useEffect(() => {
    emitDragging(Boolean(selectedTile));
  }, [selectedTile, emitDragging]);

  useEffect(() => {
    if (!isMyTurn || state?.gameOver || state?.handOver) {
      emitDragging(false);
      setSelectedTile(null);
    }
  }, [isMyTurn, state?.gameOver, state?.handOver, emitDragging, setSelectedTile]);

  return {
    selectedTile,
    setSelectedTile,
    selectedTileRef,
    handleTileTap,
    onPregameTileTap,
  };
}