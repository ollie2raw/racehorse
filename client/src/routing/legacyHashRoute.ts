type LegacyHashLocation = Pick<Location, 'hash' | 'search'>;

export function getLegacyHashRouteTarget(
  rawHash: string,
  currentSearch = '',
): string | null {
  if (!rawHash.startsWith('#/') || rawHash.startsWith('#//')) return null;

  const legacyRoute = rawHash.slice(1);
  const queryIndex = legacyRoute.indexOf('?');
  const pathname = queryIndex === -1 ? legacyRoute : legacyRoute.slice(0, queryIndex);
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return null;

  const currentParams = new URLSearchParams(currentSearch);
  if (queryIndex !== -1) {
    const legacyParams = new URLSearchParams(legacyRoute.slice(queryIndex + 1));
    legacyParams.forEach((value, key) => {
      if (!currentParams.has(key)) currentParams.append(key, value);
    });
  }

  const search = currentParams.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
}

export function migrateLegacyHashRoute(
  location: LegacyHashLocation = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): boolean {
  const target = getLegacyHashRouteTarget(location.hash, location.search);
  if (!target) return false;
  history.replaceState(history.state, '', target);
  return true;
}
