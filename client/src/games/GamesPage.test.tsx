// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GamesPage from './GamesPage';

const portal = vi.hoisted(() => vi.fn());
vi.mock('../modules/review/HistoricalGameReviewPortal', () => ({
  HistoricalGameReviewPortal: (props: { enabled?: boolean; layout?: string }) => {
    portal(props);
    return <div data-testid="archive">archive:{props.layout}</div>;
  },
}));
vi.mock('../ui/LayoutScreen', () => ({
  default: ({ title, subtitle, children, className }: { title: string; subtitle: string; children: React.ReactNode; className: string }) => (
    <main className={className}><h1>{title}</h1><p>{subtitle}</p>{children}</main>
  ),
}));

describe('GamesPage', () => {
  it('shows the full archive for a signed-in player', () => {
    render(<GamesPage signedIn onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Games' })).toBeTruthy();
    expect(screen.getByTestId('archive')).toHaveTextContent('archive:page');
    expect(portal).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, layout: 'page' }));
  });

  it('asks a signed-out visitor to sign in instead of showing an archive that cannot load', () => {
    portal.mockClear();
    render(<GamesPage signedIn={false} onBack={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sign in to see your saved games.');
    expect(screen.queryByTestId('archive')).toBeNull();
    expect(portal).not.toHaveBeenCalled();
  });

  it('offers a Sign in button to a signed-out visitor, and it opens sign-in', () => {
    const onOpenAuth = vi.fn();
    render(<GamesPage signedIn={false} onOpenAuth={onOpenAuth} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  it('does not show a dead Sign in button when there is no handler, and never to a signed-in player', () => {
    const { unmount } = render(<GamesPage signedIn={false} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    unmount();
    render(<GamesPage signedIn onOpenAuth={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  describe('for a guest', () => {
    it('still shows their archive, with a notice that the games live on the guest session', () => {
      render(<GamesPage signedIn isGuest onOpenAuth={vi.fn()} onBack={vi.fn()} />);
      expect(screen.getByTestId('archive')).toHaveTextContent('archive:page');
      expect(screen.getByRole('status')).toHaveTextContent('playing as a guest');
    });

    it('offers Create account (not Sign in), and it opens the account sheet', () => {
      const onOpenAuth = vi.fn();
      render(<GamesPage signedIn isGuest onOpenAuth={onOpenAuth} onBack={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
      expect(onOpenAuth).toHaveBeenCalledTimes(1);
    });

    it('shows no dead button without a handler', () => {
      render(<GamesPage signedIn isGuest onBack={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    });

    it('shows a permanent account no guest notice', () => {
      render(<GamesPage signedIn isGuest={false} onOpenAuth={vi.fn()} onBack={vi.fn()} />);
      expect(screen.queryByText(/playing as a guest/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    });
  });

  it('goes back home', () => {
    const onBack = vi.fn();
    render(<GamesPage signedIn onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /Back to Home/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
