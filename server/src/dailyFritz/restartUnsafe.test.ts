import { describe, expect, it, vi } from 'vitest';
import { restartDailyFritzUnsafeAttempt, type RestartDailyFritzUnsafeDeps } from './restartUnsafe';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function makeDeps(overrides?: Partial<RestartDailyFritzUnsafeDeps>) {
  const fetchAttempt = vi.fn(async () => ({
    id: ATTEMPT_ID,
    run_date: '2026-06-08',
    user_id: USER_ID,
    status: 'started',
    verified_match_id: 'match-1',
  }));
  const deleteAttempt = vi.fn(async () => undefined);
  const abandonVerifiedMatch = vi.fn(async () => undefined);
  return {
    now: new Date('2026-06-08T12:00:00Z'),
    getPacificDateKey: () => '2026-06-08',
    fetchAttempt,
    deleteAttempt,
    abandonVerifiedMatch,
    ...overrides,
  } satisfies RestartDailyFritzUnsafeDeps;
}

describe('restartDailyFritzUnsafeAttempt', () => {
  it('deletes a started attempt and abandons the verified match', async () => {
    const deps = makeDeps();
    const result = await restartDailyFritzUnsafeAttempt(
      { attemptId: ATTEMPT_ID, authenticatedUserId: USER_ID },
      deps,
    );

    expect(result).toEqual({ ok: true, attemptId: ATTEMPT_ID, runDate: '2026-06-08' });
    expect(deps.deleteAttempt).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(deps.abandonVerifiedMatch).toHaveBeenCalledWith('match-1');
  });

  it('rejects locked attempts', async () => {
    const deps = makeDeps({
      fetchAttempt: vi.fn(async () => ({
        id: ATTEMPT_ID,
        run_date: '2026-06-08',
        user_id: USER_ID,
        status: 'abandoned',
        verified_match_id: null,
      })),
    });

    await expect(
      restartDailyFritzUnsafeAttempt(
        { attemptId: ATTEMPT_ID, authenticatedUserId: USER_ID },
        deps,
      ),
    ).rejects.toThrow('daily_fritz_restart_attempt_locked:abandoned');
    expect(deps.deleteAttempt).not.toHaveBeenCalled();
  });

  it('rejects mismatched attempt ids', async () => {
    const deps = makeDeps();
    await expect(
      restartDailyFritzUnsafeAttempt(
        { attemptId: 'other-attempt', authenticatedUserId: USER_ID },
        deps,
      ),
    ).rejects.toThrow('daily_fritz_restart_attempt_not_found');
    expect(deps.deleteAttempt).not.toHaveBeenCalled();
  });
});
