// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlayVsFritz from './PlayVsFritz';

vi.mock('../components', () => ({ GlobalNav: () => null }));
vi.mock('../ui/useDeferredAsset', () => ({ useDeferredAsset: () => null }));

describe('PlayVsFritz setup page', () => {
  const onStart = vi.fn();

  beforeEach(() => {
    onStart.mockClear();
    window.localStorage.clear();
  });

  it('keeps the match setup and Fritz card while omitting recent review presentation', () => {
    const { container } = render(<PlayVsFritz onBack={vi.fn()} onStart={onStart} />);

    expect(screen.getByRole('button', { name: /Back to Single Player/i })).toBeInTheDocument();
    expect(screen.getByText('SINGLE PLAYER')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Play vs Fritz' })).toBeInTheDocument();
    expect(
      screen.getByText('Choose your tier and format, then start a match against Fritz.'),
    ).toBeInTheDocument();

    const leftColumn = container.querySelector('.pvf-left-col');
    expect(leftColumn).not.toBeNull();
    expect(Array.from(leftColumn!.children).map((child) => child.className)).toEqual([
      'pvf-back-btn rh-back-button',
      'pvf-header',
      'pvf-opponent-card',
    ]);
    expect(screen.queryByLabelText(/Recent game reviews/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent reviews/i)).not.toBeInTheDocument();

    const opponentCard = container.querySelector('.pvf-opponent-card');
    expect(opponentCard).not.toBeNull();
    expect(within(opponentCard as HTMLElement).getByText('YOUR OPPONENT')).toBeInTheDocument();
    expect(within(opponentCard as HTMLElement).getByRole('heading', { name: 'Fritz' })).toBeInTheDocument();
  });

  it('retains difficulty, deal-size, and match-start controls', () => {
    render(<PlayVsFritz onBack={vi.fn()} onStart={onStart} />);

    expect(screen.getByText('1. CHOOSE DIFFICULTY')).toBeInTheDocument();
    expect(screen.getByText('2. CHOOSE DEAL SIZE / FORMAT')).toBeInTheDocument();
    expect(screen.getByText('7 Tiles')).toBeInTheDocument();
    expect(screen.getByText('14 Tiles')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start Match/i }));

    expect(onStart).toHaveBeenCalledWith({ difficulty: 'standard', dealSize: 7 });
  });
});
