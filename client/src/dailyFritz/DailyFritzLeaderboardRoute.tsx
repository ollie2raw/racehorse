import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import { getTodayDailyFritz } from './api';
import DailyFritzLeaderboardScreen from './DailyFritzLeaderboardScreen';

interface DailyFritzLeaderboardRouteProps {
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
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
  onOpenAccount,
}: DailyFritzLeaderboardRouteProps) {
  const [runDate, setRunDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getTodayDailyFritz()
      .then((today) => {
        if (cancelled) return;
        setRunDate(today.run_date || pacificRunDateFallback());
      })
      .catch(() => {
        if (cancelled) return;
        setRunDate(pacificRunDateFallback());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !runDate) {
    return (
      <div className="rh-hub-page dflb-page" style={{ display: 'grid', placeItems: 'center' }}>
        <p style={{ color: 'rgba(148,163,184,0.8)', fontFamily: 'var(--font-body)' }}>Loading leaderboard…</p>
      </div>
    );
  }

  return (
    <DailyFritzLeaderboardScreen
      user={user}
      runDate={runDate}
      currentUsername={profile?.username ?? null}
      onBack={onClose}
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onOpenAccount={onOpenAccount}
    />
  );
}
