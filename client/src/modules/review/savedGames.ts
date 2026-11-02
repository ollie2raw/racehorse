import { apiGet } from '../../api/client.ts';
import {
  rebuildGameFromRecord,
  type RebuildFailureReason,
  type RebuiltGame,
  type SavedGameRecord,
} from './rebuildGameFromRecord.ts';
import {
  parseSavedDailyFritzGame,
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
  /** The game exists but the server cannot offer a review of it (a Daily Fritz game played before its hands were kept, or one that does not line up with its verified result). Retrying will not help. */
  | { ok: false; reason: 'not_reviewable' }
  /** The server could not be reached or errored: worth trying again. */
  | { ok: false; reason: 'unreachable' }
  /** The record is there but does not replay cleanly; retrying will not help. */
  | { ok: false; reason: RebuildFailureReason; detail: string };

const DAILY_FRITZ_GAME_ID = /^dfz:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-3])$/i;

/** A Daily Fritz game's review id is `dfz:<attempt id>:<game number>` (the server's `dailyFritzSavedGameId`). Null for any other id. */
export function parseDailyFritzSavedGameId(sourceMatchId: string): { attemptId: string; gameNumber: 1 | 2 | 3 } | null {
  const match = DAILY_FRITZ_GAME_ID.exec(sourceMatchId);
  return match ? { attemptId: match[1]!, gameNumber: Number(match[2]) as 1 | 2 | 3 } : null;
}

/**
 * A finished Daily Fritz game. The server derives it from the verified ledger and the hands it kept, in the multiplayer record format, so it rebuilds with the
 * same code; this only fetches it and names each way it can fail. A 404 from this endpoint always means "no review for this game" (the endpoint answers it for
 * a game that is not the player's too, so the two are not told apart on purpose).
 */
async function loadDailyFritzSavedGame(attemptId: string, gameNumber: number): Promise<LoadSavedGameResult> {
  const result = await apiGet<unknown>(`/api/daily-fritz/game-record?attempt_id=${encodeURIComponent(attemptId)}&game_number=${gameNumber}`);
  if (result.status === 404) return { ok: false, reason: 'not_reviewable' };
  if (result.error || !result.data) return { ok: false, reason: 'unreachable' };
  const saved = parseSavedDailyFritzGame(result.data);
  if (!saved) return { ok: false, reason: 'not_replayable', detail: 'The saved Daily Fritz game is not in a form this app can read.' };
  const rebuilt = rebuildMultiplayerGameFromRecord(saved);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason, detail: rebuilt.detail };
  return { ok: true, record: saved, game: rebuilt.game };
}

/**
 * Fetch a saved game and rebuild it into the inputs the review pipeline consumes. Each way it can fail is named, so a
 * screen can say what actually happened instead of showing a spinner or a raw error.
 */
export async function loadSavedGame(sourceMatchId: string): Promise<LoadSavedGameResult> {
  const dailyFritz = parseDailyFritzSavedGameId(sourceMatchId);
  if (dailyFritz) return loadDailyFritzSavedGame(dailyFritz.attemptId, dailyFritz.gameNumber);
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
