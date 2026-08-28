import { track } from '../lib/analytics';
import { apiGet, apiPost } from '../api/client';
import { hydrateBoardForOpenEnds } from '../game/openEndsGeometry';
import type {
  PuzzleRushCompleteResponse,
  PuzzleRushLeaderboardResponse,
  PuzzleRushTodayResponse,
  PuzzleRushPuzzle,
  PuzzleRushReportRequest,
  PuzzleRushReportResponse,
  PuzzleRushStartResponse,
} from './types';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const result = await apiPost<T>(path, body ?? {});
  if (result.error) {
    const message = result.error;
    if (message.startsWith('<!DOCTYPE') || message.startsWith('<html')) {
      throw new Error(
        `Puzzle Rush backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`,
      );
    }
    throw new Error(message);
  }
  return result.data as T;
}

/**
 * Boards arrive as stored JSON; the renderer needs the derived open-end
 * geometry the daily puzzle path also hydrates.
 */
function hydratePuzzle(puzzle: PuzzleRushPuzzle): PuzzleRushPuzzle {
  return { ...puzzle, startingBoard: hydrateBoardForOpenEnds(puzzle.startingBoard) };
}

/**
 * Start a run. One request returns the entire puzzle set plus the stage plan —
 * there is deliberately no per-puzzle fetch during a run, because a network
 * round trip between puzzles would be felt on the clock.
 */
export async function startPuzzleRush(): Promise<PuzzleRushStartResponse> {
  track('game_opened', { mode: 'puzzle_rush' });
  const response = await postJson<PuzzleRushStartResponse>('/api/puzzle-rush/start', {});
  return { ...response, puzzles: (response.puzzles ?? []).map(hydratePuzzle) };
}

/**
 * Report one puzzle optimistically. Callers must NOT await this before
 * advancing — the server does no engine work here, and the clock never waits.
 */
export async function reportPuzzleRushPuzzle(
  input: PuzzleRushReportRequest,
): Promise<PuzzleRushReportResponse> {
  return postJson<PuzzleRushReportResponse>('/api/puzzle-rush/report', input);
}

/** End the run. The server replays every reported line and returns the real total. */
export async function completePuzzleRush(input: {
  runId: string;
  clientReportedScore: number;
}): Promise<PuzzleRushCompleteResponse> {
  track('game_completed', { mode: 'puzzle_rush' });
  return postJson<PuzzleRushCompleteResponse>('/api/puzzle-rush/complete', input);
}

async function getJson<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

/** Hub state: personal best, streak, whether today's official run is done. */
export async function fetchPuzzleRushToday(): Promise<PuzzleRushTodayResponse> {
  return getJson<PuzzleRushTodayResponse>('/api/puzzle-rush/today');
}

export async function fetchPuzzleRushLeaderboard(): Promise<PuzzleRushLeaderboardResponse> {
  return getJson<PuzzleRushLeaderboardResponse>('/api/puzzle-rush/leaderboard');
}
