import { supabaseFetch } from '../supabaseUtils';
import type {
  BracketView,
  MatchRow,
  RegistrationRow,
  ScheduledTournamentRow,
  ScheduledTournamentStatus,
  MatchStatus,
} from './types';

/** Single source of truth for the table names — easy to rename later. */
export const TABLES = {
  tournaments: 'scheduled_tournaments',
  registrations: 'scheduled_tournament_registrations',
  matches: 'scheduled_tournament_matches',
} as const;

// ── Tournaments ──────────────────────────────────────────────────────────

export async function fetchUpcomingTournaments(limit = 5): Promise<ScheduledTournamentRow[]> {
  const nowIso = new Date().toISOString();
  return supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}` +
      `?select=*` +
      `&scheduled_start=gte.${encodeURIComponent(nowIso)}` +
      `&status=in.(upcoming,registration_open)` +
      `&order=scheduled_start.asc` +
      `&limit=${limit}`,
  );
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
  return supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}` +
      `?select=*` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&order=registered_at.desc` +
      `&limit=50`,
  );
}

export async function insertRegistration(tournamentId: string, userId: string): Promise<void> {
  await supabaseFetch(`/rest/v1/${TABLES.registrations}`, {
    method: 'POST',
    body: JSON.stringify({ tournament_id: tournamentId, user_id: userId, status: 'registered' }),
  });
}

export async function withdrawRegistration(tournamentId: string, userId: string): Promise<void> {
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

// ── Matches ──────────────────────────────────────────────────────────────

export async function fetchMatches(tournamentId: string): Promise<MatchRow[]> {
  return supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}` +
      `?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&order=round.asc,match_number.asc`,
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
}): Promise<MatchRow> {
  const row = {
    tournament_id: input.tournamentId,
    round: input.round,
    match_number: input.matchNumber,
    player1_id: input.player1Id,
    player2_id: input.player2Id,
    room_code: input.roomCode,
    status: input.status,
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
    'status' | 'winner_id' | 'started_at' | 'completed_at' | 'player1_score' | 'player2_score' | 'player1_id' | 'player2_id'
  >>,
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.matches}?id=eq.${encodeURIComponent(matchId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
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
