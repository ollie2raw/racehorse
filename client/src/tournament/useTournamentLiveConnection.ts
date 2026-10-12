import { useEffect, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import type { MyTournament, TournamentAssignedPlayable } from './types';

/** Screens that own their socket (a game or the multiplayer lobby): left alone. */
const SOCKET_OWNING_MODES: ReadonlySet<AppMode> = new Set<AppMode>(['multiplayer', 'bot', 'ghost', 'dailyFritz', 'puzzleRush', 'noBrainer', 'guidedMatchRecorder']);

/** Let a route hand-off finish before reconnecting. */
export const TOURNAMENT_RECONNECT_DELAY_MS = 500;

/** The player has something live in a tournament (entered and not finished, or a playable match). */
export function hasLiveTournamentStake(myTournaments: MyTournament[], playable: TournamentAssignedPlayable | null): boolean {
  if (playable) return true;
  return myTournaments.some(
    (t) =>
      (t.myRegistration.status === 'registered' || t.myRegistration.status === 'active') &&
      (t.status === 'upcoming' || t.status === 'registration_open' || t.status === 'in_progress'),
  );
}

/**
 * Keeps a socket while the player has a live tournament stake (Phase 3E), so
 * match_ready / cancellation reach the app-wide banner on any screen. Leaving
 * the tournament or match screens drops the socket and the other screens do
 * not reconnect; without this, Home would hear nothing until the next /my
 * refresh. Reconnecting also refetches /my (the tournament socket handlers'
 * recover), which covers anything missed meanwhile. Game screens and the
 * multiplayer lobby manage their own socket and are left alone.
 */
export function useTournamentLiveConnection(params: {
  enabled: boolean;
  signedIn: boolean;
  myTournaments: MyTournament[];
  activeAssignedMatch: TournamentAssignedPlayable | null;
  appMode: AppMode;
  socket: Socket | null;
  isConnected: boolean;
  connectRef: MutableRefObject<() => void>;
}): void {
  const { enabled, signedIn, myTournaments, activeAssignedMatch, appMode, socket, isConnected, connectRef } = params;
  const stake = enabled && signedIn && hasLiveTournamentStake(myTournaments, activeAssignedMatch);
  useEffect(() => {
    if (!stake || SOCKET_OWNING_MODES.has(appMode)) return;
    // Read the socket itself: a socket dropped by a route hand-off can still
    // read as connected in app state (its listeners were removed first).
    const timer = setTimeout(() => {
      if (!socket?.connected) connectRef.current();
    }, TOURNAMENT_RECONNECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stake, appMode, socket, isConnected, connectRef]);
}
