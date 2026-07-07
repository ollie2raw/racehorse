import type { MutableRefObject } from 'react';
import type { MultiplayerReconnectRuntime, MultiplayerSocketRuntime } from './connectionRuntime';
import type { TournamentAttachNavigationRuntime } from './navigationRuntime';
import type { MultiplayerRoomRuntime } from './roomRuntime';
import type { MultiplayerRecoveryRuntime } from './recoveryRuntime';

/** Opaque session ref bridge — full snapshot type lives in multiplayer/session. */
export type TournamentAttachSessionRef = MutableRefObject<{
  context: { roomCode: string | null };
}>;

/** Tournament attach/recovery refs that bridge tournament and multiplayer runtimes. */
export type TournamentAttachRuntime = {
  socketRuntime: MultiplayerSocketRuntime;
  sessionRuntime: { sessionRef: TournamentAttachSessionRef };
  roomRuntime: Pick<MultiplayerRoomRuntime, 'joinedRoomResponseRef'>;
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
  navigationRuntime: TournamentAttachNavigationRuntime;
};