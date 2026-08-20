import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, PlacementPosition, Tile } from '../../../types';
import { playTileSound } from '../../../utils/sound';
import { mpPerfBeginAction, mpPerfMarkAck } from '../../../multiplayer/mpPerf';
import { nextEndsForTile, toTileTuple } from '../../../game/moveLogger';
import { emitGameAction } from '../../../multiplayer/roomTransport';
import type { MoveEntry } from '../../../game/moveLogger';
import type { FlyingTile } from '../liveMatchSessionTypes';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';
import { tileEquals } from '../../../game/tileUtils';
import {
  buildLogicalActionSignature,
  resolveLogicalActionRequestId,
  type LogicalGameplayAction,
} from './gameplayActionIdentity';
import { buildGameplayMoveTelemetry } from './buildGameplayMoveTelemetry';
import type { GameplayBlockReason } from './gameplayBlockDiagnostics';

export type UsePlayActionParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  stateRef: MutableRefObject<GameState | null>;
  legalMovesRef: MutableRefObject<Move[]>;
  selectedTileRef: MutableRefObject<Tile | null>;
  pendingActionRef: MutableRefObject<boolean>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  logicalGameplayActionRef: MutableRefObject<LogicalGameplayAction | null>;
  mpAutoDrawSuppressUntilSequenceRef: MutableRefObject<number | null>;
  autoTurnActionKeyRef: MutableRefObject<string>;
  isMutedRef: MutableRefObject<boolean>;
  drawSequenceActive: boolean;
  flyingTiles: FlyingTile[];
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  rejoinInFlightRef: MutableRefObject<boolean>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setDrawStepMyHand: Dispatch<SetStateAction<Tile[] | null>>;
  setPendingActionRefDiag: (value: boolean) => void;
  isGameplayActionBlocked: () => boolean;
  diagnoseGameplayBlockReason: () => GameplayBlockReason | null;
  blockConditionAgeMs: (reason: GameplayBlockReason) => number | null;
  emitDraggingState: (dragging: boolean) => void;
  showToast: (message: string, duration?: number) => void;
  appendMultiplayerMove: (entry: Omit<MoveEntry, 'moveNumber'>) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  markUncertainAndResync: (requestId: string, error?: string) => void;
};

