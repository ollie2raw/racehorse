import { getRoom } from '../rooms';
import type { Room } from '../rooms';
import {
  getRoomPlayersWithFallback,
  getRoomRoster,
  type RoomPlayer,
} from '../multiplayer/roomSession';
import {
  FRITZ_ELITE_ID,
  FRITZ_GRANDMASTER_ID,
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
} from '../ranking/glicko2';
import { processRatingPeriod } from '../ranking/periodService';
import {
  isRankedGameSourceColumnsEnabled,
  type RankedGameSource,
} from '../ranking/rankedGamePayload';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';
import type { ProfileRow } from '../supabaseTypes';
import { writeForfeitActivity } from '../social/activityWriter';
import { queryVerifiedSinglePlayerMatchByLocalKey } from './verifiedSinglePlayerMatch';
import { childLogger } from '../logger';

const log = childLogger('fritz-match-lifecycle');

export function getFritzTierForRoom(room: Room, botPlayerId: string | null): string {
  const cfg = room.config;
  if (typeof cfg.fritzTier === 'string' && cfg.fritzTier.trim()) {
    return cfg.fritzTier.trim().toLowerCase();
  }

  const rawBotId = typeof botPlayerId === 'string' ? botPlayerId.toLowerCase() : '';
  if (rawBotId.includes('rookie')) return 'rookie';
  if (rawBotId.includes('standard')) return 'standard';
  if (rawBotId.includes('grandmaster')) return 'grandmaster';
  if (rawBotId.includes('master')) return 'master';
  return 'elite';
}

export function getPendingFritzMatchContext(room: Room): { realPlayer: RoomPlayer; fritzTier: string } | null {
  const rosterCached = getRoomRoster(room.code);
  const roster =
    rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(room.code, room.players);
  const botPlayer = roster.find((player) => typeof player.id === 'string' && player.id.startsWith('bot:fritz:')) ?? null;
  const realPlayers = roster.filter((player) => player.userId);
  if (!botPlayer || realPlayers.length !== 1) return null;
  return {
    realPlayer: realPlayers[0],
    fritzTier: getFritzTierForRoom(room, botPlayer.id),
  };
}

export function formatFritzActivityOpponentLabel(rawTier: string): string {
  const tier = rawTier.trim().toLowerCase();
  if (tier === 'grandmaster') return 'Fritz (Grandmaster)';
  if (tier === 'rookie' || tier === 'standard' || tier === 'elite' || tier === 'master') {
    return `Fritz (${tier.charAt(0).toUpperCase()}${tier.slice(1)})`;
  }
  return 'Fritz';
}

export function parseOptionalActivityScore(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function readFritzForfeitScoresFromRoom(
  roomCode: string,
  userId: string,
): { youScore: number; botScore: number } | null {
  try {
    const room = getRoom(roomCode);
    const context = getPendingFritzMatchContext(room);
    if (!context || context.realPlayer.userId !== userId || !room.state?.players) return null;
    const humanSeat = context.realPlayer.id;
    const botSeat = room.players.find((seatId) => seatId !== humanSeat) ?? null;
    if (!botSeat) return null;
    const youScore = room.state.players[humanSeat]?.score;
    const botScore = room.state.players[botSeat]?.score;
    if (youScore == null || botScore == null) return null;
    return { youScore, botScore };
  } catch {
    return null;
  }
}

export async function writeFritzForfeitActivityFeed(params: {
  userId: string;
  fritzTier: unknown;
  source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
  youScore?: number | null;
  botScore?: number | null;
}): Promise<void> {
  const tier = typeof params.fritzTier === 'string' && params.fritzTier.trim()
    ? params.fritzTier.trim().toLowerCase()
    : 'elite';
  const localMatchId = params.source?.localMatchId?.trim() || localMatchIdFromRoomCode(params.source?.roomCode) || null;
  const sourceMatchId = localMatchId
    ? `local:${localMatchId}:forfeit`
    : params.source?.roomCode
      ? `${params.source.roomCode}:forfeit`
      : params.source?.verifiedMatchId
        ? `${params.source.verifiedMatchId}:forfeit`
        : null;
  await writeForfeitActivity({
    userId: params.userId,
    opponentUsername: formatFritzActivityOpponentLabel(tier),
    mode: 'bot',
    score: params.youScore ?? null,
    opponentScore: params.botScore ?? null,
    fritzTier: tier,
    sourceMatchId,
  });
}

export async function finalizeFritzForfeit(params: {
  userId: string;
  fritzTier: unknown;
  source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null };
  youScore?: number | null;
  botScore?: number | null;
  /**
   * Server-derived scores only (e.g. readFritzForfeitScoresFromRoom's live
   * room.state read). Never pass client-submitted req.body scores here —
   * they are untrusted and must not determine a Glicko write. When absent,
   * recordPendingFritzDisconnectLoss writes no rating at all rather than
   * inventing a result.
   */
  verifiedScores?: { youScore: number; botScore: number } | null;
}): Promise<void> {
  await recordPendingFritzDisconnectLoss(params.userId, params.fritzTier, params.source, params.verifiedScores ?? null);
  await writeFritzForfeitActivityFeed(params);
}

