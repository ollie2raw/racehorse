import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { RoomRecoveryState, StateUpdatePayload } from '../protocol';
import type { RoomAckResponse } from '../roomTransport';

/** Room recovery, resync, and join-response callback refs. */
export type MultiplayerRecoveryRuntime = {
  applyJoinedRoomResponseRef: MutableRefObject<(resp: RoomAckResponse) => void>;
  clearRecoverableRoomStateRef: MutableRefObject<() => void>;
  resetMultiplayerRoomStateRef: MutableRefObject<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
};

export type MultiplayerRecoveryCallbacks = {
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  fetchGameState: (reason: string) => Promise<boolean>;
  resetClientGameSession: () => void;
  clearReconnectAttemptTimer: () => void;
  clearTransientRoomUi: () => void;
};

export type MultiplayerRoomRecoverySetters = {
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
};

export type MultiplayerRecoveryCallbacksRuntime = MultiplayerRecoveryCallbacks &
  Pick<MultiplayerRecoveryRuntime, 'rematchAwaitingStateRef' | 'resyncInFlightRef'>;

export type MultiplayerLiveMatchRecoveryRuntime = Pick<
  MultiplayerRecoveryRuntime,
  'resyncInFlightRef' | 'resyncBufferedUpdateRef' | 'resyncFlushRef'
> &
  Pick<MultiplayerRecoveryCallbacks, 'fetchGameState' | 'resetClientGameSession'>;