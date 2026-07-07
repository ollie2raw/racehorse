import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { fetchFriendsWithPresence } from '../social/socialApi';
import type { FriendWithPresence } from '../social/socialApi';

export type UsePrivateMatchLobbyFriendsParams = {
  showFriendPicker: boolean;
  isRatedEligible: boolean;
  socket: Socket | null;
};

export type UsePrivateMatchLobbyFriendsResult = {
  friends: FriendWithPresence[];
  friendsLoading: boolean;
  friendsError: string | null;
};

export function usePrivateMatchLobbyFriends({
  showFriendPicker,
  isRatedEligible,
  socket,
}: UsePrivateMatchLobbyFriendsParams): UsePrivateMatchLobbyFriendsResult {
  const [friends, setFriends] = useState<FriendWithPresence[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  useEffect(() => {
    if (!showFriendPicker || !isRatedEligible) return;
    setFriendsLoading(true);
    setFriendsError(null);
    fetchFriendsWithPresence()
      .then((res) => {
        if (res.error) {
          setFriendsError(res.error);
          setFriendsLoading(false);
        } else {
          if (socket && socket.connected) {
            const friendUserIds = res.friends.map((f) => f.userId);
            socket.emit(
              'presence:online',
              friendUserIds,
              (resp: { ok?: boolean; onlineUserIds?: string[] }) => {
                if (resp && resp.ok && Array.isArray(resp.onlineUserIds)) {
                  const onlineSet = new Set(resp.onlineUserIds);
                  const updatedFriends = res.friends.map((friend) => ({
                    ...friend,
                    presence_status: onlineSet.has(friend.userId)
                      ? ('online' as const)
                      : ('offline' as const),
                  }));
                  const onlineFriends = updatedFriends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                } else {
                  const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
                  setFriends(onlineFriends);
                }
                setFriendsLoading(false);
              }
            );
          } else {
            const onlineFriends = res.friends.filter((f) => f.presence_status === 'online');
            setFriends(onlineFriends);
            setFriendsLoading(false);
          }
        }
      })
      .catch((err) => {
        setFriendsError(err instanceof Error ? err.message : 'Failed to load friends.');
        setFriendsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFriendPicker, isRatedEligible]);

  return { friends, friendsLoading, friendsError };
}