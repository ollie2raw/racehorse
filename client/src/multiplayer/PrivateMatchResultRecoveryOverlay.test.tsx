// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PrivateMatchResultRecoveryOverlay,
  RESULT_RECOVERY_COPY,
} from './PrivateMatchResultRecoveryOverlay';
import type { PrivateMatchResultPayload } from './terminalRoomArchiveRecovery';

function resultPayload(overrides: Partial<PrivateMatchResultPayload> = {}): PrivateMatchResultPayload {
  return {
    matchId: '11111111-1111-4111-8111-111111111111',
    roomCode: 'ROOM1',
    terminalStatus: 'completed',
    archivedAt: '2026-08-19T00:10:00.000Z',
    you: { seatId: 'seat-a', userId: 'a', username: 'Alice' },
    opponent: { seatId: 'seat-b', userId: 'b', username: 'Bob' },
    outcome: 'win',
    yourScore: 60,
    opponentScore: 42,
    ranking: {
      eligible: true,
      applied: true,
      skipReason: null,
      message: null,
      ratingBefore: 1500,
      ratingAfter: 1512,
      ratingDelta: 12,
    },
    ...overrides,
  };
}

describe('PrivateMatchResultRecoveryOverlay', () => {
  it('renders win badge, scoreline, rating delta, and Return home when ranking is applied', async () => {
    const onReturnHome = vi.fn();
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{ kind: 'result', result: resultPayload() }}
        onReturnHome={onReturnHome}
      />,
    );

    expect(screen.getByTestId('private-match-result-recovery')).toHaveAttribute('data-state', 'result');
    expect(screen.getByTestId('result-outcome-badge')).toHaveTextContent('Win');
    expect(screen.getByText('60 – 42')).toBeTruthy();
    expect(screen.getByText('vs Bob')).toBeTruthy();
    expect(screen.getByTestId('result-ranking-copy')).toHaveTextContent('+12');
    expect(screen.queryByText('Rating not updated for this match')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Return home' }));
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('uses ranking.message from the endpoint when ranking was not applied', () => {
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{
          kind: 'result',
          result: resultPayload({
            outcome: 'loss',
            ranking: {
              eligible: false,
              applied: false,
              skipReason: 'move_log_verification_failed',
              message: 'Rating not updated for this match',
              ratingBefore: null,
              ratingAfter: null,
              ratingDelta: null,
            },
          }),
        }}
        onReturnHome={() => undefined}
      />,
    );

    expect(screen.getByTestId('result-outcome-badge')).toHaveTextContent('Loss');
    expect(screen.getByTestId('result-ranking-copy')).toHaveTextContent(
      'Rating not updated for this match',
    );
  });

  it('renders 401 as a sign-in prompt', async () => {
    const onReturnHome = vi.fn();
    const onSignIn = vi.fn();
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{ kind: 'unauthorized', roomCode: 'ROOM1' }}
        onReturnHome={onReturnHome}
        onSignIn={onSignIn}
      />,
    );

    expect(screen.getByTestId('private-match-result-recovery')).toHaveAttribute('data-state', 'unauthorized');
    expect(screen.getByText(RESULT_RECOVERY_COPY.unauthorizedTitle)).toBeTruthy();
    expect(screen.getByText(RESULT_RECOVERY_COPY.unauthorizedDetail)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('renders 403 as a generic unavailable state', () => {
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{ kind: 'forbidden', roomCode: 'ROOM1' }}
        onReturnHome={() => undefined}
      />,
    );
    expect(screen.getByTestId('private-match-result-recovery')).toHaveAttribute('data-state', 'forbidden');
    expect(screen.getByText(RESULT_RECOVERY_COPY.forbiddenTitle)).toBeTruthy();
    expect(screen.getByText(RESULT_RECOVERY_COPY.forbiddenDetail)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return home' })).toBeTruthy();
  });

  it('renders 404 as match ended — result unavailable', () => {
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{ kind: 'absent', roomCode: 'ROOM1' }}
        onReturnHome={() => undefined}
      />,
    );
    expect(screen.getByTestId('private-match-result-recovery')).toHaveAttribute('data-state', 'absent');
    expect(screen.getByText(RESULT_RECOVERY_COPY.absentTitle)).toBeTruthy();
  });

  it('renders 503 as result syncing copy', () => {
    render(
      <PrivateMatchResultRecoveryOverlay
        recovered={{ kind: 'syncing', roomCode: 'ROOM1' }}
        onReturnHome={() => undefined}
      />,
    );
    expect(screen.getByTestId('private-match-result-recovery')).toHaveAttribute('data-state', 'syncing');
    expect(screen.getByText(RESULT_RECOVERY_COPY.syncingTitle)).toBeTruthy();
  });
});
