export type PrivateMatchLobbyVisibilityParams = {
  isConnected: boolean;
  isRecoveringConnection: boolean;
  joinedRoom: string | null;
  hasLiveGameState: boolean;
};

/**
 * Whether the private-match lobby is visible enough to fetch host win-streak stats.
 * Requires connection, room, and live-game signals together — not any single domain alone.
 */
export function shouldShowPrivateMatchLobby(params: PrivateMatchLobbyVisibilityParams): boolean {
  const { isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState } = params;
  return (
    (!isConnected && !isRecoveringConnection) ||
    (isConnected && !joinedRoom) ||
    (isConnected && Boolean(joinedRoom) && !hasLiveGameState)
  );
}