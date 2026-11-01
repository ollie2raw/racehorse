import { describe, expect, it } from 'vitest';

/**
 * `mode-home-screen` is a legacy class: premium-theme.css sizes its header and content to `min(1000px, 94vw) !important`,
 * which ignores the shell's own horizontal padding. On a 390px phone that is a 367px column inside a 310px box, so the page
 * spills past the right edge and is clipped (Rating History did exactly this). Pages should use `mode-subpage-screen`.
 *
 * Nothing is exempt any more: the one component that was (the Learn v1 lesson player, which overrode those widths itself)
 * was removed as unreachable.
 */
const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the legacy mode-home-screen class', () => {
  it('is not used by any page that would be clipped on a phone', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, text]) => /className=(?:"|'|\{`)[^"'`]*\bmode-home-screen\b/.test(text))
      .map(([path]) => path);
    expect(offenders, `Use mode-subpage-screen instead of mode-home-screen (see this file's header): ${offenders.join(', ')}`).toEqual([]);
  });

  it('is looking at the app source, so an empty result means something', () => {
    expect(Object.keys(sources)).toContain('/src/ui/LayoutScreen.tsx');
  });
});
