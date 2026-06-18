/** Legacy in-memory tournament lobby (ENABLE_LEGACY_TOURNAMENTS socket events). */

export type LegacyTournamentPlayer = {
  socketId: string;
  username: string;
  userId?: string | null;
  isBot?: boolean;
};

export type LegacyTournamentStanding = {
  socketId: string;
  username?: string;
  wins?: number;
  pointsFor?: number;
  pointsAgainst?: number;
};

export type LegacyTournamentMatch = {
  id: string;
  status: string;
  a: string;
  b: string;
};

export type LegacyTournamentState = {
  id?: string;
  status?: string;
  lobbyCode?: string | null;
  hostSocketId?: string | null;
  hostId?: string | null;
  activeRoomCode?: string | null;
  activeMatchId?: string | null;
  players?: LegacyTournamentPlayer[];
  standings?: LegacyTournamentStanding[] | Record<string, LegacyTournamentStanding>;
  matches?: LegacyTournamentMatch[];
};

export type SocketAck<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok?: boolean;
  error?: string;
} & T;

export type LegacyTournamentCreateAck = SocketAck<{
  id?: string;
  lobbyCode?: string;
}>;

export type LegacyTournamentJoinAck = SocketAck<{
  id?: string;
  lobbyCode?: string;
}>;

export type LegacyTournamentStartAck = SocketAck<{
  error?: string;
}>;

export type TournamentLobbyUpdatePayload = {
  lobbyCode?: string;
  players?: LegacyTournamentPlayer[];
  hostSocketId?: string;
};

export type TournamentMatchAssignedPayload = {
  roomCode?: string;
  a?: string;
  b?: string;
};

export type GameRematchStatusPayload = {
  readyPlayerIds?: unknown[];
};
