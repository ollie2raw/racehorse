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

  it('goes back home', () => {
    const onBack = vi.fn();
    render(<GamesPage signedIn onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /Back to Home/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
