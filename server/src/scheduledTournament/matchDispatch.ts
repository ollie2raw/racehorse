import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import type { MatchRow } from './types';
import { isTournamentRoomCode, makeTournamentRoomCode } from './tournamentRoomCode';
import type { Room } from '../rooms';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { tournamentStarterUserId } from './tournamentStarter';
import { updateMatchIfUnchanged } from './casWrites';
import { withServerNow } from './serverNow';
import { alertTournamentAnomaly } from './tournamentAlerts';

const log = childLogger('tournament:dispatch');

export const TOURNAMENT_MATCH_READY_WINDOW_MS = 2 * 60_000;

type DispatchReason = 'bracket_generated' | 'winner_advanced' | 'recovery' | 'repair';

export type DispatchTournamentMatchResult = {
  ok: true;
  matchId: string;
  tournamentId: string;
  roomCode: string;
  status: 'ready' | 'in_progress';
  readyAt: string | null;
  readyDeadlineAt: string | null;
  recipients: string[];
  reusedExistingRoom: boolean;
  emittedReady: boolean;
  /** Another process changed the match before this dispatch's write: nothing was written. */
  superseded?: boolean;
};

export type DispatchTournamentMatchOptions = {
  now?: Date;
  reason?: DispatchReason;
  emitIfAlreadyReady?: boolean;
};

// Room-code generator + recognizer live in a dependency-free leaf module now
// (the authz layer needs the recognizer without the persistence graph).
export { isTournamentRoomCode, makeTournamentRoomCode };

export function isBotUserId(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && userId.startsWith('bot:fritz:');
}

export function isBotOnlyMatch(match: Pick<MatchRow, 'player1_id' | 'player2_id'>): boolean {
  return isBotUserId(match.player1_id) && isBotUserId(match.player2_id);
}

export function humanJoinedAt(match: MatchRow, userId: string): string | null {
  if (isBotUserId(userId)) return null;
  if (match.player1_id === userId) return match.player1_joined_at;
  if (match.player2_id === userId) return match.player2_joined_at;
  return null;
}

/** True when every non-bot assigned player has a joined_at timestamp. */
export function allHumanPlayersJoined(match: MatchRow): boolean {
  const humanIds = [match.player1_id, match.player2_id].filter(
    (id): id is string => Boolean(id && !isBotUserId(id)),
  );
  if (humanIds.length === 0) return false;
  return humanIds.every((id) => Boolean(humanJoinedAt(match, id)));
}

export async function promoteScheduledMatchToInProgress(
  matchId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  startedAt: string = new Date().toISOString(),
  humanUserId?: string | null,
): Promise<void> {
  const match = await persistence.fetchMatchById(matchId);
  if (!match || match.status === 'completed' || match.status === 'bye') return;
  if (match.status === 'in_progress') return;
  // The write is the waiting/ready → in_progress transition itself: only from
  // the status read, never onto a match decided or completed meanwhile.
  const promoted = await updateMatchIfUnchanged(persistence, matchId, { status: match.status }, {
    status: 'in_progress',
    started_at: match.started_at ?? startedAt,
    status_reason: null,
  });
  if (!promoted) {
    log.info({ matchId, roomCode: match.room_code }, 'promote skipped: the match changed since it was read');
    return;
  }
  log.info({ matchId, roomCode: match.room_code, humanUserId: humanUserId ?? null }, 'promoted in_progress after human attach');
}

function botLabel(tier: MatchRow['bot_tier']): string {
  if (tier === 'master') return 'Master Fritz';
  if (tier === 'elite') return 'Elite Fritz';
  return 'Fritz';
}

