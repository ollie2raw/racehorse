import { apiDelete, apiGet, apiPost } from '../api/client';
import type {
  BracketView,
  Registration,
  ScheduledTournament,
  TournamentMeResponse,
  TournamentResultView,
} from './types';

async function throwingGet<T>(path: string, auth = true): Promise<T> {
  const result = await apiGet<T>(path, { auth });
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

async function throwingPost<T>(path: string, body: unknown = {}): Promise<T> {
  const result = await apiPost<T>(path, body);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

async function throwingDelete<T>(path: string, body: unknown = {}): Promise<T> {
  const result = await apiDelete<T>(path, body);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

export async function fetchUpcoming(): Promise<ScheduledTournament[]> {
  const r = await throwingGet<{ ok: boolean; tournaments: ScheduledTournament[] }>(
    '/api/tournaments/upcoming',
    false,
  );
  return r.tournaments;
}

export async function fetchBracket(tournamentId: string): Promise<BracketView> {
  const r = await throwingGet<{ ok: boolean; view: BracketView }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
    false,
  );
  return r.view;
}

export async function fetchMyRegistrations(userId: string): Promise<Registration[]> {
  const r = await throwingGet<{ ok: boolean; registrations: Registration[] }>(
    `/api/tournaments/my?userId=${encodeURIComponent(userId)}`,
    false,
  );
  return r.registrations;
}

export async function fetchMe(): Promise<TournamentMeResponse> {
  const r = await throwingGet<{
    ok: boolean;
    registrations: Registration[];
    activeAssignedMatch: TournamentMeResponse['activeAssignedMatch'];
    currentTournamentPhase: TournamentMeResponse['currentTournamentPhase'];
    activeTournamentId: TournamentMeResponse['activeTournamentId'];
    assignedMatch: TournamentMeResponse['assignedMatch'];
    countdown: TournamentMeResponse['countdown'];
  }>('/api/tournaments/me');
  return {
    registrations: r.registrations,
    activeAssignedMatch: r.activeAssignedMatch,
    currentTournamentPhase: r.currentTournamentPhase ?? null,
    activeTournamentId: r.activeTournamentId ?? null,
    assignedMatch: r.assignedMatch ?? null,
    countdown: r.countdown ?? null,
  };
}

export async function fetchResult(tournamentId: string): Promise<TournamentResultView> {
  const r = await throwingGet<{ ok: boolean; result: TournamentResultView }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/result`,
    false,
  );
  return r.result;
}

export async function registerForTournament(tournamentId: string, _userId: string): Promise<void> {
  await throwingPost<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}

export async function withdrawFromTournament(tournamentId: string, _userId: string): Promise<void> {
  await throwingDelete<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}
