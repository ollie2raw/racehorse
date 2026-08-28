/**
 * Guards the crawl navigation.
 *
 * Issue 3 in the growth assessment was a prerendered shell whose only anchor
 * pointed at itself — a placeholder that stayed. These assertions are about
 * counts and targets, so the same thing cannot quietly happen again.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — build script module, not part of the app's TS program.
import { NOINDEX, crawlTargets, isIndexable, navLabel } from './prerenderNav.mjs';

type Route = { path: string; title: string };

const routes: Route[] = [
  { path: '/', title: 'Racehorse Dominoes | Daily Strategy Game' },
  { path: '/daily-fritz', title: 'Daily Fritz | Racehorse Dominoes' },
  { path: '/learn/how-to-play', title: 'How to Play Racehorse Dominoes' },
  { path: '/players', title: 'Player Profile | Racehorse Dominoes' },
  { path: '/multiplayer/private', title: 'Private Match | Racehorse Dominoes' },
];

describe('crawl navigation', () => {
  it('links every indexable route except the one being rendered', () => {
    const targets = crawlTargets(routes, '/daily-fritz') as Route[];
    expect(targets.map((route) => route.path)).toEqual(['/', '/learn/how-to-play']);
  });

  it('never links a per-user or per-match page', () => {
    for (const path of ['/', '/daily-fritz']) {
      const targets = crawlTargets(routes, path) as Route[];
      expect(targets.filter((route) => NOINDEX.has(route.path))).toEqual([]);
    }
  });

  it('gives every page more than the single self-link it used to have', () => {
    // The regression this exists to catch: one anchor, pointing home.
    const targets = crawlTargets(routes, '/') as Route[];
    expect(targets.length).toBeGreaterThan(1);
    expect(targets.some((route) => route.path === '/')).toBe(false);
  });

  it('uses the descriptive half of the title as anchor text', () => {
    expect(navLabel(routes[1])).toBe('Daily Fritz');
    // No separator: the whole title is already page-specific.
    expect(navLabel(routes[2])).toBe('How to Play Racehorse Dominoes');
  });

  it('agrees with the sitemap on what is indexable', () => {
    expect(routes.filter(isIndexable as (r: Route) => boolean).map((r) => r.path)).toEqual([
      '/', '/daily-fritz', '/learn/how-to-play',
    ]);
  });
});
