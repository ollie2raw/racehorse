import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import { GlobalNav } from '../components/GlobalNav';
import { usePlayerIdentityModel } from '../identity/usePlayerIdentityModel';
import { DailyFritzPerformanceSection } from './components/DailyFritzPerformanceSection';
import { FritzPerformanceSection } from './components/FritzPerformanceSection';
import { GhostPerformanceSection } from './components/GhostPerformanceSection';
import { JourneyProgressCard } from './components/JourneyProgressCard';
import { PuzzlePerformanceSection } from './components/PuzzlePerformanceSection';
import { RankedPerformanceSection } from './components/RankedPerformanceSection';
import { RivalCard } from './components/RivalCard';
import { StatsIdentityHero } from './components/StatsIdentityHero';
import './statsScreen.css';

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  targetUserId?: string | null;
  profile: UserProfile | null;
  title?: string;
  onClose: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

/**
 * Personal stats.
 *
 * A normal route page, not a modal: it was the one route rendering a
 * full-screen `role="dialog"` with its own bare topbar and no site nav. It now
 * carries the app's nav over a single scrollport, the same shape as Settings
 * and the rules article.
 */
export default function StatsScreen({
  open,
  user,
  targetUserId = null,
  profile,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: StatsScreenProps) {
  const isUnsupportedPublicTarget = Boolean(targetUserId && targetUserId !== user?.id);
  const identityState = usePlayerIdentityModel({
    subjectUserId: targetUserId ?? user?.id ?? null,
    subjectUsername: targetUserId ? null : (profile?.username ?? null),
    currentUserId: user?.id ?? null,
  });
  const model = identityState.model;

  if (!open) return null;

  const username = model?.subject.username ?? profile?.username ?? null;
  const sourceError =
    identityState.error && model?.sourceStatus.personal_insights === 'error'
      ? identityState.error
      : null;

  return (
    <div className="rh-stats-page">
      <GlobalNav
        currentMode="stats"
        activeColor="var(--tier-elite)"
        solidDarkChrome
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onSignOut={onSignOut}
      />
      <div className="rh-stats-scroll">
        <main className="rh-stats" aria-busy={identityState.loading || undefined}>
          {identityState.loading && (
            <div className="rh-stats-skeleton" aria-label="Loading stats">
              <span />
              <span />
              <span />
              <span />
            </div>
          )}

          {!identityState.loading && isUnsupportedPublicTarget && (
            <p className="rh-stats-note" role="alert">
              Personal Stats are available from the player’s own account.
            </p>
          )}

          {!identityState.loading && !isUnsupportedPublicTarget && (
            <>
              {sourceError && (
                <p className="rh-stats-note rh-stats-note--error" role="alert">
                  {sourceError}
                </p>
              )}
              {!model && !sourceError && <p className="rh-stats-note">Stats are unavailable.</p>}
              {model && (
                <>
                  <StatsIdentityHero username={username} competitive={model.competitive} />
                  <div className="rh-stats-grid">
                    <RankedPerformanceSection competitive={model.competitive} />
                    <FritzPerformanceSection fritz={model.fritz} />
                    <DailyFritzPerformanceSection dailyFritz={model.dailyFritz} />
                    <GhostPerformanceSection ghost={model.ghost} />
                    <PuzzlePerformanceSection puzzle={model.puzzle} />
                    {model.subject.isCurrentUser && model.sourceStatus.journey === 'ready' && (
                      <JourneyProgressCard learning={model.learning} />
                    )}
                    <RivalCard rivalry={model.rivalry} />
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
