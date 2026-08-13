import { useState, useEffect } from 'react';
import type { AppMode } from '../appRouteTypes';
import { shouldShowPrivateMatchLobby } from './privateLobbyVisibility';

export type UsePrivateLobbyWinStreakParams = {
  appMode: AppMode;
  authUserId: string | null;
  isConnected: boolean;
  isRecoveringConnection: boolean;
  joinedRoom: string | null;
  hasLiveGameState: boolean;
};

export function usePrivateLobbyWinStreak(
  params: UsePrivateLobbyWinStreakParams,
): number | null {
  const { appMode, authUserId, isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState } =
    params;

  const [winStreak, setWinStreak] = useState<number | null>(null);

  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUserId) {
      setWinStreak(null);
      return;
    }
    if (!shouldShowPrivateMatchLobby({ isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState })) {
      setWinStreak(null);
      return;
    }
    let cancelled = false;
    void import('../stats/statsApi')
      .then(({ fetchUserStatsByUserId }) => fetchUserStatsByUserId(authUserId))
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data) { setWinStreak(null); return; }
        setWinStreak(res.data.currentWinStreak);
      });
    return () => { cancelled = true; };
  }, [appMode, authUserId, isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState]);

  return winStreak;
}
