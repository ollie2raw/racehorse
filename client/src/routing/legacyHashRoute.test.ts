import { describe, expect, it, vi } from 'vitest';
import { getLegacyHashRouteTarget, migrateLegacyHashRoute } from './legacyHashRoute';

describe('legacy hash route compatibility', () => {
  it('promotes a HashRouter path to a browser path', () => {
    expect(getLegacyHashRouteTarget('#/daily-fritz')).toBe('/daily-fritz');
  });

  it('preserves existing query parameters and adds legacy route parameters', () => {
    expect(getLegacyHashRouteTarget('#/daily?view=today', '?room=ABCD')).toBe(
      '/daily?room=ABCD&view=today',
    );
  });

  it('ignores Supabase token hashes and protocol-relative paths', () => {
    expect(getLegacyHashRouteTarget('#access_token=secret&type=recovery')).toBeNull();
    expect(getLegacyHashRouteTarget('#//example.com/path')).toBeNull();
  });

  it('replaces the current URL without adding a history entry', () => {
    const replaceState = vi.fn();
    const migrated = migrateLegacyHashRoute(
      { hash: '#/learn', search: '' },
      { state: { existing: true }, replaceState },
    );

    expect(migrated).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({ existing: true }, '', '/learn');
  });
});
