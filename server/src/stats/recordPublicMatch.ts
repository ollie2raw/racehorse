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
    const existing = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matches?metadata->>roomMatchId=eq.${roomMatchIdEnc}&select=id&limit=1`,
    );
    if (existing.length > 0) return;

    await supabaseFetch('/rest/v1/matches', {
      method: 'POST',
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
