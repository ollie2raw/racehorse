// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });

const { mutePreference } = await import('./mutePreference');

beforeEach(() => localStorageMock.clear());

describe('mutePreference', () => {
  it('returns false when no preference stored', () => {
    expect(mutePreference.get()).toBe(false);
  });
  it('persists muted state', () => {
    mutePreference.set(true);
    expect(mutePreference.get()).toBe(true);
  });
  it('persists unmuted state', () => {
    mutePreference.set(false);
    expect(mutePreference.get()).toBe(false);
  });
  it('overwrites previous value', () => {
    mutePreference.set(true);
    mutePreference.set(false);
    expect(mutePreference.get()).toBe(false);
  });

  it('notifies subscribers when the preference changes', () => {
    // The Settings toggle and a match screen are different mounts of the same
    // preference. Without this, changing it in Settings left the App-level
    // mute state stale until a reload.
    const seen: boolean[] = [];
    const unsubscribe = mutePreference.subscribe(() => seen.push(mutePreference.get()));

    mutePreference.set(true);
    mutePreference.set(false);

    expect(seen).toEqual([true, false]);
    unsubscribe();
  });

  it('stops notifying once unsubscribed', () => {
    const listener = vi.fn();
    mutePreference.subscribe(listener)();

    mutePreference.set(true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when the value is unchanged', () => {
    mutePreference.set(true);
    const listener = vi.fn();
    const unsubscribe = mutePreference.subscribe(listener);

    mutePreference.set(true);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
