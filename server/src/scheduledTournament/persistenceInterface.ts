import type { Server } from 'socket.io';
import {
  fetchTournamentsByStatus,
  fetchMatchById,
  fetchMatches,
  fetchMatchByRoomCode,
  fetchRegistrations,
  fetchRegistrationsWithProfile,
  fetchTournamentById,
  insertMatch,
  updateMatch,
  updateRegistrationPlacement,
  updateRegistrationStatus,
  updateTournamentStatus,
} from './persistence';
import { createReservedRoom, getRoom } from '../rooms';
import type { Config } from '../game/types';
import type { Room } from '../rooms';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow, MatchStatus } from './types';

/**
 * Persistence + room-infrastructure dependencies used by the tournament engine.
 *
 * Production code uses {@link defaultEnginePersistence}, which wires the real
 * Supabase REST + in-memory room registry. Tests pass an in-memory
 * implementation so the bracket lifecycle can be driven without any external
 * side effects.
 */
export interface EnginePersistence {
  fetchTournamentById(id: string): Promise<ScheduledTournamentRow | null>;
  fetchTournamentsByStatus?(statuses: ScheduledTournamentRow['status'][]): Promise<ScheduledTournamentRow[]>;
  fetchRegistrations(tournamentId: string): Promise<RegistrationRow[]>;
  fetchRegistrationsWithProfile(
    tournamentId: string,
  ): Promise<Array<RegistrationRow & { username: string | null; rating: number | null }>>;
  fetchMatches(tournamentId: string): Promise<MatchRow[]>;
  fetchMatchById(matchId: string): Promise<MatchRow | null>;
  fetchMatchByRoomCode(roomCode: string): Promise<MatchRow | null>;
  insertMatch(input: {
    tournamentId: string;
    round: 1 | 2 | 3;
    matchNumber: number;
    player1Id: string | null;
    player2Id: string | null;
    roomCode: string;
    status: MatchStatus;
    botTier?: MatchRow['bot_tier'];
  }): Promise<MatchRow>;
  updateMatch(
    matchId: string,
    patch: Partial<Pick<MatchRow,
      'status' | 'winner_id' | 'room_code' | 'ready_at' | 'ready_deadline_at' |
      'started_at' | 'completed_at' | 'player1_joined_at' | 'player2_joined_at' |
      'winner_source' | 'status_reason' | 'forfeit_user_id' | 'no_show_user_id' |
      'bot_tier' | 'player1_score' | 'player2_score' | 'player1_id' | 'player2_id'
    >>,
  ): Promise<void>;
  updateRegistrationStatus(
    tournamentId: string,
    userId: string,
    status: RegistrationRow['status'],
    seed?: number,
  ): Promise<void>;
  updateRegistrationPlacement(
    tournamentId: string,
    userId: string,
    placement: number | null,
  ): Promise<void>;
  updateTournamentStatus(
    id: string,
    status: ScheduledTournamentRow['status'],
    extra?: Partial<Pick<ScheduledTournamentRow, 'winner_id'>>,
  ): Promise<void>;
  createReservedRoom(code: string, config: Partial<Config>): Room;
  getRoom(code: string): Room;
}

/** Real Supabase + in-memory rooms implementation used in production. */
export const defaultEnginePersistence: EnginePersistence = {
  fetchTournamentById,
  fetchTournamentsByStatus,
  fetchRegistrations,
  fetchRegistrationsWithProfile,
  fetchMatches,
  fetchMatchById,
  fetchMatchByRoomCode,
  insertMatch,
  updateMatch,
  updateRegistrationStatus,
  updateRegistrationPlacement,
  updateTournamentStatus,
  createReservedRoom,
  getRoom,
};

/** Convenience: io is also a dependency, but it's stable and easy to mock per-test. */
export type EngineDeps = {
  persistence: EnginePersistence;
  io: Server;
};
