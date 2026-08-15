import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import type { FlyingTile } from '../liveMatchSessionTypes';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';

export type GameplayBlockReason =
  | 'missing_context'
  | 'connection'
  | 'pendingActionRef'
  | 'drawSequenceActive'
  | 'flyingTiles'
  | 'pendingUiAction'
  | 'handOver'
  | 'not_in_game'
  | 'not_your_turn';

export type UseGameplayBlockDiagnosticsParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  state: GameState | null;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  rejoinInFlightRef: MutableRefObject<boolean>;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  drawSequenceActive: boolean;
  flyingTiles: FlyingTile[];
  pendingActionRef: MutableRefObject<boolean>;
  showToast: (message: string, duration?: number) => void;
};

export type UseGameplayBlockDiagnosticsResult = {
  isGameplayActionBlocked: () => boolean;
  diagnoseGameplayBlockReason: () => GameplayBlockReason | null;
  blockConditionAgeMs: (reason: GameplayBlockReason) => number | null;
  setPendingActionRefDiag: (value: boolean) => void;
};

/**
 * TEMP-DIAGNOSTIC: tracks how long each gameplay-blocking condition has been
 * active, and exposes the blocking predicate itself. Extracted verbatim from
 * useLiveMatchActions — behavior and logging are unchanged.
 */
export function useGameplayBlockDiagnostics(
  params: UseGameplayBlockDiagnosticsParams,
): UseGameplayBlockDiagnosticsResult {
  const {
    socket,
    joinedRoom,
    you,
    state,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
    showToast,
  } = params;

  const drawSequenceActiveTrueSinceRef = useRef<number | null>(null);
  const flyingTilesNonEmptySinceRef = useRef<number | null>(null);
  const pendingActionTrueSinceRef = useRef<number | null>(null);
  const pendingUiActionTrueSinceRef = useRef<number | null>(null);
  const connectionBlockedTrueSinceRef = useRef<number | null>(null);
  const prevDrawSequenceActiveRef = useRef(drawSequenceActive);
  const prevFlyingTilesCountRef = useRef(flyingTiles.length);

  const setPendingActionRefDiag = useCallback(
    (value: boolean) => {
      const now = Date.now();
      if (value) {
        if (pendingActionTrueSinceRef.current === null) {
          pendingActionTrueSinceRef.current = now;
        }
      } else {
        pendingActionTrueSinceRef.current = null;
      }
      pendingActionRef.current = value;
    },
    [pendingActionRef],
  );

  useEffect(() => {
    const now = Date.now();
    if (drawSequenceActive) {
      if (drawSequenceActiveTrueSinceRef.current === null) {
        drawSequenceActiveTrueSinceRef.current = now;
      }
    } else {
      drawSequenceActiveTrueSinceRef.current = null;
    }
  }, [drawSequenceActive]);

  useEffect(() => {
    const now = Date.now();
    const prev = prevDrawSequenceActiveRef.current;
    if (prev !== drawSequenceActive) {
      // TEMP-DIAGNOSTIC: correlate with useRoomSocketSync path-tagged logs for clear-path attribution.
      console.log('[TEMP-DIAGNOSTIC] drawSequenceActive observed transition', {
        from: prev,
        to: drawSequenceActive,
        at: now,
      });
      prevDrawSequenceActiveRef.current = drawSequenceActive;
    }
  }, [drawSequenceActive]);

  useEffect(() => {
    const now = Date.now();
    const prevCount = prevFlyingTilesCountRef.current;
    const nextCount = flyingTiles.length;
    if (nextCount > 0) {
      if (flyingTilesNonEmptySinceRef.current === null) {
        flyingTilesNonEmptySinceRef.current = now;
      }
    } else if (prevCount > 0) {
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] flyingTiles transitioned to empty', {
        at: now,
        wasNonEmptyForMs:
          flyingTilesNonEmptySinceRef.current === null
            ? null
            : now - flyingTilesNonEmptySinceRef.current,
        previousCount: prevCount,
      });
      flyingTilesNonEmptySinceRef.current = null;
    }
    prevFlyingTilesCountRef.current = nextCount;
  }, [flyingTiles]);

  useEffect(() => {
    const now = Date.now();
    const blocksConnection =
      !socket ||
      !joinedRoom ||
      !state ||
      !you ||
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current;
    if (blocksConnection) {
      if (connectionBlockedTrueSinceRef.current === null) {
        connectionBlockedTrueSinceRef.current = now;
      }
    } else {
      connectionBlockedTrueSinceRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
  ]);

  useEffect(() => {
    const now = Date.now();
    const blocksUi =
      pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play';
    if (blocksUi) {
      if (pendingUiActionTrueSinceRef.current === null) {
        pendingUiActionTrueSinceRef.current = now;
      }
    } else {
      pendingUiActionTrueSinceRef.current = null;
    }
  }, [pendingUiAction]);

  const diagnoseGameplayBlockReason = useCallback((): GameplayBlockReason | null => {
    if (!socket || !joinedRoom || !state || !you) return 'missing_context';
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      return 'connection';
    }
    if (pendingActionRef.current) return 'pendingActionRef';
    if (drawSequenceActive) return 'drawSequenceActive';
    if (flyingTiles.length > 0) return 'flyingTiles';
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return 'pendingUiAction';
    }
    if (state.handOver || state.gameOver) return 'handOver';
    if (!state.playerIds.includes(you)) return 'not_in_game';
    if (state.playerIds[state.currentPlayerIndex] !== you) return 'not_your_turn';
    return null;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);

  const blockConditionAgeMs = useCallback(
    (reason: GameplayBlockReason): number | null => {
      const now = Date.now();
      switch (reason) {
        case 'pendingActionRef':
          return pendingActionTrueSinceRef.current === null
            ? null
            : now - pendingActionTrueSinceRef.current;
        case 'drawSequenceActive':
          return drawSequenceActiveTrueSinceRef.current === null
            ? null
            : now - drawSequenceActiveTrueSinceRef.current;
        case 'flyingTiles':
          return flyingTilesNonEmptySinceRef.current === null
            ? null
            : now - flyingTilesNonEmptySinceRef.current;
        case 'pendingUiAction':
          return pendingUiActionTrueSinceRef.current === null
            ? null
            : now - pendingUiActionTrueSinceRef.current;
        case 'connection':
          return connectionBlockedTrueSinceRef.current === null
            ? null
            : now - connectionBlockedTrueSinceRef.current;
        default:
          return null;
      }
    },
    [],
  );

  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current) {
      return true;
    }
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    showToast,
    pendingActionRef,
  ]);

  return {
    isGameplayActionBlocked,
    diagnoseGameplayBlockReason,
    blockConditionAgeMs,
    setPendingActionRefDiag,
  };
}
