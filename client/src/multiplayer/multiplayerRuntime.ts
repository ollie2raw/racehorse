import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import type { GameState, Move, Tile } from '../types';
import type { AppMode } from '../types';

type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

export type StateUpdatePayload = {
  you?: string;
  state?: GameState | null;
  legalMoves?: Move[];
  canDraw?: boolean;
  eventMeta?: RoomEventMeta | null;
  /** Authoritative lobby flag from server — do not infer from local state shape. */
  matchStarted?: boolean;
  /** Set with `state` when the server aggregated a forced-draw chain after a PLAY. */
  forcedDrawCount?: number;
  forcedDrawActorId?: string;
  /** Server auto-passed players (socket ids) this frame — show a brief notice. */
  recentAutoPasses?: string[];
};

export type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

export type RoomIdentity = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

export type RoomPlayer = { id: string; username: string; userId: string | null };

/** Socket instance refs shared across multiplayer/tournament hooks. */
export type MultiplayerSocketRuntime = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
};

/** Joined room identity, sequence tracking, and lobby refs. */
export type MultiplayerRoomRuntime = {
  joinedRoomRef: MutableRefObject<string | null>;
  joinedRoomResponseRef: MutableRefObject<unknown>;
  roomIdentityRef: MutableRefObject<RoomIdentity | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
};

/** Reconnect/backoff and auto-rejoin guard refs. */
export type MultiplayerReconnectRuntime = {
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  rejoinInFlightRef: MutableRefObject<boolean>;
};

/** In-flight guards for room create/join/invite operations. */
export type MultiplayerJoinFlightRuntime = {
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
};

/** Auth identity refs used when joining/rejoining rooms. */
export type MultiplayerAuthRuntime = {
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
};

/** App-mode navigation callbacks/refs for multiplayer flows. */
export type MultiplayerNavigationRuntime = {
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
};

/** Room recovery, resync, and join-response callback refs. */
export type MultiplayerRecoveryRuntime = {
  applyJoinedRoomResponseRef: MutableRefObject<(resp: unknown) => void>;
  clearRecoverableRoomStateRef: MutableRefObject<() => void>;
  resetMultiplayerRoomStateRef: MutableRefObject<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
};

/** Live-match session refs used by room sync and connection hooks. */
export type MultiplayerSessionRefsRuntime = {
  isSeatedPlayerRef: MutableRefObject<boolean>;
  matchStartedRef: MutableRefObject<boolean>;
  playerReadyEmittedRef: MutableRefObject<boolean>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  isMutedRef: MutableRefObject<boolean>;
};

