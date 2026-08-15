import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FritzTier } from '../modules/fritz/fritzConfig';
import type { BotDealSize } from '../modules/match/runtime/botEngine';
import {
  createFritzChallenge,
  getFritzChallenge,
  joinFritzChallenge,
  type FritzChallengeView,
} from './api';
import { buildFritzChallengeShareUrl } from './fritzChallengeLinks';
import { fetchFriendsWithPresence, type FriendWithPresence } from '../social/socialApi';
import './fritzChallenge.css';

type FritzChallengeDialogProps = {
  initialCode: string | null;
  fritzTier: FritzTier;
  dealSize: BotDealSize;
  onClose: () => void;
  onCreated?: (challenge: FritzChallengeView) => void;
  onOpenAuth?: () => void;
};

const TIER_LABELS: Record<FritzTier, string> = {
  rookie: 'Rookie',
  standard: 'Standard',
  elite: 'Elite',
  master: 'Master',
};

function friendlyError(error: unknown): string {
  if (!(error instanceof Error)) return 'Fritz Challenge is unavailable right now.';
  if ((error as Error & { status?: number }).status === 401) {
    return 'Sign in to create or accept a challenge.';
  }
  if (error.message === 'Failed to fetch' || error.message === 'Network error') {
    return 'Couldn’t reach the game server. Check your connection and try again.';
  }
  return error.message;
}

