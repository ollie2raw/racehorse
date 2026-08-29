// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const { mutePreference } = await import('./mutePreference');
const { useMutePreference } = await import('./useMutePreference');

describe('useMutePreference', () => {
  beforeEach(() => {
    mutePreference.set(false);
  });

  it('starts from the stored preference', () => {
    mutePreference.set(true);
    const { result } = renderHook(() => useMutePreference());
    expect(result.current[0]).toBe(true);
  });

  it('writes through when the hook sets it', () => {
    const { result } = renderHook(() => useMutePreference());

    act(() => result.current[1](true));

    expect(mutePreference.get()).toBe(true);
    expect(result.current[0]).toBe(true);
  });

  it('follows a change made anywhere else', () => {
    // The Settings toggle and a match screen are separate mounts. This is the
    // one that matters: muting in Settings has to reach a reader that is
    // already mounted.
    const { result } = renderHook(() => useMutePreference());
    expect(result.current[0]).toBe(false);

    act(() => mutePreference.set(true));

    expect(result.current[0]).toBe(true);
  });

  it('keeps two mounted readers in agreement', () => {
    const a = renderHook(() => useMutePreference());
    const b = renderHook(() => useMutePreference());

    act(() => a.result.current[1](true));

    expect(b.result.current[0]).toBe(true);
  });

  it('accepts an updater, the way the match trays call it', () => {
    // The mute buttons are written `setIsMuted((prev) => !prev)`.
    const { result } = renderHook(() => useMutePreference());

    act(() => result.current[1]((prev) => !prev));

    expect(result.current[0]).toBe(true);
    expect(mutePreference.get()).toBe(true);
  });

  it('unmutes through the updater too', () => {
    // A setter that forwards the function itself passes this only by accident
    // on the muting direction — a function is truthy. This is the direction
    // that catches it.
    mutePreference.set(true);
    const { result } = renderHook(() => useMutePreference());

    act(() => result.current[1]((prev) => !prev));

    expect(result.current[0]).toBe(false);
    expect(mutePreference.get()).toBe(false);
  });
});
