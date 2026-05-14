import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import StatsScreen from '../stats/StatsScreen';
import ActivityFeedPanel from '../social/ActivityFeedPanel';
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  type FriendRecord,
  type FriendRequestRecord,
} from './friendsApi';
import { fetchFriendsWithPresence, type PresenceStatus } from '../social/socialApi';
import './friendsScreen.css';

interface FriendsScreenProps {
  open: boolean;
  user: User | null;
  socket: Socket | null;
  joinedRoom: string | null;
  currentUsername: string;
  onClose: () => void;
  showToast: (msg: string, duration?: number) => void;
  onCopyInviteLink: () => Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }>;
  onCreatePrivateRoom?: () => Promise<{ ok: boolean; roomCode: string | null; inviteUrl: string | null }>;
  onViewProfile?: (username: string) => void;
}

function PresenceDot({ status }: { status: PresenceStatus | boolean }) {
  const normalized: PresenceStatus = typeof status === 'boolean'
    ? (status ? 'online' : 'offline')
    : status;
  const color = normalized === 'online'
    ? '#4ADE80'
    : normalized === 'in_game'
    ? '#E7B64A'
    : 'rgba(255,255,255,0.18)';
  const glow = normalized === 'online'
    ? '0 0 8px #4ADE8088'
    : normalized === 'in_game'
    ? '0 0 8px #E7B64A66'
    : 'none';
  const label = normalized === 'online' ? 'Online' : normalized === 'in_game' ? 'In Game' : 'Offline';
  return (
    <span
      aria-hidden="true"
      className="friends-page-dot"
      title={label}
      style={{ background: color, boxShadow: glow }}
    />
  );
}

