// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getHomeTabs } from './HomeScreen.tsx';

describe('Home Spectator Mode visibility', () => {
  it('omits Live Now by default without leaving a slot', () => {
    const tabs = getHomeTabs(false, true, false);
    expect(tabs.map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Tournament', 'Social', 'Learn']);
  });

  it('keeps Tournament, marked coming soon, while live tournaments are switched off (the default)', () => {
    const tabs = getHomeTabs(false, false, false);
    expect(tabs.map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Tournament', 'Social', 'Learn']);
    expect(tabs.filter((tab) => tab.comingSoon).map((tab) => tab.label)).toEqual(['Tournament']);
    expect(getHomeTabs(false, true, false).some((tab) => tab.comingSoon)).toBe(false);
  });

  it('restores Live Now only for an explicitly enabled configuration', () => {
    expect(getHomeTabs(true, false, false)[0]).toMatchObject({ label: 'Live Now', mode: 'live' });
  });

  it('iOS app: drops the Tournament tab instead of showing Soon while off', () => {
    const tabs = getHomeTabs(false, false, true);
    expect(tabs.map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Social', 'Learn']);
    expect(tabs.some((tab) => tab.comingSoon)).toBe(false);
    expect(getHomeTabs(false, true, true).map((tab) => tab.label)).toContain('Tournament');
  });
});
