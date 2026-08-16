import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BotHandOverModal, type BotHandOverModalProps } from './BotHandOverModal';
import type { BotHandReveal } from '../modules/match/types/matchRuntimeTypes';

const handReveal: BotHandReveal = {
  winner: 'you',
  reason: 'domino',
  pointsAwarded: 1,
  loserPips: 5,
  calcText: '',
  yourRemainingTiles: [],
  botRemainingTiles: [],
};

function makeProps(overrides: Partial<BotHandOverModalProps> = {}): BotHandOverModalProps {
  return {
    handReveal,
    gameOver: false,
    handRevealProgress: 1,
    handAdvanceError: null,
    showManualHandAdvance: true,
    ghostResultError: null,
    isGuidedMode: false,
    isGuidedV2Mode: false,
    isDailyFritzMode: true,
    opponentLabel: 'Fritz',
    tileReveals: [],
    coach: {},
    autoAdvanceMs: 0,
    onAdvanceHand: vi.fn(),
    onRetryGhost: vi.fn(),
    onRetryHandAdvance: vi.fn(),
    handNumber: 1,
    ...overrides,
  };
}

// Re-verifies, post pillar-2's reloadRequiredRef removal AND this pillar's
// touches to the same failure-handling code, that a hand-over state with a
// valid server checkpoint never strands the player behind a destructive-only
// "Reload Hand" button. The specific regression this guards against: a
// future change re-introducing a discard-and-reload branch (or the
// isDailyFritzMode guard being dropped) without anyone noticing, since the
// underlying server data was never actually at risk in the traced code path
// — this is the UI-level backstop for that claim.
describe('BotHandOverModal — no stuck state on a hand-over with a valid checkpoint (Daily Fritz)', () => {
  it('renders "Continue" (non-destructive) when there is no error, and calls onRetryHandAdvance on click', () => {
    const props = makeProps({ handAdvanceError: null });
    render(<BotHandOverModal {...props} />);

    const button = screen.getByRole('button', { name: /^Continue$/i });
    expect(screen.queryByRole('button', { name: /Reload Hand/i })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onRetryHandAdvance).toHaveBeenCalledTimes(1);
  });

  it('renders "Retry" (non-destructive), never "Reload Hand", even when the error message itself says "Reload the hand" — the exact string that used to trigger the destructive branch', () => {
    const props = makeProps({
      isDailyFritzMode: true,
      handAdvanceError: 'Reload the hand to continue.',
    });
    render(<BotHandOverModal {...props} />);

    expect(screen.queryByRole('button', { name: /Reload Hand/i })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /^Retry$/i });
    fireEvent.click(button);
    expect(props.onRetryHandAdvance).toHaveBeenCalledTimes(1);
  });
});
