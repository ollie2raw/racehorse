import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  deriveLegacyRoomRecoveryState,
  derivePreventAutoRejoin,
  deriveReconnectRoomCode,
  deriveReconnectShouldJoin,
  type RecoveryMachineSnapshot,
} from './recoveryMachine';
import type { RoomRecoveryState } from './multiplayerRuntime';

export type RecoveryLegacyRefTargets = {
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setIsRecoveringConnection: Dispatch<SetStateAction<boolean>>;
};

/** Keep legacy refs aligned with machine snapshot (shim layer for App + room actions). */
export function syncRecoveryLegacyRefs(
  snapshot: RecoveryMachineSnapshot,
  targets: RecoveryLegacyRefTargets,
): void {
  targets.reconnectShouldJoinRef.current = deriveReconnectShouldJoin(snapshot);
  targets.preventAutoRejoinRef.current = derivePreventAutoRejoin(snapshot);
  targets.reconnectRoomCodeRef.current = deriveReconnectRoomCode(snapshot);
  targets.reconnectAttemptCountRef.current = snapshot.attempt;
  targets.rejoinInFlightRef.current = snapshot.state === 'joining';
  targets.setRoomRecoveryState(deriveLegacyRoomRecoveryState(snapshot));
  targets.setRoomRecoveryMessage(snapshot.lastMessage);
  targets.setIsRecoveringConnection(
    snapshot.state === 'connecting' ||
      snapshot.state === 'joining' ||
      snapshot.state === 'resyncing',
  );
}
