import { childLogger } from '../logger';
import { supabaseFetch } from '../supabaseUtils';
import { isTournamentPastActiveWindow } from './activeWindow';
import { humanJoinedAt } from './matchDispatch';
import type {
  BracketView,
  MatchRow,
  RegistrationRow,
  ScheduledTournamentRow,
  ScheduledTournamentStatus,
  MatchStatus,
} from './types';

const log = childLogger('tournament:persistence');

/** Single source of truth for the table names — easy to rename later. */
export const TABLES = {
  tournaments: 'scheduled_tournaments',
  registrations: 'scheduled_tournament_registrations',
  matches: 'scheduled_tournament_matches',
} as const;

const UUID_V4ISH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_V4ISH_PATTERN.test(value.trim());
}

// ── Tournaments ──────────────────────────────────────────────────────────

export async function fetchUpcomingTournaments(limit = 5): Promise<ScheduledTournamentRow[]> {
  const nowIso = new Date().toISOString();
  const [preStart, bracketLobby] = await Promise.all([
    supabaseFetch<ScheduledTournamentRow[]>(
      `/rest/v1/${TABLES.tournaments}` +
        `?select=*` +
        `&scheduled_start=gte.${encodeURIComponent(nowIso)}` +
        `&status=in.(upcoming,registration_open)` +
        `&order=scheduled_start.asc` +
        `&limit=${limit}`,
    ),
    supabaseFetch<ScheduledTournamentRow[]>(
      `/rest/v1/${TABLES.tournaments}` +
        `?select=*` +
        `&scheduled_start=gte.${encodeURIComponent(nowIso)}` +
        `&status=eq.in_progress` +
        `&order=scheduled_start.asc` +
        `&limit=${limit}`,
    ),
  ]);
  const byId = new Map<string, ScheduledTournamentRow>();
  for (const row of [...preStart, ...bracketLobby]) {
    byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start))
    .slice(0, limit);
}

export async function fetchTournamentById(id: string): Promise<ScheduledTournamentRow | null> {
  const rows = await supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchTournamentsByStatus(
  statuses: ScheduledTournamentStatus[],
): Promise<ScheduledTournamentRow[]> {
  const inClause = statuses.map((s) => `"${s}"`).join(',');
  return supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}?select=*&status=in.(${inClause})&order=scheduled_start.asc&limit=200`,
  );
}

export async function updateTournamentStatus(
  id: string,
  status: ScheduledTournamentStatus,
  extra: Partial<Pick<ScheduledTournamentRow, 'winner_id'>> = {},
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.tournaments}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra }),
    },
  );
}

// ── Registrations ────────────────────────────────────────────────────────

export async function fetchRegistrations(tournamentId: string): Promise<RegistrationRow[]> {
  return supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}` +
      `?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&order=registered_at.asc`,
  );
}

export async function fetchRegistrationsWithProfile(
  tournamentId: string,
): Promise<Array<RegistrationRow & { username: string | null; rating: number | null }>> {
  // Two-query approach: registrations then a single batched profile lookup.
  // Avoids a PostgREST embed (which requires FK metadata sometimes unavailable).
  const regs = await fetchRegistrations(tournamentId);
  if (regs.length === 0) return [];
  const userIds = regs.map((r) => `"${r.user_id}"`).join(',');
  const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number | null }>>(
    `/rest/v1/profiles?select=id,username,glicko_rating&id=in.(${userIds})`,
  ).catch(() => []);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return regs.map((r) => {
    const prof = byId.get(r.user_id);
    return {
      ...r,
      username: prof?.username ?? null,
      rating: prof?.glicko_rating ?? null,
    };
  });
}

export async function fetchActiveRegistration(
  tournamentId: string,
  userId: string,
): Promise<RegistrationRow | null> {
  if (!isValidUuid(userId)) {
    return null;
  }
  const rows = await supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}` +
      `?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchRegistrationsForUser(userId: string): Promise<RegistrationRow[]> {
  if (!isValidUuid(userId)) {
    return [];
  }
  return supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}` +
      `?select=*` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&order=registered_at.desc` +
      `&limit=50`,
  );
}

