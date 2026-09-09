import { apiDeleteOrThrow, apiGetOrThrow, apiPostOrThrow } from '../api/client';
import type {
  BracketView,
  Registration,
  ScheduledTournament,
  TournamentMeResponse,
  TournamentResultView,
} from './types';

export async function fetchUpcoming(): Promise<ScheduledTournament[]> {
  const r = await apiGetOrThrow<{ ok: boolean; tournaments: ScheduledTournament[] }>('/api/tournaments/upcoming', { auth: false });
  return r.tournaments;
}

export async function fetchBracket(tournamentId: string): Promise<BracketView> {
  const r = await apiGetOrThrow<{ ok: boolean; view: BracketView }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`, { auth: false });
  return r.view;
}

export async function fetchMyRegistrations(userId: string): Promise<Registration[]> {
  const r = await apiGetOrThrow<{ ok: boolean; registrations: Registration[] }>(`/api/tournaments/my?userId=${encodeURIComponent(userId)}`, { auth: false });
  return r.registrations;
}

export async function fetchMe(): Promise<TournamentMeResponse> {
  const r = await apiGetOrThrow<{
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
  const r = await apiGetOrThrow<{ ok: boolean; result: TournamentResultView }>(`/api/tournaments/${encodeURIComponent(tournamentId)}/result`, { auth: false });
  return r.result;
}

export async function registerForTournament(tournamentId: string, _userId: string): Promise<void> {
  await apiPostOrThrow<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}

export async function withdrawFromTournament(tournamentId: string, _userId: string): Promise<void> {
  await apiDeleteOrThrow<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}
