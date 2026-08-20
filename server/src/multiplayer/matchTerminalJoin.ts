import {
  queryLatestPersistedRoomMatchLogByRoomCode,
  type PersistedRoomMatchLogRow,
} from './roomMatchLogPersistence';

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

export async function resolveArchivedTerminalJoin(
  roomCode: string,
): Promise<MatchTerminalJoinError | null> {
  const archived = await queryLatestPersistedRoomMatchLogByRoomCode(roomCode);
  if (!archived) return null;
  return new MatchTerminalJoinError(toTerminalPayload(archived));
}

export async function throwArchivedTerminalJoinOrError(
  roomCode: string,
  fallbackError: string,
): Promise<void> {
  const terminal = await resolveArchivedTerminalJoin(roomCode);
  if (terminal) throw terminal;
  throw new Error(fallbackError);
}
