// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getHomeTabs } from './HomeScreen.tsx';

describe('Home Spectator Mode visibility', () => {
  it('omits Live Now by default without leaving a slot', () => {
    const tabs = getHomeTabs(false);
    expect(tabs.map((tab) => tab.label)).toEqual(['Multiplayer', 'Single Player', 'Tournament', 'Social', 'Learn']);
  });

  it('restores Live Now only for an explicitly enabled configuration', () => {
    expect(getHomeTabs(true)[0]).toMatchObject({ label: 'Live Now', mode: 'live' });
  });
});
