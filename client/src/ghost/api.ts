import type { PlacementPosition, Tile } from '../types';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

export type GhostMoveLogEntry = {
  turn: number;
  hand_number?: number;
  actor?: 'you' | 'ghost';
  board_state: string;
  tile_played: string | null;
  branch: string | null;
  hand_before: string[];
  score_delta: number;
  forced_draw?: boolean;
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

export type GhostGameStyleSnapshot = {
  gameId: string;
  playedAt: string;
  scoringBias: number;
  doublePriority: number;
  branchingFrequency: number;
  spinnerControl: number;
  avgTurnPoints: number;
  drawPriority: number;
  pointSuppression: number;
  handSize: number;
  attackSetup: number;
  consistency: number;
};

export type GhostCompositeLog = {
  generatedAt: string;
  sourceGameIds: string[];
  states: GhostCompositeState[];
  recentGameStyles: GhostGameStyleSnapshot[];
};

export type GhostStyleProfile = {
  scoringBias: number;
  doublePriority: number;
  branchingFrequency: number;
  spinnerControl: number;
  avgTurnPoints: number;
  drawPriority: number;
  pointSuppression: number;
  handSize: number;
  attackSetup: number;
  consistency: number;
  confidence: number;
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
  glickoRating: number | null;
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

export type GhostProfileSummaryByUsername = {
  userId: string;
  username: string;
  summary: GhostProfileSummary;
};

function resolveBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
    return '';
  }
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

export async function fetchGhostProfileSummaryByUsername(
  username: string,
): Promise<GhostProfileSummaryByUsername> {
  const response = await requestJson<{ ok: true } & GhostProfileSummaryByUsername>(
    `/api/ghost/profile-by-username/${encodeURIComponent(username.replace(/^@/, '').trim())}`,
    { method: 'GET' },
  );
  return {
    userId: response.userId,
    username: response.username,
    summary: response.summary,
  };
}

export async function startGhostMatchSession(params: {
  userId: string;
  localMatchId: string;
  opponentUserId?: string | null;
}): Promise<{ matchId: string }> {
  const response = await requestJson<{ ok: true; matchId: string }>('/api/ghost/start', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return { matchId: response.matchId };
}

export async function completeGhostGame(params: {
  matchId: string;
  userId: string;
  opponentUserId?: string | null;
  localMatchId?: string | null;
  finalScore: number;
  opponentScore: number;
  moveLog: GhostMoveLogEntry[];
  playerMoveLog?: GhostMoveLogEntry[];
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
