import { FRIEND_CHALLENGE_MATCH_SUMMARY, type FriendInvitePayload } from './friendChallenge';
import './friendChallenge.css';

interface IncomingFriendChallengeCardProps {
  invite: FriendInvitePayload;
  joining: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingFriendChallengeCard({
  invite,
  joining,
  onAccept,
  onDecline,
}: IncomingFriendChallengeCardProps) {
  const summary = invite.matchSummary || FRIEND_CHALLENGE_MATCH_SUMMARY;
  const initials = invite.fromUsername.slice(0, 2).toUpperCase();

  return (
    <div className="rh-friend-challenge-card" role="dialog" aria-label="Incoming challenge">
      <div className="rh-friend-challenge-card__avatar" aria-hidden>
        {initials}
      </div>
      <div className="rh-friend-challenge-card__copy">
        <p className="rh-friend-challenge-card__title">
          <strong>@{invite.fromUsername}</strong> challenged you to a private match.
        </p>
        <p className="rh-friend-challenge-card__meta">{summary}</p>
      </div>
      <div className="rh-friend-challenge-card__actions">
        <button
          type="button"
          className="rh-friend-challenge-card__btn rh-friend-challenge-card__btn--accept"
          onClick={onAccept}
          disabled={joining}
        >
          {joining ? 'Joining…' : 'Accept'}
        </button>
        <button
          type="button"
          className="rh-friend-challenge-card__btn rh-friend-challenge-card__btn--decline"
          onClick={onDecline}
          disabled={joining}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
