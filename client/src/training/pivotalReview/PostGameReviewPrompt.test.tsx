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
    expect(accuracyStat).toHaveTextContent('Analyzing…');
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
    expect(screen.getByText('Analyzing 34 / 37 decisions')).toBeInTheDocument();
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
  });

  it('accuracyModel.accuracy === null: shows Partial / Fritz\'s read and explicit accounting', () => {
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
      />,
    );
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText("Fritz's read")).toBeInTheDocument();
    expect(screen.getByText('27 scored · 20 estimates · 47 non-forced')).toBeInTheDocument();
  });

  it('partial with scored accuracy: qualifies accuracy and suppresses letter grade', () => {
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
      />,
    );
    expect(screen.getByText('Scored accuracy: 88.1%')).toBeInTheDocument();
    expect(screen.queryByText('A', { selector: '.is-accent' })).not.toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.getByText('35 scored · 5 estimates · 40 non-forced')).toBeInTheDocument();
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
      />,
    );
    expect(screen.getByText('95.0%')).toBeInTheDocument();
    expect(screen.getByText('S', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText(/Scored accuracy/)).not.toBeInTheDocument();
  });

  it('unavailable non-forced via ledger: shows scored accuracy, suppresses letter grade', () => {
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
    expect(screen.getByText('Scored accuracy: 90.0%')).toBeInTheDocument();
    expect(screen.getByText('—', { selector: '.is-accent' })).toBeInTheDocument();
    expect(screen.queryByText('A', { selector: '.is-accent' })).not.toBeInTheDocument();
  });
});