async function fetchUsernames(userIds: string[]): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(userIds.filter((id) => id && !isBotUserId(id)))];
  if (uniqueIds.length === 0) return new Map();
  const inClause = uniqueIds.map((id) => `"${id}"`).join(',');
  const rows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=in.(${inClause})`,
  ).catch(() => []);
  return new Map(rows.map((row) => [row.id, row.username ?? null]));
}

/**
 * Production socket auth path:
 * - clients send Supabase access tokens via `presence:identify` and room payloads
 * - `resolveSocketIdentity()` in server/src/index.ts validates the token through
 *   `getAuthenticatedUserIdFromToken()`
 * - verified identity is stored on `socket.data.userId`
 * Tournament dispatch relies on that verified `socket.data.userId` when targeting
 * assigned players and when later enforcing attach admission.
 */
export async function dispatchTournamentMatch(
  io: Server,
  matchId: string,
  opts: DispatchTournamentMatchOptions = {},
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<DispatchTournamentMatchResult> {
  const match = await persistence.fetchMatchById(matchId);
  if (!match) throw new Error('match_not_found');

  const tournament = await persistence.fetchTournamentById(match.tournament_id);
  if (!tournament) throw new Error('tournament_not_found');
  if (tournament.status === 'cancelled') throw new Error('tournament_cancelled');
  if (tournament.status === 'completed') throw new Error('tournament_completed');
  if (!match.player1_id || !match.player2_id) throw new Error('match_missing_players');
  if (match.status === 'completed' || match.status === 'bye') throw new Error('match_invalid_state');

  const now = opts.now ?? new Date();
  let readyAt = match.ready_at ?? now.toISOString();
  let readyDeadlineAt = match.ready_deadline_at ?? new Date(now.getTime() + TOURNAMENT_MATCH_READY_WINDOW_MS).toISOString();
  const roomCode = match.room_code && match.room_code.trim()
    ? match.room_code.trim().toUpperCase()
    : makeTournamentRoomCode(match);
  const alreadyReady =
    match.status === 'ready' &&
    match.room_code === roomCode &&
    Boolean(match.ready_at) &&
    Boolean(match.ready_deadline_at);

  let room: Room;
  let reusedExistingRoom = Boolean(match.room_code);
  try {
    room = persistence.getRoom(roomCode);
    // A room in memory under this code that belongs to another match (a legacy
    // room-code collision) is never taken over.
    if (room.scheduledTournamentMatchId && room.scheduledTournamentMatchId !== match.id) {
      alertTournamentAnomaly(
        'tournament_foreign_live_session',
        { tournamentId: match.tournament_id, matchId: match.id, roomCode },
        { foreignMatchId: room.scheduledTournamentMatchId, stage: 'dispatch' },
      );
      throw new Error('tournament_room_session_mismatch');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'tournament_room_session_mismatch') throw err;
    reusedExistingRoom = false;
    // Not in memory (first dispatch, or after a restart): a stored game in
    // progress must be restored, never covered by an empty room.
    room = persistence.restoreOrCreateRoom
      ? await persistence.restoreOrCreateRoom(roomCode, match.id, { winningScore: tournament.win_target, skipPregameDraw: true })
      : persistence.createReservedRoom(roomCode, { winningScore: tournament.win_target, skipPregameDraw: true });
  }
  room.scheduledTournamentMatchId = match.id;
  room.scheduledTournamentId = tournament.id;
  room.scheduledTournamentBotTier = match.bot_tier ?? undefined;
  // No interactive pre-game draw in tournaments: the server picks the starter
  // (same answer on every dispatch). A started game is never touched.
  room.scheduledTournamentStarterUserId = tournamentStarterUserId(match) ?? undefined;
  if (!room.state) room.config = { ...room.config, skipPregameDraw: true };

  if (isBotUserId(match.player1_id)) {
    seatSyntheticBotInRoom(roomCode, match.player1_id, botLabel(match.bot_tier));
  }
  if (isBotUserId(match.player2_id)) {
    seatSyntheticBotInRoom(roomCode, match.player2_id, botLabel(match.bot_tier));
  }

  let dispatchedNow = false;
  let effectiveStatus: MatchRow['status'] = match.status;
  if (!alreadyReady) {
    // Compare-and-set on every field this write fills or clears, as read: a
    // dispatch decided from an older read never replaces a newer room,
    // deadline or reason, nor moves a match that has since started, been
    // decided or completed.
    dispatchedNow = await updateMatchIfUnchanged(persistence, match.id, {
      status: match.status,
      room_code: match.room_code ?? null,
      ready_at: match.ready_at,
      ready_deadline_at: match.ready_deadline_at,
      status_reason: match.status_reason,
    }, {
      room_code: roomCode,
      status: match.status === 'in_progress' ? 'in_progress' : 'ready',
      ready_at: readyAt,
      ready_deadline_at: readyDeadlineAt,
      status_reason: null,
    });
    if (dispatchedNow) {
      const humanUserIds = [match.player1_id, match.player2_id].filter(
        (id): id is string => Boolean(id && !isBotUserId(id)),
      );
      log.info({ matchId: match.id, roomCode, humanUserIds }, 'match ready');
    } else {
      // Another process changed the match first: report its current state.
      const current = await persistence.fetchMatchById(match.id);
      log.info({ matchId: match.id, roomCode, currentStatus: current?.status ?? null }, 'dispatch write skipped: the match changed since it was read');
      if (!current || (current.status !== 'ready' && current.status !== 'in_progress')) {
        return {
          ok: true,
          matchId: match.id,
          tournamentId: match.tournament_id,
          roomCode: current?.room_code || roomCode,
          status: current?.status === 'in_progress' ? 'in_progress' : 'ready',
          readyAt: current?.ready_at ?? readyAt,
          readyDeadlineAt: current?.ready_deadline_at ?? readyDeadlineAt,
          recipients: [],
          reusedExistingRoom,
          emittedReady: false,
          superseded: true,
        };
      }
      effectiveStatus = current.status;
      readyAt = current.ready_at ?? readyAt;
      readyDeadlineAt = current.ready_deadline_at ?? readyDeadlineAt;
    }
  }

  const shouldEmit = dispatchedNow || opts.emitIfAlreadyReady === true || opts.reason === 'recovery';
  const recipients: string[] = [];
  const recipientSockets = shouldEmit
    ? Array.from(io.sockets.sockets.values()).filter((sock) => {
      const userId: string | undefined = (sock.data as { userId?: string }).userId;
        return Boolean(
          userId &&
          !isBotUserId(userId) &&
          (userId === match.player1_id || userId === match.player2_id),
        );
      })
    : [];
  const usernames = shouldEmit && recipientSockets.length > 0
    ? await fetchUsernames([match.player1_id, match.player2_id])
    : new Map<string, string | null>();

  if (shouldEmit) {
    for (const sock of recipientSockets) {
      const userId: string | undefined = (sock.data as { userId?: string }).userId;
      if (!userId) continue;
      recipients.push(userId);
      const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
      const payload = {
        tournamentId: match.tournament_id,
        matchId: match.id,
        round: match.round,
        matchNumber: match.match_number,
        roomCode,
        matchStatus: effectiveStatus === 'in_progress' ? 'in_progress' as const : 'ready' as const,
        readyAt,
        readyDeadlineAt,
        opponentId,
        opponentUsername: opponentId
          ? isBotUserId(opponentId)
            ? botLabel(match.bot_tier)
            : usernames.get(opponentId) ?? null
          : null,
      };
      sock.emit('tournament:match_ready', withServerNow(payload));
    }
    if (recipientSockets.length === 0) {
      log.debug({ matchId: match.id, roomCode }, 'match_ready skipped — no connected sockets');
    }
  }

  return {
    ok: true,
    matchId: match.id,
    tournamentId: match.tournament_id,
    roomCode,
    status: effectiveStatus === 'in_progress' ? 'in_progress' : 'ready',
    readyAt,
    readyDeadlineAt,
    recipients,
    reusedExistingRoom,
    emittedReady: shouldEmit && recipients.length > 0,
  };
}
