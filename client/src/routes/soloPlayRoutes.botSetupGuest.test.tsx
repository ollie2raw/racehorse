// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRoutesAuthProps, AppRoutesBotMatchProps, AppRoutesNavigationProps, AppRoutesShellProps } from '../appRouteTypes';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.on }));
vi.mock('../bot/PlayVsFritz', () => ({
  default: (props: { onStart: (p: { difficulty: string; dealSize: number }) => void }) => (
    <button type="button" onClick={() => props.onStart({ difficulty: 'elite', dealSize: 7 })}>start-match</button>
  ),
}));

const { BotSetupRoute } = await import('./soloPlayRoutes');

afterEach(cleanup);
beforeEach(() => {
  flag.on = true;
});

function setup(authUser: unknown, ensureGuestSession: () => Promise<{ error: string | null }>) {
  const setAppMode = vi.fn();
  const setBotFritzTier = vi.fn();
  const setBotDealSize = vi.fn();
  const shell = { withAuthModals: (node: React.ReactNode) => node, appRootClassName: 'app' } as unknown as AppRoutesShellProps;
  const navigation = { setAppMode } as unknown as AppRoutesNavigationProps;
  const auth = { authUser, ensureGuestSession, setAuthModalOpen: vi.fn(), handleSignOut: vi.fn() } as unknown as AppRoutesAuthProps;
  const botMatch = { setBotFritzTier, setBotDealSize } as unknown as AppRoutesBotMatchProps;
  render(<BotSetupRoute shell={shell} navigation={navigation} auth={auth} botMatch={botMatch} />);
  return { setAppMode, setBotFritzTier, setBotDealSize };
}

async function start() {
  const button = await screen.findByRole('button', { name: 'start-match' }, { timeout: 4000 });
  await act(async () => {
    button.click();
  });
}

describe('Play vs Fritz start (the setup route)', () => {
  it('makes a guest session for a visitor with none, and starts the match once it exists', async () => {
    let finish!: () => void;
    const ensure = vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = () => resolve({ error: null }); }));
    const { setAppMode, setBotFritzTier, setBotDealSize } = setup(null, ensure);
    await start();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(setBotFritzTier).toHaveBeenCalledWith('elite');
    expect(setBotDealSize).toHaveBeenCalledWith(7);
    expect(setAppMode).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(setAppMode).toHaveBeenCalledWith('bot');
  });

  it('still starts the match when the session cannot be made', async () => {
    const { setAppMode } = setup(null, vi.fn().mockResolvedValue({ error: 'Anonymous sign-ins are disabled' }));
    await start();
    expect(setAppMode).toHaveBeenCalledWith('bot');
  });

  it('does not touch a signed-in player', async () => {
    const ensure = vi.fn().mockResolvedValue({ error: null });
    const { setAppMode } = setup({ id: 'u1' }, ensure);
    await start();
    expect(ensure).not.toHaveBeenCalled();
    expect(setAppMode).toHaveBeenCalledWith('bot');
  });

  it('does not make a session with the flag off', async () => {
    flag.on = false;
    const ensure = vi.fn().mockResolvedValue({ error: null });
    const { setAppMode } = setup(null, ensure);
    await start();
    expect(ensure).not.toHaveBeenCalled();
    expect(setAppMode).toHaveBeenCalledWith('bot');
  });
});
