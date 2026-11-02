import { apiGet } from '../../api/client.ts';
import {
  rebuildGameFromRecord,
  type RebuildFailureReason,
  type RebuiltGame,
  type SavedGameRecord,
} from './rebuildGameFromRecord.ts';
import {
  parseSavedMultiplayerRecord,
  rebuildMultiplayerGameFromRecord,
  type SavedMultiplayerRecord,
} from './rebuildMultiplayerGameFromRecord.ts';

/** The server sends multiplayer games only to a client that asks for them: an older app build would not know how to show one. */
const MODES_QUERY = 'modes=pvf,mp';

/** One row of the games archive (no actions, no deal seed). */
export type SavedGameSummary = {
  sourceMatchId: string;
  mode: 'pvf' | 'mp';
  /** The opponent's display name as it was in that game (multiplayer only). */
  opponentName?: string | null;
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
  const result = await apiGet<{ games: SavedGameSummary[] }>(`/api/game-records/recent?limit=${limit}&${MODES_QUERY}`);
  if (result.error || !result.data) return { ok: false, reason: 'unreachable' };
  return { ok: true, games: result.data.games };
}

export type LoadSavedGameResult =
  | { ok: true; record: SavedGameRecord | SavedMultiplayerRecord; game: RebuiltGame }
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
  const result = await apiGet<SavedGameRecord | { mode: 'mp' }>(`/api/game-records/${encodeURIComponent(sourceMatchId)}?${MODES_QUERY}`);
  if (result.status === 404) return { ok: false, reason: 'not_found' };
  if (result.error || !result.data) return { ok: false, reason: 'unreachable' };
  if (result.data.mode === 'mp') {
    const saved = parseSavedMultiplayerRecord(result.data);
    if (!saved) return { ok: false, reason: 'not_replayable', detail: 'The saved multiplayer game is not in a form this app can read.' };
    const rebuiltMp = rebuildMultiplayerGameFromRecord(saved);
    if (!rebuiltMp.ok) return { ok: false, reason: rebuiltMp.reason, detail: rebuiltMp.detail };
    return { ok: true, record: saved, game: rebuiltMp.game };
  }
  const rebuilt = rebuildGameFromRecord(result.data as SavedGameRecord);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason, detail: rebuilt.detail };
  return { ok: true, record: result.data as SavedGameRecord, game: rebuilt.game };
}
