import type { ComponentProps } from 'react';
import FriendsScreen from '../friends/FriendsScreen';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

type FriendsScreenLobbyBridgeProps = Omit<
  ComponentProps<typeof FriendsScreen>,
  'onCopyInviteLink' | 'onCreatePrivateRoom'
>;

export default function FriendsScreenLobbyBridge(props: FriendsScreenLobbyBridgeProps) {
  const { copyInviteLink, onCreatePrivateRoom } = useMultiplayerLobbyActionsContext();
  return <FriendsScreen {...props} onCopyInviteLink={copyInviteLink} onCreatePrivateRoom={onCreatePrivateRoom} />;
}
