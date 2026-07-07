/**
 * Phase K — single source of truth for recovery authority.
 *
 * Recovery state is driven only by:
 * - recoveryMachine snapshot
 * - episodeSequence gate (socketEventBus)
 * - socketEventBus projection gate
 *
 * Any other derived state is invalid for recovery authority.
 */

export const RECOVERY_AUTHORITY_CONTRACT =
  'recoveryMachine+episodeSequence+projectionGate' as const;

const ALLOWED_RECOVERY_TRIGGERS = new Set([
  'recoveryMachine.dispatch',
  'socketEventBus.resyncNeeded',
  'socketEventBus.transportFail',
  'socketEventBus.roomJoinTerminal',
  'joinAckCoordinator.roomJoinOk',
  'useMultiplayerConnection.resyncOk',
  'useMultiplayerConnection.resyncFail',
  'useMultiplayerConnection.executeRecoveryRoomJoin',
  'useMultiplayerConnection.socketConnected',
  'useMultiplayerConnection.userLeave',
  'useMultiplayerConnection.userRetry',
]);

/** DEV/test guard — rejects undocumented recovery trigger paths. */
export function assertNoSecondaryRecoveryTriggers(observedTriggers: string[]): void {
  for (const trigger of observedTriggers) {
    if (!ALLOWED_RECOVERY_TRIGGERS.has(trigger)) {
      throw new Error(`Secondary recovery trigger detected: ${trigger}`);
    }
  }
}