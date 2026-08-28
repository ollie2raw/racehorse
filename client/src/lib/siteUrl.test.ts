/**
 * Every share carries the site's domain into whatever feed it lands in, so a
 * stale host here is a growth bug, not a cosmetic one: between launch and the
 * commit that added SITE_DOMAIN, every shared result advertised a preview URL.
 *
 * The source scan is the part that would actually have caught it — the ghost
 * card builds an SVG rather than returning text, so no output assertion covers
 * it.
 */
import { describe, it, expect } from 'vitest';
import { SITE_DOMAIN } from './siteUrl';
import { buildShareText } from '../dailyFritz/shareCard';
import { buildLadderShareText } from '../dailyPuzzle/ladderShareCard';
import type { DailyFritzSetOverlayViewModel } from '../dailyFritz/setOverlayViewModel';

const DEPLOY_HOST = /[a-z0-9-]+\.vercel\.app/i;

describe('share domain', () => {
  it('is the brand domain, not a deploy host', () => {
    expect(SITE_DOMAIN).toBe('playracehorse.com');
    expect(DEPLOY_HOST.test(SITE_DOMAIN)).toBe(false);
  });

  it('signs the Daily Fritz share', () => {
    const text = buildShareText({
      shareDate: 'August 26, 2026',
      resultValue: 'Won',
      shareTier: 'Elite',
      marginValue: '+80',
      games: [],
    } as unknown as DailyFritzSetOverlayViewModel);
    expect(text).toContain(SITE_DOMAIN);
    expect(text).not.toMatch(DEPLOY_HOST);
  });

  it('signs the Daily Puzzle Ladder share', () => {
    const text = buildLadderShareText({
      shareDate: 'August 26, 2026',
      totalScore: 420,
      rank: 3,
      slotLines: ['A ✓', 'B ✓'],
      shareStreak: 7,
      shareRating: 2230,
    } as Parameters<typeof buildLadderShareText>[0]);
    expect(text).toContain(SITE_DOMAIN);
    expect(text).not.toMatch(DEPLOY_HOST);
  });

  it('no share module hardcodes a deploy host', () => {
    // Vite reads these at build time, so the scan needs no node builtins and
    // stays inside the client tsconfig.
    const sources = import.meta.glob('../**/*[sS]hare*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    const scanned = Object.keys(sources).filter((file) => !/\.test\./.test(file));
    // A scan that matched nothing would pass silently and guard nothing.
    expect(scanned.length).toBeGreaterThan(0);

    const offenders = scanned.filter((file) => DEPLOY_HOST.test(sources[file]));
    expect(offenders).toEqual([]);
  });
});
