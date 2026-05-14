import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriends,
  removeFriend,
  sendFriendRequest,
  type FriendRecord,
  type FriendRequestRecord,
} from './friendsApi';
import {
  fetchFriendsWithPresence,
  fetchPublicProfile,
  type PresenceStatus,
  type PublicProfile,
} from '../social/socialApi';
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

function PresenceDot({ status }: { status: PresenceStatus }) {
  const color = status === 'online' ? '#4ADE80' : status === 'in_game' ? '#E7B64A' : 'rgba(255,255,255,0.18)';
  const glow = status === 'online' ? '0 0 8px #4ADE8088' : status === 'in_game' ? '0 0 8px #E7B64A66' : 'none';
  const label = status === 'online' ? 'Online' : status === 'in_game' ? 'In Game' : 'Offline';
  return (
    <span aria-hidden="true" className="friends-page-dot" title={label} style={{ background: color, boxShadow: glow }} />
  );
}

function ratingTier(rating: number, provisional: boolean): { label: string; color: string } {
  if (provisional) return { label: 'Provisional', color: 'rgba(255,255,255,0.35)' };
  if (rating >= 1600) return { label: 'Master', color: 'var(--tier-master)' };
  if (rating >= 1300) return { label: 'Elite', color: 'var(--tier-elite)' };
  if (rating >= 1000) return { label: 'Standard', color: 'var(--tier-standard)' };
  return { label: 'Rookie', color: 'var(--tier-rookie)' };
}

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
  const [selectedProfile, setSelectedProfile] = useState<PublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
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

  useEffect(() => { void loadFriends(); }, [loadFriends]);

  useEffect(() => {
    void refreshPresence();
    const interval = setInterval(() => { void refreshPresence(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshPresence]);

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

  const handleSelectFriend = useCallback(async (friend: FriendRecord) => {
    setSelectedFriend(friend);
    setSelectedProfile(null);
    setProfileLoading(true);
    const result = await fetchPublicProfile(friend.username);
    setProfileLoading(false);
    if (!result.error && result.profile) setSelectedProfile(result.profile);
  }, []);

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
      <header className="friends-page-topbar">
        <div className="friends-page-brand">RACEHORSE</div>
        <button type="button" className="friends-page-back rh-back-button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>Back</span>
        </button>
      </header>

      <div className="friends-page-split">
        {/* ── Left: friend list ── */}
        <div className="friends-page-list-pane">
          <div className="friends-page-list-header">
            <span className="friends-page-list-title">Friends</span>
            <span className="friends-page-online-count">
              <span className="friends-page-online-dot" />
              {onlineCount} online
            </span>
          </div>

          {!user && <p className="friends-page-auth-note">Sign in to use friends.</p>}

          {user && (
            <>
              <div className="friends-page-add-row">
                <input
                  type="text"
                  placeholder="Add by username…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    const resp = await sendFriendRequest(user.id, query);
                    if (resp.error) { setError(resp.error); return; }
                    setQuery(''); setError(null); await loadFriends();
                  }}
                  className="friends-page-input"
                />
                <button
                  type="button"
                  className="friends-page-add-btn"
                  onClick={async () => {
                    const resp = await sendFriendRequest(user.id, query);
                    if (resp.error) { setError(resp.error); return; }
                    setQuery(''); setError(null); await loadFriends();
                  }}
                >
                  Add
                </button>
              </div>

              {error && <p className="friends-page-error">{error}</p>}
              {loading && <p className="friends-page-note">Loading…</p>}

              {hasPendingRequests && (
                <div className="friends-page-requests">
                  <p className="friends-page-section-label">Requests {incoming.length > 0 && <span className="friends-page-badge">{incoming.length}</span>}</p>
                  {incoming.map((req) => (
                    <div key={req.id} className="friends-page-row friends-page-row--request">
                      <span className="friends-page-row__name">@{req.username}</span>
                      <div className="friends-page-row__actions">
                        <button type="button" className="friends-page-action-btn friends-page-action-btn--invite"
                          onClick={async () => {
                            const resp = await acceptFriendRequest(req.id, user.id);
                            if (resp.error) { setError(resp.error); return; }
                            await loadFriends();
                          }}>Accept</button>
                        <button type="button" className="friends-page-action-btn friends-page-action-btn--danger"
                          onClick={async () => {
                            const resp = await declineFriendRequest(req.id, user.id);
                            if (resp.error) { setError(resp.error); return; }
                            await loadFriends();
                          }}>Decline</button>
                      </div>
                    </div>
                  ))}
                  {outgoing.map((req) => (
                    <div key={req.id} className="friends-page-row">
                      <span className="friends-page-row__name" style={{ color: 'rgba(255,255,255,0.42)' }}>Pending: @{req.username}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="friends-page-section-label" style={{ marginTop: 12 }}>Your Friends</p>
              {friends.length === 0 && !loading && (
                <p className="friends-page-note">No friends yet. Add someone above.</p>
              )}
              <div className="friends-page-list">
                {friends.map((friend) => {
                  const presenceStatus = presenceMap.get(friend.userId) ?? 'offline';
                  const isSelected = selectedFriend?.id === friend.id;
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className={`friends-page-row friends-page-row--selectable${isSelected ? ' friends-page-row--selected' : ''}`}
                      onClick={() => handleSelectFriend(friend)}
                    >
                      <div className="friends-page-row__left">
                        <PresenceDot status={presenceStatus} />
                        <div>
                          <div className="friends-page-row__name">@{friend.username}</div>
                          <div className="friends-page-row__meta">
                            {presenceStatus === 'in_game' ? 'In Game' : presenceStatus === 'online' ? 'Online' : 'Offline'}
                          </div>
                        </div>
                      </div>
                      <div className="friends-page-row__actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="friends-page-action-btn friends-page-action-btn--invite"
                          style={{ opacity: presenceStatus !== 'offline' ? 1 : 0.5 }}
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
                        >
                          {copiedFriendId === friend.id ? 'Sent!' : 'Invite'}
                        </button>
                        <button
                          type="button"
                          className="friends-page-action-btn friends-page-action-btn--danger"
                          onClick={async () => {
                            if (!user) return;
                            const resp = await removeFriend(friend.id, user.id);
                            if (resp.error) { setError(resp.error); return; }
                            if (selectedFriend?.id === friend.id) setSelectedFriend(null);
                            await loadFriends();
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Right: selected friend preview ── */}
        <div className="friends-page-preview-pane">
          {!selectedFriend && (
            <div className="friends-page-preview-empty">
              <p>Select a friend to see their profile.</p>
            </div>
          )}

          {selectedFriend && profileLoading && (
            <div className="friends-page-preview-empty">
              <p>Loading profile…</p>
            </div>
          )}

          {selectedFriend && !profileLoading && selectedProfile && (
            <div className="friends-page-preview">
              {/* Avatar + name */}
              <div className="friends-page-preview-hero">
                <div className="friends-page-preview-avatar">
                  {selectedProfile.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="friends-page-preview-identity">
                  <span className="friends-page-preview-username">{selectedProfile.username}</span>
                  {(() => {
                    const s = presenceMap.get(selectedFriend.userId) ?? 'offline';
                    const color = s === 'online' ? '#4ADE80' : s === 'in_game' ? '#E7B64A' : 'rgba(255,255,255,0.25)';
                    const label = s === 'online' ? 'Online' : s === 'in_game' ? 'In Game' : 'Offline';
                    return (
                      <span className="friends-page-preview-presence" style={{ color }}>
                        <span className="friends-page-dot" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} aria-hidden />
                        {label}
                      </span>
                    );
                  })()}
                  {(() => {
                    const tier = ratingTier(selectedProfile.glicko_rating, selectedProfile.provisional);
                    return <span className="friends-page-preview-tier" style={{ color: tier.color }}>{tier.label}</span>;
                  })()}
                </div>
              </div>

              {/* Stats */}
              <div className="friends-page-preview-stats">
                <div className="friends-page-preview-stat">
                  <span className="friends-page-preview-stat-val">{Math.round(selectedProfile.glicko_rating).toLocaleString()}</span>
                  <span className="friends-page-preview-stat-label">RATING</span>
                </div>
                <div className="friends-page-preview-stat">
                  <span className="friends-page-preview-stat-val">
                    {selectedProfile.ranked_games_played > 0 ? `${selectedProfile.win_rate.toFixed(1)}%` : '—'}
                  </span>
                  <span className="friends-page-preview-stat-label">WIN RATE</span>
                </div>
                <div className="friends-page-preview-stat">
                  <span className="friends-page-preview-stat-val">{selectedProfile.wins}</span>
                  <span className="friends-page-preview-stat-label">WINS</span>
                </div>
                <div className="friends-page-preview-stat">
                  <span className="friends-page-preview-stat-val">{selectedProfile.puzzles_completed ?? 0}</span>
                  <span className="friends-page-preview-stat-label">PUZZLES</span>
                </div>
              </div>

              {/* Recent matches */}
              {selectedProfile.recent_matches.length > 0 && (
                <div className="friends-page-preview-matches">
                  <p className="friends-page-section-label" style={{ marginBottom: 8 }}>Recent Matches</p>
                  {selectedProfile.recent_matches.slice(0, 5).map((m, i) => (
                    <div key={i} className={`friends-page-match friends-page-match--${m.result}`}>
                      <span className={`friends-page-match-result friends-page-match-result--${m.result}`}>
                        {m.result === 'win' ? 'W' : 'L'}
                      </span>
                      <span className="friends-page-match-vs">vs {m.opponent_username}</span>
                      {m.score != null && <span className="friends-page-match-score">{m.score}–{m.opponent_score}</span>}
                      <span className="friends-page-match-time">{timeAgo(m.played_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="friends-page-preview-actions">
                {onViewProfile && (
                  <button type="button" className="friends-page-preview-btn friends-page-preview-btn--primary"
                    onClick={() => onViewProfile(selectedProfile.username)}>
                    View Full Profile
                  </button>
                )}
                {selectedProfile.presence.status !== 'offline' && (
                  <button type="button" className="friends-page-preview-btn"
                    onClick={async () => {
                      const f = selectedFriend;
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
                        toUserId: f.userId,
                        fromUsername: currentUsername || user?.email?.split('@')[0] || 'player',
                        roomCode: roomInfo.roomCode,
                        inviteUrl: roomInfo.inviteUrl,
                      });
                      showToast(`Invite sent to ${f.username}`);
                    }}>
                    Challenge
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
