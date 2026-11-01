import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import { useAsyncData } from '../hooks/useAsyncData';
import { getTodayDailyFritz } from './api';
import { pacificDateText } from './dailyFritzScreenHelpers';
import DailyFritzLeaderboardScreen from './DailyFritzLeaderboardScreen';
import { DailyFritzLeaderboardLoading } from './DailyFritzLeaderboardLoading';

interface DailyFritzLeaderboardRouteProps {
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

function pacificRunDateFallback(): string {
  return pacificDateText(new Date());
}

export default function DailyFritzLeaderboardRoute({
  user,
  profile,
  onClose,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: DailyFritzLeaderboardRouteProps) {
  // `today` is kept so the screen can seed from this response instead of
  // fetching /api/daily-fritz/today a second time for byte-identical data.
  // /api/daily-fritz/today needs a signed-in user: a visitor asking for it only gets a 401 (and a console error). They
  // still see the board, dated by the Pacific day, with the sign-in prompt the screen already shows.
  const signedIn = Boolean(user);
  const { data, loading, error } = useAsyncData(() => getTodayDailyFritz(), [user?.id], { enabled: signedIn });
  const today = data ?? null;
  const runDate = data
    ? data.run_date || pacificRunDateFallback()
    : error || !signedIn
      ? pacificRunDateFallback()
      : null;

  if (loading || !runDate) {
    return <DailyFritzLeaderboardLoading onBack={onClose} />;
  }

  return (
    <DailyFritzLeaderboardScreen
      user={user}
      runDate={runDate}
      initialToday={today}
      currentUsername={profile?.username ?? null}
      glickoRating={profile?.glicko_rating ?? null}
      onBack={onClose}
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onSignOut={onSignOut}
    />
  );
}
