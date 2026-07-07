import IncomingFriendChallengeCard from './IncomingFriendChallengeCard';
import type { FriendInviteState } from './runtime/friendInviteRuntime';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

export function FriendInvitePopupBridge({
  invite,
  joining,
}: {
  invite: NonNullable<FriendInviteState>;
  joining: boolean;
}) {
  const { acceptFriendInvite, declineFriendInvite } = useMultiplayerLobbyActionsContext();
  return (
    <IncomingFriendChallengeCard
      invite={invite}
      joining={joining}
      onAccept={() => {
        void acceptFriendInvite();
      }}
      onDecline={declineFriendInvite}
    />
  );
}
