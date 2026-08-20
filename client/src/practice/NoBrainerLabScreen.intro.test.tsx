// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoBrainerHandRecord } from './noBrainerDataset';

const { mockHand, pickNoBrainerHandMock } = vi.hoisted(() => {
  const hand: NoBrainerHandRecord = {
    key: 'test-hand',
    difficulty: 'easy',
    hand: [
      { low: 6, high: 5 },
      { low: 5, high: 4 },
      { low: 4, high: 3 },
      { low: 3, high: 2 },
      { low: 2, high: 1 },
      { low: 1, high: 0 },
      { low: 6, high: 6 },
    ],
    example: [
      { low: 6, high: 5 },
      { low: 5, high: 4 },
      { low: 4, high: 3 },
      { low: 3, high: 2 },
      { low: 2, high: 1 },
      { low: 1, high: 0 },
      { low: 6, high: 6 },
    ],
  };
  return {
    mockHand: hand,
    pickNoBrainerHandMock: vi.fn(() => hand),
  };
});

vi.mock('./noBrainerDataset', () => ({
  NO_BRAINER_COMBO_COUNT: 1284,
  loadNoBrainerDataset: vi.fn(async () => [mockHand]),
  pickNoBrainerHand: pickNoBrainerHandMock,
}));

vi.mock('./noBrainerLabProgress', () => ({
  getNoBrainerSolvedCount: vi.fn(() => 0),
  markNoBrainerHandSolved: vi.fn(() => false),
}));

vi.mock('../match/board', () => ({
  MatchLiveLayout: ({
    handFooter,
    hudCenter,
  }: {
    handFooter?: React.ReactNode;
    hudCenter?: React.ReactNode;
  }) => (
    <div>
      <div data-testid="hud-center">{hudCenter}</div>
      <div data-testid="hand-footer">{handFooter}</div>
    </div>
  ),
}));

vi.mock('../components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components')>();
  return {
    ...actual,
    Board: () => <div data-testid="practice-board" />,
  };
});

import NoBrainerLabScreen from './NoBrainerLabScreen';

describe('NoBrainerLabScreen intro gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the intro modal before the training hand is available', async () => {
    render(<NoBrainerLabScreen onBack={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: "What's a no-brainer?" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hint/i })).not.toBeInTheDocument();
  });

  it('starts the hand after Start training is clicked', async () => {
    render(<NoBrainerLabScreen onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Start training/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "What's a no-brainer?" })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hint/i })).toBeInTheDocument();
    });
    expect(pickNoBrainerHandMock).toHaveBeenCalled();
    expect(screen.getByText(/Clear all 7 tiles in one turn/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show Solution/i })).toBeInTheDocument();
  });

  it('starts the hand when the modal is dismissed with Escape', async () => {
    render(<NoBrainerLabScreen onBack={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Hint/i })).toBeInTheDocument();
    });
  });
});
