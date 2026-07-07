import { useMultiplayerSessionState } from '../runtime/runtimeProvider';

export type { UseSessionStateResult } from './useSessionStateTypes';

/**
 * React adapter for the authoritative session lifecycle FSM.
 * Machine is owned by createMultiplayerRuntime — this hook only subscribes.
 */
export function useSessionState() {
  return useMultiplayerSessionState();
}