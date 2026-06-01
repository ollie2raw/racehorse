import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import type {
  BracketView,
  Registration,
  ScheduledTournament,
  TournamentHistoryEntry,
  TournamentMeResponse,
  TournamentResultView,
} from './types';

function serverUrl(): string {
  return resolveGameServerUrl();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getAuthedJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    headers: await authHeaders(),
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `GET ${path} failed: ${res.status}`;
    throw new Error(error);
  }
  return body as T;
}

async function postAuthedJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error =
      parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `POST ${path} failed: ${res.status}`;
    throw new Error(error);
  }
  return parsed as T;
}

async function deleteAuthedJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error =
      parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `DELETE ${path} failed: ${res.status}`;
    throw new Error(error);
  }
  return parsed as T;
}

export async function fetchUpcoming(): Promise<ScheduledTournament[]> {
  const r = await getJson<{ ok: boolean; tournaments: ScheduledTournament[] }>(
    '/api/tournaments/upcoming',
  );
  return r.tournaments;
}

export async function fetchBracket(tournamentId: string): Promise<BracketView> {
  const r = await getJson<{ ok: boolean; view: BracketView }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
  );
  return r.view;
}

export async function fetchMyRegistrations(userId: string): Promise<Registration[]> {
  const r = await getJson<{ ok: boolean; registrations: Registration[] }>(
    `/api/tournaments/my?userId=${encodeURIComponent(userId)}`,
  );
  return r.registrations;
}

export async function fetchMe(): Promise<TournamentMeResponse> {
  const r = await getAuthedJson<{
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

export async function fetchHistory(): Promise<TournamentHistoryEntry[]> {
  const r = await getAuthedJson<{ ok: boolean; history: TournamentHistoryEntry[] }>(
    '/api/tournaments/history',
  );
  return r.history;
}

export async function fetchResult(tournamentId: string): Promise<TournamentResultView> {
  const r = await getJson<{ ok: boolean; result: TournamentResultView }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/result`,
  );
  return r.result;
}

export async function registerForTournament(tournamentId: string, _userId: string): Promise<void> {
  await postAuthedJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}

export async function withdrawFromTournament(tournamentId: string, _userId: string): Promise<void> {
  await deleteAuthedJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    {},
  );
}
