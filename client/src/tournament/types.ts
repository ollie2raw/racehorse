// Mirrors of server/src/scheduledTournament/types.ts (client subset, renamed for readability).

export type ScheduledTournamentStatus =
  | 'upcoming'
  | 'registration_open'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** 'live': a scheduled communal Live Event. 'fritz_cup': one player's on-demand cup against Fritz. */
export type TournamentKind = 'live' | 'fritz_cup';

/** What the server says the client may offer (on /upcoming and /my). */
export type TournamentFeatures = { tournaments: boolean; fritzCup: boolean };

export type ScheduledTournament = {
  id: string;
  /** Absent only from a pre-M1 server; treat as 'live'. */
  kind?: TournamentKind;
  scheduled_start: string;
  registration_open_at: string;
  registration_close_at: string;
  status: ScheduledTournamentStatus;
  format: string;
  win_target: number;
  max_players: number;
  winner_id: string | null;
  created_at: string;
  registered_count?: number | null;
  cancel_reason?: string | null;
};

export type RegistrationStatus =
  | 'registered'
  | 'withdrawn'
  | 'eliminated'
  | 'active'
  | 'winner';

export type Registration = {
  id: string;
  tournament_id: string;
  user_id: string;
  registered_at: string;
  seed: number | null;
  placement: number | null;
  status: RegistrationStatus;
  username?: string | null;
  rating?: number | null;
};

export type MatchStatus =
  | 'waiting'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'bye';

export type TournamentMatch = {
  id: string;
  tournament_id: string;
  round: 1 | 2 | 3;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  /** Not sent by the public bracket (server publicBracket.ts): a player's room comes from their own state and socket events. */
  room_code?: string | null;
  status: MatchStatus;
  bot_tier?: 'standard' | 'elite' | 'master' | null;
  started_at: string | null;
  completed_at: string | null;
  player1_score: number | null;
  player2_score: number | null;
  /** How a completed match was decided (server, Phase 3B); null while undecided. */
  outcomeKind?: TournamentOutcomeKind | null;
};

export type BracketView = {
  tournament: ScheduledTournament;
  registrations: Registration[];
  matches: TournamentMatch[];
};

export type MatchReadyEvent = {
  tournamentId: string;
  matchId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  roomCode: string;
  matchStatus: 'ready' | 'in_progress';
  readyAt: string | null;
  readyDeadlineAt: string | null;
  opponentId: string | null;
  opponentUsername: string | null;
  /** Server time when sent (Phase 2C). */
  serverNow?: string;
};

export type TournamentUserPhase =
  | 'registered'
  | 'bracket_lobby'
  | 'match_ready'
  | 'in_match'
  | 'eliminated'
  | 'completed';

export type TournamentCountdownKind =
  | 'registration_close'
  | 'scheduled_start'
  | 'ready_deadline';

export type TournamentAssignedMatch = {
  matchId: string;
  tournamentId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  opponentId: string | null;
  opponentUsername: string | null;
  roomCode: string | null;
  matchStatus: MatchStatus;
  scheduledStart: string;
  matchStartsAt: string | null;
  readyDeadlineAt: string | null;
};

export type TournamentMeResponse = {
  registrations: Registration[];
  activeAssignedMatch: {
    matchId: string;
    tournamentId: string;
    round: 1 | 2 | 3;
    matchNumber: number;
    roomCode: string | null;
    opponentId: string | null;
    opponentUsername: string | null;
    matchStatus: 'ready' | 'in_progress';
    readyDeadlineAt: string | null;
  } | null;
  currentTournamentPhase: TournamentUserPhase | null;
  activeTournamentId: string | null;
  assignedMatch: TournamentAssignedMatch | null;
  countdown: { kind: TournamentCountdownKind; at: string } | null;
};

export type TournamentResultPlacement = {
  userId: string;
  username: string | null;
  rating: number | null;
  placement: number | null;
  placementLabel: string | null;
  seed: number | null;
  status: RegistrationStatus;
};

export type TournamentResultView = {
  tournamentId: string;
  kind?: TournamentKind;
  scheduledStart: string;
  format: string;
  winTarget: number;
  championId: string | null;
  /** The champion as clients show it ("Master Fritz" for a Fritz champion). */
  championName: string | null;
  championIsFritz?: boolean;
  championFritzTier?: 'standard' | 'elite' | 'master' | null;
  finalOutcomeKind?: TournamentOutcomeKind | null;
  placements: TournamentResultPlacement[];
};

/** One finished tournament of the player's, as /history reports it (Phase 3E). */
export type TournamentHistoryEntry = {
  tournamentId: string;
  kind?: TournamentKind;
  scheduledStart: string;
  format: string;
  winTarget: number;
  /** 1 champion, 2 runner-up, 3 semifinal exit, 5 quarterfinal exit. */
  placement: number | null;
  placementLabel: string | null;
  championId: string | null;
  championName: string | null;
  championIsFritz?: boolean;
  championFritzTier?: 'standard' | 'elite' | 'master' | null;
  /** The player's own last match (their exit, or the final they won). */
  myLastMatch?: TournamentUserMatchOutcome | null;
};

/** How a completed match was decided (server outcomeKind). */
export type TournamentOutcomeKind =
  | 'played'
  | 'forfeit'
  | 'missed_turns'
  | 'no_show'
  | 'administrative'
  | 'bye'
  | 'bot_simulated';

/** The player's own last decided match in a tournament (/my, /history). */
export type TournamentUserMatchOutcome = {
  matchId: string;
  round: 1 | 2 | 3;
  won: boolean;
  outcomeKind: TournamentOutcomeKind;
  opponentId: string | null;
  opponentBotTier: 'standard' | 'elite' | 'master' | null;
};

/** One of the player's tournaments as /my reports it. */
export type MyTournament = ScheduledTournament & {
  myRegistration: {
    status: RegistrationStatus;
    placement: number | null;
    placementLabel: string | null;
    seed: number | null;
  };
  myLastMatch: TournamentUserMatchOutcome | null;
};

/**
 * The player's playable assigned match (/my and /me). `ready` until this
 * player has joined it; `in_progress` once they have.
 */
export type TournamentAssignedPlayable = NonNullable<TournamentMeResponse['activeAssignedMatch']>;

export type TournamentMyResponse = {
  registrations: Registration[];
  tournaments: MyTournament[];
  activeAssignedMatch: TournamentAssignedPlayable | null;
  features: TournamentFeatures;
};

export type TournamentUpcomingResponse = {
  tournaments: ScheduledTournament[];
  features: TournamentFeatures;
};

export type FritzCupStartResponse = {
  existing: boolean;
  tournament: ScheduledTournament;
  activeAssignedMatch: TournamentAssignedPlayable | null;
};
