// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzTodayResponse } from './api';
import { DailyFritzHubView, type DailyFritzHubViewProps } from './DailyFritzHubView';
import { buildDailyFritzHubViewModel } from './dailyFritzHubViewModel';

vi.mock('../components', () => ({
  GlobalNav: () => null,
  BoneyardStackIcon: () => null,
}));

const TODAY: DailyFritzTodayResponse = {
  ok: true,
  run_date: '2026-07-05',
  fritz_tier: 'elite',
  deal_size: 7,
  winning_score: 60,
  attempt_status: 'none',
  next_action: 'play_hand',
  current_game_number: null,
  streak: 2,
  result: null,
  set_result: null,
  rank: null,
  leaderboard_preview: [],
};

function renderHub(signedIn: boolean, overrides: Partial<DailyFritzHubViewProps> = {}) {
  const props: DailyFritzHubViewProps = {
    hub: buildDailyFritzHubViewModel(signedIn ? TODAY : null, null, 0, false, signedIn),
    heroSrc: null,
    hubError: null,
    startActionPending: false,
    onBack: vi.fn(),
    onOpenAuth: vi.fn(),
    onSetAction: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    ...overrides,
  };
  render(<DailyFritzHubView {...props} />);
  return props;
}

afterEach(cleanup);

describe('Daily Fritz hub for a signed-out visitor', () => {
  it('the main button signs them in instead of starting a set', () => {
    const props = renderHub(false);
    const button = screen.getByRole('button', { name: /Sign in to play/ });
    fireEvent.click(button);
    expect(props.onOpenAuth).toHaveBeenCalledTimes(1);
    expect(props.onSetAction).not.toHaveBeenCalled();
  });

  it('does not repeat the same message as an alert above the button', () => {
    renderHub(false, { hubError: 'Sign in to play Daily Fritz.' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows real values in the set tiles, not placeholder dashes', () => {
    renderHub(false);
    const tiles = within(screen.getByRole('list', { name: 'Set details' }));
    expect(tiles.getByText('Best of 3')).toBeTruthy();
    expect(screen.queryAllByText('—')).toHaveLength(0);
  });
});

describe('Daily Fritz hub for a signed-in player', () => {
  it('the main button starts the set and does not open sign-in', () => {
    const props = renderHub(true);
    fireEvent.click(screen.getByRole('button', { name: /Play Today's Set/ }));
    expect(props.onSetAction).toHaveBeenCalledTimes(1);
    expect(props.onOpenAuth).not.toHaveBeenCalled();
  });

  it('still shows a hub error', () => {
    renderHub(true, { hubError: 'Could not start the set.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start the set.');
  });
});
