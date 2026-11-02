// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRoutesAuthProps, AppRoutesBotMatchProps, AppRoutesLearnProps, AppRoutesNavigationProps, AppRoutesShellProps } from '../appRouteTypes';

const flag = vi.hoisted(() => ({ on: true }));
const journey = vi.hoisted(() => ({ challenge: null as unknown }));
const captured = vi.hoisted(() => ({ onSaveGuestGame: undefined as (() => void) | null | undefined }));
vi.mock('../config/guestPlayFeature', () => ({ isGuestPlayEnabled: () => flag.on }));
vi.mock('../journey/journeyRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../journey/journeyRuntime')>()),
  getJourneyActiveChallenge: () => journey.challenge,
}));
vi.mock('../bot/BotMatchScreen', () => ({
  default: (props: { onSaveGuestGame?: (() => void) | null }) => {
    captured.onSaveGuestGame = props.onSaveGuestGame;
    return <div data-testid="bot-match" />;
  },
}));

const { BotMatchRoute } = await import('./soloPlayRoutes');

afterEach(cleanup);
beforeEach(() => {
  flag.on = true;
  journey.challenge = null;
  captured.onSaveGuestGame = undefined;
});

async function mount(authUser: unknown, botMatch: Partial<AppRoutesBotMatchProps> = {}) {
  const setAuthModalOpen = vi.fn();
  const shell = { withAuthModals: (node: React.ReactNode) => node, appRootClassName: 'app' } as unknown as AppRoutesShellProps;
  const navigation = { setAppMode: vi.fn() } as unknown as AppRoutesNavigationProps;
  const auth = { authUser, authLoading: false, setAuthModalOpen, isAdmin: false } as unknown as AppRoutesAuthProps;
  const learn = {
    setIsGuidedMode: vi.fn(), setIsAuthoringMode: vi.fn(), setIsAuthoringV2Mode: vi.fn(), setIsGuidedV2Mode: vi.fn(),
  } as unknown as AppRoutesLearnProps;
  const bot = { botDealSize: 7, botFritzTier: 'elite', ...botMatch } as unknown as AppRoutesBotMatchProps;
  render(<BotMatchRoute shell={shell} navigation={navigation} auth={auth} learn={learn} botMatch={bot} />);
  await screen.findByTestId('bot-match', undefined, { timeout: 4000 });
  return { setAuthModalOpen };
}

const GUEST = { id: 'g', is_anonymous: true };
const MEMBER = { id: 'm', is_anonymous: false };

describe('the Play vs Fritz match route and the guest save prompt', () => {
  it('gives a guest in a standalone match a way to open account creation', async () => {
    const { setAuthModalOpen } = await mount(GUEST);
    expect(captured.onSaveGuestGame).toBeTypeOf('function');
    captured.onSaveGuestGame?.();
    expect(setAuthModalOpen).toHaveBeenCalledWith(true);
  });

  it('gives a permanent account, or a build with the flag off, nothing', async () => {
    await mount(MEMBER);
    expect(captured.onSaveGuestGame).toBeNull();
    cleanup();
    flag.on = false;
    await mount(GUEST);
    expect(captured.onSaveGuestGame).toBeNull();
  });

  it('does not interrupt a Journey trial or a guided/authoring match', async () => {
    journey.challenge = { attemptId: 'a1', dealSize: 7, fritzTier: 'elite', winningScore: 60 };
    await mount(GUEST);
    expect(captured.onSaveGuestGame).toBeNull();
    cleanup();
    journey.challenge = null;
    await mount(GUEST, { isGuidedMode: true });
    expect(captured.onSaveGuestGame).toBeNull();
  });
});
