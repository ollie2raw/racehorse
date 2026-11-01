import { describe, expect, it } from 'vitest';

/**
 * `mode-home-screen` is a legacy class: premium-theme.css sizes its header and content to `min(1000px, 94vw) !important`,
 * which ignores the shell's own horizontal padding. On a 390px phone that is a 367px column inside a 310px box, so the page
 * spills past the right edge and is clipped (Rating History did exactly this). Pages should use `mode-subpage-screen`.
 *
 * The only component allowed to keep it is the lesson player, which overrides those widths itself
 * (learnPlayer.css: `.learn-player-screen .layout-screen-content.screen-shell`).
 */
const ALLOWED = new Set(['/src/learn/LearnPlayer.tsx']);

const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the legacy mode-home-screen class', () => {
  it('is not used by any page that would be clipped on a phone', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.') && !ALLOWED.has(path))
      .filter(([, text]) => /className=(?:"|'|\{`)[^"'`]*\bmode-home-screen\b/.test(text))
      .map(([path]) => path);
    expect(offenders, `Use mode-subpage-screen instead of mode-home-screen (see this file's header): ${offenders.join(', ')}`).toEqual([]);
  });

  it('still finds the one allowed user, so the guard is looking in the right place', () => {
    expect(Object.keys(sources)).toContain('/src/learn/LearnPlayer.tsx');
    expect(/\bmode-home-screen\b/.test(sources['/src/learn/LearnPlayer.tsx'] ?? '')).toBe(true);
  });
});
