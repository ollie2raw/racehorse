import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import { useAsyncData } from '../hooks/useAsyncData';
import { getTodayDailyFritz } from './api';
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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
  const { data, loading, error } = useAsyncData(() => getTodayDailyFritz(), []);
  const today = data ?? null;
  const runDate = data
    ? data.run_date || pacificRunDateFallback()
    : error
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
