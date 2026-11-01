// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('guided match lesson loader when the bundled lesson cannot be fetched', () => {
  it('imports cleanly and reports the lesson as unavailable instead of rejecting the module', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const loader = await import('./guidedMatchLessonLoader');

    expect(loader.getPublicGuidedMatchLessonSanityIssues()).toEqual(['the bundled lesson could not be loaded']);
    expect(() => loader.getPublicGuidedMatchPlaybackLesson()).toThrow(/unavailable/);
    expect(() => loader.getPublicGuidedMatchLesson()).toThrow(/unavailable/);
    expect(loader.getPublicGuidedMatchFinalDebrief()).toBeNull();
  });

  it('treats a non-OK response the same way', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));

    const loader = await import('./guidedMatchLessonLoader');

    expect(loader.getPublicGuidedMatchLessonSanityIssues()).toHaveLength(1);
    expect(() => loader.getPublicGuidedMatchPlaybackLesson()).toThrow(/unavailable/);
  });

  it('lets the start resolver turn that into a player-facing message and no route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { resolveGuidedMatchStart } = await import('../lessonV2');
    const start = resolveGuidedMatchStart();

    expect(start.route).toBeNull();
    expect(start.error).toBeTruthy();
  });
});
