// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BotMatchJourneyChip } from './BotMatchJourneyChip.tsx';

describe('BotMatchJourneyChip', () => {
  it('shows stage title, rival and target score', () => {
    render(<BotMatchJourneyChip context={{ stageTitle: 'Dot’s Table', rivalName: 'Dot', targetScore: 30, headStartLabel: null }} />);
    const chip = screen.getByRole('note');
    expect(chip.textContent).toContain('Dot’s Table');
    expect(chip.textContent).toContain('vs Dot');
    expect(chip.textContent).toContain('Race to 30');
    expect(screen.queryByText(/You start/)).toBeNull();
    expect(chip.getAttribute('aria-label')).toBe('Journey stage Dot’s Table, versus Dot, race to 30');
  });

  it('shows the configured head start explicitly', () => {
    render(<BotMatchJourneyChip context={{ stageTitle: 'Handicap Stakes', rivalName: 'Fritz', targetScore: 60, headStartLabel: 'You start +15' }} />);
    expect(screen.getByText('You start +15')).toBeTruthy();
    expect(screen.getByRole('note').getAttribute('aria-label')).toContain('You start +15');
  });
});