/** MOVE (play) action handler, extracted verbatim from useLiveMatchActions. */
export function usePlayAction(
  params: UsePlayActionParams,
): (position: PlacementPosition) => Promise<void> {
  const {
    socket,
    joinedRoom,
    you,
    stateRef,
    legalMovesRef,
    selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    isMutedRef,
    drawSequenceActive,
    flyingTiles,
    pendingUiAction,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    setActionError,
    setPendingUiAction,
    setSelectedTile,
    setDrawStepMyHand,
    setPendingActionRefDiag,
    isGameplayActionBlocked,
    diagnoseGameplayBlockReason,
    blockConditionAgeMs,
    emitDraggingState,
    showToast,
    appendMultiplayerMove,
    flashLastPlayed,
    markUncertainAndResync,
  } = params;

  return useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      const stateNow = stateRef.current;
      const legalMovesNow = legalMovesRef.current;
      const selected = selectedTileRef.current;
      if (!socket || !joinedRoom || !selected) return;

      if (isGameplayActionBlocked()) {
        const blockReason = diagnoseGameplayBlockReason();
        if (blockReason) {
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] play() blocked by isGameplayActionBlocked', {
            reason: blockReason,
            conditionAgeMs: blockConditionAgeMs(blockReason),
            at: Date.now(),
            position,
            selectedTile: selected ? `${selected.low}-${selected.high}` : null,
            stateSequence: stateNow?.sequence ?? null,
            drawSequenceActive,
            flyingTilesCount: flyingTiles.length,
            pendingActionRef: pendingActionRef.current,
            pendingUiAction,
            roomRecoveryState,
            socketConnected: socket?.connected ?? false,
            isRecoveringConnection,
            rejoinInFlight: rejoinInFlightRef.current,
          });
        }
        return;
      }

      const tileToPlay = selected;
      const selectedMove = legalMovesNow.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      if (!selectedMove) {
        emitDraggingState(false);
        setSelectedTile(null);
        setActionError('That tile cannot be played there.');
        return;
      }
      emitDraggingState(false);
      const baselineSequence = stateNow?.sequence ?? -1;
      pendingGameplayActionRef.current = { kind: 'play', baselineSequence };
      mpPerfBeginAction('play', baselineSequence);
      setPendingUiAction('play');
      playTileSound('standard', isMutedRef.current);
      setPendingActionRefDiag(true);
      setSelectedTile(null);
      setDrawStepMyHand(null);
      const telemetry = buildGameplayMoveTelemetry({ stateNow, legalMovesNow, you });
      const playedTile = toTileTuple(tileToPlay);
      const handNumber = stateNow?.handNumber ?? 0;
      const signature = buildLogicalActionSignature({
        kind: 'move',
        roomCode: joinedRoom,
        playerId: you,
        baselineSequence,
        handNumber,
        tile: tileToPlay,
        position,
      });
      const logicalAction = resolveLogicalActionRequestId({
        current: logicalGameplayActionRef.current,
        kind: 'move',
        roomCode: joinedRoom,
        playerId: you,
        baselineSequence,
        handNumber,
        signature,
      });
      logicalGameplayActionRef.current = logicalAction;
      const requestId = logicalAction.requestId;

      try {
        const resp = await emitGameAction(socket, joinedRoom, {
          type: 'MOVE',
          requestId,
          move: { tile: tileToPlay, position },
        });

        mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
        if (!resp?.ok) {
          if (resp?.uncertain) {
            markUncertainAndResync(
              requestId,
              resp.error ?? "Move couldn't be saved — try again.",
            );
          } else {
            setActionError(resp?.error ?? 'Unable to play tile.');
          }
          return;
        }
        if (logicalGameplayActionRef.current?.requestId === requestId) {
          logicalGameplayActionRef.current = null;
        }
        if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
          mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
          autoTurnActionKeyRef.current = '';
        }
        flashLastPlayed(selectedMove?.tile ?? tileToPlay);
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          pipDelta: -(playedTile[0] + playedTile[1]),
          pointsScored: (() => {
            const possibleEnds = nextEndsForTile(playedTile, telemetry.boardEnds);
            for (const ends of possibleEnds) {
              const s = ends[0] + ends[1];
              if (s > 0 && s % 5 === 0) return s / 5;
            }
            return 0;
          })(),
          ...telemetry,
        });
      } catch (e) {
        mpPerfMarkAck(false);
        if (logicalGameplayActionRef.current?.requestId === requestId) {
          logicalGameplayActionRef.current = {
            ...logicalGameplayActionRef.current,
            uncertain: true,
          };
        }
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
        setPendingActionRefDiag(false);
        pendingGameplayActionRef.current = null;
      }
    },
    [
      socket,
      joinedRoom,
      you,
      appendMultiplayerMove,
      emitDraggingState,
      showToast,
      flashLastPlayed,
      isGameplayActionBlocked,
      diagnoseGameplayBlockReason,
      blockConditionAgeMs,
      drawSequenceActive,
      flyingTiles,
      pendingUiAction,
      logicalGameplayActionRef,
      roomRecoveryState,
      isRecoveringConnection,
      rejoinInFlightRef,
      stateRef,
      legalMovesRef,
      selectedTileRef,
      pendingGameplayActionRef,
      setPendingActionRefDiag,
      pendingActionRef,
      mpAutoDrawSuppressUntilSequenceRef,
      autoTurnActionKeyRef,
      isMutedRef,
      setActionError,
      setPendingUiAction,
      setSelectedTile,
      setDrawStepMyHand,
      markUncertainAndResync,
    ],
  );
}
