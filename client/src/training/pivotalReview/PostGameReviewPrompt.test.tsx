// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer.ts';
import type { GameAccuracyModelResult } from '../../analyzer/gameAccuracyModel.ts';
import { PostGameReviewPrompt } from './PostGameReviewPrompt.tsx';

function baseAnalysis(overrides: Partial<GameAnalysis> = {}): GameAnalysis {
  return {
    accuracy: 77.3,
    grade: 'B',
    analyzedAt: 0,
    analyzedMoves: [],
    timeline: [],
    hands: [],
    oracleMode: 'tier',
    tierPlayed: 'standard',
    oracleLabel: 'Fritz',
    worstHandNumber: null,
    consequenceByMoveNumber: {},
    ...overrides,
  };
}

const requiredProps = {
  open: true,
  modeLabel: 'Play vs Fritz',
  resultLabel: 'Victory',
  won: true,
  youScore: 60,
  opponentScore: 40,
  opponentLabel: 'Fritz',
  onReviewGame: vi.fn(),
  onSkip: vi.fn(),
};

describe('PostGameReviewPrompt — accuracy/grade three-state rendering (C4 UI follow-up)', () => {
  it('pending: shows a loading state for both stats, never the legacy numbers as a placeholder', () => {
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis()}
        accuracyModelPending
      />,
    );
    const accuracyStat = screen.getByText('Accuracy').closest('.dfd__stat');
    const gradeStat = screen.getByText('Grade').closest('.dfd__stat');
    expect(accuracyStat).toHaveTextContent('…');
    expect(gradeStat).toHaveTextContent('…');
    expect(screen.queryByText('77.3%')).not.toBeInTheDocument();
    expect(screen.queryByText('B', { selector: '.is-accent' })).not.toBeInTheDocument();
    expect(screen.queryByText(/moves analyzed/i)).not.toBeInTheDocument();
  });

  it('accuracyModel undefined: renders the legacy accuracy/grade exactly as before, no coverage copy', () => {
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis()}
        accuracyModelPending={false}
      />,
    );
    expect(screen.getByText('77.3%')).toBeInTheDocument();
    expect(screen.getByText('B', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText(/moves analyzed/i)).not.toBeInTheDocument();
  });

  it('accuracyModel.accuracy === null: shows Partial / Fritz\'s read and the "N of M moves analyzed" copy -- never the legacy number standing in', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'partial',
      accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
      accuracy: null,
      grade: null,
      heuristicMoveCount: 20,
      totalNonForcedMoveCount: 47,
      coverageFraction: 27 / 47,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
      />,
    );
    expect(screen.queryByText('77.3%')).not.toBeInTheDocument();
    expect(screen.queryByText('B', { selector: '.is-accent' })).not.toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText("Fritz's read")).toBeInTheDocument();
    expect(screen.getByText('27 of 47 moves analyzed')).toBeInTheDocument();
  });

  it('accuracyModel.accuracy populated: renders the new accuracy/grade in place of the legacy ones, plus the coverage copy', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'partial',
      accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
      accuracy: 88.1,
      grade: 'A',
      heuristicMoveCount: 5,
      totalNonForcedMoveCount: 40,
      coverageFraction: 35 / 40,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
      />,
    );
    // The new numbers replace the legacy ones (77.3% / B) in the same slot.
    expect(screen.queryByText('77.3%')).not.toBeInTheDocument();
    expect(screen.getByText('88.1%')).toBeInTheDocument();
    expect(screen.getByText('A', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.getByText('35 of 40 moves analyzed')).toBeInTheDocument();
  });

  it('status:"complete" with accuracyModel populated still shows the new numbers, not "Partial"', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'complete',
      accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
      accuracy: 95,
      grade: 'S',
      heuristicMoveCount: 0,
      totalNonForcedMoveCount: 30,
      coverageFraction: 1,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
      />,
    );
    expect(screen.getByText('95.0%')).toBeInTheDocument();
    expect(screen.getByText('S', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText('Partial')).not.toBeInTheDocument();
    expect(screen.getByText('30 of 30 moves analyzed')).toBeInTheDocument();
  });
});
