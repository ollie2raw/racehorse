import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { GameState, Move, Tile } from '../../types';
import type { PreGameDrawState } from '../../match/preGameDraw/preGameDrawLogic';
import type { RoomEventMeta, RoomPlayer, RoomRecoveryState } from '../protocol';
import type { FriendInviteState } from './friendInviteRuntime';
import type { MultiplayerRoomRuntime } from './roomRuntime';
import type { MultiplayerRecoveryCallbacks, MultiplayerRecoveryRuntime } from './recoveryRuntime';
/** Mirrors multiplayer/session/sessionTypes.ts — duplicated to keep runtime layer isolated. */
export type MultiplayerSessionPhase =
  | 'idle'
  | 'connected'
  | 'in_lobby'
  | 'match_starting'
  | 'in_match'
  | 'match_ended'
  | 'leaving';

export type MultiplayerSessionSnapshotRef = MutableRefObject<{
  phase: MultiplayerSessionPhase;
  context: {
    roomCode: string | null;
    youId: string;
    seated: boolean;
    playerReadyEmitted: boolean;
    intentionalDisconnect: boolean;
  };
}>;

export type MultiplayerSessionDispatchEvent = { type: string } & Record<string, unknown>;

export type MultiplayerSessionDispatch = (event: MultiplayerSessionDispatchEvent) => void;

/** Live-match session runtime used by room sync and connection hooks. */
export type MultiplayerSessionRefsRuntime = {
  sessionRef: MultiplayerSessionSnapshotRef;
  dispatchSession: MultiplayerSessionDispatch;
} & {
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  isMutedRef: MutableRefObject<boolean>;
};

/** Gameplay UI refs owned by the live match session. */
export type MultiplayerGameplayRefsRuntime = {
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

export type MultiplayerRoomSyncRuntime = {
  roomRuntime: Pick<MultiplayerRoomRuntime, 'maxSequenceRef'>;
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
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: Dispatch<SetStateAction<FriendInviteState>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnected: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnectMessage: Dispatch<SetStateAction<string>>;
  setPreGameDraw: Dispatch<SetStateAction<PreGameDrawState | null>>;
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
  setError: Dispatch<SetStateAction<string>>;
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