export default function FriendsScreen({
  open,
  user,
  socket,
  joinedRoom,
  currentUsername,
  onClose,
  showToast,
  onCopyInviteLink,
  onCreatePrivateRoom,
  onViewProfile,
}: FriendsScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceStatus>>(new Map());
  const [query, setQuery] = useState('');
  const [selectedFriend, setSelectedFriend] = useState<FriendRecord | null>(null);
  const [copiedFriendId, setCopiedFriendId] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    if (!open || !user) return;
    setLoading(true);
    const resp = await fetchFriends(user.id);
    setLoading(false);
    setError(resp.error);
    setFriends(resp.friends);
    setIncoming(resp.incoming);
    setOutgoing(resp.outgoing);
  }, [open, user]);

  const refreshPresence = useCallback(async () => {
    if (!open || !user) return;
    const result = await fetchFriendsWithPresence();
    if (!result.error && result.friends.length > 0) {
      const map = new Map<string, PresenceStatus>();
      for (const f of result.friends) map.set(f.userId, f.presence_status);
      setPresenceMap(map);
    }
  }, [open, user]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    void refreshPresence();
    const interval = setInterval(() => { void refreshPresence(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshPresence]);

  // Keep legacy socket-based online check as fallback for invited rooms
  useEffect(() => {
    if (!open || !socket || friends.length === 0) return;
    const friendUserIds = friends.map((f) => f.userId);
    const checkPresence = () => {
      if (!socket.connected) return;
      socket.emit('presence:online', friendUserIds, (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
        if (!resp?.ok) return;
        const set = new Set(resp.onlineUserIds ?? []);
        setPresenceMap((prev) => {
          const next = new Map(prev);
          for (const id of friendUserIds) {
            if (!next.has(id)) next.set(id, set.has(id) ? 'online' : 'offline');
          }
          return next;
        });
      });
    };
    checkPresence();
    socket.on('connect', checkPresence);
    return () => { socket.off('connect', checkPresence); };
  }, [open, socket, friends.length]);

  const onlineCount = useMemo(
    () => friends.filter((f) => {
      const s = presenceMap.get(f.userId);
      return s === 'online' || s === 'in_game';
    }).length,
    [friends, presenceMap],
  );
  const hasPendingRequests = incoming.length > 0 || outgoing.length > 0;

  if (!open) return null;

  return (
    <div className="friends-page" role="dialog" aria-modal="true" aria-label="Friends">
      {/* ── Top bar ── */}
      <header className="friends-page-topbar">
        <div className="friends-page-brand">RACEHORSE</div>
        <button type="button" className="friends-page-back rh-back-button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>Back to Home</span>
        </button>
      </header>

      {/* ── Split layout ── */}
      <div className="friends-page-split">

        {/* Left hero */}
        <div className="friends-page-hero">
          <div className="friends-page-hero__atmo" aria-hidden="true" />
          <div className="friends-page-hero__line" aria-hidden="true" />
          <div className="friends-page-hero__decor" aria-hidden="true">F</div>
          <div className="friends-page-hero__content">
            <p className="friends-page-hero__eyebrow">SOCIAL</p>
            <h1 className="friends-page-hero__title">FRIENDS</h1>
            <div className="friends-page-hero__stats">
              <div className="friends-page-hero__stat">
                <span className="friends-page-hero__stat-val friends-page-hero__stat-val--online">{onlineCount}</span>
                <span className="friends-page-hero__stat-label">ONLINE</span>
              </div>
              <div className="friends-page-hero__stat">
                <span className="friends-page-hero__stat-val">{friends.length}</span>
                <span className="friends-page-hero__stat-label">FRIENDS</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right control pane */}
        <div className="friends-page-panel">

          {!user && (
            <p className="friends-page-auth-note">Sign in to use friends.</p>
          )}

          {user && (
            <>
              {/* Add friend */}
              <p className="friends-page-section-label">Add Friend</p>
              <div className="friends-page-add-row">
                <input
                  type="text"
                  placeholder="USERNAME"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="friends-page-input"
                />
                <button
                  type="button"
                  className="friends-page-add-btn"
                  onClick={async () => {
                    const resp = await sendFriendRequest(user.id, query);
                    if (resp.error) { setError(resp.error); return; }
                    setQuery('');
                    setError(null);
                    await loadFriends();
                  }}
                >
                  Add
                </button>
              </div>

              {error && <p className="friends-page-error">{error}</p>}
              {loading && <p className="friends-page-note">Loading friends…</p>}

              {/* Friends list */}
              {!loading && (
                <>
                  <p className="friends-page-section-label">Your Friends</p>
                  {friends.length === 0 && (
                    <p className="friends-page-note">No friends yet. Add someone by username above.</p>
                  )}
                  <div className="friends-page-list">
                    {friends.map((friend) => {
                      const presenceStatus = presenceMap.get(friend.userId) ?? 'offline';
                      const isAvailable = presenceStatus === 'online' || presenceStatus === 'in_game';
                      return (
                        <div key={friend.id} className="friends-page-row">
                          <div className="friends-page-row__left">
                            <PresenceDot status={presenceStatus} />
                            <div>
                              <div className="friends-page-row__name">@{friend.username}</div>
                              <div className="friends-page-row__meta">
                                {presenceStatus === 'in_game' ? 'In Game' : presenceStatus === 'online' ? 'Online' : 'Offline'}
                              </div>
                            </div>
                          </div>
                          <div className="friends-page-row__actions">
                            {onViewProfile && (
                              <button
                                type="button"
                                className="friends-page-action-btn"
                                onClick={() => onViewProfile(friend.username)}
                              >
                                Profile
                              </button>
                            )}
                            <button
                              type="button"
                              className="friends-page-action-btn friends-page-action-btn--invite"
                              style={{ opacity: isAvailable ? 1 : 0.6 }}
                              onClick={async () => {
                                if (!socket?.connected) return;
                                let roomInfo;
                                if (!joinedRoom) {
                                  const created = await onCreatePrivateRoom?.();
                                  if (!created?.ok || !created?.roomCode) { showToast('Unable to create room.', 2000); return; }
                                  roomInfo = created;
                                } else {
                                  roomInfo = await onCopyInviteLink();
                                }
                                if (!roomInfo?.ok || !roomInfo.roomCode || !roomInfo.inviteUrl) { showToast('Create a room first.', 2000); return; }
                                socket.emit('friend:invite', {
                                  toUserId: friend.userId,
                                  fromUsername: currentUsername || user?.email?.split('@')[0] || 'player',
                                  roomCode: roomInfo.roomCode,
                                  inviteUrl: roomInfo.inviteUrl,
                                });
                                onClose();
                                setCopiedFriendId(friend.id);
                                setTimeout(() => { setCopiedFriendId((prev) => (prev === friend.id ? null : prev)); }, 2000);
                              }}
                              title={joinedRoom ? 'Copy invite link' : 'Create room and copy invite link'}
                            >
                              {copiedFriendId === friend.id ? 'Copied!' : 'Invite'}
                            </button>
                            <button
                              type="button"
                              className="friends-page-action-btn"
                              onClick={() => setSelectedFriend(friend)}
                            >
                              Stats
                            </button>
                            <button
                              type="button"
                              className="friends-page-action-btn friends-page-action-btn--danger"
                              onClick={async () => {
                                if (!user) return;
                                const resp = await removeFriend(friend.id, user.id);
                                if (resp.error) { setError(resp.error); return; }
                                await loadFriends();
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pending requests */}
                  {hasPendingRequests && (
                    <>
                      <p className="friends-page-section-label" style={{ marginTop: 20 }}>Requests</p>
                      <div className="friends-page-list">
                        {incoming.map((req) => (
                          <div key={req.id} className="friends-page-row">
                            <span className="friends-page-row__name">@{req.username} sent you a request</span>
                            <div className="friends-page-row__actions">
                              <button
                                type="button"
                                className="friends-page-action-btn friends-page-action-btn--invite"
                                onClick={async () => {
                                  const resp = await acceptFriendRequest(req.id, user.id);
                                  if (resp.error) { setError(resp.error); return; }
                                  await loadFriends();
                                }}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="friends-page-action-btn friends-page-action-btn--danger"
                                onClick={async () => {
                                  const resp = await declineFriendRequest(req.id, user.id);
                                  if (resp.error) { setError(resp.error); return; }
                                  await loadFriends();
                                }}
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        ))}
                        {outgoing.map((req) => (
                          <div key={req.id} className="friends-page-row">
                            <span className="friends-page-row__name" style={{ color: 'rgba(255,255,255,0.42)' }}>
                              Pending: @{req.username}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Activity feed strip */}
      {user && friends.length > 0 && (
        <div className="friends-page-feed-strip">
          <p className="friends-page-section-label" style={{ marginBottom: 10 }}>Recent Activity</p>
          <ActivityFeedPanel
            user={user}
            onViewProfile={onViewProfile ?? (() => {})}
          />
        </div>
      )}

      <StatsScreen
        open={Boolean(selectedFriend)}
        user={user}
        targetUserId={selectedFriend?.userId ?? null}
        profile={
          selectedFriend
            ? { id: selectedFriend.userId, username: selectedFriend.username }
            : null
        }
        title={selectedFriend ? `@${selectedFriend.username} / Stats` : 'Friend Stats'}
        onClose={() => setSelectedFriend(null)}
      />
    </div>
  );
}
