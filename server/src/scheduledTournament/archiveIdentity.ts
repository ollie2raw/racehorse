import type { PersistedRoomMatchLogRow } from '../multiplayer/roomMatchLogPersistence';
import { isBotUserId } from './matchDispatch';
import type { MatchRow } from './types';

/**
 * Is this room_match_logs archive the game of this tournament match? The one
 * identity rule for archives, used by terminal-result recovery and by the
 * terminal-join answer (callers add their own state requirements).
 *
 *  - Same room code, always.
 *  - An archive that records `summary.scheduledTournamentMatchId` (every
 *    tournament archive since Phase 2A) belongs to that match only: an
 *    explicit id is authoritative, whatever the players or timing.
 *  - Only an archive written before that field existed falls back to the
 *    compatibility identity: exactly this match's two players (a Fritz seat's
 *    id is its tournament id), archived no earlier than the match started.
 */
export function archiveBelongsToMatch(
  archive: Pick<PersistedRoomMatchLogRow, 'room_code' | 'summary' | 'participants' | 'archived_at'>,
  match: Pick<MatchRow, 'id' | 'room_code' | 'player1_id' | 'player2_id' | 'started_at'>,
): boolean {
  if (!match.room_code || archive.room_code.trim().toUpperCase() !== match.room_code.trim().toUpperCase()) return false;
  const archivedMatchId = archive.summary?.scheduledTournamentMatchId;
  if (typeof archivedMatchId === 'string') return archivedMatchId === match.id;
  const players = archive.participants.map((p) => p.userId ?? (isBotUserId(p.id) ? p.id : null));
  const samePlayers = players.length === 2 && match.player1_id !== match.player2_id &&
    players.includes(match.player1_id) && players.includes(match.player2_id);
  if (!samePlayers) return false;
  const startedMs = Date.parse(match.started_at ?? '');
  return !Number.isFinite(startedMs) || Date.parse(archive.archived_at) >= startedMs;
}
