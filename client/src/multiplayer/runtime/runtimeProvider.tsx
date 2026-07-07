import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { MultiplayerRuntime } from './runtimeTypes';
import type { UseSessionStateResult } from '../session/useSessionStateTypes';

const MultiplayerRuntimeContext = createContext<MultiplayerRuntime | null>(null);

export type MultiplayerRuntimeProviderProps = {
  runtime: MultiplayerRuntime;
  children: ReactNode;
};

/** React boundary — distributes composed runtime; does not construct runtimes. */
export function MultiplayerRuntimeProvider({
  runtime,
  children,
}: MultiplayerRuntimeProviderProps): ReactNode {
  useEffect(() => {
    return () => {
      runtime.destroy();
    };
  }, [runtime]);

  return (
    <MultiplayerRuntimeContext.Provider value={runtime}>
      {children}
    </MultiplayerRuntimeContext.Provider>
  );
}

export function useMultiplayerRuntime(): MultiplayerRuntime {
  const runtime = useContext(MultiplayerRuntimeContext);
  if (!runtime) {
    throw new Error(
      'useMultiplayerRuntime must be used within MultiplayerRuntimeProvider — runtime is composed in App.tsx',
    );
  }
  return runtime;
}

/** React adapter for session FSM — machine owned by composition root. */
export function useMultiplayerSessionState(): UseSessionStateResult {
  const runtime = useMultiplayerRuntime();
  const sessionSnapshot = useSyncExternalStore(
    runtime.session.subscribe,
    runtime.session.getSnapshot,
    runtime.session.getSnapshot,
  );
  return {
    sessionRef: runtime.session.sessionRef,
    dispatchSession: runtime.session.dispatchSession,
    sessionSnapshot,
  };
}