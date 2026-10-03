// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReviewStartTrigger } from './useReviewStartTrigger.ts';

describe('useReviewStartTrigger', () => {
  afterEach(() => vi.useRealTimers());

  it('starts after the delay while active, immediately on request, and resets when inactive', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook((props: { active: boolean }) =>
      useReviewStartTrigger({ active: props.active, delayMs: 5_000 }), { initialProps: { active: true } });
    expect(result.current.started).toBe(false);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current.started).toBe(true);

    rerender({ active: false });
    expect(result.current.started).toBe(false);
    rerender({ active: true });
    act(() => result.current.requestStart());
    expect(result.current.started).toBe(true);
  });

  it('never starts on its own while inactive', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReviewStartTrigger({ active: false, delayMs: 5_000 }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.started).toBe(false);
  });
});