/** Gameplay UI refs owned by the live match session. */
export type MultiplayerGameplayRefsRuntime = {
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

/** Tournament attach/recovery refs that bridge tournament and multiplayer runtimes. */
export type TournamentAttachRuntime = {
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: Pick<MultiplayerRoomRuntime, 'joinedRoomRef' | 'joinedRoomResponseRef'>;
  reconnectRuntime: Pick<
    MultiplayerReconnectRuntime,
    'preventAutoRejoinRef' | 'reconnectShouldJoinRef' | 'reconnectRoomCodeRef'
  >;
  recoveryRuntime: Pick<
    MultiplayerRecoveryRuntime,
    | 'applyJoinedRoomResponseRef'
    | 'clearRecoverableRoomStateRef'
    | 'resetMultiplayerRoomStateRef'
  >;
  navigationRuntime: MultiplayerNavigationRuntime;
};

export type MultiplayerRecoveryCallbacks = {
  applyJoinedRoomResponse: (resp: unknown) => void;
  fetchGameState: (reason: string) => Promise<boolean>;
  resetClientGameSession: () => void;
  clearReconnectAttemptTimer: () => void;
  clearTransientRoomUi: () => void;
};

export type MultiplayerRoomRecoverySetters = {
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
};

export type FriendInviteState = {
  inviteId: string;
  fromUsername: string;
  fromUserId: string | null;
  roomCode: string;
  inviteUrl: string;
  matchSummary: string;
} | null;

export type MultiplayerRoomActionsTransport = {
  normalizeRoomCode: (value: unknown) => string;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  emitWithAck: <TResp>(
    socket: { emit: (...args: any[]) => void },
    event: string,
    ...argsWithoutAck: any[]
  ) => Promise<TResp>;
  emitCreateRoom: (targetSocket: Socket) => Promise<unknown>;
  getInviteLink: (code: string) => string;
  resolvePendingCreate: (code: string | null) => void;
  lastRoomStorageKey: string;
};

export type MultiplayerRoomActionsAuth = {
  authUsername: string;
  authUserId: string | null;
  authToken: string | null;
  authUsernameRef: MutableRefObject<string>;
  authUserIdRef: MutableRefObject<string | null>;
  authTokenRef: MutableRefObject<string | null>;
};

export type MultiplayerRoomActionsUi = {
  showToast: (message: string, duration?: number) => void;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setMpSubView: Dispatch<SetStateAction<'quick' | 'private'>>;
  setOutboundChallenge: Dispatch<SetStateAction<import('./friendChallenge').OutboundChallenge | null>>;
};

/** Ref bridge so App-level connection handlers can append/clear lobby-owned room reactions. */
export type MultiplayerRoomSocialRuntime = {
  appendRoomReactionRef: MutableRefObject<(item: RoomChatEvent | RoomEmoteEvent) => void>;
  clearRoomReactionsRef: MutableRefObject<() => void>;
};

export type MultiplayerConnectionUiSetters = {
  setSocket: Dispatch<SetStateAction<Socket | null>>;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsRecoveringConnection: Dispatch<SetStateAction<boolean>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setYou: Dispatch<SetStateAction<string>>;
  setServerWaking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  setJoinedRoom: Dispatch<SetStateAction<string | null>>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setTournamentId: Dispatch<SetStateAction<string | null>>;
  setTournamentState: Dispatch<SetStateAction<unknown>>;
  setTournamentActiveRoom: Dispatch<SetStateAction<string | null>>;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setHandReveal: Dispatch<
    SetStateAction<{
      handNumber: number;
      opponentRemainingTiles: Tile[];
      yourRemainingTiles: Tile[];
      pointsAwarded: { you: number; opponent: number };
      whoWentOut?: string | null;
      winnerId?: string | null;
      handWinnerId?: string | null;
    } | null>
  >;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
};

export type MultiplayerConnectionConfig = {
  emitWithAck: MultiplayerRoomActionsTransport['emitWithAck'];
  normalizeRoomCode: (value: unknown) => string;
  lastRoomStorageKey: string;
  serverUrl: string;
  showToast: (message: string, duration?: number) => void;
  emitCreateRoom: (targetSocket: Socket) => Promise<unknown>;
};

export type MultiplayerConnectionState = {
  socket: Socket | null;
  isConnecting: boolean;
  isConnected: boolean;
  roomRecoveryState: RoomRecoveryState;
  appMode: AppMode;
  authUserId?: string | null;
  authEmail?: string | null;
  authProfileUsername?: string | null;
  tournamentId: string | null;
  tournamentStateStatus?: string | null;
  roomCode: string;
};

export type MultiplayerRecoveryCallbacksRuntime = MultiplayerRecoveryCallbacks &
  Pick<MultiplayerRecoveryRuntime, 'rematchAwaitingStateRef'>;

export type MultiplayerLiveMatchRoomRuntime = Pick<
  MultiplayerRoomRuntime,
  'joinedRoomRef' | 'maxSequenceRef' | 'roomPlayersRef'
>;

export type MultiplayerLiveMatchRecoveryRuntime = Pick<
  MultiplayerRecoveryRuntime,
  'resyncInFlightRef' | 'resyncBufferedUpdateRef' | 'resyncFlushRef'
> &
  Pick<MultiplayerRecoveryCallbacks, 'fetchGameState' | 'resetClientGameSession'>;

export type MultiplayerRoomSyncRuntime = {
  roomRuntime: Pick<MultiplayerRoomRuntime, 'joinedRoomRef' | 'maxSequenceRef'>;
  recoveryRuntime: Pick<
    MultiplayerRecoveryRuntime,
    | 'resyncInFlightRef'
    | 'resyncBufferedUpdateRef'
    | 'resyncFlushRef'
    | 'rematchAwaitingStateRef'
  > &
    Pick<MultiplayerRecoveryCallbacks, 'fetchGameState' | 'resetClientGameSession'>;
  sessionRefsRuntime: MultiplayerSessionRefsRuntime;
};

export type MultiplayerRoomSyncUiRuntime = {
  showToast: (message: string, duration?: number) => void;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: {
    matchId?: string;
    lastEventSequence?: number;
    eventCount?: number;
  } | null) => void;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setOptimisticPlayedTile: Dispatch<SetStateAction<Tile | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnected: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnectMessage: Dispatch<SetStateAction<string>>;
  setDrawSequenceActiveBoth: (value: boolean) => void;
  setDrawStepMyHand: Dispatch<SetStateAction<Tile[] | null>>;
  setDrawStepActorId: Dispatch<SetStateAction<string | null>>;
  setDrawStepOpponentHandCount: Dispatch<SetStateAction<number | null>>;
  setFlyingTiles: Dispatch<
    SetStateAction<{ x: number; y: number; toX: number; toY: number; id: number }[]>
  >;
  setBoneyardDisplayCount: Dispatch<SetStateAction<number | null>>;
  setDrawPulseIndex: Dispatch<SetStateAction<number | null>>;
  playDrawSound: (muted: boolean) => void;
  tileEquals: (a: Tile, b: Tile) => boolean;
  onAuthoritativeGameplayStateApplied?: (nextState: GameState | null) => void;
};

export type MultiplayerRoomSyncDomRuntime = {
  drawSequenceActiveRef: MutableRefObject<boolean>;
  drawSequenceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  flyingTileIdRef: MutableRefObject<number>;
  pendingForcedHandRevealRef: MutableRefObject<{ sequence: number; fullHand: Tile[] } | null>;
};

/** Live connection surface for MultiplayerModeController — reuses hook connectionState + config. */
export type MultiplayerControllerConnectionBundle = {
  connectionState: MultiplayerConnectionState;
  config: Pick<MultiplayerConnectionConfig, 'serverUrl'>;
  connect: () => void;
  retryRoomRecovery: () => void;
  isRecoveringConnection: boolean;
  serverWaking: boolean;
  roomRecoveryMessage: string;
  setAppMode: MultiplayerNavigationRuntime['setAppMode'];
};

/** Lobby callbacks from useMultiplayerRoomActions (not the full hook transport/auth bundles). */
export type MultiplayerControllerLobbyActions = {
  createRoom: () => void;
  joinRoom: () => void;
  leavePrivateLobbyRoom: () => void;
  startGame: () => void;
  copyInviteLink: () => Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }>;
  copyRoomCodeToClipboard: () => void;
};

/** Live lobby snapshot for MultiplayerModeController render (roomCode lives on connectionState). */
export type MultiplayerControllerLobbySnapshot = {
  joinedRoom: string | null;
  you: string;
  players: RoomPlayer[];
  isRoomHost: boolean;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  privateLobbyHostWinStreak: number | null;
  outboundChallenge: import('./friendChallenge').OutboundChallenge | null;
};
