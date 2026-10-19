import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../supabaseUtils', () => ({ supabaseFetch: supabaseFetchMock }));

import { recordUserMatch, validateRecordUserMatchInput } from './recordUserMatch';

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

describe('recordUserMatch — SA-2 (HARDENING_PLAN.md §11.3)', () => {
  beforeEach(() => {
    supabaseFetchMock.mockReset();
  });

  it('rejects a registered-vs-registered online claim with no matching authoritative recordPublicOnlineMatch row', async () => {
    // No authoritative row found for this room_code/participant combination —
    // this is the exact shape of the forgery reproduced live before this fix.
    supabaseFetchMock.mockResolvedValueOnce([]);

    const result = await recordUserMatch({
      authenticatedUserId: AUTH_USER,
      mode: 'online',
      opponentType: 'online',
      winnerUserId: AUTH_USER,
      loserUserId: OTHER_USER,
      winnerScore: 60,
      loserScore: 0,
      moveCount: null,
      roomCode: 'FORGED1',
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('authoritative'), status: 409 });
    // Only the authoritative-check read happened — no insert into matches.
    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
    const [checkPath] = supabaseFetchMock.mock.calls[0]!;
    expect(String(checkPath)).toContain('metadata->>roomMatchId=not.is.null');
  });

  it('accepts a registered-vs-registered online claim once a matching authoritative row exists', async () => {
    supabaseFetchMock
      .mockResolvedValueOnce([{ id: 'authoritative-row-1' }]) // authoritative check
      .mockResolvedValueOnce(undefined); // the actual insert

    const result = await recordUserMatch({
      authenticatedUserId: AUTH_USER,
      mode: 'online',
      opponentType: 'online',
      winnerUserId: AUTH_USER,
      loserUserId: OTHER_USER,
      winnerScore: 60,
      loserScore: 30,
      moveCount: null,
      roomCode: 'REAL0001',
    });

    expect(result).toEqual({ ok: true });
    expect(supabaseFetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a registered-vs-registered online claim with no room_code — nothing to match against', async () => {
    const result = await recordUserMatch({
      authenticatedUserId: AUTH_USER,
      mode: 'online',
      opponentType: 'online',
      winnerUserId: AUTH_USER,
      loserUserId: OTHER_USER,
      winnerScore: 60,
      loserScore: 0,
      moveCount: null,
      roomCode: null,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('room_code'), status: 400 });
    expect(supabaseFetchMock).not.toHaveBeenCalled();
  });

  it('still accepts a legitimate guest-opponent self-report with no authoritative-row check at all', async () => {
    // Guest matches never get a recordPublicOnlineMatch row (it requires both
    // a.userId and b.userId), so this path must not require one — only the
    // pre-existing idempotency check (same-room-and-sockets replay guard)
    // and the insert itself should run.
    supabaseFetchMock
      .mockResolvedValueOnce([]) // hasExistingGuestMatch — not a replay
      .mockResolvedValueOnce(undefined); // the insert

    const result = await recordUserMatch({
      authenticatedUserId: AUTH_USER,
      mode: 'online',
      opponentType: 'guest',
      winnerUserId: AUTH_USER,
      loserUserId: null,
      winnerScore: 66,
      loserScore: 19,
      moveCount: null,
      roomCode: 'ABC123',
      metadata: { winnerSocketId: 'p1', loserSocketId: 'p2' },
    });

    expect(result.ok).toBe(true);
    // No authoritative-match lookup ran — every call is either the existing
    // idempotency check or the insert, never the new metadata->>roomMatchId query.
    for (const [path] of supabaseFetchMock.mock.calls) {
      expect(String(path)).not.toContain('roomMatchId');
    }
    const insertCall = supabaseFetchMock.mock.calls.find(([path]) => String(path) === '/rest/v1/matches');
    expect(insertCall).toBeTruthy();
  });
});

describe('recordUserMatch — avgMoveQuality is not a client-assertable field', () => {
  beforeEach(() => {
    supabaseFetchMock.mockReset();
  });

  // A match's move quality now comes only from the server's own review-completion job (see authoritativeMoveQuality). The old
  // record-match body carried a browser-computed number straight into the row: anything in (0, 100] was accepted.
  const CLAIMS: unknown[] = [99.9, 100, 1, 0, -5, 1000, 'abc', Number.NaN, { evil: true }, [1, 2], true];

  it.each(CLAIMS.map((claim) => [JSON.stringify(claim) ?? String(claim), claim]))(
    'a client claim of %s neither fails validation nor reaches the validated payload',
    (_label, claim) => {
      const input = { ...baseInput(), avgMoveQuality: claim } as Parameters<typeof validateRecordUserMatchInput>[0];
      const result = validateRecordUserMatchInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.payload)).not.toContain('avg_move_quality');
        expect(JSON.stringify(result.payload)).not.toContain('avg_move_quality');
      }
    },
  );

  it('the row inserted into matches never carries a quality column, whatever the caller sent', async () => {
    supabaseFetchMock
      .mockResolvedValueOnce([]) // not a replay
      .mockResolvedValueOnce(undefined); // the insert
    const result = await recordUserMatch({ ...baseInput(), avgMoveQuality: 100 } as Parameters<typeof recordUserMatch>[0]);
    expect(result.ok).toBe(true);
    const insertCall = supabaseFetchMock.mock.calls.find(([path]) => String(path) === '/rest/v1/matches');
    expect(insertCall).toBeTruthy();
    const body = JSON.parse(String((insertCall![1] as { body: string }).body)) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('avg_move_quality');
    expect(Object.keys(body).sort()).toEqual([
      'loser_score', 'loser_user_id', 'metadata', 'mode', 'move_count', 'room_code', 'winner_score', 'winner_user_id',
    ]);
  });
});
