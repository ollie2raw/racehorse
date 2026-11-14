import { createElement, lazy, type ComponentType } from 'react';

export type LazyScreen<P> = ComponentType<P> & {
  /** Starts (or joins) the chunk load. A failed load is forgotten so the next call retries. */
  preload: () => Promise<unknown>;
  isLoaded: () => boolean;
};

/**
 * React.lazy, except that once the chunk has loaded the component renders synchronously.
 * React.lazy suspends one more time even for a cached import(), which commits the route's
 * fallback and then holds the real screen behind React's ~300 ms fallback reveal throttle.
 */
export function lazyScreen<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyScreen<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;

  const preload = () => {
    pending ??= load().then(
      (mod) => {
        loaded = mod.default;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  // Only for a render that arrives before the chunk has; React.lazy owns suspending then.
  const UntilLoaded = lazy(() => preload().then(() => ({ default: loaded as ComponentType<P> })));

  const Screen = (props: P) =>
    createElement((loaded ?? UntilLoaded) as ComponentType<P>, props);
  return Object.assign(Screen, { preload, isLoaded: () => loaded !== null });
}
