/**
 * The crawl navigation injected into every prerendered page.
 *
 * Search engines discover pages by following links. Before this existed the
 * prerendered shell carried exactly one anchor — pointing at itself — so the
 * sitemap listed fourteen URLs that nothing linked to and the routing fix
 * produced no crawlable surface at all (growth assessment, Issue 3).
 *
 * Extracted from prerender.mjs so it can be tested without running the build.
 */

/** Routes whose content is per-user or per-match, so not worth indexing. */
export const NOINDEX = new Set([
  '/players',
  '/tournament/detail',
  '/tournament/result',
  '/multiplayer/private',
]);

export function isIndexable(route) {
  return !NOINDEX.has(route.path);
}

/**
 * Anchor text. Titles read "Page | Racehorse Dominoes", so the first segment
 * is the descriptive half; the titles without a separator are already
 * page-specific and pass through whole.
 */
export function navLabel(route) {
  return route.title.split('|')[0].trim();
}

/**
 * Every indexable route except the current one, so a crawler landing on any
 * page can reach the rest and no page wastes a link on itself.
 */
export function crawlTargets(routes, currentPath) {
  return routes.filter((route) => isIndexable(route) && route.path !== currentPath);
}
