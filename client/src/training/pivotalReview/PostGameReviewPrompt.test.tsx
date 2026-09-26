// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer.ts';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
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
    expect(accuracyStat).toHaveTextContent('Analyzing game…');
    expect(gradeStat).toHaveTextContent('—');
    expect(screen.queryByText('77.3%')).not.toBeInTheDocument();
  });

  it('pending with ledger: shows Analyzing N / M decisions progress', () => {
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis()}
        accuracyModelPending
        decisionLedger={{
          scoredCount: 30,
          estimateCount: 0,
          forcedCount: 4,
          unavailableCount: 0,
          pendingCount: 3,
          totalDecisions: 37,
          entries: [],
        }}
      />,
    );
    expect(screen.getByText('Analyzing 30 / 33 decisions')).toBeInTheDocument();
  });

  it('accuracyModel missing: never publishes legacy accuracy without completed analysis', () => {
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis()}
        accuracyModelPending={false}
      />,
    );
    expect(screen.getByText('Analyzing game…')).toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.is-accent' })).toBeInTheDocument();
  });

  it('partial coverage never publishes accuracy or Fritz as an authority', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'partial',
      accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
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
        decisionLedger={{ scoredCount: 27, estimateCount: 20, forcedCount: 0, unavailableCount: 0, pendingCount: 0, totalDecisions: 47, entries: [] }}
      />,
    );
    expect(screen.getByText('Analyzing game…')).toBeInTheDocument();
    expect(screen.getByText('Analyzing 27 / 47 decisions')).toBeInTheDocument();
  });

  it('partial with scored subset hides accuracy and suppresses letter grade', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'partial',
      accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
      accuracy: 88.1,
      grade: null,
      heuristicMoveCount: 5,
      totalNonForcedMoveCount: 40,
      coverageFraction: 35 / 40,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
        decisionLedger={{ scoredCount: 35, estimateCount: 5, forcedCount: 0, unavailableCount: 0, pendingCount: 0, totalDecisions: 40, entries: [] }}
      />,
    );
    expect(screen.getByText('Analyzing game…')).toBeInTheDocument();
    expect(screen.getByText('Analyzing 35 / 40 decisions')).toBeInTheDocument();
    expect(screen.queryByText('A', { selector: '.is-accent' })).not.toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.is-accent' })).toBeInTheDocument();
  });

  it('status complete: shows unqualified accuracy + letter grade', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'complete',
      accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
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
        decisionLedger={{ scoredCount: 30, estimateCount: 0, forcedCount: 0, unavailableCount: 0, pendingCount: 0, totalDecisions: 30, entries: [] }}
      />,
    );
    expect(screen.getByText('95.0%')).toBeInTheDocument();
    expect(screen.getByText('S', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText(/Scored accuracy/)).not.toBeInTheDocument();
  });

  it('unavailable non-forced via ledger cannot publish scored accuracy', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'complete',
      accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
      accuracy: 90,
      grade: 'A',
      heuristicMoveCount: 0,
      unavailableMoveCount: 1,
      totalNonForcedMoveCount: 10,
      coverageFraction: 1,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
        decisionLedger={{
          scoredCount: 8,
          estimateCount: 0,
          forcedCount: 2,
          unavailableCount: 1,
          pendingCount: 0,
          totalDecisions: 11,
          entries: [],
        }}
      />,
    );
    expect(screen.getByText('Analyzing game…')).toBeInTheDocument();
    expect(screen.getByText('Analyzing 8 / 9 decisions')).toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText('A', { selector: '.is-accent' })).not.toBeInTheDocument();
  });

  it('production failure shape 20 scored / 3 forced / 33 unavailable stays analyzing, never 92.5%', () => {
    const accuracyModel: GameAccuracyModelResult = {
      status: 'partial',
      accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
      accuracy: 92.5,
      grade: null,
      heuristicMoveCount: 20,
      unavailableMoveCount: 33,
      totalNonForcedMoveCount: 53,
      coverageFraction: 20 / 53,
    };
    render(
      <PostGameReviewPrompt
        {...requiredProps}
        analysis={baseAnalysis({ accuracyModel })}
        accuracyModelPending={false}
        decisionLedger={{
          scoredCount: 20,
          estimateCount: 0,
          forcedCount: 3,
          unavailableCount: 33,
          pendingCount: 0,
          totalDecisions: 56,
          entries: [],
        }}
      />,
    );
    expect(screen.getByText('Analyzing game…')).toBeInTheDocument();
    expect(screen.getByText('Analyzing 20 / 53 decisions')).toBeInTheDocument();
    expect(screen.queryByText('92.5%')).not.toBeInTheDocument();
  });
});
