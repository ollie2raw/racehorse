import type { Server } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import type { MatchRow } from './types';
import type { Room } from '../rooms';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';

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
};

export type DispatchTournamentMatchOptions = {
  now?: Date;
  reason?: DispatchReason;
  emitIfAlreadyReady?: boolean;
};

function makeTournamentRoomCode(match: MatchRow): string {
  const short = match.tournament_id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `T${short}R${match.round}M${match.match_number}`;
}

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
  await persistence.updateMatch(matchId, {
    status: 'in_progress',
    started_at: match.started_at ?? startedAt,
    status_reason: null,
  });
  console.log('[tournament:match] promoted in_progress only after human attach', {
    matchId,
    roomCode: match.room_code,
    humanUserId: humanUserId ?? null,
  });
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
  const readyAt = match.ready_at ?? now.toISOString();
  const readyDeadlineAt = match.ready_deadline_at ?? new Date(now.getTime() + TOURNAMENT_MATCH_READY_WINDOW_MS).toISOString();
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
  } catch {
    reusedExistingRoom = false;
    room = persistence.createReservedRoom(roomCode, { winningScore: tournament.win_target });
  }
  room.scheduledTournamentMatchId = match.id;
  room.scheduledTournamentId = tournament.id;
  room.scheduledTournamentBotTier = match.bot_tier ?? undefined;

  if (isBotUserId(match.player1_id)) {
    seatSyntheticBotInRoom(roomCode, match.player1_id, botLabel(match.bot_tier));
  }
  if (isBotUserId(match.player2_id)) {
    seatSyntheticBotInRoom(roomCode, match.player2_id, botLabel(match.bot_tier));
  }

  if (!alreadyReady) {
    await persistence.updateMatch(match.id, {
      room_code: roomCode,
      status: match.status === 'in_progress' ? 'in_progress' : 'ready',
      ready_at: readyAt,
      ready_deadline_at: readyDeadlineAt,
      status_reason: null,
    });
    const humanUserIds = [match.player1_id, match.player2_id].filter(
      (id): id is string => Boolean(id && !isBotUserId(id)),
    );
    console.log('[tournament:dispatch] match ready', {
      matchId: match.id,
      roomCode,
      humanUserIds,
    });
  }

  const shouldEmit = !alreadyReady || opts.emitIfAlreadyReady === true || opts.reason === 'recovery';
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
        matchStatus: match.status === 'in_progress' ? 'in_progress' as const : 'ready' as const,
        readyAt,
        readyDeadlineAt,
        opponentId,
        opponentUsername: opponentId
          ? isBotUserId(opponentId)
            ? botLabel(match.bot_tier)
            : usernames.get(opponentId) ?? null
          : null,
      };
      sock.emit('tournament:match_ready', payload);
    }
    if (recipientSockets.length === 0) {
      console.log('[tournament:match_ready] skipped — no connected assigned sockets', {
        matchId: match.id,
        roomCode,
      });
    }
  }

  return {
    ok: true,
    matchId: match.id,
    tournamentId: match.tournament_id,
    roomCode,
    status: match.status === 'in_progress' ? 'in_progress' : 'ready',
    readyAt,
    readyDeadlineAt,
    recipients,
    reusedExistingRoom,
    emittedReady: shouldEmit && recipients.length > 0,
  };
}
