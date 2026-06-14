import { createContext, useCallback, useContext, useMemo, useRef, type MutableRefObject } from 'react';

export type MultiplayerConnectionActions = {
  connect: () => void;
  disconnect: (reason?: string) => void;
  retryRoomRecovery: () => void;
};

export type MultiplayerConnectionActionsBridge = MultiplayerConnectionActions & {
  disconnectRef: MutableRefObject<(reason?: string) => void>;
  retryRoomRecoveryRef: MutableRefObject<() => void>;
};

const MultiplayerConnectionContext = createContext<MultiplayerConnectionActions | null>(null);

export function useMultiplayerConnectionContext(): MultiplayerConnectionActions {
  const value = useContext(MultiplayerConnectionContext);
  if (!value) {
    throw new Error('useMultiplayerConnectionContext must be used within MultiplayerConnectionHost');
  }
  return value;
}

/** Stable action wrappers; connect delegates to the existing socketRuntime connectRef. */
export function useMultiplayerConnectionActionsBridge(
  connectRef: MutableRefObject<() => void>,
): MultiplayerConnectionActionsBridge {
  const disconnectRef = useRef<(reason?: string) => void>(() => {});
  const retryRoomRecoveryRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    connectRef.current();
  }, [connectRef]);

  const disconnect = useCallback((reason?: string) => {
    disconnectRef.current(reason);
  }, []);

  const retryRoomRecovery = useCallback(() => {
    retryRoomRecoveryRef.current();
  }, []);

  return useMemo(
    (): MultiplayerConnectionActionsBridge => ({
      disconnectRef,
      retryRoomRecoveryRef,
      connect,
      disconnect,
      retryRoomRecovery,
    }),
    [connect, disconnect, retryRoomRecovery],
  );
}

export { MultiplayerConnectionContext };
