import { createElement, useEffect, useMemo, type ReactNode } from 'react';
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
  const contextValue = useMemo(
    () => ({ connect, disconnect, retryRoomRecovery }),
    [connect, disconnect, retryRoomRecovery],
  );

  useEffect(() => {
    const disconnectBridgeRef = actionsBridge.disconnectRef;
    const retryRoomRecoveryBridgeRef = actionsBridge.retryRoomRecoveryRef;
    disconnectBridgeRef.current = disconnect;
    retryRoomRecoveryBridgeRef.current = retryRoomRecovery;
  }, [actionsBridge, disconnect, retryRoomRecovery]);

  return createElement(
    MultiplayerConnectionContext.Provider,
    {
      value: contextValue,
    },
    children,
  );
}
