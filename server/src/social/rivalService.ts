import { supabaseFetch } from '../supabaseUtils';
import { dedupeMatchRows } from '../stats/dedupeMatchRows';

export interface RivalEntry {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
}

export async function getAutoRivals(userId: string): Promise<RivalEntry[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const enc = encodeURIComponent(userId);

  const matches = dedupeMatchRows(
    await supabaseFetch<Array<{
      winner_user_id: string | null;
      loser_user_id: string | null;
      winner_score: number | null;
      loser_score: number | null;
      created_at: string;
      room_code: string | null;
    }>>(
      `/rest/v1/matches` +
      `?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
      `&created_at=gte.${encodeURIComponent(since)}` +
      `&mode=eq.online` +
      `&select=winner_user_id,loser_user_id,winner_score,loser_score,room_code,created_at`,
    ),
  );

  const tally = new Map<string, { wins: number; losses: number }>();
  for (const m of matches) {
    const opponentId = m.winner_user_id === userId ? m.loser_user_id : m.winner_user_id;
    if (!opponentId || opponentId === userId) continue;
    const existing = tally.get(opponentId) ?? { wins: 0, losses: 0 };
    if (m.winner_user_id === userId) existing.wins += 1;
    else existing.losses += 1;
    tally.set(opponentId, existing);
  }

  const sorted = [...tally.entries()]
    .map(([id, rec]) => ({ id, games: rec.wins + rec.losses, wins: rec.wins, losses: rec.losses }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  if (!sorted.length) return [];

  const idFilter = sorted.map((s) => `id.eq.${encodeURIComponent(s.id)}`).join(',');
  const profiles = await supabaseFetch<
    Array<{ id: string; username: string; glicko_rating: number | null }>
  >(`/rest/v1/profiles?or=(${idFilter})&select=id,username,glicko_rating`);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const rivals = sorted.map((s) => {
    const profile = profileMap.get(s.id);
    return {
      userId: s.id,
      username: profile?.username ?? 'player',
      gamesPlayed: s.games,
      winsAgainst: s.wins,
      lossesAgainst: s.losses,
      rating: profile?.glicko_rating != null ? Number(profile.glicko_rating) : null,
    };
  });

  return rivals;
}
