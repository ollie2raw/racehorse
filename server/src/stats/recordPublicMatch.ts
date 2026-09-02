import { supabaseFetch } from '../supabaseUtils';

export async function recordPublicOnlineMatch(input: {
  roomCode: string;
  roomMatchId: string;
  winnerUserId: string;
  loserUserId: string;
  winnerScore: number;
  loserScore: number;
}): Promise<void> {
  try {
    const roomMatchIdEnc = encodeURIComponent(input.roomMatchId);
    // Fast-path only — NOT the idempotency guarantee. The partial unique index
    // `matches_room_match_id_uidx` on ((metadata->>'roomMatchId')) plus
    // `resolution=ignore-duplicates` below is what makes this safe under the
    // game-over persist retry (MP-G4).
    const existing = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matches?metadata->>roomMatchId=eq.${roomMatchIdEnc}&select=id&limit=1`,
    );
    if (existing.length > 0) return;

    await supabaseFetch('/rest/v1/matches', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify({
        mode: 'online',
        room_code: input.roomCode,
        winner_user_id: input.winnerUserId,
        loser_user_id: input.loserUserId,
        winner_score: input.winnerScore,
        loser_score: input.loserScore,
        metadata: {
          opponentType: 'online',
          roomMatchId: input.roomMatchId,
          roomCode: input.roomCode,
        },
      }),
    });
  } catch (err) {
    console.warn(
      '[stats] recordPublicOnlineMatch failed',
      err instanceof Error ? err.message : err,
    );
  }
}
