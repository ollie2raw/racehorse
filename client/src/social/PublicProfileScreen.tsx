import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { sendFriendRequest } from '../friends/friendsApi';
import { usePlayerIdentityModel } from '../identity/usePlayerIdentityModel';
import { PlayerCompetitiveSummary } from '../identity/components/PlayerCompetitiveSummary';
import { PlayerIdentityHeader } from '../identity/components/PlayerIdentityHeader';
import { PlayerIdentityHighlights } from '../identity/components/PlayerIdentityHighlights';
import { PlayerMilestoneShelf } from '../identity/components/PlayerMilestoneShelf';
import { selectNonDuplicateMilestones } from '../identity/components/PlayerMilestoneShelf';
import { PlayerModeSummary } from '../identity/components/PlayerModeSummary';
import { PlayerRecentForm } from '../identity/components/PlayerRecentForm';
import { PlayerRelationshipCard } from '../identity/components/PlayerRelationshipCard';
import './publicProfile.css';

interface PublicProfileScreenProps {
  username: string;
  user: User | null;
  onClose: () => void;
  showToast: (msg: string) => void;
  onChallenge?: (username: string) => void;
  onSpectate?: (roomCode: string) => void;
}

export default function PublicProfileScreen({ username, user, onClose, showToast, onChallenge, onSpectate }: PublicProfileScreenProps) {
  const identityState = usePlayerIdentityModel({ subjectUserId: null, subjectUsername: username, currentUserId: user?.id ?? null });
  const model = identityState.model;
  const [addingFriend, setAddingFriend] = useState(false);

  const handleAddFriend = async () => {
    if (!user || !model?.subject.username) return;
    setAddingFriend(true);
    const result = await sendFriendRequest(user.id, model.subject.username);
    setAddingFriend(false);
    if (result.error) { showToast(result.error); return; }
    showToast(`Friend request sent to ${model.subject.username}`);
  };

  if (identityState.loading) {
    return <div className="rh-pp-screen" aria-busy="true"><div className="rh-pp-loading"><div className="identity-loading-skeleton" aria-label="Loading player profile"><span className="identity-loading-skeleton__avatar" /><span className="identity-loading-skeleton__line identity-loading-skeleton__line--name" /><span className="identity-loading-skeleton__line" /><span className="identity-loading-skeleton__panel" /></div></div></div>;
  }

  if (!model || model.sourceStatus.public_profile === 'error' || model.sourceStatus.public_profile === 'unavailable') {
    return <div className="rh-pp-screen"><div className="rh-pp-header"><button type="button" className="rh-pp-back" onClick={onClose} aria-label="Back"><span aria-hidden="true">←</span></button></div><div className="rh-pp-error-state" role="alert">{identityState.error ?? 'Player not found.'}</div></div>;
  }

  const featuredRelationship = model.identitySignals.featured.some((signal) => signal.domain === 'rivalry');
  const remainingMilestones = selectNonDuplicateMilestones(model.identitySignals.featured, model.milestones);

  return (
    <div className="rh-pp-screen">
      <div className="rh-pp-header">
        <button type="button" className="rh-pp-back" onClick={onClose} aria-label="Back"><span aria-hidden="true">←</span></button>
        <span className="rh-pp-breadcrumb">Player Profile</span>
      </div>
      <main className="rh-pp-content">
        <PlayerIdentityHeader
          subject={model.subject}
          competitive={model.competitive}
          canInteract={Boolean(user)}
          addingFriend={addingFriend}
          onAddFriend={handleAddFriend}
          onChallenge={onChallenge}
          onSpectate={onSpectate}
        />
        <PlayerIdentityHighlights signals={model.identitySignals.featured} isCurrentUser={model.subject.isCurrentUser} />
        <PlayerCompetitiveSummary competitive={model.competitive} />
        <PlayerModeSummary model={model} />
        <PlayerRecentForm competitive={model.competitive} />
        <PlayerMilestoneShelf milestones={remainingMilestones} />
        <PlayerRelationshipCard subject={model.subject} rivalry={model.rivalry} featuredRelationship={featuredRelationship} />
      </main>
    </div>
  );
}
