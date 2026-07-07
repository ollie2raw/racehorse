import type { ComponentProps } from 'react';
import PublicProfileScreen from '../social/PublicProfileScreen';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

type PublicProfileScreenLobbyBridgeProps = Omit<
  ComponentProps<typeof PublicProfileScreen>,
  'onSpectate'
>;

export default function PublicProfileScreenLobbyBridge(props: PublicProfileScreenLobbyBridgeProps) {
  const { spectateRoom } = useMultiplayerLobbyActionsContext();
  return (
    <PublicProfileScreen
      {...props}
      onSpectate={spectateRoom}
    />
  );
}
