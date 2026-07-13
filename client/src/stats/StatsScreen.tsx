import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { usePlayerIdentityModel } from '../identity/usePlayerIdentityModel';
import { FritzPerformanceSection } from './components/FritzPerformanceSection';
import { GhostPerformanceSection } from './components/GhostPerformanceSection';
import { PlayerRankedOverview } from './components/PlayerRankedOverview';
import { PuzzlePerformanceSection } from './components/PuzzlePerformanceSection';
import { RankedPerformanceSection } from './components/RankedPerformanceSection';
import './statsScreen.css';

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  targetUserId?: string | null;
  profile: UserProfile | null;
  title?: string;
  onClose: () => void;
}

export default function StatsScreen({ open, user, targetUserId = null, profile, title, onClose }: StatsScreenProps) {
  const isUnsupportedPublicTarget = Boolean(targetUserId && targetUserId !== user?.id);
  const identityState = usePlayerIdentityModel({
    subjectUserId: targetUserId ?? user?.id ?? null,
    subjectUsername: targetUserId ? null : profile?.username ?? null,
    currentUserId: user?.id ?? null,
  });
  const model = identityState.model;
  const displayName = profile?.username ? `@${profile.username}` : user?.email ? `@${user.email.split('@')[0]}` : 'Player';
  const headerTitle = title ?? `${displayName} / Stats`;
  if (!open) return null;

  if (identityState.loading) {
    return <div className="stats-page" role="dialog" aria-modal="true" aria-label="Stats" aria-busy="true"><StatsTopbar title={headerTitle} onClose={onClose} /><div className="stats-page-body"><div className="stats-loading-skeleton" aria-label="Loading stats"><span /><span /><span /><span /></div></div></div>;
  }

  if (isUnsupportedPublicTarget) {
    return <div className="stats-page" role="dialog" aria-modal="true" aria-label="Stats"><StatsTopbar title={headerTitle} onClose={onClose} /><div className="stats-page-body"><p className="stats-page-error" role="alert">Personal Stats are available from the player’s own account.</p></div></div>;
  }

  const sourceError = identityState.error && model?.sourceStatus.personal_insights === 'error' ? identityState.error : null;
  return (
    <div className="stats-page" role="dialog" aria-modal="true" aria-label="Stats">
      <StatsTopbar title={headerTitle} onClose={onClose} />
      <main className="stats-page-body">
        {sourceError && <p className="stats-page-error" role="alert">{sourceError}</p>}
        {!model && !sourceError && <p className="stats-page-note">Stats are unavailable.</p>}
        {model && <>
          <PlayerRankedOverview competitive={model.competitive} username={model.subject.username ?? profile?.username ?? null} />
          <RankedPerformanceSection competitive={model.competitive} />
          <FritzPerformanceSection fritz={model.fritz} />
          <GhostPerformanceSection ghost={model.ghost} />
          <PuzzlePerformanceSection puzzle={model.puzzle} />
          {model.sourceStatus.journey === 'ready' && model.subject.isCurrentUser && model.learning.completedNodes != null && model.learning.totalNodes != null && <section className="stats-analysis-card stats-journey-card" aria-labelledby="stats-journey-title"><p className="stats-eyebrow stats-eyebrow--green">Journey progress</p><h2 id="stats-journey-title">{model.learning.activeChapterTitle ?? 'Learning path'}</h2><p>{model.learning.completedNodes} of {model.learning.totalNodes} nodes completed</p></section>}
        </>}
      </main>
    </div>
  );
}

function StatsTopbar({ title, onClose }: { title: string; onClose: () => void }) {
  return <header className="stats-page-topbar"><div className="stats-page-brand">RACEHORSE</div><button type="button" className="stats-page-back rh-back-button" onClick={onClose} aria-label={`Back from ${title}`}><span aria-hidden="true">←</span><span>{title}</span></button></header>;
}
