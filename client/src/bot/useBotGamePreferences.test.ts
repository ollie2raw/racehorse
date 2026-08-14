// @vitest-environment jsdom
/**
 * Regression tests for useBotGamePreferences.
 *
 * Covers: initial state hydration from storage, persistence effects,
 * isMutedRef sync, botSetup mode deal-size reset.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./pvfTierPreference', () => ({
  resolveDefaultPvfFritzTier: vi.fn(() => 2),
  writeStoredPvfFritzTier: vi.fn(),
}));

vi.mock('../utils/mutePreference', () => ({
  mutePreference: {
    get: vi.fn(() => false),
    set: vi.fn(),
  },
}));

const { useBotGamePreferences } = await import('./useBotGamePreferences');
const { writeStoredPvfFritzTier } = await import('./pvfTierPreference');
const { mutePreference } = await import('../utils/mutePreference');

type Params = Parameters<typeof useBotGamePreferences>[0];

function defaultParams(overrides: Partial<Params> = {}): Params {
  return { appMode: 'home', ...overrides };
}

describe('useBotGamePreferences — initial state', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(mutePreference.get).mockReturnValue(false);
  });

  it('isMuted initializes from mutePreference.get()', () => {
    vi.mocked(mutePreference.get).mockReturnValue(true);
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.isMuted).toBe(true);
  });

  it('botDealSize defaults to 7 when storage is empty', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.botDealSize).toBe(7);
  });

  it('botDealSize reads 14 from storage', () => {
    window.localStorage.setItem('racehorse_bot_deal_size', '14');
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.botDealSize).toBe(14);
  });

  it('botFritzTier initializes from resolveDefaultPvfFritzTier', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.botFritzTier).toBe(2);
  });

  it('all guided/authoring modes start false', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.isGuidedMode).toBe(false);
    expect(result.current.isAuthoringMode).toBe(false);
    expect(result.current.isAuthoringV2Mode).toBe(false);
    expect(result.current.isGuidedV2Mode).toBe(false);
  });
});

describe('useBotGamePreferences — persistence effects', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(mutePreference.get).mockReturnValue(false);
    vi.mocked(mutePreference.set).mockClear();
    vi.mocked(writeStoredPvfFritzTier).mockClear();
  });

  it('persists botDealSize to localStorage on change', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    act(() => { result.current.setBotDealSize(14); });
    expect(window.localStorage.getItem('racehorse_bot_deal_size')).toBe('14');
  });

  it('calls writeStoredPvfFritzTier on botFritzTier change', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    act(() => { result.current.setBotFritzTier(3 as any); });
    expect(writeStoredPvfFritzTier).toHaveBeenCalledWith(3);
  });

  it('calls mutePreference.set on isMuted change', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    act(() => { result.current.setIsMuted(true); });
    expect(mutePreference.set).toHaveBeenCalledWith(true);
  });
});

describe('useBotGamePreferences — isMutedRef sync', () => {
  beforeEach(() => { vi.mocked(mutePreference.get).mockReturnValue(false); });

  it('isMutedRef tracks isMuted', () => {
    const { result } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams(),
    });
    expect(result.current.isMutedRef.current).toBe(false);
    act(() => { result.current.setIsMuted(true); });
    expect(result.current.isMutedRef.current).toBe(true);
  });
});

describe('useBotGamePreferences — botSetup deal-size reset', () => {
  beforeEach(() => { vi.mocked(mutePreference.get).mockReturnValue(false); });

  it('resets botDealSize to 7 when appMode becomes botSetup', () => {
    const { result, rerender } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams({ appMode: 'home' }),
    });
    act(() => { result.current.setBotDealSize(14); });
    expect(result.current.botDealSize).toBe(14);

    act(() => { rerender(defaultParams({ appMode: 'botSetup' })); });
    expect(result.current.botDealSize).toBe(7);
  });

  it('does not reset botDealSize on other mode changes', () => {
    const { result, rerender } = renderHook((p: Params) => useBotGamePreferences(p), {
      initialProps: defaultParams({ appMode: 'home' }),
    });
    act(() => { result.current.setBotDealSize(14); });

    act(() => { rerender(defaultParams({ appMode: 'stats' })); });
    expect(result.current.botDealSize).toBe(14);
  });
});
