import { apiGet } from '../../api/client.ts';
import {
  rebuildGameFromRecord,
  type RebuildFailureReason,
  type RebuiltGame,
  type SavedGameRecord,
} from './rebuildGameFromRecord.ts';

/** One row of the games archive (no actions, no deal seed). */
export type SavedGameSummary = {
  sourceMatchId: string;
  mode: 'pvf';
  fritzTier: string | null;
  dealSize: number | null;
  winningScore: number | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moveCount: number;
  verification: 'replay_verified' | 'replay_mismatch' | 'unverified';
  playedAt: string | null;
  savedAt: string;
  /** This game's saved review, when it has one that reopens instantly (joined on the server). */
  review: { id: string; accuracy: number | null; grade: string | null } | null;
};

export type RecentGamesResult =
  | { ok: true; games: SavedGameSummary[] }
  | { ok: false; reason: 'unreachable' };

/** The signed-in player's saved games, newest first. */
export async function fetchRecentGames(limit = 20): Promise<RecentGamesResult> {
  const result = await apiGet<{ games: SavedGameSummary[] }>(`/api/game-records/recent?limit=${limit}`);
  if (result.error || !result.data) return { ok: false, reason: 'unreachable' };
  return { ok: true, games: result.data.games };
}

export type LoadSavedGameResult =
  | { ok: true; record: SavedGameRecord; game: RebuiltGame }
  /** This game was never saved (or is not this player's). */
  | { ok: false; reason: 'not_found' }
  /** The server could not be reached or errored: worth trying again. */
  | { ok: false; reason: 'unreachable' }
  /** The record is there but does not replay cleanly; retrying will not help. */
  | { ok: false; reason: RebuildFailureReason; detail: string };

/**
 * Fetch a saved game and rebuild it into the inputs the review pipeline consumes. Each way it can fail is named, so a
 * screen can say what actually happened instead of showing a spinner or a raw error.
 */
export async function loadSavedGame(sourceMatchId: string): Promise<LoadSavedGameResult> {
  const result = await apiGet<SavedGameRecord>(`/api/game-records/${encodeURIComponent(sourceMatchId)}`);
  if (result.status === 404) return { ok: false, reason: 'not_found' };
  if (result.error || !result.data) return { ok: false, reason: 'unreachable' };
  const rebuilt = rebuildGameFromRecord(result.data);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason, detail: rebuilt.detail };
  return { ok: true, record: result.data, game: rebuilt.game };
}
