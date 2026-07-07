import type { MatchReadyEvent } from './types';

/** Hub lifecycle delegates — owned by useTournament, invoked by the registrar only. */
export type TournamentHubSocketDelegates = {
  onRegistrationOpen: () => void;
  onRegistrationUpdated: (payload: { tournamentId: string }) => void;
  onBracketGenerated: (payload: { tournamentId: string }) => void;
  onMatchUpdated: (payload: { tournamentId: string }) => void;
  onMatchReady: (payload: MatchReadyEvent) => void;
  onMatchCompleted: (payload: {
    tournamentId: string;
    matchId: string;
    roomCode?: string | null;
    round?: number;
  }) => void;
  onTournamentCompleted: (payload: { tournamentId: string }) => void;
  onRecover: () => void;
};

/** Live session delegates — owned by useTournamentSessionSockets. */
export type TournamentSessionSocketDelegates = {
  onTournamentCompleted: (payload: { tournamentId?: string }) => void;
  onMatchCompleted: (payload: {
    tournamentId?: string;
    matchId?: string;
    roomCode?: string | null;
    round?: number;
  }) => void;
  onMatchAbandoned: (payload: {
    roomCode?: string;
    abandonedUserId?: string | null;
    abandonedUsername?: string | null;
    message?: string;
    tournamentId?: string | null;
    isTournament?: boolean;
  }) => void;
};

export type TournamentSocketScope = {
  hub: TournamentHubSocketDelegates | null;
  session: TournamentSessionSocketDelegates | null;
};