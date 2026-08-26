/**
 * Soft-flag policy for unverified Daily Fritz runs.
 *
 * PR #58 removed the hard gates that trapped a player mid-set when a hand
 * failed verification. That was right: play, saving and completion must never
 * depend on a verifier receipt. But it also made verification_status purely
 * decorative — an attempt that advanced without a receipt still ranked.
 *
 * The policy here is the middle ground: an unverified run is fully saved,
 * completable and visible to its own player, and is excluded ONLY from the
 * public ranked leaderboard.
 *
 * Note on vocabulary: the DB has no 'unverified' status. A protocol-v2 run that
 * advanced a hand without a receipt is 'rejected' (written by
 * writeUnverifiedDailyFritzHand); a run finalized with no transcript authority
 * at all is 'legacy_unverified'. Both are "unverified" for ranking purposes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../config', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePoolerUrl: null,
    supabaseServiceKey: 'test-key',
  },
}));

vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setContext: vi.fn() })),
  captureException: vi.fn(),
}));

import {
  buildDailyFritzLeaderboard,
  invalidateDailyFritzLeaderboard,
  isDailyFritzAttemptLeaderboardEligible,
} from '../stores/dailyFritzStore';
import { resetCircuitBreaker } from '../../supabaseUtils';

const RUN_DATE = '2026-08-24';

/** A completed protocol-v2 set with every field the leaderboard projection needs. */
function attemptRow(input: {
  id: string;
  userId: string;
  verificationStatus: string;
  pointDiff: number;
}) {
  return {
    id: input.id,
    run_date: RUN_DATE,
    user_id: input.userId,
    status: 'completed',
    current_hand_index: 6,
    current_game_number: 1,
    revision: 4,
    challenge_id: 'challenge-1',
    challenge_contract_version: 1,
    generation_version: 1,
    game_rules_version: 1,
    transcript_protocol_version: 2,
    fritz_policy_version: 1,
    ranking_version: 1,
    authority_schema_version: 1,
    started_at: `${RUN_DATE}T00:00:00.000Z`,
    completed_at: `${RUN_DATE}T00:20:00.000Z`,
    verified_match_id: `match-${input.id}`,
    completion_hash: 'hash',
    result: {
      verification_status: input.verificationStatus,
      verification_protocol_version: 2,
    },
    final_score: 60,
    opponent_score: 60 - input.pointDiff,
    point_diff: input.pointDiff,
    won: true,
    moves_used: 31,
    hands_played: 6,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetCircuitBreaker();
  mockFetch.mockReset();
  invalidateDailyFritzLeaderboard(RUN_DATE);
});

afterEach(() => {
  resetCircuitBreaker();
  invalidateDailyFritzLeaderboard(RUN_DATE);
});

describe('isDailyFritzAttemptLeaderboardEligible — unverified runs are unranked', () => {
  it('excludes a completed protocol-v2 run whose hand advanced without a receipt', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'rejected', verification_protocol_version: 2 },
    })).toBe(false);
  });

  it('excludes a completed protocol-v2 run finalized with no transcript authority', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'legacy_unverified', verification_protocol_version: 2 },
    })).toBe(false);
  });

  it('still admits a completed, server-verified run on either protocol', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 1 },
    })).toBe(true);
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 2 },
    })).toBe(true);
  });

  /**
   * Observed in production 2026-08-21 (user 291bdfc3): an attempt carrying four
   * unverified_hands entries whose verification_status had drifted back to
   * 'in_progress' rather than staying 'rejected'. Whatever writes that drift,
   * the ledger itself is the durable fact, so eligibility must consult it and
   * not trust the status field alone.
   */
  it('excludes a run whose unverified_hands ledger is non-empty even if the status drifted', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: {
        verification_status: 'verified',
        verification_protocol_version: 2,
        unverified_hands: [
          { game_number: 1, hand_index: 1, verifier_code: 'fritz_state_mismatch' },
        ],
      },
    })).toBe(false);
  });

  it('admits a verified run carrying an empty ledger', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: {
        verification_status: 'verified',
        verification_protocol_version: 2,
        unverified_hands: [],
      },
    })).toBe(true);
  });

  it('still excludes an unfinished run and an unpinned protocol', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'started',
      result: { verification_status: 'verified', verification_protocol_version: 2 },
    })).toBe(false);
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified', verification_protocol_version: 0 },
    })).toBe(false);
  });
});

describe('buildDailyFritzLeaderboard — the public ranked query', () => {
  it('renders the verified run and omits the unverified ones', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/rest/v1/daily_fritz_attempts')) {
        return jsonResponse([
          // Biggest point diff, so it would rank first if it were eligible.
          attemptRow({ id: 'a-rejected', userId: 'user-rejected', verificationStatus: 'rejected', pointDiff: 55 }),
          attemptRow({ id: 'a-legacy', userId: 'user-legacy', verificationStatus: 'legacy_unverified', pointDiff: 50 }),
          attemptRow({ id: 'a-verified', userId: 'user-verified', verificationStatus: 'verified', pointDiff: 20 }),
        ]);
      }
      if (String(url).includes('/rest/v1/profiles')) {
        return jsonResponse([
          { id: 'user-rejected', username: 'Rejected Player' },
          { id: 'user-legacy', username: 'Legacy Player' },
          { id: 'user-verified', username: 'Verified Player' },
        ]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const leaderboard = await buildDailyFritzLeaderboard(RUN_DATE);

    expect(leaderboard.map((entry) => entry.userId)).toEqual(['user-verified']);
    expect(leaderboard[0]?.rank).toBe(1);
  });
});
