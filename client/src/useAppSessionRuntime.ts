import { useMultiplayerRuntime } from './multiplayer/runtime/runtimeProvider';
import { selectLegacyAppSessionRuntime } from './multiplayer/runtime/runtimeSelectors';

export type {
  MultiplayerRecoveryRuntime,
  MultiplayerRecoveryCallbacks,
  MultiplayerRoomRecoverySetters,
  MultiplayerRecoveryCallbacksRuntime,
  MultiplayerLiveMatchRecoveryRuntime,
} from './multiplayer/runtime/recoveryRuntime';

export type UseAppSessionRuntimeResult = ReturnType<typeof selectLegacyAppSessionRuntime>;

/**
 * @deprecated Runtime slices are composed once in createMultiplayerRuntime — this hook only selects.
 * Prefer useMultiplayerRuntime() + runtimeSelectors for new code.
 */
export function useAppSessionRuntime(): UseAppSessionRuntimeResult {
  return selectLegacyAppSessionRuntime(useMultiplayerRuntime());
}