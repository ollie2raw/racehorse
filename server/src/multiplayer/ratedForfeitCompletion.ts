import { childLogger } from '../logger';
import { processRealtimeMultiplayerGame, type RealtimeRatingResult, type Profile } from '../ranking/periodService';
import type { MatchOutcome } from '../ranking/glicko2';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';
import type { ProfileRow } from '../supabaseTypes';
import { recordMatchEnd } from '../matchmaking/persistence';
import type { ForfeitReason } from './terminalCompletion';

const log = childLogger('rated-forfeit-completion');

export type RatedForfeitSeat = { seatId: string; userId: string };

export type RatedForfeitCompletionInput = {
  roomCode: string;
  /** `room.matchId` — the (player_id, source_match_id) idempotency key. */
  sourceMatchId: string;
  /** Seat order is the room's engine seat order (A = players[0]). */
  a: RatedForfeitSeat;
  b: RatedForfeitSeat;
  scoreA: number;
  scoreB: number;
  /** The seat that quit. The quitter is the loser whatever the scoreboard said. */
  abandonerSeatId: string;
  forfeitReason: ForfeitReason;
  /** Latch time (`room.abandonedAt`): stable across foreground and restart replay. */
  playedAt: string;
  matchmakingMatchId?: string | null;
  winnerUserId: string | null;
};

export type RatedForfeitCompletionResult =
  | { status: 'logged'; ratingResult: RealtimeRatingResult | null }
  /** A profile is missing: nothing can be rated, and retrying will not change that. */
  | { status: 'unrated'; reason: 'profile_missing' };

/**
 * The rated half of a forfeit, shared by the foreground handler and the restart-time replay.
 * Throws on any transient failure (the caller keeps the completion pending); every write is
 * idempotent on (player_id, source_match_id) and the rating commit on its own receipt, so
 * running it again after a crash or lost response is safe.
 */
export async function completeRatedForfeit(
  input: RatedForfeitCompletionInput,
): Promise<RatedForfeitCompletionResult> {
  const { a, b } = input;
  const abandonerIsSeatA = input.abandonerSeatId === a.seatId;
  // The quitter loses even when ahead on points — rating and history must agree.
  const outcomeA: MatchOutcome = abandonerIsSeatA ? 'loss' : 'win';
  const outcomeB: MatchOutcome = abandonerIsSeatA ? 'win' : 'loss';
  const ratingTreatment = input.forfeitReason === 'disconnect_timeout' ? 'disconnect_forfeit' : 'standard';
  const completionCause = input.forfeitReason === 'disconnect_timeout' ? 'disconnect_timeout' : 'manual_forfeit';

  const [profilesA, profilesB] = await Promise.all([
    supabaseFetch<ProfileRow[]>(`/rest/v1/profiles?id=eq.${a.userId}`),
    supabaseFetch<ProfileRow[]>(`/rest/v1/profiles?id=eq.${b.userId}`),
  ]);
  const profileA = profilesA?.[0];
  const profileB = profilesB?.[0];
  if (!profileA || !profileB) {
    log.warn({ roomCode: input.roomCode, sourceMatchId: input.sourceMatchId }, 'forfeit rating skipped: profile missing');
    await endMatchmakingMatch(input, null);
    return { status: 'unrated', reason: 'profile_missing' };
  }

  const [insertA, insertB] = await Promise.all([
    insertRankedGameIdempotent({
      playerId: a.userId,
      opponentId: b.userId,
      playerScore: input.scoreA,
      opponentScore: input.scoreB,
      gameType: 'multiplayer',
      ratingBefore: profileA.glicko_rating ?? 0,
      rdBefore: profileA.glicko_rd ?? 0,
      playedAt: input.playedAt,
      ratingTreatment,
      completionCause,
      opponentRating: profileB.glicko_rating ?? NaN,
      opponentRd: profileB.glicko_rd ?? NaN,
      outcome: outcomeA,
      source: { sourceType: 'live_room', sourceMatchId: input.sourceMatchId },
    }),
    insertRankedGameIdempotent({
      playerId: b.userId,
      opponentId: a.userId,
      playerScore: input.scoreB,
      opponentScore: input.scoreA,
      gameType: 'multiplayer',
      ratingBefore: profileB.glicko_rating ?? 0,
      rdBefore: profileB.glicko_rd ?? 0,
      playedAt: input.playedAt,
      ratingTreatment,
      completionCause,
      opponentRating: profileA.glicko_rating ?? NaN,
      opponentRd: profileA.glicko_rd ?? NaN,
      outcome: outcomeB,
      source: { sourceType: 'live_room', sourceMatchId: input.sourceMatchId },
    }),
  ]);

  let ratingResult: RealtimeRatingResult | null = null;
  if (insertA.isNew && insertB.isNew && insertA.game && insertB.game) {
    ratingResult = await processRealtimeMultiplayerGame({
      playerAProfile: profileA as Profile,
      playerBProfile: profileB as Profile,
      playerAGame: insertA.game,
      playerBGame: insertB.game,
    });
    log.info(
      {
        roomCode: input.roomCode,
        forfeitReason: input.forfeitReason,
        ratingTreatment,
        completionCause,
        outcomeA,
        outcomeB,
        deltaA: ratingResult.playerA.delta,
        deltaB: ratingResult.playerB.delta,
      },
      'forfeit rating update complete',
    );
  }
  // A duplicate pair (replay after a crash that already inserted) leaves any pending rating
  // application to the ranked catch-up, which owns every unrated ranked_games row.

  await endMatchmakingMatch(input, ratingResult);
  return { status: 'logged', ratingResult };
}

async function endMatchmakingMatch(
  input: RatedForfeitCompletionInput,
  ratingResult: RealtimeRatingResult | null,
): Promise<void> {
  if (!input.matchmakingMatchId) return;
  // First-terminal-writer PATCH (status=in_progress): a replay is a harmless no-op.
  await recordMatchEnd({
    matchId: input.matchmakingMatchId,
    status: 'forfeit',
    winnerId: input.winnerUserId,
    playerARatingChange: ratingResult?.playerA?.delta ?? null,
    playerBRatingChange: ratingResult?.playerB?.delta ?? null,
    isSim: false,
    throwOnError: true,
  });
}
