// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getHomeTabs } from './HomeScreen.tsx';

describe('Home Spectator Mode visibility', () => {
  it('omits Live Now by default without leaving a slot', () => {
    const tabs = getHomeTabs(false, true);
    expect(tabs.map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Tournament', 'Social', 'Learn']);
  });

  it('omits Tournament while live tournaments are switched off (the default)', () => {
    expect(getHomeTabs(false).map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Social', 'Learn']);
  });

  it('restores Live Now only for an explicitly enabled configuration', () => {
    expect(getHomeTabs(true)[0]).toMatchObject({ label: 'Live Now', mode: 'live' });
  });
});
