import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import StatsScreen from '../stats/StatsScreen';
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  type FriendRecord,
  type FriendRequestRecord,
} from './friendsApi';
import '../ui/claudeUtilityPanels.css';

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
}: FriendsScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
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

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    if (!open || !socket || friends.length === 0) return;
    const friendUserIds = friends.map((f) => f.userId);
    const checkPresence = () => {
      if (!socket.connected) return;
      socket.emit('presence:online', friendUserIds, (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
        if (!resp?.ok) return;
        const set = new Set(resp.onlineUserIds ?? []);
        setFriends((prev) => prev.map((f) => ({ ...f, online: set.has(f.userId) })));
      });
    };

    checkPresence();
    const interval = setInterval(checkPresence, 30000);
    socket.on('connect', checkPresence);
    return () => {
      clearInterval(interval);
      socket.off('connect', checkPresence);
    };
  }, [open, socket, friends.length]);

  const headerText = useMemo(() => {
    if (!user) return 'Sign in to use Friends';
    return `Friends (${friends.length})`;
  }, [user, friends.length]);
  const hasPendingRequests = incoming.length > 0 || outgoing.length > 0;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Friends"
      onClick={onClose}
      className="claude-utility-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="claude-utility-panel claude-utility-panel--medium"
      >
        <div className="claude-utility-header">
          <div className="claude-utility-titleblock">
            <p className="claude-utility-kicker">Social</p>
            <h3 className="claude-utility-title">Friends</h3>
          </div>
          <button className="mode-inline-btn claude-utility-close" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="claude-utility-subtitle">{headerText}</p>

        {!user && <p className="auth-inline-error">Sign in to use friends.</p>}

        {user && (
          <>
            <div className="claude-utility-inputrow">
              <input
                type="text"
                placeholder="Add friend by username"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="claude-utility-input"
              />
              <button
                className="mode-inline-btn"
                onClick={async () => {
                  const resp = await sendFriendRequest(user.id, query);
                  if (resp.error) {
                    setError(resp.error);
                    return;
                  }
                  setQuery('');
                  setError(null);
                  await loadFriends();
                }}
              >
                Add
              </button>
            </div>

            {error && <p className="auth-inline-error">{error}</p>}
            {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading friends...</p>}

            {!loading && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <h4 className="claude-utility-section-title">Friends</h4>
                  {friends.length === 0 && (
                    <p style={{ margin: 0, color: 'rgba(196,213,223,0.82)' }}>
                      No friends yet. Add someone by username above.
                    </p>
                  )}
                  {friends.map((friend) => (
                    <div key={friend.id} className="claude-utility-row">
                      <div className="claude-utility-rowhead">
                        <div className="claude-utility-rowmain">
                          <span
                            aria-hidden="true"
                            className="claude-utility-statusdot"
                            style={{
                              background: friend.online ? '#34d399' : 'rgba(148,163,184,0.6)',
                              boxShadow: friend.online
                                ? '0 0 10px rgba(52,211,153,0.85)'
                                : '0 0 0 rgba(0,0,0,0)',
                            }}
                          />
                          <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            @{friend.username}
                          </strong>
                        </div>
                        <div className="claude-utility-rowactions">
                          <button
                            className="mode-inline-btn"
                            style={{
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              background: friend.online
                                ? 'linear-gradient(170deg, rgba(29,55,66,0.88) 0%, rgba(11,21,34,0.9) 100%)'
                                : 'rgba(255,255,255,0.08)',
                              borderColor: friend.online
                                ? 'rgba(149, 240, 202, 0.45)'
                                : 'rgba(255,255,255,0.16)',
                              opacity: friend.online ? 1 : 0.72,
                            }}
                            onClick={async () => {
                              if (!socket?.connected) return;

                              // Ensure room exists FIRST and wait for it
                              let roomInfo;

                              if (!joinedRoom) {
                                const created = await onCreatePrivateRoom?.();
                                if (!created?.ok || !created?.roomCode) {
                                  showToast('Unable to create room.', 2000);
                                  return;
                                }
                                roomInfo = created;
                              } else {
                                roomInfo = await onCopyInviteLink();
                              }

                              if (!roomInfo?.ok || !roomInfo.roomCode || !roomInfo.inviteUrl) {
                                showToast('Create a room first.', 2000);
                                return;
                              }

                              socket.emit('friend:invite', {
                                toUserId: friend.userId,
                                fromUsername: currentUsername || user?.email?.split('@')[0] || 'player',
                                roomCode: roomInfo.roomCode,
                                inviteUrl: roomInfo.inviteUrl,
                              });
                              onClose();

                              setCopiedFriendId(friend.id);
                              setTimeout(() => {
                                setCopiedFriendId((prev) => (prev === friend.id ? null : prev));
                              }, 2000);
                            }}
                            title={joinedRoom ? 'Copy invite link' : 'Create room and copy invite link'}
                          >
                            {copiedFriendId === friend.id ? 'Copied!' : '⚡ Invite'}
                          </button>
                          <button className="mode-inline-btn" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setSelectedFriend(friend)}>
                            📊 Stats
                          </button>
                          <button
                            className="mode-inline-btn"
                            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            onClick={async () => {
                              if (!user) return;
                              const resp = await removeFriend(friend.id, user.id);
                              if (resp.error) {
                                setError(resp.error);
                                return;
                              }
                              await loadFriends();
                            }}
                          >
                            🗑 Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {hasPendingRequests && (
                  <div className="claude-utility-section">
                    <h4 className="claude-utility-section-title">Requests</h4>
                    {incoming.map((req) => (
                      <div key={req.id} className="claude-utility-row">
                        <span>@{req.username} sent you a request</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="mode-inline-btn"
                            onClick={async () => {
                              const resp = await acceptFriendRequest(req.id, user.id);
                              if (resp.error) {
                                setError(resp.error);
                                return;
                              }
                              await loadFriends();
                            }}
                          >
                            Accept
                          </button>
                          <button
                            className="mode-inline-btn"
                            onClick={async () => {
                              const resp = await declineFriendRequest(req.id, user.id);
                              if (resp.error) {
                                setError(resp.error);
                                return;
                              }
                              await loadFriends();
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                    {outgoing.map((req) => (
                      <div key={req.id} className="claude-utility-row">
                        Pending: @{req.username}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <StatsScreen
        open={Boolean(selectedFriend)}
        user={user}
        targetUserId={selectedFriend?.userId ?? null}
        profile={
          selectedFriend
            ? {
                id: selectedFriend.userId,
                username: selectedFriend.username,
              }
            : null
        }
        title={selectedFriend ? `@${selectedFriend.username} / Stats` : 'Friend Stats'}
        onClose={() => setSelectedFriend(null)}
      />
    </div>
  );
}
