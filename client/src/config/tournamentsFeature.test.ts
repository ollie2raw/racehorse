import { describe, expect, it } from 'vitest';
import { getAppPrimaryTabs } from '../components/nav/appPrimaryTabs';
import { isTournamentsEnabled, parseTournamentsFlag } from './tournamentsFeature';

describe('tournaments feature flag', () => {
  it('is on only for exactly "true"', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE', true]) expect(parseTournamentsFlag(value)).toBe(false);
    expect(parseTournamentsFlag('true')).toBe(true);
    expect(isTournamentsEnabled(undefined)).toBe(false);
  });

  it('keeps the Tournament tab in place, marked coming soon only while off', () => {
    const labels = ['Multiplayer', 'Single Player', 'Tournament', 'Social', 'Learn'];
    const off = getAppPrimaryTabs(false);
    const on = getAppPrimaryTabs(true);
    expect(off.map((t) => t.label)).toEqual(labels);
    expect(on.map((t) => t.label)).toEqual(labels);
    expect(off.filter((t) => t.comingSoon).map((t) => t.label)).toEqual(['Tournament']);
    expect(on.some((t) => t.comingSoon)).toBe(false);
  });
});
