import {
  queryLatestPersistedRoomMatchLogByRoomCode,
  queryRecentPersistedRoomMatchLogsByRoomCode,
  type PersistedRoomMatchLogRow,
} from './roomMatchLogPersistence';
import { archiveBelongsToMatch } from '../scheduledTournament/archiveIdentity';
import { fetchMatchById, fetchMatchByRoomCode } from '../scheduledTournament/persistence';
import { isTournamentRoomCode } from '../scheduledTournament/tournamentRoomCode';
import type { MatchRow } from '../scheduledTournament/types';

export type MatchTerminalJoinPayload = {
  status: 'completed' | 'abandoned';
  matchId: string;
  recoverable: true;
};

export class MatchTerminalJoinError extends Error {
  readonly code = 'match_terminal' as const;

  readonly terminal: MatchTerminalJoinPayload;

  constructor(terminal: MatchTerminalJoinPayload) {
    super('match_terminal');
    this.name = 'MatchTerminalJoinError';
    this.terminal = terminal;
  }
}

const TERMINAL_HYDRATION_ERRORS = new Set(['snapshot_terminal', 'snapshot_terminal_state']);

export function isTerminalHydrationError(error: string | undefined): boolean {
  return typeof error === 'string' && TERMINAL_HYDRATION_ERRORS.has(error);
}

function toTerminalPayload(row: PersistedRoomMatchLogRow): MatchTerminalJoinPayload {
  return {
    status: row.status,
    matchId: row.match_id,
    recoverable: true,
  };
}

export type ArchivedTerminalJoinOptions = {
  /** The tournament match being joined, when the caller knows it. */
  tournamentMatchId?: string;
};

type ArchivedTerminalJoinDeps = {
  fetchMatchById?: (id: string) => Promise<MatchRow | null>;
  fetchMatchByRoomCode?: (code: string) => Promise<MatchRow | null>;
};

/** How many archives under one room code are considered for a tournament match. */
const TOURNAMENT_ARCHIVE_CANDIDATES = 5;

/**
 * The archived terminal state to report for a join to `roomCode`, or null.
 *
 * Ordinary rooms: the newest archive for the code, as before. Tournament
 * rooms (a known tournament match, or a tournament-shaped code with a match
 * row): only an archive of that match (archiveBelongsToMatch: the exact match
 * id when recorded, the legacy identity otherwise) — never another match's
 * archive that merely shares the room code, however new. Null when none.
 */
export async function resolveArchivedTerminalJoin(
  roomCode: string,
  options: ArchivedTerminalJoinOptions = {},
  deps: ArchivedTerminalJoinDeps = {},
): Promise<MatchTerminalJoinError | null> {
  let match: MatchRow | null = null;
  if (options.tournamentMatchId) {
    match = await (deps.fetchMatchById ?? fetchMatchById)(options.tournamentMatchId);
  } else if (isTournamentRoomCode(roomCode)) {
    match = await (deps.fetchMatchByRoomCode ?? fetchMatchByRoomCode)(roomCode.trim().toUpperCase());
  }
  if (match) {
    const archives = await queryRecentPersistedRoomMatchLogsByRoomCode(roomCode, TOURNAMENT_ARCHIVE_CANDIDATES);
    const own = archives.find((archived) => archiveBelongsToMatch(archived, match!));
    return own ? new MatchTerminalJoinError(toTerminalPayload(own)) : null;
  }
  const archived = await queryLatestPersistedRoomMatchLogByRoomCode(roomCode);
  if (!archived) return null;
  return new MatchTerminalJoinError(toTerminalPayload(archived));
}

export async function throwArchivedTerminalJoinOrError(
  roomCode: string,
  fallbackError: string,
  options: ArchivedTerminalJoinOptions = {},
): Promise<void> {
  const terminal = await resolveArchivedTerminalJoin(roomCode, options);
  if (terminal) throw terminal;
  throw new Error(fallbackError);
}
