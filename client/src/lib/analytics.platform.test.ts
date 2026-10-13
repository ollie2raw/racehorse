import { afterEach, describe, expect, it, vi } from 'vitest';

const posthog = { init: vi.fn(), register: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() };
vi.mock('posthog-js', () => ({ default: posthog }));

const getPlatform = vi.fn(() => 'web');
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => getPlatform(), isNativePlatform: () => getPlatform() !== 'web' } }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshAnalytics() {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_testkey');
  return import('./analytics');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  getPlatform.mockReturnValue('web');
});

describe('analytics platform property', () => {
  it('maps Capacitor platforms', async () => {
    const { analyticsPlatform } = await freshAnalytics();
    expect(analyticsPlatform('web')).toBe('web');
    expect(analyticsPlatform('ios')).toBe('ios');
    expect(analyticsPlatform('android')).toBe('android');
    expect(analyticsPlatform('electron')).toBe('web');
  });

  it('registers platform: web in a browser, once, without renaming events', async () => {
    const { track } = await freshAnalytics();
    track('session_start');
    track('game_opened', { mode: 'multiplayer' });
    await settle();
    expect(posthog.register).toHaveBeenCalledTimes(1);
    expect(posthog.register).toHaveBeenCalledWith({ platform: 'web' });
    expect(posthog.capture.mock.calls.map((c) => c[0])).toEqual(['session_start', 'game_opened']);
  });

  it('registers platform: ios inside the native shell', async () => {
    getPlatform.mockReturnValue('ios');
    const { track } = await freshAnalytics();
    track('session_start');
    await settle();
    expect(posthog.register).toHaveBeenCalledWith({ platform: 'ios' });
  });

  it('stays non-blocking if PostHog setup throws', async () => {
    posthog.register.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { track } = await freshAnalytics();
    expect(() => track('session_start')).not.toThrow();
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('falls back to PostHog US cloud when the host env var is empty (iOS env files)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_testkey');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    const { track } = await import('./analytics');
    track('session_start');
    await settle();
    expect(posthog.init.mock.calls.at(-1)?.[1]).toMatchObject({ api_host: 'https://us.i.posthog.com' });
  });
});

