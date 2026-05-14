import type { User } from '@supabase/supabase-js';
import ActivityFeedPanel from './ActivityFeedPanel';
import './activityFeedScreen.css';

interface ActivityFeedScreenProps {
  user: User | null;
  onViewProfile: (username: string) => void;
  onClose: () => void;
  onNavigateToFriends?: () => void;
}

export default function ActivityFeedScreen({ user, onViewProfile, onClose, onNavigateToFriends }: ActivityFeedScreenProps) {
  return (
    <div className="rh-afs-screen">
      <div className="rh-afs-header">
        <button className="rh-afs-back" onClick={onClose} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="rh-afs-title-block">
          <h1 className="rh-afs-title">Activity Feed</h1>
          <span className="rh-afs-subtitle">Friends · Recent Activity</span>
        </div>
      </div>

      <div className="rh-afs-body">
        {!user ? (
          <div className="rh-afs-empty">
            <p className="rh-afs-empty-text">Sign in to see your friends' activity.</p>
          </div>
        ) : (
          <ActivityFeedPanel
            user={user}
            onViewProfile={onViewProfile}
            emptyAction={
              onNavigateToFriends ? (
                <button className="rh-afs-cta" onClick={onNavigateToFriends}>
                  Add Friends
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
