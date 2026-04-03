import { supabase } from '../lib/supabase';
import type { LeagueHistoryResponse, LeaguePlayerState, LeagueStandingRow } from './types';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

function resolveBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.port === '5173') return '';
  return DEFAULT_SERVER_ORIGIN;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
    error: sessionError,
  } = supabase ? await supabase.auth.getSession() : { data: { session: null }, error: null };
  if (sessionError) {
    throw sessionError;
  }
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error('You must be signed in to use League Mode.');
  }

  const url = `${resolveBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error(`League backend is unavailable. Start the server on ${DEFAULT_SERVER_ORIGIN}.`);
  }
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.ok
        ? `League backend returned a non-JSON response from ${url}.`
        : `League backend is unavailable. Start the server on ${DEFAULT_SERVER_ORIGIN}.`,
    );
  }
  const body = JSON.parse(text) as T & { error?: string };
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  }
  return body;
}

export async function ensureLeagueReady(userId: string): Promise<LeaguePlayerState> {
  const assigned = await requestJson<{ ok: true; assignment: { league: { id: string } } }>(
    '/league/assign-player',
    {
      method: 'POST',
      body: JSON.stringify({ userId }),
    },
  );
  await requestJson<{ ok: true }>('/league/generate-fixtures', {
    method: 'POST',
    body: JSON.stringify({ leagueId: assigned.assignment.league.id }),
  });
  const stateResp = await requestJson<{ ok: true; state: LeaguePlayerState | null }>(
    `/league/state/${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
  if (!stateResp.state) {
    throw new Error('League state is not available yet.');
  }
  return stateResp.state;
}

export async function reportLeagueResult(
  input: {
    fixtureId: string;
    homeScore: number;
    awayScore: number;
    mode: 'ghost' | 'bot' | 'live';
    playerMemberId: string;
    opponentMemberId: string;
    roomCode?: string | null;
  },
): Promise<{
  standings: LeagueStandingRow[];
  fixture: LeaguePlayerState['todaysFixture'];
  isCanonicalProvisional?: boolean;
}> {
  const response = await requestJson<{
    ok: true;
    result: {
      standings: LeagueStandingRow[];
      fixture: LeaguePlayerState['todaysFixture'];
      isCanonicalProvisional?: boolean;
    };
  }>(
    '/league/report-result',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return {
    standings: response.result.standings,
    fixture: response.result.fixture,
    isCanonicalProvisional: response.result.isCanonicalProvisional,
  };
}

export async function fetchLeagueHistory(userId: string): Promise<LeagueHistoryResponse> {
  const response = await requestJson<{ ok: true; history: LeagueHistoryResponse }>(
    `/league/history/${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
  return response.history;
}

export async function openLeagueLiveRoom(
  fixtureId: string,
): Promise<{ fixtureId: string; roomCode: string }> {
  const response = await requestJson<{ ok: true; fixtureId: string; roomCode: string }>(
    `/league/fixture/${encodeURIComponent(fixtureId)}/live-room`,
    { method: 'POST' },
  );
  return {
    fixtureId: response.fixtureId,
    roomCode: response.roomCode,
  };
}
