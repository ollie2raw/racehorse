export type StateUpdater<TState> = TState | ((previous: TState) => TState);

export type MatchSessionListener<TState> = (state: TState, previous: TState) => void;

/**
 * Authoritative in-memory match session store.
 * React and other UI layers subscribe; they do not own state.
 */
export class MatchSessionStore<TState> {
  private state: TState;
  private readonly listeners = new Set<() => void>();
  private readonly stateListeners = new Set<MatchSessionListener<TState>>();

  constructor(initialState: TState) {
    this.state = initialState;
    this.getState = this.getState.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  getState(): TState {
    return this.state;
  }

  setState(updater: StateUpdater<TState>): void {
    const previous = this.state;
    const next =
      typeof updater === 'function'
        ? (updater as (prev: TState) => TState)(previous)
        : updater;
    if (Object.is(next, previous)) {
      return;
    }
    this.state = next;
    this.stateListeners.forEach((listener) => listener(next, previous));
    this.listeners.forEach((listener) => listener());
  }

  /** React useSyncExternalStore subscription. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Domain listeners (plugins, analytics, replay). */
  onStateChange(listener: MatchSessionListener<TState>): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }
}