export function getFritzIdentityForTier(rawTier: unknown): { fritzId: string; gameType: string } {
  const tier = typeof rawTier === 'string' ? rawTier.trim().toLowerCase() : '';
  // Keep storage-compatible legacy game_type while rating identity stays distinct via opponent_id.
  if (tier === 'rookie') return { fritzId: FRITZ_ROOKIE_ID, gameType: 'fritz' };
  if (tier === 'standard') return { fritzId: FRITZ_STANDARD_ID, gameType: 'fritz' };
  if (tier === 'master') return { fritzId: FRITZ_MASTER_ID, gameType: 'fritz' };
  if (tier === 'grandmaster') return { fritzId: FRITZ_GRANDMASTER_ID, gameType: 'fritz' };
  return { fritzId: FRITZ_ELITE_ID, gameType: 'fritz' };
}

export async function insertPendingFritzMatch(room: Room) {
  const pendingContext = getPendingFritzMatchContext(room);
  if (!pendingContext) return;

  await supabaseFetch('/rest/v1/bot_match_pending', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: pendingContext.realPlayer.userId,
      fritz_tier: pendingContext.fritzTier,
      room_code: room.code,
      resolved: false,
    }),
  });
}

export async function resolvePendingFritzMatch(roomCode: string) {
  await supabaseFetch(
    `/rest/v1/bot_match_pending?room_code=eq.${roomCode}&resolved=eq.false`,
    {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true }),
    },
  );
}

export function localMatchIdFromRoomCode(roomCode: string | null | undefined): string | null {
  if (typeof roomCode !== 'string') return null;
  return roomCode.startsWith('local:') ? roomCode.slice('local:'.length) || null : null;
}

export async function resolveLocalFritzAbandonRankedSource(
  userId: string,
  source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null },
): Promise<RankedGameSource | null> {
  if (!isRankedGameSourceColumnsEnabled()) return null;
  const explicitVerifiedMatchId = source?.verifiedMatchId?.trim();
  if (explicitVerifiedMatchId) {
    return { sourceType: 'local_fritz_abandon', sourceMatchId: explicitVerifiedMatchId };
  }

  const localMatchId = source?.localMatchId?.trim() || localMatchIdFromRoomCode(source?.roomCode) || null;
  if (!localMatchId) return null;

  const verifiedMatch = await queryVerifiedSinglePlayerMatchByLocalKey(userId, localMatchId);
  return {
    sourceType: 'local_fritz_abandon',
    sourceMatchId: verifiedMatch?.matchId ?? `local:${localMatchId}:abandon`,
  };
}

/**
 * Records a Fritz loss-by-abandon/disconnect. Requires a server-derived
 * verifiedScores pair (never a client-submitted score, never a synthesized
 * one). If no real score is available at cleanup time — e.g. the stale-match
 * sweep runs long after the in-memory room is gone — this writes NO ranked
 * game and applies NO rating change. That match stays unranked rather than
 * getting a fabricated result.
 */
export async function recordPendingFritzDisconnectLoss(
  userId: string,
  fritzTier: unknown = 'elite',
  source?: { localMatchId?: string | null; roomCode?: string | null; verifiedMatchId?: string | null },
  verifiedScores?: { youScore: number; botScore: number } | null,
) {
  if (!verifiedScores) {
    log.info(
      { userId, fritzTier, source },
      'fritz forfeit has no server-verified score at cleanup time — leaving match unranked, no Glicko write',
    );
    return;
  }

  const profileRows = await supabaseFetch<ProfileRow[]>(`/rest/v1/profiles?id=eq.${userId}&limit=1`);
  const profile = profileRows?.[0];
  if (!profile) {
    throw new Error(`Ranking profile not found for user ${userId}`);
  }
  const { fritzId, gameType } = getFritzIdentityForTier(fritzTier);
  const rankedSource = await resolveLocalFritzAbandonRankedSource(userId, source);

  // RK-1 (HARDENING_PLAN §8.3): route through the idempotent insert so a
  // re-triggered stale-match sweep or retry cannot double-apply this loss.
  // Requires rankedSource to actually carry a per-match-unique
  // sourceMatchId — see resolveLocalFritzAbandonRankedSource's callers for
  // how that id is derived; a roomCode alone is NOT safe here (a rematch in
  // the same room reuses room.code, so `${roomCode}:forfeit` would collide
  // across two genuinely distinct forfeit events).
  const insertResult = await insertRankedGameIdempotent({
    playerId: userId,
    opponentId: fritzId,
    playerScore: verifiedScores.youScore,
    opponentScore: verifiedScores.botScore,
    gameType,
    ratingBefore: profile.glicko_rating ?? 0,
    rdBefore: profile.glicko_rd ?? 0,
    playedAt: new Date().toISOString(),
    source: rankedSource,
  });
  if (!insertResult.isNew) {
    log.info(
      { userId, fritzTier, source: rankedSource },
      'fritz disconnect loss already recorded for this sourceMatchId — skipping duplicate rating application',
    );
    return;
  }

  await processRatingPeriod(userId);
}
