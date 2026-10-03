// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components', () => ({ GlobalNav: () => null }));

import { TournamentsComingSoonScreen } from './TournamentsComingSoonScreen';

describe('TournamentsComingSoonScreen', () => {
  it('says tournaments are coming back and routes back home or to single player', () => {
    const onNavigate = vi.fn();
    const onBackHome = vi.fn();
    render(<TournamentsComingSoonScreen onNavigate={onNavigate} onOpenAuth={vi.fn()} onSignOut={vi.fn()} onBackHome={onBackHome} />);
    expect(screen.getByRole('heading', { name: 'Tournaments are coming back soon' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to Home/ }));
    expect(onBackHome).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play Single Player' }));
    expect(onNavigate).toHaveBeenCalledWith('singlePlayerHub');
  });
});
