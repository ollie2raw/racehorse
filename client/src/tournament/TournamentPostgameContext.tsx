import { createContext, useContext } from 'react';
import type { MyTournament, TournamentAssignedPlayable, TournamentUserMatchOutcome } from './types';

/**
 * What the in-match post-game needs from /my (Phase 3D): how the player's
 * match was decided, and their next ready match. Joining it is a tap.
 */
export type TournamentPostgameValue = {
  myTournaments: MyTournament[];
  activeAssignedMatch: TournamentAssignedPlayable | null;
  joining: boolean;
  onJoin: (matchId: string) => void;
};

const EMPTY: TournamentPostgameValue = { myTournaments: [], activeAssignedMatch: null, joining: false, onJoin: () => undefined };

export const TournamentPostgameContext = createContext<TournamentPostgameValue>(EMPTY);

export function useTournamentPostgame(): TournamentPostgameValue {
  return useContext(TournamentPostgameContext);
}

/** The player's decided outcome for this match, once /my reports it. */
export function outcomeForMatch(
  myTournaments: MyTournament[],
  tournamentId: string,
  matchId: string,
): TournamentUserMatchOutcome | null {
  const last = myTournaments.find((t) => t.id === tournamentId)?.myLastMatch ?? null;
  return last && last.matchId === matchId ? last : null;
}

/** The player's next ready match in this tournament (never the one just played). */
export function nextReadyMatch(
  activeAssignedMatch: TournamentAssignedPlayable | null,
  tournamentId: string,
  currentMatchId: string,
): TournamentAssignedPlayable | null {
  const next = activeAssignedMatch;
  if (!next || next.tournamentId !== tournamentId || next.matchId === currentMatchId || next.matchStatus !== 'ready') return null;
  return next;
}
