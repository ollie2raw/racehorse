import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import type { StateUpdatePayload } from './useRoomSocketSync';
import type { FriendInviteState, RoomPlayer, RoomRecoveryState } from './multiplayerRuntime';

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

/** Imperative bridge App connection/lobby code uses without re-rendering App on state:update. */
export type MultiplayerGameShellBridge = {
  stateRef: MutableRefObject<GameState | null>;
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setActionError: Dispatch<SetStateAction<string>>;
  clearTransientRoomUi: () => void;
  applyJoinResponseGameState: (resp: {
    state?: GameState | null;
    matchStarted?: boolean;
    you?: string;
  }) => { ok: boolean; nextState: GameState | null };
  resetShellClientGameSession: () => void;
  inGame: boolean;
};

export type MultiplayerGameShellConnectionRecovery = {
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  roomRecoveryMessage: string;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
};

type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

export type MultiplayerGameShellProps = {
  socket: Socket | null;
  joinedRoom: string;
  you: string;
  players: RoomPlayer[];
  isConnected: boolean;
  showToast: (message: string, duration?: number) => void;
  connectionRecovery: MultiplayerGameShellConnectionRecovery;
  setError: Dispatch<SetStateAction<string>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  isMuted: boolean;
  isMutedRef: MutableRefObject<boolean>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  authUser: { id: string; email?: string | null } | null;
  authProfile: { username?: string | null; glicko_rating?: number | null } | null;
  refreshAuthProfile: () => Promise<void>;
  authProfileRef: MutableRefObject<{ glicko_rating?: number | null } | null>;
  supabaseEnabled: boolean;
  tournamentMatch: {
    isTournament?: boolean;
    opponentUserId?: string | null;
    opponentUsername?: string | null;
    round?: number;
  } | null;
  tournamentOpponentLabel: string | null;
  rejoinInFlightRef: MutableRefObject<boolean>;
  joinedRoomRef: MutableRefObject<string | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  fetchGameState: (reason: string) => Promise<boolean>;
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  shellBridgeRef: MutableRefObject<MultiplayerGameShellBridge | null>;
  sharedGameplayRefs: {
    stateRef: MutableRefObject<import('../types').GameState | null>;
    draggingStateRef: MutableRefObject<boolean>;
    handRevealShownRef: MutableRefObject<number | null>;
    handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
};
