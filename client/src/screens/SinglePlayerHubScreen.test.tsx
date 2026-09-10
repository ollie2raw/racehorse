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
  it('shows Fritz, Ghost, and Journey, each navigating to its mode', () => {
    const onNavigate = vi.fn();
    render(<SinglePlayerHubScreen {...props} onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'Play vs Fritz' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ghost Mode' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Journey' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onNavigate).toHaveBeenCalledWith('journey');
  });

  it('no longer shows the "more modes coming soon" placeholder', () => {
    render(<SinglePlayerHubScreen {...props} />);
    expect(screen.queryByText(/more modes coming soon/i)).toBeNull();
  });
});
