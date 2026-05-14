import type { BracketView, Registration, ScheduledTournament } from './types';

function serverUrl(): string {
  return (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function deleteJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
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

export async function registerForTournament(tournamentId: string, userId: string): Promise<void> {
  await postJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    { userId },
  );
}

export async function withdrawFromTournament(tournamentId: string, userId: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    { userId },
  );
}