export async function insertRegistration(tournamentId: string, userId: string): Promise<void> {
  if (!isValidUuid(userId)) {
    throw new Error('invalid_user');
  }
  await supabaseFetch(`/rest/v1/${TABLES.registrations}`, {
    method: 'POST',
    body: JSON.stringify({ tournament_id: tournamentId, user_id: userId, status: 'registered' }),
  });
}

export async function withdrawRegistration(tournamentId: string, userId: string): Promise<void> {
  if (!isValidUuid(userId)) {
    throw new Error('invalid_user');
  }
  await supabaseFetch(
    `/rest/v1/${TABLES.registrations}` +
      `?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export async function updateRegistrationStatus(
  tournamentId: string,
  userId: string,
  status: RegistrationRow['status'],
  seed?: number,
): Promise<void> {
  const body: Record<string, unknown> = { status };
  if (seed !== undefined) body.seed = seed;
  await supabaseFetch(
    `/rest/v1/${TABLES.registrations}` +
      `?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function updateRegistrationPlacement(
  tournamentId: string,
  userId: string,
  placement: number | null,
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.registrations}` +
      `?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify({ placement }) },
  );
}

// ── Matches ──────────────────────────────────────────────────────────────

/**
 * Backstop for the match read, not a page size callers work around: an
 * 8-player bracket is 7 matches. The scheduler calls fetchMatches for every
 * in-progress tournament on a 30-second tick, and the response was previously
 * bounded only by however many rows a tournament happened to have.
 */
export const TOURNAMENT_MATCH_PAGE_LIMIT = 256;

export async function fetchMatches(tournamentId: string): Promise<MatchRow[]> {
  return supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}` +
      `?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&order=round.asc,match_number.asc` +
      `&limit=${TOURNAMENT_MATCH_PAGE_LIMIT}`,
  );
}

export async function fetchMatchById(matchId: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}?select=*&id=eq.${encodeURIComponent(matchId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchMatchByRoomCode(roomCode: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}?select=*&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function insertMatch(input: {
  tournamentId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  player1Id: string | null;
  player2Id: string | null;
  roomCode: string;
  status: MatchStatus;
  botTier?: MatchRow['bot_tier'];
}): Promise<MatchRow> {
  const row = {
    tournament_id: input.tournamentId,
    round: input.round,
    match_number: input.matchNumber,
    player1_id: input.player1Id,
    player2_id: input.player2Id,
    room_code: input.roomCode,
    status: input.status,
    bot_tier: input.botTier ?? null,
  };
  const inserted = await supabaseFetch<MatchRow[]>(`/rest/v1/${TABLES.matches}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return inserted[0];
}

