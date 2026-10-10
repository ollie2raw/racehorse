import type { MatchReadyEvent } from './types';

/** Payload fields every tournament-level push may carry (Phase 3B). */
export type TournamentPushPayload = {
  tournamentId: string;
  kind?: 'live' | 'fritz_cup';
  serverNow?: string;
};

/** Hub lifecycle delegates — owned by useTournament, invoked by the registrar only. */
export type TournamentHubSocketDelegates = {
  onRegistrationOpen: (payload: TournamentPushPayload) => void;
  onRegistrationUpdated: (payload: TournamentPushPayload) => void;
  onBracketGenerated: (payload: TournamentPushPayload) => void;
  onMatchUpdated: (payload: TournamentPushPayload & { matchId?: string }) => void;
  onMatchReady: (payload: MatchReadyEvent) => void;
  onMatchCompleted: (payload: {
    tournamentId: string;
    matchId: string;
    roomCode?: string | null;
    round?: number;
  }) => void;
  onRoundCompleted: (payload: TournamentPushPayload & { round?: number }) => void;
  onTournamentCompleted: (payload: TournamentPushPayload & { winnerId?: string }) => void;
  onTournamentCancelled: (payload: TournamentPushPayload & { status?: 'cancelled' }) => void;
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