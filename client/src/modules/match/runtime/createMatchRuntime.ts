import type { MatchCapabilities } from '@racehorse/match-protocol';
import { MatchEventBus } from '../events/MatchEventBus.ts';
import { MatchLifecycleController } from '../controllers/MatchLifecycleController.ts';
import { MatchSessionStore } from '../store/MatchSessionStore.ts';

export type MatchRuntime<TState> = {
  readonly capabilities: MatchCapabilities;
  readonly store: MatchSessionStore<TState>;
  readonly eventBus: MatchEventBus;
  readonly lifecycle: MatchLifecycleController;
  destroy(): void;
};

export function createMatchRuntime<TState>(input: {
  initialState: TState;
  capabilities: MatchCapabilities;
}): MatchRuntime<TState> {
  const eventBus = new MatchEventBus();
  const store = new MatchSessionStore(input.initialState);
  const lifecycle = new MatchLifecycleController(eventBus);

  return {
    capabilities: input.capabilities,
    store,
    eventBus,
    lifecycle,
    destroy() {
      eventBus.clear();
    },
  };
}