export async function updateMatch(
  matchId: string,
  patch: Partial<Pick<
    MatchRow,
    'status' | 'winner_id' | 'room_code' | 'ready_at' | 'ready_deadline_at' |
    'started_at' | 'completed_at' | 'player1_joined_at' | 'player2_joined_at' |
    'winner_source' | 'status_reason' | 'forfeit_user_id' | 'no_show_user_id' |
    'bot_tier' | 'player1_score' | 'player2_score' | 'player1_id' | 'player2_id'
  >>,
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.matches}?id=eq.${encodeURIComponent(matchId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function fetchActiveAssignedMatchForUser(userId: string): Promise<{
  match: MatchRow;
  tournament: ScheduledTournamentRow;
  opponentUsername: string | null;
} | null> {
  if (!isValidUuid(userId)) {
    return null;
  }
  const encUserId = encodeURIComponent(userId);
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}` +
      `?select=*` +
      `&or=(player1_id.eq.${encUserId},player2_id.eq.${encUserId})` +
      `&status=in.(ready,in_progress)` +
      `&limit=10`,
  );
  const tournamentsById = new Map(
    (await Promise.all(
      [...new Set(rows.map((match) => match.tournament_id))].map(async (tournamentId) => [
        tournamentId,
        await fetchTournamentById(tournamentId),
      ] as const),
    ))
      .filter((entry): entry is [string, ScheduledTournamentRow] => Boolean(entry[1])),
  );

  const nowMs = Date.now();
  const candidateRows = rows
    .map((match) => ({ match, tournament: tournamentsById.get(match.tournament_id) ?? null }))
    .filter(
      (entry): entry is { match: MatchRow; tournament: ScheduledTournamentRow } => Boolean(entry.tournament),
    );

  log.info({
    userId,
    count: candidateRows.length,
    matches: candidateRows.map(({ match, tournament }) => ({
      tournamentId: tournament.id,
      matchId: match.id,
      status: match.status,
      scheduledStart: tournament.scheduled_start,
      roomCode: match.room_code,
    })),
  }, 'candidates');

  const filtered = candidateRows.filter(({ match, tournament }) => {
    if (isTournamentPastActiveWindow(tournament, nowMs)) {
      log.info({
        tournamentId: tournament.id,
        matchId: match.id,
        reason: 'tournament_past_active_window',
      }, 'skipped-stale');
      return false;
    }
    if (tournament.status !== 'in_progress') {
      log.info({
        tournamentId: tournament.id,
        matchId: match.id,
        reason: `tournament_${tournament.status}`,
      }, 'skipped-stale');
      return false;
    }
    if (match.status !== 'ready' && match.status !== 'in_progress') {
      log.info({
        tournamentId: tournament.id,
        matchId: match.id,
        reason: `match_${match.status}`,
      }, 'skipped-stale');
      return false;
    }
    if (match.completed_at || match.winner_id) {
      log.info({
        tournamentId: tournament.id,
        matchId: match.id,
        roomCode: match.room_code,
      }, 'skipped-completed');
      return false;
    }
    if (
      match.status === 'ready' &&
      match.ready_deadline_at &&
      Date.parse(match.ready_deadline_at) < nowMs &&
      !humanJoinedAt(match, userId)
    ) {
      log.info({
        tournamentId: tournament.id,
        matchId: match.id,
        reason: 'ready_deadline_expired',
      }, 'skipped-stale');
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const scheduledDiff =
      Date.parse(b.tournament.scheduled_start) - Date.parse(a.tournament.scheduled_start);
    if (scheduledDiff !== 0) return scheduledDiff;
    const statusWeight = (status: MatchRow['status']) => (status === 'in_progress' ? 0 : 1);
    const statusDiff = statusWeight(a.match.status) - statusWeight(b.match.status);
    if (statusDiff !== 0) return statusDiff;
    const roundDiff = a.match.round - b.match.round;
    if (roundDiff !== 0) return roundDiff;
    return a.match.match_number - b.match.match_number;
  });

  const selected = filtered[0];
  if (!selected) {
    return null;
  }
  log.info({
    tournamentId: selected.tournament.id,
    matchId: selected.match.id,
    reason: 'latest_in_progress_attachable_match',
  }, 'selected');
  const opponentId =
    selected.match.player1_id === userId ? selected.match.player2_id : selected.match.player1_id;
  let opponentUsername: string | null = null;
  if (opponentId) {
    const profiles = await supabaseFetch<Array<{ username: string | null }>>(
      `/rest/v1/profiles?select=username&id=eq.${encodeURIComponent(opponentId)}&limit=1`,
    ).catch(() => []);
    opponentUsername = profiles[0]?.username ?? null;
  }
  return { match: selected.match, tournament: selected.tournament, opponentUsername };
}

// ── Bracket aggregate ────────────────────────────────────────────────────

export async function fetchBracketView(tournamentId: string): Promise<BracketView | null> {
  const tournament = await fetchTournamentById(tournamentId);
  if (!tournament) return null;
  const [registrations, matches] = await Promise.all([
    fetchRegistrationsWithProfile(tournamentId),
    fetchMatches(tournamentId),
  ]);
  return { tournament, registrations, matches };
}
