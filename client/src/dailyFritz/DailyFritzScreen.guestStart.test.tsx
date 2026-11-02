// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzTodayResponse } from './api';
import type { DailyFritzScreenProps } from './dailyFritzScreenTypes';

const init = vi.hoisted(() => ({ today: null as unknown }));
const beginRun = vi.hoisted(() => vi.fn());
const continueSet = vi.hoisted(() => vi.fn());
const guestFlag = vi.hoisted(() => ({ on: true }));

vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => guestFlag.on }));
vi.mock('../ui/useDeferredAsset', () => ({ useDeferredAsset: () => null }));
vi.mock('../screens/RacehorseHomeArt.css', () => ({}));
vi.mock('./dailyFritz.css', () => ({}));
vi.mock('../presentation/gameplayPresentation', () => ({ useGameplayPresentation: () => undefined }));
vi.mock('./DailyFritzLoadingScreen', () => ({ DailyFritzLoadingScreen: () => null }));
vi.mock('./DailyFritzEmbeddedMatchView', () => ({ DailyFritzEmbeddedMatchView: () => null }));
const buildOverlay = vi.hoisted(() => vi.fn(() => null));
const overlayState = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./buildDailyFritzSetOverlayViewModel', () => ({ buildDailyFritzSetOverlayViewModel: buildOverlay }));
vi.mock('./useDailyFritzInit', () => ({
  useDailyFritzInit: () => ({
    today: init.today,
    initPhase: 'ready',
    loadError: null,
    initRetryPending: false,
    hubError: null,
    setHubError: vi.fn(),
    refreshToday: vi.fn(),
    runInit: vi.fn(),
    showInitScreen: false,
  }),
}));
vi.mock('./useDailyFritzRunController', () => ({
  useDailyFritzRunController: () => ({
    activeRun: null,
    embeddedMatchKey: null,
    setOverlay: overlayState.value,
    startActionPending: false,
    dailyFritzPackageForMatch: null,
    beginRun,
    continueSet,
    closeEmbeddedRun: vi.fn(),
    finishEmbeddedRun: vi.fn(),
    handleDailyFritzGameComplete: vi.fn(),
    clearSetOverlay: vi.fn(),
    retryFinalSubmission: vi.fn(),
    hasEmbeddedMatch: false,
  }),
}));
// The hub itself is covered by DailyFritzHubView.guest.test.tsx; here it is just the two buttons the screen wires up.
vi.mock('./DailyFritzHubView', () => ({
  DailyFritzHubView: (props: { onStartGuest?: () => void; onSetAction: () => void; guestError?: string | null; hub: { primaryCtaLabel: string } }) => (
    <div>
      <button type="button" onClick={props.onStartGuest}>start-guest</button>
      <button type="button" onClick={props.onSetAction}>set-action</button>
      <span data-testid="label">{props.hub.primaryCtaLabel}</span>
      <span data-testid="error">{props.guestError ?? ''}</span>
    </div>
  ),
}));

import DailyFritzScreen from './DailyFritzScreen';

const TODAY = {
  ok: true,
  run_date: '2026-11-02',
  fritz_tier: 'elite',
  deal_size: 7,
  winning_score: 60,
  attempt_status: 'none',
  next_action: 'play_hand',
  current_game_number: null,
  streak: 0,
  result: null,
  set_result: null,
  rank: null,
  leaderboard_preview: [],
} as unknown as DailyFritzTodayResponse;

const GUEST = { id: 'guest-1' } as unknown as User;

function props(overrides: Partial<DailyFritzScreenProps> = {}): DailyFritzScreenProps {
  return {
    user: null,
    profile: null,
    ghostProfile: null,
    onGhostProfileChange: vi.fn(),
    onOpenAuth: vi.fn(),
    ensureGuestSession: vi.fn().mockResolvedValue({ error: null }),
    onBack: vi.fn(),
    socket: null,
    ...overrides,
  };
}

async function tap(name: string) {
  await act(async () => {
    screen.getByRole('button', { name }).click();
  });
}

