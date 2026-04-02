import type { PlacementPosition, Tile } from '../types';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

export type GhostMoveLogEntry = {
  turn: number;
  actor?: 'you' | 'ghost';
  board_state: string;
  tile_played: string | null;
  branch: string | null;
  hand_before: string[];
  score_delta: number;
};

export type GhostCompositeCandidate = {
  tilePlayed: string;
  branch: string | null;
  count: number;
  bestScoreDelta: number;
};

export type GhostCompositeState = {
  key: string;
  turn: number;
  boardState: string;
  recommendedMove: GhostCompositeCandidate;
  candidates: GhostCompositeCandidate[];
};

export type GhostCompositeLog = {
  generatedAt: string;
  sourceGameIds: string[];
  states: GhostCompositeState[];
};

export type GhostStyleProfile = {
  scoringBias: number;
  doublePriority: number;
  branchingFrequency: number;
  avgTurnPoints: number;
};

export type GhostProfileSummary = {
  ghostRating: number;
  gamesPlayed: number;
  avgScore: number | null;
  recentScores: number[];
  paddingGames: number;
  compositeLog: GhostCompositeLog | null;
  styleProfile: GhostStyleProfile | null;
};

export type GhostCompletionResult = {
  newRating: number;
  ratingDelta: number;
  playerScore: number;
  ghostScore: number;
  playerWon: boolean;
  compositeLog: GhostCompositeLog;
  styleProfile: GhostStyleProfile | null;
};

export type GhostResolvedMove = {
  tile: Tile;
  position: PlacementPosition;
  source: 'composite' | 'random-padding' | 'best-score';
};

function resolveBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.port === '5173') return '';
  return DEFAULT_SERVER_ORIGIN;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new Error(`Ghost backend is unavailable. Start the server on ${DEFAULT_SERVER_ORIGIN}.`);
  }
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.ok
        ? `Ghost backend returned a non-JSON response from ${url}. Check that the dev proxy for /api/ghost points at the backend.`
        : `Ghost backend is unavailable. Start the server on ${DEFAULT_SERVER_ORIGIN}.`,
    );
  }
  const body = JSON.parse(text) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body;
}

export async function fetchGhostProfileSummary(userId: string): Promise<GhostProfileSummary> {
  const response = await requestJson<{ ok: true; summary: GhostProfileSummary }>(
    `/api/ghost/profile/${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
  return response.summary;
}

export async function completeGhostGame(params: {
  userId: string;
  finalScore: number;
  opponentScore: number;
  moveLog: GhostMoveLogEntry[];
}): Promise<GhostCompletionResult> {
  const response = await requestJson<{ ok: true; result: GhostCompletionResult }>(
    '/api/ghost/complete',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
  );
  return response.result;
}
