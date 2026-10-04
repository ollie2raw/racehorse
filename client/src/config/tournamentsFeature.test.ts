import { describe, expect, it } from 'vitest';
import { getAppPrimaryTabs } from '../components/nav/appPrimaryTabs';
import { isTournamentsEnabled, parseTournamentsFlag } from './tournamentsFeature';

describe('tournaments feature flag', () => {
  it('is on only for exactly "true"', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE', true]) expect(parseTournamentsFlag(value)).toBe(false);
    expect(parseTournamentsFlag('true')).toBe(true);
    expect(isTournamentsEnabled(undefined)).toBe(false);
  });

  it('removes the Tournament tab when off and keeps it when on', () => {
    expect(getAppPrimaryTabs(false).map((t) => t.label)).not.toContain('Tournament');
    expect(getAppPrimaryTabs(true).map((t) => t.label)).toContain('Tournament');
  });
});
