import { apiGet, apiPost } from '../api/client';
import type { PlacementPosition, Tile } from '../types';

const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

function throwGhostError(error: string): never {
  if (
    error === 'Network error' ||
    error.toLowerCase().includes('failed to fetch') ||
    error === 'Invalid response format'
  ) {
    throw new Error(`Ghost backend is unavailable. Start the server on ${DEFAULT_SERVER_ORIGIN}.`);
  }
  throw new Error(error);
}

async function throwingGet<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result.error) throwGhostError(result.error);
  return result.data as T;
}

async function throwingPost<T>(path: string, body: unknown): Promise<T> {
  const result = await apiPost<T>(path, body);
  if (result.error) throwGhostError(result.error);
  return result.data as T;
}

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
  glickoDelta: number | null;
  playerScore: number;
  ghostScore: number;
  playerWon: boolean;
  compositeLog: GhostCompositeLog;
  styleProfile: GhostStyleProfile | null;
};

export type GhostResolvedMove = {
  tile: Tile;
  position: PlacementPosition;
  source: 'composite' | 'random-padding' | 'style-weighted' | 'best-score';
};

export type GhostProfileSummaryByUsername = {
  userId: string;
  username: string;
  summary: GhostProfileSummary;
};

export async function fetchGhostProfileSummary(userId: string): Promise<GhostProfileSummary> {
  const response = await throwingGet<{ ok: true; summary: GhostProfileSummary }>(
    `/api/ghost/profile/${encodeURIComponent(userId)}`,
  );
  return response.summary;
}

export async function fetchGhostProfileSummaryByUsername(
  username: string,
): Promise<GhostProfileSummaryByUsername> {
  const response = await throwingGet<{ ok: true } & GhostProfileSummaryByUsername>(
    `/api/ghost/profile-by-username/${encodeURIComponent(username.replace(/^@/, '').trim())}`,
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
  const response = await throwingPost<{ ok: true; matchId: string }>('/api/ghost/start', params);
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
  accessToken?: string | null;
}): Promise<GhostCompletionResult> {
  const { accessToken: _accessToken, ...bodyParams } = params;
  const response = await throwingPost<{ ok: true; result: GhostCompletionResult }>(
    '/api/ghost/complete',
    bodyParams,
  );
  return response.result;
}
