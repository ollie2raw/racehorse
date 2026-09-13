// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SinglePlayerHubScreen from './SinglePlayerHubScreen';

vi.mock('./useSinglePlayerHubStats', () => ({
  useSinglePlayerHubStats: () => ({ fritz: [], ghost: [] }),
}));
vi.mock('../ui/useDeferredAsset', () => ({ useDeferredAsset: () => null }));
vi.mock('../components', () => ({ GlobalNav: () => null }));

const props = { userId: null, onBack: vi.fn(), onNavigate: vi.fn() };

describe('SinglePlayerHubScreen', () => {
  it('shows Fritz, Ghost, and Journey, Ghost navigating to its mode', () => {
    const onNavigate = vi.fn();
    render(<SinglePlayerHubScreen {...props} onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'Play vs Fritz' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ghost Mode' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Journey' })).toBeTruthy();

    const [, ghostPlay] = screen.getAllByRole('button', { name: 'Play' });
    fireEvent.click(ghostPlay);
    expect(onNavigate).toHaveBeenCalledWith('ghostSetup');
  });

  it('locks Journey behind "Coming Soon" for non-admins and does not navigate on click', () => {
    const onNavigate = vi.fn();
    render(<SinglePlayerHubScreen {...props} onNavigate={onNavigate} />);

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    const comingSoon = screen.getByRole('button', { name: 'Coming Soon' });
    expect(comingSoon).toBeDisabled();

    fireEvent.click(comingSoon);
    expect(onNavigate).not.toHaveBeenCalledWith('journey');
  });

  it('unlocks Journey with a real Start button for the admin account', () => {
    const onNavigate = vi.fn();
    render(<SinglePlayerHubScreen {...props} isAdmin onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onNavigate).toHaveBeenCalledWith('journey');
  });

  it('no longer shows the "more modes coming soon" placeholder', () => {
    render(<SinglePlayerHubScreen {...props} />);
    expect(screen.queryByText(/more modes coming soon/i)).toBeNull();
  });
});
