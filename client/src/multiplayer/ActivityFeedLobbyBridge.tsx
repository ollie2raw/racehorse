import type { ComponentProps } from 'react';
import ActivityFeedScreen from '../social/ActivityFeedScreen';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

type ActivityFeedLobbyBridgeProps = Omit<
  ComponentProps<typeof ActivityFeedScreen>,
  'sendFriendChallenge'
>;

export default function ActivityFeedLobbyBridge(props: ActivityFeedLobbyBridgeProps) {
  const { sendFriendChallenge } = useMultiplayerLobbyActionsContext();
  return <ActivityFeedScreen {...props} sendFriendChallenge={sendFriendChallenge} />;
}