beforeEach(() => {
  init.today = null;
  guestFlag.on = true;
  overlayState.value = null;
  buildOverlay.mockClear();
  beginRun.mockReset();
  continueSet.mockReset();
});
afterEach(cleanup);

describe('Daily Fritz screen: Play as guest', () => {
  it('offers the guest button only with the flag on and a way to make a session', () => {
    const { rerender } = render(<DailyFritzScreen {...props()} />);
    expect(screen.getByTestId('label').textContent).toBe('Play as guest');
    rerender(<DailyFritzScreen {...props({ ensureGuestSession: undefined })} />);
    expect(screen.getByTestId('label').textContent).toBe('Sign in to play');
    guestFlag.on = false;
    rerender(<DailyFritzScreen {...props()} />);
    expect(screen.getByTestId('label').textContent).toBe('Sign in to play');
  });

  it('creates the session, then starts the set on its own once the set has loaded for the new user', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    const { rerender } = render(<DailyFritzScreen {...props({ ensureGuestSession: ensure })} />);
    await tap('start-guest');
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(beginRun).not.toHaveBeenCalled(); // no user yet, nothing loaded

    rerender(<DailyFritzScreen {...props({ ensureGuestSession: ensure, user: GUEST })} />);
    expect(beginRun).not.toHaveBeenCalled(); // user, but the set has not loaded

    init.today = TODAY;
    rerender(<DailyFritzScreen {...props({ ensureGuestSession: ensure, user: GUEST })} />);
    expect(beginRun).toHaveBeenCalledTimes(1);

    rerender(<DailyFritzScreen {...props({ ensureGuestSession: ensure, user: GUEST })} />);
    expect(beginRun).toHaveBeenCalledTimes(1); // once, not on every render
  });

  it('shows the reason and does not start anything when the session cannot be made', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: 'Unable to start a guest session.' });
    const { rerender } = render(<DailyFritzScreen {...props({ ensureGuestSession: ensure })} />);
    await tap('start-guest');
    expect(screen.getByTestId('error').textContent).toBe('Unable to start a guest session.');

    // a later sign-in must not be treated as the guest start that failed
    init.today = TODAY;
    rerender(<DailyFritzScreen {...props({ ensureGuestSession: ensure, user: GUEST })} />);
    expect(beginRun).not.toHaveBeenCalled();
  });

  describe('the save prompt on the finished-set card', () => {
    const contextOf = () => (buildOverlay.mock.calls.at(-1) as unknown as [unknown, unknown, { guestSavePrompt?: { onCreateAccount: () => void } }])[2];

    it('is offered to a guest, and its action opens sign-up', () => {
      overlayState.value = { kind: 'final' };
      const onOpenAuth = vi.fn();
      render(<DailyFritzScreen {...props({ user: { id: 'g', is_anonymous: true } as unknown as User, onOpenAuth })} />);
      contextOf().guestSavePrompt?.onCreateAccount();
      expect(onOpenAuth).toHaveBeenCalledTimes(1);
    });

    it('is not offered to a permanent account, or when the flag is off', () => {
      overlayState.value = { kind: 'final' };
      render(<DailyFritzScreen {...props({ user: { id: 'u', is_anonymous: false } as unknown as User })} />);
      expect(contextOf().guestSavePrompt).toBeUndefined();
      cleanup();
      guestFlag.on = false;
      render(<DailyFritzScreen {...props({ user: { id: 'g', is_anonymous: true } as unknown as User })} />);
      expect(contextOf().guestSavePrompt).toBeUndefined();
    });
  });

  it('does not start a set that is already finished or underway', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    const { rerender } = render(<DailyFritzScreen {...props({ ensureGuestSession: ensure })} />);
    await tap('start-guest');
    init.today = { ...TODAY, attempt_status: 'started' } as unknown as DailyFritzTodayResponse;
    rerender(<DailyFritzScreen {...props({ ensureGuestSession: ensure, user: GUEST })} />);
    expect(beginRun).not.toHaveBeenCalled();
    expect(continueSet).not.toHaveBeenCalled();
  });
});
