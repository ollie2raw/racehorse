import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import { fetchUserStatsByUserId, type StatsSummary } from '../stats/statsApi';
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  type FriendRecord,
  type FriendRequestRecord,
} from './friendsApi';

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

const EMPTY_STATS: StatsSummary = {
  onlineGamesPlayed: 0,
  wins: 0,
  losses: 0,
  avgMoveQuality: null,
  longestWinStreak: 0,
  winRate: 0,
  currentWinStreak: 0,
  gamesThisWeek: 0,
  ghostRating: null,
  ghostGamesThisWeek: 0,
  ghostRatingChangeThisWeek: 0,
  ghostBestWinMarginThisWeek: null,
};

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
  const [friendStats, setFriendStats] = useState<StatsSummary>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!selectedFriend) return;
    setStatsLoading(true);
    setStatsError(null);
    fetchUserStatsByUserId(selectedFriend.userId).then((resp) => {
      setStatsLoading(false);
      if (resp.error) {
        setStatsError(resp.error);
        return;
      }
      setFriendStats(resp.data ?? EMPTY_STATS);
    });
  }, [selectedFriend]);

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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(860px, calc(100vw - 24px))',
          borderRadius: '16px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: 12,
          maxHeight: 'calc(100dvh - 24px)',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Friends</h3>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>{headerText}</p>

        {!user && <p className="auth-inline-error">Sign in to use friends.</p>}

        {user && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 8,
                alignItems: 'stretch',
              }}
            >
              <input
                type="text"
                placeholder="Add friend by username"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mode-join-input"
                style={{ height: 44, borderRadius: 12 }}
              />
              <button
                className="mode-inline-btn"
                style={{ height: 44, borderRadius: 12 }}
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
                  <h4 style={{ margin: 0 }}>Friends</h4>
                  {friends.length === 0 && (
                    <p style={{ margin: 0, color: 'rgba(196,213,223,0.82)' }}>
                      No friends yet. Add someone by username above.
                    </p>
                  )}
                  {friends.map((friend) => (
                    <div
                      key={friend.id}
                      style={{
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.14)',
                        background: 'rgba(12,20,34,0.66)',
                        padding: '9px 10px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              background: friend.online ? '#34d399' : 'rgba(148,163,184,0.6)',
                              boxShadow: friend.online
                                ? '0 0 10px rgba(52,211,153,0.85)'
                                : '0 0 0 rgba(0,0,0,0)',
                              flexShrink: 0,
                            }}
                          />
                          <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            @{friend.username}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
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
                  <div style={{ display: 'grid', gap: 8, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 12 }}>
                    <h4 style={{ margin: 0 }}>Requests</h4>
                    {incoming.map((req) => (
                      <div
                        key={req.id}
                        style={{
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.14)',
                          background: 'rgba(12,20,34,0.66)',
                          padding: 10,
                          display: 'grid',
                          gap: 8,
                        }}
                      >
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
                      <div
                        key={req.id}
                        style={{
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.14)',
                          background: 'rgba(12,20,34,0.66)',
                          padding: 10,
                        }}
                      >
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

      {selectedFriend && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Friend stats"
          onClick={() => setSelectedFriend(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1950,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(6,10,18,0.54)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(620px, calc(100vw - 24px))',
              borderRadius: 16,
              border: '1px solid rgba(236,252,245,0.2)',
              background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
              boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
              padding: 16,
              color: 'rgba(235,245,242,0.96)',
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>@{selectedFriend.username} / Stats</h3>
              <button className="mode-inline-btn" onClick={() => setSelectedFriend(null)}>
                Close
              </button>
            </div>
            {statsLoading && <p style={{ margin: 0 }}>Loading stats...</p>}
            {statsError && <p className="auth-inline-error">{statsError}</p>}
            {!statsLoading && !statsError && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                {[
                  { label: 'Win Rate', value: friendStats.onlineGamesPlayed > 0 ? `${Math.round((friendStats.wins / friendStats.onlineGamesPlayed) * 100)}%` : '0%', icon: '📊', tone: 'neutral' },
                  { label: 'Wins', value: friendStats.wins, icon: '🏆', tone: 'teal' },
                  { label: 'Losses', value: friendStats.losses, icon: '📉', tone: 'red' },
                  { label: 'Best Streak', value: friendStats.longestWinStreak, icon: '⚡', tone: 'neutral' },
                  { label: 'Online Games', value: friendStats.onlineGamesPlayed, icon: '🧩', tone: 'neutral' },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(12,20,34,0.68)',
                      padding: 12,
                      display: 'grid',
                      gap: 6,
                      alignContent: 'start',
                      boxShadow: item.tone === 'teal' ? 'inset 0 0 0 1px rgba(52,211,153,0.2)' : item.tone === 'red' ? 'inset 0 0 0 1px rgba(248,113,113,0.2)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: '0.9rem', color: 'rgba(191,213,223,0.86)' }}>{item.icon} {item.label}</span>
                    <strong style={{ fontSize: '1.4rem', color: item.tone === 'teal' ? 'rgba(52,211,153,0.95)' : item.tone === 'red' ? 'rgba(248,113,113,0.95)' : 'rgba(235,245,242,0.96)' }}>{item.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
