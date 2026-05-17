const STORAGE_KEY = 'racehorse_terminal_tournament_matches_v1';
const TOURNAMENT_TERMINAL_KEY = 'racehorse_terminal_tournaments_v1';
const MAX_ENTRIES = 32;

export type TerminalTournamentMatchRecord = {
  matchId: string;
  tournamentId?: string;
  roomCode?: string;
  completedAt: number;
};

function readAll(): TerminalTournamentMatchRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is TerminalTournamentMatchRecord =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as TerminalTournamentMatchRecord).matchId === 'string' &&
        typeof (entry as TerminalTournamentMatchRecord).completedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeAll(entries: TerminalTournamentMatchRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = entries
      .slice()
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, MAX_ENTRIES);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* sessionStorage may be unavailable */
  }
}

export function readTerminalTournamentMatchIds(): Set<string> {
  return new Set(readAll().map((entry) => entry.matchId));
}

export function isTerminalTournamentMatch(matchId: string | null | undefined): boolean {
  const clean = matchId?.trim();
  if (!clean) return false;
  return readTerminalTournamentMatchIds().has(clean);
}

export function markTerminalTournamentMatch(record: {
  matchId: string;
  tournamentId?: string;
  roomCode?: string | null;
}): void {
  const matchId = record.matchId.trim();
  if (!matchId) return;
  const completedAt = Date.now();
  const existing = readAll().filter((entry) => entry.matchId !== matchId);
  existing.unshift({
    matchId,
    tournamentId: record.tournamentId,
    roomCode: record.roomCode?.trim() || undefined,
    completedAt,
  });
  writeAll(existing);
  if (record.tournamentId) {
    markTournamentTerminal({ tournamentId: record.tournamentId, completedAt });
  }
}

type TournamentTerminalRecord = {
  tournamentId: string;
  completedAt: number;
};

function readTournamentTerminals(): TournamentTerminalRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(TOURNAMENT_TERMINAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is TournamentTerminalRecord =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as TournamentTerminalRecord).tournamentId === 'string' &&
        typeof (entry as TournamentTerminalRecord).completedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeTournamentTerminals(entries: TournamentTerminalRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = entries
      .slice()
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, MAX_ENTRIES);
    window.sessionStorage.setItem(TOURNAMENT_TERMINAL_KEY, JSON.stringify(trimmed));
  } catch {
    /* sessionStorage may be unavailable */
  }
}

export function markTournamentTerminal(record: {
  tournamentId: string;
  completedAt?: number;
}): void {
  const tournamentId = record.tournamentId.trim();
  if (!tournamentId) return;
  const completedAt = record.completedAt ?? Date.now();
  const existing = readTournamentTerminals().filter((entry) => entry.tournamentId !== tournamentId);
  existing.unshift({ tournamentId, completedAt });
  writeTournamentTerminals(existing);
}

export function readTournamentTerminalCompletedAt(tournamentId: string | null | undefined): number | null {
  const clean = tournamentId?.trim();
  if (!clean) return null;
  const entry = readTournamentTerminals().find((row) => row.tournamentId === clean);
  return entry?.completedAt ?? null;
}

export function tournamentSubViewAfterMatchComplete(input: {
  round?: number;
  tournamentCompleted?: boolean;
}): 'bracket' | 'result' {
  if (input.tournamentCompleted || input.round === 3) return 'result';
  return 'bracket';
}
