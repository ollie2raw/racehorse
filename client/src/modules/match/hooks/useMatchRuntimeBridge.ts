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
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    runtimeRef.current === null
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    || instanceKeyRef.current !== input.instanceKey
  ) {
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    runtimeRef.current?.destroy();
    runtimeRef.current = createMatchRuntime({
      initialState: input.createInitialState(),
      capabilities: input.capabilities,
    });
    // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
    instanceKeyRef.current = input.instanceKey;
  }

  const runtime = runtimeRef.current;

  useEffect(() => () => {
    runtimeRef.current?.destroy();
    runtimeRef.current = null;
  }, []);

  const match = useSyncExternalStore(
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    runtime.store.subscribe,
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    runtime.store.getState,
    // eslint-disable-next-line react-hooks/refs -- lazy-initialized singleton read during render — the React useRef-docs idiom (if (!ref.current) ref.current = new X()); the rule does not model it
    runtime.store.getState,
  );

  const matchRef = useRef(match);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  matchRef.current = match;

  const setMatch = useCallback((updater: StateUpdater<TState>) => {
    runtime.store.setState(updater);
    matchRef.current = runtime.store.getState();
  }, [runtime]);

  // eslint-disable-next-line react-hooks/refs -- ref object shared into a hook/provider — its .current is read only inside that consumer's effects/callbacks; the rule cannot see across the call boundary (D-2)
  return { runtime, match, setMatch, matchRef };
}