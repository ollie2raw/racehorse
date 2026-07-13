import type { PlayerIdentityModel } from '../playerIdentityTypes';
import { getPlayerRatingTier } from '../playerIdentityDerivation';

type Props = {
  subject: PlayerIdentityModel['subject'];
  competitive: PlayerIdentityModel['competitive'];
  canInteract: boolean;
  addingFriend: boolean;
  onAddFriend: () => void;
  onChallenge?: (username: string) => void;
  onSpectate?: (roomCode: string) => void;
};

export function PlayerIdentityHeader({ subject, competitive, canInteract, addingFriend, onAddFriend, onChallenge, onSpectate }: Props) {
  const username = subject.username ?? 'Player';
  const tier = getPlayerRatingTier(competitive.rating, competitive.provisional);
  const isPlaying = subject.presence === 'playing' && Boolean(subject.currentMode);
  const presenceLabel = subject.presence === 'online' ? 'Online' : subject.presence === 'playing' ? 'In Game' : subject.presence === 'offline' ? 'Offline' : 'Unknown';

  return (
    <section className="identity-header" aria-labelledby="player-identity-name">
      <div className="identity-avatar" aria-hidden="true">
        {subject.avatarUrl ? <img src={subject.avatarUrl} alt="" /> : username.slice(0, 2).toUpperCase()}
      </div>
      <div className="identity-header__body">
        <div className="identity-header__name-row">
          <h1 id="player-identity-name">{username}</h1>
          <span className={`identity-presence identity-presence--${subject.presence}`}>
            <span className="identity-presence__dot" aria-hidden="true" />
            {presenceLabel}
          </span>
        </div>
        <div className="identity-header__context">
          <span style={{ color: tier.color }}>{tier.label}</span>
          {competitive.globalRank != null && <span>#{competitive.globalRank} globally</span>}
          {competitive.rankedGames != null && <span>{competitive.rankedGames} ranked games</span>}
        </div>
      </div>
      {canInteract && !subject.isCurrentUser && (
        <div className="identity-header__actions">
          {isPlaying && onSpectate ? (
            <button type="button" className="identity-btn identity-btn--secondary" onClick={() => onSpectate(subject.currentMode!)}>Spectate</button>
          ) : subject.presence === 'online' && onChallenge ? (
            <button type="button" className="identity-btn identity-btn--secondary" onClick={() => onChallenge(username)}>Challenge</button>
          ) : null}
          {subject.friendshipStatus === 'none' && (
            <button type="button" className="identity-btn identity-btn--primary" onClick={onAddFriend} disabled={addingFriend}>
              {addingFriend ? 'Sending…' : 'Add Friend'}
            </button>
          )}
          {subject.friendshipStatus === 'friends' && <span className="identity-status-pill identity-status-pill--friend">Friends</span>}
        </div>
      )}
    </section>
  );
}
