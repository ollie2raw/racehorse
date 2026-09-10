import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/**
 * Shared replacement for the hand-rolled `[data] / [loading] / [error]` +
 * `useEffect` fetch triad that ~15 screens each re-implement with subtly
 * different abort handling (REFACTOR_OPPORTUNITIES.md §3 D1).
 *
 * What it standardises — the parts the copy-pasted versions get wrong:
 *  - a response from a superseded request (deps changed, or the component
 *    unmounted mid-flight) is *dropped*, never applied → no "setState on an
 *    unmounted component", no last-writer-wins race between two in-flight loads;
 *  - the previous `data` stays visible while a refetch is in flight (no flash to
 *    empty) — matches what every current triad already does;
 *  - `error` is cleared at the start of every attempt;
 *  - an `AbortSignal` is handed to the fetcher for APIs that can honour it.
 *
 * It deliberately does NOT do caching, stale-while-revalidate across mounts, or
 * request dedup — those are `socialApi`'s `withCachedRequest` job. This is the
 * per-screen "load this when these inputs change" primitive only.
 */

export interface UseAsyncDataOptions {
  /**
   * When false the fetcher does not run and `loading` is false. Use for screens
   * that gate on an id being present (`enabled: Boolean(userId)`). Flipping it
   * true triggers a fetch; flipping it false leaves the last `data`/`error` in
   * place (the screen decides what to render when disabled).
   */
  enabled?: boolean;
  /**
   * Message to surface when the thrown error carries no usable `.message`.
   * Lets a migrated screen keep its exact copy ("Could not load the
   * leaderboard.") without a per-render fallback expression.
   */
  errorMessage?: string;
}

export interface UseAsyncDataResult<T> {
  /** `undefined` until the first successful load; retained across refetches. */
  data: T | undefined;
  loading: boolean;
  /** Normalised to a display string, or null when the last attempt succeeded. */
  error: string | null;
  /**
   * Re-run the fetcher now (e.g. after a mutation, or a manual "retry" button).
   * Resolves when that run settles; never rejects. No-op while `enabled` is
   * false.
   */
  refetch: () => Promise<void>;
}

const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export function useAsyncData<T>(
  fetcher: (context: { signal: AbortSignal }) => Promise<T>,
  deps: DependencyList,
  options: UseAsyncDataOptions = {},
): UseAsyncDataResult<T> {
  const { enabled = true, errorMessage } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Raw in-flight flag, mutated only from inside `execute` (never synchronously
  // in an effect). The value handed to the caller is derived below so a disabled
  // hook always reports `loading: false` even if a request was superseded
  // mid-flight by `enabled` flipping false.
  const [fetching, setFetching] = useState(enabled);

  // Monotonic id of the latest request. A settled promise whose id no longer
  // matches has been superseded (deps change / unmount / manual refetch) and its
  // result is discarded.
  const runIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  // Always call the newest fetcher/fallback without making them refetch triggers
  // (only `deps` decides that).
  const fetcherRef = useRef(fetcher);
  const errorMessageRef = useRef(errorMessage);
  useEffect(() => {
    fetcherRef.current = fetcher;
    errorMessageRef.current = errorMessage;
  });

  const execute = useCallback(async (): Promise<void> => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const runId = ++runIdRef.current;

    // Push the state updates off the synchronous call stack so this is never a
    // setState *within* the effect body (avoids cascading renders — the same
    // `await Promise.resolve()` guard the hand-rolled triads use).
    await Promise.resolve();
    if (runId !== runIdRef.current) return;

    setFetching(true);
    setError(null);

    try {
      const result = await fetcherRef.current({ signal: controller.signal });
      if (runId === runIdRef.current) {
        setData(result);
        setFetching(false);
      }
    } catch (err) {
      if (runId !== runIdRef.current || controller.signal.aborted) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : errorMessageRef.current ?? DEFAULT_ERROR_MESSAGE;
      setError(message);
      setFetching(false);
    }
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    await execute();
  }, [enabled, execute]);

  useEffect(() => {
    if (!enabled) {
      // Supersede any request left in flight by the transition to disabled; the
      // derived `loading` below already reads false while disabled.
      runIdRef.current += 1;
      activeControllerRef.current?.abort();
      return;
    }
    void execute();
    return () => {
      // Supersede the in-flight request and abort it so its resolution is a
      // no-op.
      runIdRef.current += 1;
      activeControllerRef.current?.abort();
    };
    // `deps` is the caller's declared list of refetch triggers; `execute` is
    // stable. Spreading a param array is invisible to the rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, execute, ...deps]);

  return { data, loading: enabled && fetching, error, refetch };
}
