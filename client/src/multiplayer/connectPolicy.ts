import type { AppMode } from '../appRouteTypes';

export type ConnectPolicyParams = {
  appMode: AppMode;
  hasAuthUser: boolean;
  isSocketConnected: boolean;
};

/**
 * Feed mode lazily connects the socket once auth is ready.
 * Other modes manage connect elsewhere; do not auto-connect here.
 */
export function shouldAutoConnectForMode(params: ConnectPolicyParams): boolean {
  const { appMode, hasAuthUser, isSocketConnected } = params;
  return appMode === 'feed' && hasAuthUser && !isSocketConnected;
}