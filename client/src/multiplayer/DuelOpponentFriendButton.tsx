import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { fetchFriends, sendFriendRequest } from '../friends/friendsApi';
import { IconPlus } from './MultiplayerDuelIcons';

export type FriendRequestState = 'hidden' | 'can-request' | 'sending' | 'pending' | 'friends';

type DuelOpponentFriendButtonProps = {
  currentUserId: string | null;
  opponentUserId: string;
  opponentUsername: string;
  /** Hide for sim/bot opponents or when opponent is self */
  hidden?: boolean;
  onToast?: (message: string) => void;
};

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 6L9 17L4 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DuelOpponentFriendButton({
  currentUserId,
  opponentUserId,
  opponentUsername,
  hidden = false,
  onToast,
}: DuelOpponentFriendButtonProps) {
  const [state, setState] = useState<FriendRequestState>('hidden');

  useEffect(() => {
    if (hidden || !currentUserId || opponentUserId === currentUserId) {
      setState('hidden');
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await fetchFriends(currentUserId);
      if (cancelled) return;
      if (result.friends.some((f) => f.userId === opponentUserId)) {
        setState('friends');
        return;
      }
      const pending =
        result.outgoing.some((f) => f.userId === opponentUserId) ||
        result.incoming.some((f) => f.userId === opponentUserId);
      setState(pending ? 'pending' : 'can-request');
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, opponentUserId, hidden]);

  const handleClick = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!currentUserId || state !== 'can-request') return;
      setState('sending');
      const result = await sendFriendRequest(currentUserId, opponentUsername);
      if (result.error) {
        const err = result.error.toLowerCase();
        if (err.includes('already pending') || err.includes('already friends')) {
          setState(err.includes('friends') ? 'friends' : 'pending');
        } else {
          onToast?.("Couldn't send friend request");
          setState('can-request');
        }
        return;
      }
      setState('pending');
      onToast?.('Friend request sent');
    },
    [currentUserId, opponentUsername, onToast, state],
  );

  if (state === 'hidden') return null;

  const label =
    state === 'sending'
      ? 'Sending...'
      : state === 'pending'
        ? 'Request sent'
        : state === 'friends'
          ? 'Friends'
          : `Send friend request to ${opponentUsername}`;

  if (state === 'friends') {
    return (
      <span
        className="pml-match-add-friend-button pml-match-add-friend-button--friends"
        aria-label={label}
        title="Friends"
      >
        <IconCheck size={14} />
      </span>
    );
  }

  if (state === 'pending') {
    return (
      <span
        className="pml-match-add-friend-button pml-match-add-friend-button--pending"
        aria-label={label}
        title="Request sent"
      >
        <IconCheck size={14} />
      </span>
    );
  }

  return (
    <button
      type="button"
      className="pml-match-add-friend-button"
      onClick={handleClick}
      disabled={state === 'sending'}
      aria-label={label}
      title={state === 'sending' ? 'Sending...' : 'Add friend'}
    >
      {state === 'sending' ? (
        <span className="pml-match-add-friend-button__dots" aria-hidden>
          ···
        </span>
      ) : (
        <IconPlus />
      )}
    </button>
  );
}
