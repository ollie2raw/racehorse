import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertQaDailyFritzResetEnv,
  resetDailyFritzQaAttempt,
  type QaDailyFritzResetDeps,
} from './qaReset';

const VALID_USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-06-03T10:00:00.000Z');

function makeDeps(overrides: Partial<QaDailyFritzResetDeps> = {}): QaDailyFritzResetDeps {
  return {
    env: {
      NODE_ENV: 'development',
      ENABLE_QA_DAILY_FRITZ_RESET: '1',
      QA_DAILY_FRITZ_USER_ID: VALID_USER_ID,
      SUPABASE_URL: 'http://127.0.0.1:54321',
    },
    now: NOW,
    log: vi.fn(),
    fetchAttempt: vi.fn(async () => null),
    deleteAttempt: vi.fn(async () => undefined),
    abandonVerifiedMatch: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('assertQaDailyFritzResetEnv', () => {
  it('rejects production', () => {
    expect(() =>
      assertQaDailyFritzResetEnv({
        NODE_ENV: 'production',
        ENABLE_QA_DAILY_FRITZ_RESET: '1',
        QA_DAILY_FRITZ_USER_ID: VALID_USER_ID,
        SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toThrow('qa_daily_fritz_reset_blocked_in_production');
  });

  it('requires ENABLE_QA_DAILY_FRITZ_RESET', () => {
    expect(() =>
      assertQaDailyFritzResetEnv({
        NODE_ENV: 'development',
        QA_DAILY_FRITZ_USER_ID: VALID_USER_ID,
        SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toThrow('qa_daily_fritz_reset_requires_ENABLE_QA_DAILY_FRITZ_RESET');
  });

  it('requires QA user id', () => {
    expect(() =>
      assertQaDailyFritzResetEnv({
        NODE_ENV: 'development',
        ENABLE_QA_DAILY_FRITZ_RESET: '1',
        SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toThrow('qa_daily_fritz_reset_requires_QA_DAILY_FRITZ_USER_ID');
  });
});

describe('resetDailyFritzQaAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('noops when no attempt exists', async () => {
    const deps = makeDeps();
    const result = await resetDailyFritzQaAttempt(undefined, deps);
    expect(result.deleted).toBe(false);
    expect(deps.deleteAttempt).not.toHaveBeenCalled();
  });

  it('deletes attempt and abandons verified match', async () => {
    const deps = makeDeps({
      fetchAttempt: vi.fn(async () => ({
        id: 'attempt-1',
        run_date: '2026-06-03',
        user_id: VALID_USER_ID,
        status: 'abandoned',
        verified_match_id: 'match-1',
      })),
    });
    const result = await resetDailyFritzQaAttempt({ runDate: '2026-06-03' }, deps);
    expect(result.deleted).toBe(true);
    expect(result.previousStatus).toBe('abandoned');
    expect(deps.deleteAttempt).toHaveBeenCalledWith('attempt-1');
    expect(deps.abandonVerifiedMatch).toHaveBeenCalledWith('match-1', 'qa_reset');
  });

  it('rejects authenticated user mismatch', async () => {
    const deps = makeDeps();
    await expect(
      resetDailyFritzQaAttempt({ authenticatedUserId: '22222222-2222-4222-8222-222222222222' }, deps),
    ).rejects.toThrow('qa_daily_fritz_reset_forbidden_user');
  });
});
