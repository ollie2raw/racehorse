import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { MatchCapabilities } from '@racehorse/match-protocol';
import type { StateUpdater } from '../store/MatchSessionStore.ts';
import { createMatchRuntime, type MatchRuntime } from '../runtime/createMatchRuntime.ts';

export type UseMatchRuntimeBridgeResult<TState> = {
  runtime: MatchRuntime<TState>;
  match: TState;
  setMatch: (updater: StateUpdater<TState>) => void;
  matchRef: React.MutableRefObject<TState>;
};

/**
 * React bridge: subscribes to MatchSessionStore without putting business logic in the screen.
 */
export function useMatchRuntimeBridge<TState>(input: {
  createInitialState: () => TState;
  capabilities: MatchCapabilities;
  instanceKey: string | null | undefined;
}): UseMatchRuntimeBridgeResult<TState> {
  const runtimeRef = useRef<MatchRuntime<TState> | null>(null);
  const instanceKeyRef = useRef(input.instanceKey);

  if (
    runtimeRef.current === null
    || instanceKeyRef.current !== input.instanceKey
  ) {
    runtimeRef.current?.destroy();
    runtimeRef.current = createMatchRuntime({
      initialState: input.createInitialState(),
      capabilities: input.capabilities,
    });
    instanceKeyRef.current = input.instanceKey;
  }

  const runtime = runtimeRef.current;

  useEffect(() => () => {
    runtimeRef.current?.destroy();
    runtimeRef.current = null;
  }, []);

  const match = useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getState,
  );

  const matchRef = useRef(match);
  matchRef.current = match;

  const setMatch = useCallback((updater: StateUpdater<TState>) => {
    runtime.store.setState(updater);
    matchRef.current = runtime.store.getState();
  }, [runtime]);

  return { runtime, match, setMatch, matchRef };
}