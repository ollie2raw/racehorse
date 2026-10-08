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
  generateTournamentBracket,
  updateMatch,
  updateRegistrationPlacement,
  updateTournamentStatus,
  cancelTournamentBeforeStart,
  updateMatchIf,
  openRegistrationIfDue,
  cancelTournamentIfBracketUnchanged,
  cancelTournamentIfNoEntrants,
  type MatchPatch,
  type MatchExpectation,
  type BracketSnapshotEntry,
  type CompleteTournamentMatchParams,
  type CompleteTournamentMatchResult,
  type PromoteTournamentMatchResult,
  type GenerateTournamentBracketResult,
  type BracketQfPair,
  type BracketSeed,
} from './persistence';
import { createReservedRoom, getRoom } from '../rooms';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';
import type { Config } from '../game/types';
import type { Room } from '../rooms';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

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
  /**
   * The only way a bracket is created: all 7 rows, registrations → active with
   * their bracket seed, tournament → in_progress and bye walkovers, in one
   * Postgres transaction. Idempotent, and repairs a partial pre-RPC bracket.
   */
  generateTournamentBracket(params: {
    tournamentId: string;
    qfPairs: BracketQfPair[];
    seeds: BracketSeed[];
    actor?: string;
  }): Promise<GenerateTournamentBracketResult>;
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
  updateRegistrationPlacement(
    tournamentId: string,
    userId: string,
    placement: number | null,
  ): Promise<void>;
  updateTournamentStatus(
    id: string,
    status: ScheduledTournamentRow['status'],
    extra?: Partial<Pick<ScheduledTournamentRow, 'winner_id' | 'cancel_reason'>>,
  ): Promise<void>;
  /**
   * Cancel only if the tournament is still before its start
   * (upcoming / registration_open), atomically; true when it was cancelled.
   * Production always provides it; a test double without it gets a
   * read-then-write fallback (see engine.cancelTournamentBeforeStart).
   */
  cancelTournamentBeforeStart?(id: string, reason: string): Promise<boolean>;
  /**
   * Compare-and-set match update (true when applied). Production always
   * provides it; a test double without it gets a read-compare-write fallback
   * (engine.updateMatchIfUnchanged).
   */
  updateMatchIf?(matchId: string, expected: MatchExpectation, patch: MatchPatch): Promise<boolean>;
  /** upcoming → registration_open if still upcoming and due (true when opened). */
  openRegistrationIfDue?(id: string, now: Date): Promise<boolean>;
  /** Cancel for lack of entrants, only if still nobody is registered and registration has closed (true when cancelled). */
  cancelTournamentIfNoEntrants?(id: string, reason: string): Promise<boolean>;
  /** Cancel an in-progress tournament only if its bracket is exactly `expected` (true when cancelled). */
  cancelTournamentIfBracketUnchanged?(id: string, expected: BracketSnapshotEntry[], reason: string): Promise<boolean>;
  createReservedRoom(code: string, config: Partial<Config>): Room;
  getRoom(code: string): Room;
  /**
   * The match's room when it is not in memory: restored from its live session
   * if a game is stored, otherwise created. Without it, dispatch creates an
   * empty reserved room (in-memory test persistences).
   */
  restoreOrCreateRoom?(code: string, matchId: string, config: Partial<Config>): Promise<Room>;
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
  generateTournamentBracket,
  updateMatch,
  completeTournamentMatch,
  promoteTournamentMatch,
  updateRegistrationPlacement,
  updateTournamentStatus,
  cancelTournamentBeforeStart,
  updateMatchIf,
  openRegistrationIfDue,
  cancelTournamentIfBracketUnchanged,
  cancelTournamentIfNoEntrants,
  createReservedRoom,
  getRoom,
  restoreOrCreateRoom: restoreOrCreateTournamentRoom,
};

/** Convenience: io is also a dependency, but it's stable and easy to mock per-test. */
export type EngineDeps = {
  persistence: EnginePersistence;
  io: Server;
};
