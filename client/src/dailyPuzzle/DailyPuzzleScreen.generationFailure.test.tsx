import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DailyPuzzleTodayResponse } from './types';

const getTodayDailyPuzzleLadderMock = vi.fn();

vi.mock('./api', () => ({
  getTodayDailyPuzzleLadder: (...args: unknown[]) => getTodayDailyPuzzleLadderMock(...args),
  getDailyPuzzleByDateSeed: vi.fn(),
  getDailyPuzzleForDate: vi.fn(),
  getLocalDateKey: () => '2026-05-17',
  fetchDailyPuzzleLeaderboard: vi.fn().mockResolvedValue([]),
}));

vi.mock('./useDailyPuzzleValidatorWorker', () => ({
  useDailyPuzzleValidatorWorker: () => ({
    requestValidation: vi.fn(),
    requestValidationFromWorker: vi.fn(),
    requestBestScoreFromWorker: vi.fn(),
  }),
}));

vi.mock('canvas-confetti', () => ({
  default: { create: () => () => {} },
}));

import DailyPuzzleScreen from './DailyPuzzleScreen';

// Named gap from the prior audit: what does the client do when today's
// three-puzzle ladder generation has failed or is incomplete server-side?
// Traced (this pass): DailyPuzzleScreen.tsx's boot effect (~line 156) calls
// getTodayDailyPuzzleLadder(); if the response reports fewer than
// DAILY_PUZZLE_SLOT_COUNT published slots (exactly what an incomplete/failed
// generation run looks like from the client's perspective), entryMode is set
// to 'ladderPending' — a real, already-wired, honest error screen (~line
// 578), not a spinner with no exit. This test proves that state actually
// renders for real, rather than re-asserting the trace.
describe('DailyPuzzleScreen — generation-failure / incomplete-ladder honest state', () => {
  it('renders a specific "check back soon" message with a Refresh action, not an indefinite spinner, when fewer than 3 slots are published', async () => {
    const incompleteResponse: DailyPuzzleTodayResponse = {
      ok: true,
      runDate: '2026-05-17',
      setVersion: 1,
      slots: [], // generation failed/incomplete: zero (or any count < 5) published slots
      attemptStatus: 'none',
      attempt: null,
      nextAvailableSlotIndex: null,
      leaderboardPreview: [],
      legacySinglePuzzleDay: false,
    };
    getTodayDailyPuzzleLadderMock.mockResolvedValue(incompleteResponse);

    render(<DailyPuzzleScreen user={null} profile={null} onBack={() => {}} />);

    const heading = await screen.findByText(/being prepared/i);
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText(/couldn.t publish today.s full three-puzzle ladder yet/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeInTheDocument();

    // Not a vacuous pass: confirm the loading spinner's own copy ("Preparing
    // today's ladder") is gone — the state actually transitioned away from
    // loading into the specific failure state, not stuck mid-load.
    expect(screen.queryByText(/Preparing today.s ladder/i)).not.toBeInTheDocument();
  });
});
