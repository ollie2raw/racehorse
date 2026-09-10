// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_PRIMARY_TABS } from './nav/appPrimaryTabs';

const mockAuth = vi.fn();
vi.mock('../auth/useAuth', () => ({ useAuth: () => mockAuth() }));
vi.mock('../friends/friendsApi', () => ({ fetchFriends: () => new Promise(() => {}) }));
vi.mock('./BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('./nav/AppBottomTabBar', () => ({ AppBottomTabBar: () => null }));

const { GlobalNav } = await import('./GlobalNav');

const signedIn = {
  user: { id: 'user-1', email: 'qa@racehorse.test' },
  profile: { id: 'user-1', username: 'oliver', glicko_rating: 1500 },
  loading: false,
};

/** The label of the desktop tab currently showing the glow underline. */
function activeTabLabel(container: HTMLElement): string | null {
  const underline = container.querySelector('.rh-glow-underline--global-nav');
  const button = underline?.closest('button');
  return button?.textContent?.trim() ?? null;
}

describe('GlobalNav — desktop active tab is driven by APP_PRIMARY_TABS (S4)', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockAuth.mockReturnValue(signedIn);
  });

  it('highlights the correct tab for every mode in the shared table', () => {
    for (const tab of APP_PRIMARY_TABS) {
      for (const mode of tab.activeModes) {
        const { container, unmount } = render(<GlobalNav currentMode={mode} />);
        expect(activeTabLabel(container)).toBe(tab.label);
        unmount();
      }
    }
  });

  it('highlights Single Player on /daily-fritz/leaderboard and Learn on /learn/recorder', () => {
    const { container: a, unmount: unmountA } = render(<GlobalNav currentMode="dailyFritzLeaderboard" />);
    expect(activeTabLabel(a)).toBe('Single Player');
    unmountA();

    const { container: b } = render(<GlobalNav currentMode="guidedMatchRecorder" />);
    expect(activeTabLabel(b)).toBe('Learn');
  });

  it('highlights no tab for a mode outside the primary nav', () => {
    const { container } = render(<GlobalNav currentMode="settings" />);
    expect(activeTabLabel(container)).toBeNull();
  });
});
