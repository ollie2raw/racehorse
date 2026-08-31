import type { Server } from 'socket.io';
import {
  completeTournamentMatch,
  promoteTournamentMatch,
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
  type MatchPatch,
  type CompleteTournamentMatchParams,
  type CompleteTournamentMatchResult,
  type PromoteTournamentMatchResult,
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
  updateMatch(matchId: string, patch: MatchPatch): Promise<void>;
  /**
   * Atomic completion + validation + advancement + elimination + (round 3)
   * tournament completion, in one Postgres transaction. `result.applied` is
   * false for an idempotent replay or a winner conflict.
   */
  completeTournamentMatch(params: CompleteTournamentMatchParams): Promise<CompleteTournamentMatchResult>;
  /** `waiting`→`ready` or `ready`→`in_progress`, guarded by a row lock. */
  promoteTournamentMatch(
    matchId: string,
    toStatus: 'ready' | 'in_progress',
    opts?: {
      readyAt?: string;
      readyDeadlineAt?: string;
      roomCode?: string;
      startedAt?: string;
      actor?: string;
    },
  ): Promise<PromoteTournamentMatchResult>;
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
  completeTournamentMatch,
  promoteTournamentMatch,
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
