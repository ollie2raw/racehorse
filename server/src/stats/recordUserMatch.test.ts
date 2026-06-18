import { describe, expect, it } from 'vitest';
import { validateRecordUserMatchInput } from './recordUserMatch';

const AUTH_USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

function baseInput(
  overrides: Partial<Parameters<typeof validateRecordUserMatchInput>[0]> = {},
) {
  return {
    authenticatedUserId: AUTH_USER,
    mode: 'online' as const,
    opponentType: 'guest' as const,
    winnerUserId: AUTH_USER,
    loserUserId: null,
    winnerScore: 66,
    loserScore: 19,
    moveCount: null,
    roomCode: 'ABC123',
    metadata: { winnerSocketId: 'p1', loserSocketId: 'p2' },
    ...overrides,
  };
}

describe('validateRecordUserMatchInput', () => {
  it('accepts guest-online rows where the caller is the winner', () => {
    const result = validateRecordUserMatchInput(baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.winner_user_id).toBe(AUTH_USER);
      expect(result.payload.idempotency).toEqual({
        roomCode: 'ABC123',
        winnerSocketId: 'p1',
        loserSocketId: 'p2',
      });
    }
  });

  it('rejects forged rows where the caller is not a participant', () => {
    const result = validateRecordUserMatchInput(
      baseInput({
        winnerUserId: OTHER_USER,
        loserUserId: null,
      }),
    );
    expect(result).toEqual({ ok: false, error: 'Forbidden', status: 403 });
  });

  it('rejects non-uuid participant ids', () => {
    const result = validateRecordUserMatchInput(
      baseInput({
        winnerUserId: 'not-a-uuid',
      }),
    );
    expect(result).toEqual({ ok: false, error: 'Invalid winner_user_id.', status: 400 });
  });

  it('rejects out-of-range scores', () => {
    const result = validateRecordUserMatchInput(
      baseInput({
        winnerScore: 999,
      }),
    );
    expect(result).toEqual({ ok: false, error: 'Invalid winner_score.', status: 400 });
  });
});
