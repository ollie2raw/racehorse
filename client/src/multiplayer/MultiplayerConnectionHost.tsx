import { createElement, type ReactNode } from 'react';
import { useMultiplayerConnection, type UseMultiplayerConnectionParams } from './useMultiplayerConnection';
import {
  MultiplayerConnectionContext,
  type MultiplayerConnectionActionsBridge,
} from './useMultiplayerConnectionContext';

export type MultiplayerConnectionHostProps = UseMultiplayerConnectionParams & {
  actionsBridge: MultiplayerConnectionActionsBridge;
  children?: ReactNode;
};

export function MultiplayerConnectionHost({
  actionsBridge,
  children,
  ...params
}: MultiplayerConnectionHostProps) {
  const { connect, disconnect, retryRoomRecovery } = useMultiplayerConnection(params);

  actionsBridge.disconnectRef.current = disconnect;
  actionsBridge.retryRoomRecoveryRef.current = retryRoomRecovery;

  return createElement(
    MultiplayerConnectionContext.Provider,
    {
      value: { connect, disconnect, retryRoomRecovery },
    },
    children,
  );
}
