// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsyncData } from './useAsyncData';

/** A promise whose resolution/rejection the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncData', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.restoreAllMocks();
  });

  it('starts in loading with no data or error, then resolves to data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces a thrown Error message and leaves data undefined', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeUndefined();
  });

  it('falls back to options.errorMessage when the error has no message', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(''));
    const { result } = renderHook(() =>
      useAsyncData(fetcher, [], { errorMessage: 'Could not load the leaderboard.' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load the leaderboard.');
  });

  it('normalises a non-Error rejection to the fallback string', async () => {
    const fetcher = vi.fn().mockRejectedValue('a bare string');
    const { result } = renderHook(() =>
      useAsyncData(fetcher, [], { errorMessage: 'Nope.' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Nope.');
  });

  it('refetch() re-runs the fetcher, clears the prior error, and keeps stale data meanwhile', async () => {
    const first = deferred<{ n: number }>();
    const second = deferred<{ n: number }>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await act(async () => {
      first.resolve({ n: 1 });
    });
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.loading).toBe(false);

    let refetchDone = false;
    await act(async () => {
      void result.current.refetch().then(() => {
        refetchDone = true;
      });
    });

    // Mid-refetch: loading again, but the previous data is still on screen.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual({ n: 1 });
    expect(refetchDone).toBe(false);

    await act(async () => {
      second.resolve({ n: 2 });
    });
    expect(result.current.data).toEqual({ n: 2 });
    expect(result.current.loading).toBe(false);
    expect(refetchDone).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetch() recovers from an errored state', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useAsyncData(fetcher, []));
    await waitFor(() => expect(result.current.error).toBe('flaky'));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ ok: true });
  });

  it('refetches when a dep changes and ignores the superseded (slower) first response', async () => {
    const slowOld = deferred<string>();
    const fastNew = deferred<string>();
    const fetcher = vi
      .fn<(id: string) => Promise<string>>()
      .mockReturnValueOnce(slowOld.promise)
      .mockReturnValueOnce(fastNew.promise);

    const { result, rerender } = renderHook(({ id }) => useAsyncData(() => fetcher(id), [id]), {
      initialProps: { id: 'a' },
    });

    // First request (id: 'a') is in flight.
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenLastCalledWith('a');

    rerender({ id: 'b' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenLastCalledWith('b');

    // The second (id: 'b') request resolves first...
    await act(async () => {
      fastNew.resolve('B');
    });
    expect(result.current.data).toBe('B');

    // ...then the stale id: 'a' request resolves and must be dropped.
    await act(async () => {
      slowOld.resolve('A');
      await Promise.resolve();
    });
    expect(result.current.data).toBe('B');
  });

  it('does not fetch while enabled is false, and fetches once it flips true', async () => {
    const fetcher = vi.fn().mockResolvedValue('ready');
    const { result, rerender } = renderHook(
      ({ enabled }) => useAsyncData(fetcher, [], { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBe('ready'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('drops the response and aborts the signal when unmounted mid-fetch (no setState-after-unmount)', async () => {
    const pending = deferred<string>();
    let capturedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((ctx: { signal: AbortSignal }) => {
      capturedSignal = ctx.signal;
      return pending.promise;
    });

    const { result, unmount } = renderHook(() => useAsyncData(fetcher, []));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve('too late');
    });

    // Last snapshot before unmount is unchanged, and React logged nothing.
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('drops a rejection that lands after unmount without an unhandled rejection', async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn(() => pending.promise);
    const { unmount } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      pending.reject(new Error('late failure'));
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});
