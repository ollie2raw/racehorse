/**
 * Contract for the native landscape Home (iPhone 844x390 / 874x402): Home is one fixed screen, so the daily cards are the flexible
 * region. Measured in the real iOS WebView, double-counting the bottom inset (main AND the legal footer) left the cards 95pt tall for
 * 164pt of content and clipped the PLAY button, which is the only way into Daily Fritz / Daily Puzzles. These rules pin the fix.
 */
import { describe, expect, it } from 'vitest';

// Vitest stubs every CSS import (?raw / ?inline included) to '', and the app tsconfig has no node types, so read the file through a
// non-literal dynamic import that tsc does not try to resolve.
const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (path: string, enc: 'utf8') => string };
const css = readFileSync('src/styles/native-landscape.css', 'utf8'); // vitest runs from client/
const webHomeCss = readFileSync('src/screens/RacehorseHomeArt.css', 'utf8');;

/** Every declaration block for a selector, in source order (later blocks win the cascade). */
function rules(selector: string): string[] {
  const blocks: string[] = [];
  for (let at = css.indexOf(`${selector} {`); at > -1; at = css.indexOf(`${selector} {`, at + 1)) {
    blocks.push(css.slice(at, css.indexOf('}', at)));
  }
  expect(blocks.length, `missing rule: ${selector}`).toBeGreaterThan(0);
  return blocks;
}

describe('native landscape Home fits one screen', () => {
  it('the legal footer owns the bottom inset; Home main does not pad for it a second time', () => {
    const main = rules('.rh-native .today-home .home-main').join('\n');
    expect(main).toMatch(/padding:\s*var\(--rh-native-nav-h\)\s+0\s+0;/);
    expect(main).not.toContain('--rh-safe-bottom');
  });

  it('the card blurb yields to the Play button on not-yet-played cards', () => {
    const blurb = rules('.rh-native .today-home .home-daily-grid .home-card-description').filter((b) => /display:/.test(b));
    expect(blurb[blurb.length - 1]).toContain('display: none');
  });

  it('web phones held sideways do not spend 61px of the pixel-sized compact Home on the legal footer; native keeps it', () => {
    const at = webHomeCss.indexOf('html:not(.rh-native) .today-home .home-legal-footer {');
    expect(at).toBeGreaterThan(-1);
    expect(webHomeCss.slice(webHomeCss.lastIndexOf('@media', at), at)).toContain('(--short-landscape)');
    expect(webHomeCss.slice(at, webHomeCss.indexOf('}', at))).toContain('display: none');
  });
});
