// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

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
});
