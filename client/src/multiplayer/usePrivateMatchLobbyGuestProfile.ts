import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchRankingProfile } from '../stats/statsApi';
import { normalizeLobbyUsername } from './privateMatchLobbyViewModel';

export type UsePrivateMatchLobbyGuestProfileParams = {
  guestPresent: boolean;
  roomGuestUserId?: string | null;
  roomGuestUsername?: string | null;
};

export type UsePrivateMatchLobbyGuestProfileResult = {
  guestRankedLoading: boolean;
  guestRating: number | null;
  guestWinStreak: number | null;
};

export function usePrivateMatchLobbyGuestProfile({
  guestPresent,
  roomGuestUserId,
  roomGuestUsername,
}: UsePrivateMatchLobbyGuestProfileParams): UsePrivateMatchLobbyGuestProfileResult {
  const [guestRankedLoading, setGuestRankedLoading] = useState(false);
  const [guestRating, setGuestRating] = useState<number | null>(null);
  const [guestWinStreak, setGuestWinStreak] = useState<number | null>(null);

  useEffect(() => {
    if (!guestPresent || !roomGuestUsername) {
      void (async () => {
        await Promise.resolve();
        setGuestRankedLoading(false);
        setGuestRating(null);
        setGuestWinStreak(null);
      })();
      return;
    }

    const uname = normalizeLobbyUsername(roomGuestUsername);
    const isPlaceholderGuest = !uname || uname.toLowerCase() === 'guest';

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setGuestRankedLoading(true);
      setGuestRating(null);
      setGuestWinStreak(null);
      let userId: string | null = roomGuestUserId ?? null;

      if (!userId && supabase && !isPlaceholderGuest) {
        const { data, error } = await supabase.from('profiles').select('id').eq('username', uname).maybeSingle();
        if (!cancelled && !error && data?.id && typeof data.id === 'string') {
          userId = data.id;
        }
      }

      if (!userId) {
        if (!cancelled) {
          setGuestRankedLoading(false);
          setGuestRating(null);
          setGuestWinStreak(null);
        }
        return;
      }

      const { data, error } = await fetchRankingProfile(userId);
      if (cancelled) return;
      setGuestRankedLoading(false);
      if (error || !data) {
        setGuestRating(null);
        setGuestWinStreak(null);
        return;
      }
      setGuestRating(Math.round(Number(data.glicko_rating)));
      setGuestWinStreak(data.currentWinStreak);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestPresent, roomGuestUserId, roomGuestUsername]);

  return { guestRankedLoading, guestRating, guestWinStreak };
}