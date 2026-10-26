// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameSpeedPreference } from './gameSpeedPreference';
import { useGameSpeedPreference } from './useGameSpeedPreference';

beforeEach(() => {
  window.localStorage.clear();
});

describe('gameSpeedPreference', () => {
  it('is the original cadence when nothing is stored', () => {
    expect(gameSpeedPreference.get()).toBe('normal');
  });

  it('persists fast and goes back to normal', () => {
    gameSpeedPreference.set('fast');
    expect(gameSpeedPreference.get()).toBe('fast');
    expect(window.localStorage.getItem('racehorse_game_speed')).toBe('fast');
    gameSpeedPreference.set('normal');
    expect(gameSpeedPreference.get()).toBe('normal');
  });

  it('treats anything that is not "fast" as normal', () => {
    window.localStorage.setItem('racehorse_game_speed', 'turbo');
    expect(gameSpeedPreference.get()).toBe('normal');
  });

  it('notifies subscribers once per real change, and not after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = gameSpeedPreference.subscribe(listener);
    gameSpeedPreference.set('fast');
    gameSpeedPreference.set('fast'); // no change
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    gameSpeedPreference.set('normal');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to normal when storage throws (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(gameSpeedPreference.get()).toBe('normal');
    spy.mockRestore();
  });
});

describe('useGameSpeedPreference', () => {
  it('hears a change made elsewhere, such as the Settings switch', () => {
    const { result } = renderHook(() => useGameSpeedPreference());
    expect(result.current[0]).toBe('normal');
    act(() => gameSpeedPreference.set('fast'));
    expect(result.current[0]).toBe('fast');
  });

  it('sets the preference through its setter', () => {
    const { result } = renderHook(() => useGameSpeedPreference());
    act(() => result.current[1]('fast'));
    expect(gameSpeedPreference.get()).toBe('fast');
  });
});