export function FritzChallengeDialog({
  initialCode,
  fritzTier,
  dealSize,
  onClose,
  onCreated,
  onOpenAuth,
}: FritzChallengeDialogProps) {
  const [challenge, setChallenge] = useState<FritzChallengeView | null>(null);
  const [pending, setPending] = useState(Boolean(initialCode));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<FriendWithPresence[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(!initialCode);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [createdChallenges, setCreatedChallenges] = useState<FritzChallengeView[]>([]);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    setError(null);
    const result = await fetchFriendsWithPresence();
    setFriends(result.friends);
    if (result.error) setError(friendlyError(new Error(result.error)));
    setFriendsLoading(false);
  }, []);

  useEffect(() => {
    if (!initialCode) return;
    let cancelled = false;
    void getFritzChallenge(initialCode)
      .then((loaded) => {
        if (!cancelled) setChallenge(loaded);
      })
      .catch((requestError) => {
        if (!cancelled) setError(friendlyError(requestError));
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialCode]);

  useEffect(() => {
    if (initialCode) return;
    let cancelled = false;
    void fetchFriendsWithPresence().then((result) => {
      if (cancelled) return;
      setFriends(result.friends);
      if (result.error) setError(friendlyError(new Error(result.error)));
      setFriendsLoading(false);
    });
    return () => { cancelled = true; };
  }, [initialCode]);

  const shareUrl = useMemo(
    () => challenge && typeof window !== 'undefined'
      ? buildFritzChallengeShareUrl(challenge.share_code, window.location)
      : '',
    [challenge],
  );

  const handleAuthError = useCallback((requestError: unknown) => {
    if ((requestError as Error & { status?: number })?.status === 401) {
      onOpenAuth?.();
    }
    setError(friendlyError(requestError));
  }, [onOpenAuth]);

  const handleCreate = useCallback(async () => {
    if (pending || selectedFriendIds.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const results = await Promise.allSettled(selectedFriendIds.map((recipientUserId) => (
        createFritzChallenge({ fritzTier, dealSize, recipientUserId })
      )));
      const successfulChallenges = results.flatMap((result) => (
        result.status === 'fulfilled' ? [result.value.challenge] : []
      ));
      if (successfulChallenges.length === 0) {
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        throw failure?.reason ?? new Error('No challenges were created.');
      }
      if (successfulChallenges.length === 1 && onCreated) {
        onCreated(successfulChallenges[0]);
      } else {
        setCreatedChallenges(successfulChallenges);
        setSelectedFriendIds([]);
        if (successfulChallenges.length !== selectedFriendIds.length) {
          setError(`Created ${successfulChallenges.length} of ${selectedFriendIds.length} challenges. Share the successful invites below.`);
        }
      }
    } catch (requestError) {
      handleAuthError(requestError);
    } finally {
      setPending(false);
    }
  }, [dealSize, fritzTier, handleAuthError, onCreated, pending, selectedFriendIds]);

  const toggleFriend = useCallback((userId: string) => {
    setSelectedFriendIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }, []);

  const shareCreatedChallenge = useCallback(async (created: FritzChallengeView) => {
    const url = buildFritzChallengeShareUrl(created.share_code, window.location);
    if (navigator.share) {
      await navigator.share({
        title: 'Racehorse Fritz Challenge',
        text: `Play my ${TIER_LABELS[created.fritz_tier]} Fritz best-of-three challenge.`,
        url,
      });
      return;
    }
    await navigator.clipboard.writeText(url);
  }, []);

  const handleJoin = useCallback(async () => {
    if (!challenge || pending) return;
    setPending(true);
    setError(null);
    try {
      setChallenge(await joinFritzChallenge(challenge.share_code));
    } catch (requestError) {
      handleAuthError(requestError);
    } finally {
      setPending(false);
    }
  }, [challenge, handleAuthError, pending]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    if (!challenge || !shareUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: 'Racehorse Fritz Challenge',
        text: `Play my ${TIER_LABELS[challenge.fritz_tier]} Fritz best-of-three challenge.`,
        url: shareUrl,
      });
      return;
    }
    await handleCopy();
  }, [challenge, handleCopy, shareUrl]);

  const isIncoming = Boolean(initialCode);
  const canJoin = challenge?.viewer_role === 'opponent'
    && challenge.status === 'open'
    && !challenge.recipient_accepted;

  return createPortal(
    <div className="fritz-challenge-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fritz-challenge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fritz-challenge-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="fritz-challenge-close" onClick={onClose} aria-label="Close">×</button>
        <span className="fritz-challenge-eyebrow">
          {isIncoming ? 'FRITZ CHALLENGE INVITE' : 'CHALLENGE A FRIEND'}
        </span>
        <h2 id="fritz-challenge-title">
          {isIncoming ? 'Same deal. Your best run.' : 'Create a shared best of three.'}
        </h2>
        <p className="fritz-challenge-intro">
          Both players face Fritz on the same fixed deals. Compare the verified result when both runs finish.
        </p>

        {pending && !challenge ? <div className="fritz-challenge-state">Loading challenge…</div> : null}
        {error ? <div className="fritz-challenge-error" role="alert">{error}</div> : null}

        {!challenge && !initialCode && createdChallenges.length === 0 ? (
          <>
            <div className="fritz-challenge-summary">
              <div><span>Format</span><strong>Best of 3</strong></div>
              <div><span>Fritz</span><strong>{TIER_LABELS[fritzTier]}</strong></div>
              <div><span>Deal</span><strong>{dealSize} tiles</strong></div>
              <div><span>Target</span><strong>First to 60</strong></div>
            </div>
            <div className="fritz-challenge-recipient-picker" aria-label="Choose a friend to challenge">
              <span>CHOOSE FRIEND</span>
              {friendsLoading ? <div className="fritz-challenge-state">Loading friends…</div> : null}
              {!friendsLoading && !error && friends.length === 0 ? (
                <div className="fritz-challenge-state">Add an accepted friend before creating a verified challenge.</div>
              ) : null}
              {!friendsLoading && error ? (
                <div className="fritz-challenge-state">
                  <span>Friends could not be loaded.</span>
                  <button type="button" onClick={() => void loadFriends}>Retry</button>
                </div>
              ) : null}
              {!friendsLoading ? (
                <div className="fritz-challenge-friend-list" aria-label="Friends">
                  {friends.map((friend) => (
                    <button
                      key={friend.userId}
                      type="button"
                      className={selectedFriendIds.includes(friend.userId) ? 'is-selected' : ''}
                      aria-pressed={selectedFriendIds.includes(friend.userId)}
                      onClick={() => toggleFriend(friend.userId)}
                    >
                      <strong>@{friend.username}</strong>
                      <span>{friend.presence_status === 'online' ? 'Online' : 'Invite to play anytime'}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="fritz-challenge-primary" disabled={pending || selectedFriendIds.length === 0} onClick={handleCreate}>
              {pending ? 'Sending invites…' : selectedFriendIds.length === 1 ? 'Send Challenge' : selectedFriendIds.length > 1 ? `Send to ${selectedFriendIds.length} friends` : 'Select friends'}
            </button>
          </>
        ) : null}

        {!challenge && !initialCode && createdChallenges.length > 0 ? (
          <div className="fritz-challenge-batch-success">
            <strong>{createdChallenges.length} challenges created</strong>
            <span>Each invite is locked to its selected friend. Share each link below.</span>
            <div className="fritz-challenge-batch-list">
              {createdChallenges.map((created) => (
                <div key={created.id} className="fritz-challenge-batch-item">
                  <div>
                    <strong>{created.share_code}</strong>
                    <span>{TIER_LABELS[created.fritz_tier]} · Best of 3</span>
                  </div>
                  <button type="button" onClick={() => void shareCreatedChallenge(created)}>Share invite</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {challenge ? (
          <>
            <div className="fritz-challenge-code">
              <span>CHALLENGE CODE</span>
              <strong>{challenge.share_code}</strong>
            </div>
            <div className="fritz-challenge-summary">
              <div><span>Format</span><strong>Best of 3</strong></div>
              <div><span>Fritz</span><strong>{TIER_LABELS[challenge.fritz_tier]}</strong></div>
              <div><span>Deal</span><strong>{challenge.deal_size} tiles</strong></div>
              <div><span>Status</span><strong>{challenge.recipient_accepted ? 'Accepted' : 'Invite sent'}</strong></div>
            </div>

            {canJoin ? (
              <button className="fritz-challenge-primary" disabled={pending} onClick={handleJoin}>
                {pending ? 'Accepting…' : 'Accept Challenge'}
              </button>
            ) : (
              <div className="fritz-challenge-ready">
                <strong>
                  {challenge.viewer_role === 'creator'
                    ? challenge.recipient_accepted ? 'Your friend accepted.' : 'Your invite is sent.'
                    : 'Challenge accepted.'}
                </strong>
                <span>The shared deal is locked and waiting for both verified runs.</span>
              </div>
            )}

            {challenge.viewer_role === 'creator' ? (
              <div className="fritz-challenge-actions">
                <button onClick={handleCopy}>{copied ? 'Copied' : 'Copy Link'}</button>
                <button onClick={handleShare}>Share</button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
