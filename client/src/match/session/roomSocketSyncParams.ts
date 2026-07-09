import { useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GameState } from '../../types';
import { tileEquals } from '../../game/tileUtils';
import type { UseRoomSocketSyncParams } from '../../multiplayer/useRoomSocketSync';
import type { StateUpdatePayload, RoomPlayer, RoomRecoveryState } from '../../multiplayer/protocol';
import type { RoomEventMeta } from '../../multiplayer/protocol';
import type { FriendInviteState } from '../../multiplayer/runtime/friendInviteRuntime';
import type { MultiplayerSessionRefsRuntime } from '../../multiplayer/runtime/gameplayRuntime';
import type { FlyingTile } from './liveMatchSessionTypes';
import type { PreGameDrawState } from '../preGameDraw/preGameDrawLogic';

export type BuildRoomSocketSyncParamsInput = {
  socket: Socket | null;
  showToast: (message: string, duration?: number) => void;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  maxSequenceRef: MutableRefObject<number>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  fetchGameState: (reason: string) => Promise<boolean>;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  resetClientGameSession: () => void;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  sessionRefsRuntime: MultiplayerSessionRefsRuntime;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setLegalMoves: Dispatch<SetStateAction<import('../../types').Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnected: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnectMessage: Dispatch<SetStateAction<string>>;
  setPreGameDraw: Dispatch<SetStateAction<PreGameDrawState | null>>;
  setDrawSequenceActiveBoth: (value: boolean) => void;
  setDrawStepMyHand: Dispatch<SetStateAction<import('../../types').Tile[] | null>>;
  setDrawStepActorId: Dispatch<SetStateAction<string | null>>;
  setDrawStepOpponentHandCount: Dispatch<SetStateAction<number | null>>;
  setFlyingTiles: Dispatch<SetStateAction<FlyingTile[]>>;
  setBoneyardDisplayCount: Dispatch<SetStateAction<number | null>>;
  setDrawPulseIndex: Dispatch<SetStateAction<number | null>>;
  playDrawSound: (muted: boolean) => void;
  clearPendingGameplayUiOnAuthoritativeState: (nextState: GameState | null) => void;
  setError: Dispatch<SetStateAction<string>>;
  drawSequenceActiveRef: MutableRefObject<boolean>;
  drawSequenceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  boneyardRef: MutableRefObject<HTMLDivElement | null>;
  handAreaRef: MutableRefObject<HTMLDivElement | null>;
  opponentPillRef: MutableRefObject<HTMLButtonElement | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  flyingTileIdRef: MutableRefObject<number>;
  pendingForcedHandRevealRef: MutableRefObject<{
    sequence: number;
    fullHand: import('../../types').Tile[];
  } | null>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setRecentAutoPasses: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
};

export function useRoomSocketSyncParams(
  input: BuildRoomSocketSyncParamsInput,
): UseRoomSocketSyncParams {
  const {
    socket,
    showToast,
    normalizeRoomPlayers,
    applyRoomEventMeta,
    setFriendInvite,
    maxSequenceRef,
    setPlayers,
    roomPlayersRef,
    fetchGameState,
    resyncInFlightRef,
    resyncBufferedUpdateRef,
    resyncFlushRef,
    resetClientGameSession,
    rematchAwaitingStateRef,
    sessionRefsRuntime,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setLegalMoves,
    setCanDraw,
    setOpponentDisconnected,
    setOpponentDisconnectMessage,
    setPreGameDraw,
    setDrawSequenceActiveBoth,
    setDrawStepMyHand,
    setDrawStepActorId,
    setDrawStepOpponentHandCount,
    setFlyingTiles,
    setBoneyardDisplayCount,
    setDrawPulseIndex,
    playDrawSound,
    clearPendingGameplayUiOnAuthoritativeState,
    setError,
    drawSequenceActiveRef,
    drawSequenceTimeoutRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    youRef,
    stateRef,
    flyingTileIdRef,
    pendingForcedHandRevealRef,
    setState,
    setRecentAutoPasses,
    setOpponentDragging,
  } = input;

  return useMemo(
    (): UseRoomSocketSyncParams => ({
      socket,
      syncRuntime: {
        roomRuntime: {
          maxSequenceRef,
        },
        recoveryRuntime: {
          resyncInFlightRef,
          resyncBufferedUpdateRef,
          resyncFlushRef,
          rematchAwaitingStateRef,
          fetchGameState,
          resetClientGameSession,
        },
        sessionRefsRuntime,
      },
      syncUi: {
        showToast,
        normalizeRoomPlayers,
        applyRoomEventMeta,
        setFriendInvite,
        setRoomRecoveryState,
        setRoomRecoveryMessage,
        setLegalMoves,
        setCanDraw,
        setOpponentDisconnected,
        setOpponentDisconnectMessage,
        setPreGameDraw,
        setDrawSequenceActiveBoth,
        setDrawStepMyHand,
        setDrawStepActorId,
        setDrawStepOpponentHandCount,
        setFlyingTiles,
        setBoneyardDisplayCount,
        setDrawPulseIndex,
        playDrawSound,
        tileEquals,
        onAuthoritativeGameplayStateApplied: clearPendingGameplayUiOnAuthoritativeState,
        setError,
        setRecentAutoPasses,
        setOpponentDragging,
      },
      syncDom: {
        drawSequenceActiveRef,
        drawSequenceTimeoutRef,
        boneyardRef,
        handAreaRef,
        opponentPillRef,
        youRef,
        stateRef,
        flyingTileIdRef,
        pendingForcedHandRevealRef,
      },
      setState,
      setPlayers,
      roomPlayersRef,
    }),
    [
      socket,
      showToast,
      normalizeRoomPlayers,
      applyRoomEventMeta,
      setFriendInvite,
      maxSequenceRef,
      setPlayers,
      roomPlayersRef,
      fetchGameState,
      resyncInFlightRef,
      resyncBufferedUpdateRef,
      resyncFlushRef,
      resetClientGameSession,
      sessionRefsRuntime,
      clearPendingGameplayUiOnAuthoritativeState,
      setDrawSequenceActiveBoth,
      playDrawSound,
      setError,
      rematchAwaitingStateRef,
      setRoomRecoveryState,
      setRoomRecoveryMessage,
      setLegalMoves,
      setCanDraw,
      setOpponentDisconnected,
      setOpponentDisconnectMessage,
      setPreGameDraw,
      setDrawStepMyHand,
      setDrawStepActorId,
      setDrawStepOpponentHandCount,
      setFlyingTiles,
      setBoneyardDisplayCount,
      setDrawPulseIndex,
      drawSequenceActiveRef,
      drawSequenceTimeoutRef,
      boneyardRef,
      handAreaRef,
      opponentPillRef,
      youRef,
      stateRef,
      flyingTileIdRef,
      pendingForcedHandRevealRef,
      setState,
      setRecentAutoPasses,
      setOpponentDragging,
    ],
  );
}