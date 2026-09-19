// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PivotalTurnReviewCard } from './PivotalTurnReviewCard';
import { selectPivotalTurns } from './pivotalTurnSelector';
import { matchFixture } from './pivotalReviewTestFixtures';

vi.mock('../../components', () => ({ Board: () => null, DominoTile: () => null }));

describe('pivotal reflection UI', () => {
  it('shows oracle actions, calibrated loss rating, expected loss and immediate difference despite conflicting legacy values', () => {
    const fixture = matchFixture([100]);
    fixture.analysis.analyzedMoves[0].rating = 'Brilliant';
    render(<PivotalTurnReviewCard open selection={selectPivotalTurns(fixture.moveLog, fixture)} onComplete={vi.fn()} />);
    expect(screen.getByText('[0|1] left')).toBeInTheDocument();
    expect(screen.getByText('[5|6] right')).toBeInTheDocument();
    expect(screen.getByText('Blunder')).toBeInTheDocument();
    expect(screen.getByText('100 pts')).toBeInTheDocument();
    expect(screen.getByText('+3 immediate pts')).toBeInTheDocument();
    expect(screen.queryByText('[6|6] left')).not.toBeInTheDocument();
    expect(screen.queryByText('Brilliant')).not.toBeInTheDocument();
  });

  it('keeps a negative immediate difference distinct from positive expected loss and handles draw/pass actions', () => {
    const fixture = matchFixture([10]);
    const original = fixture.evaluationsByDecisionId.get('decision-1')!;
    fixture.evaluationsByDecisionId.set('decision-1', {
      ...original,
      played: { ...original.played, action: { kind: 'pass' }, immediatePoints: 5 },
      best: { ...original.best, action: { kind: 'draw' }, immediatePoints: 0 },
    });
    render(<PivotalTurnReviewCard open selection={selectPivotalTurns(fixture.moveLog, fixture)} onComplete={vi.fn()} />);
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Draw')).toBeInTheDocument();
    expect(screen.getByText('-5 immediate pts')).toBeInTheDocument();
    expect(screen.getByText('10 pts')).toBeInTheDocument();
  });

  it('renders nothing when the completed batch has no eligible moments', () => {
    const fixture = matchFixture([]);
    render(<PivotalTurnReviewCard open selection={selectPivotalTurns(fixture.moveLog, fixture)} onComplete={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes the taxonomy and preserves the optional 120-character free-text note', () => {
    const fixture = matchFixture([10]);
    const onComplete = vi.fn();
    render(<PivotalTurnReviewCard open selection={selectPivotalTurns(fixture.moveLog, fixture)} onComplete={onComplete} />);
    expect(screen.queryByRole('group', { name: 'Miss reasons' })).not.toBeInTheDocument();
    expect(screen.queryByText('Why did you miss this?')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick up to/)).not.toBeInTheDocument();
    const note = screen.getByRole('textbox', { name: 'Optional note' });
    expect(note).toHaveAttribute('maxlength', '120');
    fireEvent.change(note, { target: { value: 'Consider the right branch.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish Review' }));
    expect(onComplete).toHaveBeenCalledWith([expect.objectContaining({ moveNumber: 1, note: 'Consider the right branch.' })]);
  });
});
