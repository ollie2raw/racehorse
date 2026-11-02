// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRoutesAuthProps, AppRoutesNavigationProps, AppRoutesShellProps } from '../appRouteTypes';

const flag = vi.hoisted(() => ({ on: true }));
const seen = vi.hoisted(() => ({ props: null as null | { signedIn: boolean; isGuest?: boolean } }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.on }));
vi.mock('../games/GamesPage', () => ({
  default: (props: { signedIn: boolean; isGuest?: boolean }) => {
    seen.props = props;
    return <div data-testid="games" />;
  },
}));

const { GamesRoute } = await import('./socialRoutes');

afterEach(cleanup);
beforeEach(() => {
  flag.on = true;
  seen.props = null;
});

async function mount(authUser: unknown) {
  const shell = { withAuthModals: (node: React.ReactNode) => node, appRootClassName: 'app' } as unknown as AppRoutesShellProps;
  const navigation = { setAppMode: vi.fn() } as unknown as AppRoutesNavigationProps;
  const auth = { authUser, handleOpenAuthModal: vi.fn() } as unknown as AppRoutesAuthProps;
  render(<GamesRoute shell={shell} navigation={navigation} auth={auth} />);
  await screen.findByTestId('games', undefined, { timeout: 4000 });
}

describe('the Games route and guests', () => {
  it('tells the page when the player is a guest', async () => {
    await mount({ id: 'g', is_anonymous: true });
    expect(seen.props).toMatchObject({ signedIn: true, isGuest: true });
  });

  it('does not call a permanent account, a signed-out visitor, or any user with the flag off a guest', async () => {
    await mount({ id: 'm', is_anonymous: false });
    expect(seen.props).toMatchObject({ signedIn: true, isGuest: false });
    cleanup();
    await mount(null);
    expect(seen.props).toMatchObject({ signedIn: false, isGuest: false });
    cleanup();
    flag.on = false;
    await mount({ id: 'g', is_anonymous: true });
    expect(seen.props).toMatchObject({ signedIn: true, isGuest: false });
  });
});
