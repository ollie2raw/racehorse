import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, PlacementPosition, Tile } from '../../types';
import type { PreGameDrawState } from '../preGameDraw/preGameDrawLogic';
import type { MoveEntry } from '../../analyzer/moveLogger';
import type { RoomAckResponse } from '../../multiplayer/roomTransport';
import { useRoomSocketSync, type StateUpdatePayload } from '../../multiplayer/useRoomSocketSync';
import type {
  FriendInviteState,
  MultiplayerLiveMatchRecoveryRuntime,
  MultiplayerLiveMatchRoomRuntime,
  MultiplayerRoomRecoverySetters,
  MultiplayerSessionRefsRuntime,
  RoomPlayer,
  RoomRecoveryState,
} from '../../multiplayer/multiplayerRuntime';

export type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

/** Matches `useMultiplayerConnection` hand:ended payload shape. */
export type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

export type UseLiveMatchSessionParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  isConnected: boolean;
  showToast: (message: string, duration?: number) => void;
  setError: Dispatch<SetStateAction<string>>;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  rejoinInFlightRef: MutableRefObject<boolean>;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  roomRuntime: MultiplayerLiveMatchRoomRuntime;
  recoveryRuntime: MultiplayerLiveMatchRecoveryRuntime;
  recoverySetters: MultiplayerRoomRecoverySetters;
  sessionRefsRuntime: MultiplayerSessionRefsRuntime;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  playDrawSound: (muted: boolean) => void;
  onGameStart: () => void;
  appendMultiplayerMove: (entry: Omit<MoveEntry, 'moveNumber'>) => void;
};

export type LiveMatchSessionApi = {
  state: GameState | null;
  setState: Dispatch<SetStateAction<GameState | null>>;
  legalMoves: Move[];
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  canDraw: boolean;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  selectedTile: Tile | null;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  actionError: string;
  setActionError: Dispatch<SetStateAction<string>>;
  handReveal: HandEndedPayload | null;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  rematchRequested: boolean;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  rematchReadyIds: string[];
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  drawStepMyHand: Tile[] | null;
  setDrawStepMyHand: Dispatch<SetStateAction<Tile[] | null>>;
  drawStepActorId: string | null;
  setDrawStepActorId: Dispatch<SetStateAction<string | null>>;
  drawStepOpponentHandCount: number | null;
  setDrawStepOpponentHandCount: Dispatch<SetStateAction<number | null>>;
  flyingTiles: FlyingTile[];
  setFlyingTiles: Dispatch<SetStateAction<FlyingTile[]>>;
  drawSequenceActive: boolean;
  opponentDragging: boolean;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  opponentDisconnected: boolean;
  setOpponentDisconnected: Dispatch<SetStateAction<boolean>>;
  opponentDisconnectMessage: string;
  setOpponentDisconnectMessage: Dispatch<SetStateAction<string>>;
  preGameDraw: PreGameDrawState | null;
  onPregameTileTap: (tileId: string) => void;
  lastPlayedTile: Tile | null;
  boneyardDisplayCount: number | null;
  setBoneyardDisplayCount: Dispatch<SetStateAction<number | null>>;
  drawPulseIndex: number | null;
  setDrawPulseIndex: Dispatch<SetStateAction<number | null>>;
  handRevealAutoProgress: number;
  inGame: boolean;
  isMyTurn: boolean;
  myHand: Tile[];
  opponentTileCount: number;
  boneyardCount: number;
  hasPlayMoves: boolean;
  canDrawNow: boolean;
  canPass: boolean;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  selectedTileHasLegalPlay: boolean;
  boardSelectedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  handSelectedTile: Tile | null;
  stateRef: MutableRefObject<GameState | null>;
  legalMovesRef: MutableRefObject<Move[]>;
  selectedTileRef: MutableRefObject<Tile | null>;
  pendingActionRef: MutableRefObject<boolean>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  draggingStateRef: MutableRefObject<boolean>;
  drawSequenceActiveRef: MutableRefObject<boolean>;
  drawSequenceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  mpAutoDrawSuppressUntilSequenceRef: MutableRefObject<number | null>;
  autoTurnActionKeyRef: MutableRefObject<string>;
  frozenHandOverBoardRef: MutableRefObject<{
    handNumber: number;
    board: NonNullable<GameState['board']>;
  } | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  pendingForcedHandRevealRef: MutableRefObject<{ sequence: number; fullHand: Tile[] } | null>;
  flyingTileIdRef: MutableRefObject<number>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  continueAfterHandRevealRef: MutableRefObject<() => void>;
  handReadyRecoveryRef: MutableRefObject<boolean>;
  lastPlayedTileTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  youRef: MutableRefObject<string>;
  clearTransientRoomUi: () => void;
  clearPendingGameplayUiOnAuthoritativeState: (nextState: GameState | null) => void;
  play: (position: PlacementPosition) => Promise<void>;
  draw: () => Promise<void>;
  pass: () => Promise<void>;
  startGame: () => Promise<void>;
  requestRematch: () => void;
  continueAfterHandReveal: () => void;
  emitDraggingState: (dragging: boolean) => void;
  isGameplayActionBlocked: () => boolean;
  handleTileTap: (tile: Tile) => void;
  setDrawSequenceActiveBoth: (value: boolean) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  applyJoinResponseGameState: (resp: RoomAckResponse) => {
    ok: boolean;
    nextState: GameState | null;
  };
  roomSocketSyncParams: Parameters<typeof useRoomSocketSync>[0];
};

export type FlatLiveMatchSessionParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  isConnected: boolean;
  showToast: (message: string, duration?: number) => void;
  setError: Dispatch<SetStateAction<string>>;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  rejoinInFlightRef: MutableRefObject<boolean>;
  fetchGameState: (reason: string) => Promise<boolean>;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  joinedRoomRef: MutableRefObject<string | null>;
  maxSequenceRef: MutableRefObject<number>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  isSeatedPlayerRef: MutableRefObject<boolean>;
  matchStartedRef: MutableRefObject<boolean>;
  playerReadyEmittedRef: MutableRefObject<boolean>;
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  isMutedRef: MutableRefObject<boolean>;
  playDrawSound: (muted: boolean) => void;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  resetClientGameSession: () => void;
  onGameStart: () => void;
  appendMultiplayerMove: (entry: Omit<MoveEntry, 'moveNumber'>) => void;
};

export function flattenLiveMatchSessionParams(params: UseLiveMatchSessionParams): FlatLiveMatchSessionParams {
  return {
    socket: params.socket,
    joinedRoom: params.joinedRoom,
    you: params.you,
    isConnected: params.isConnected,
    showToast: params.showToast,
    setError: params.setError,
    roomRecoveryState: params.roomRecoveryState,
    isRecoveringConnection: params.isRecoveringConnection,
    rejoinInFlightRef: params.rejoinInFlightRef,
    fetchGameState: params.recoveryRuntime.fetchGameState,
    normalizeRoomPlayers: params.normalizeRoomPlayers,
    applyRoomEventMeta: params.applyRoomEventMeta,
    setFriendInvite: params.setFriendInvite,
    ...params.roomRuntime,
    setPlayers: params.setPlayers,
    ...params.recoverySetters,
    ...params.sessionRefsRuntime,
    playDrawSound: params.playDrawSound,
    resyncInFlightRef: params.recoveryRuntime.resyncInFlightRef,
    resyncBufferedUpdateRef: params.recoveryRuntime.resyncBufferedUpdateRef,
    resyncFlushRef: params.recoveryRuntime.resyncFlushRef,
    resetClientGameSession: params.recoveryRuntime.resetClientGameSession,
    onGameStart: params.onGameStart,
    appendMultiplayerMove: params.appendMultiplayerMove,
  };
}
