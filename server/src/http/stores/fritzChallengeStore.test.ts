import { describe, expect, it, vi } from 'vitest';
import {
  createGeneratedFritzChallenge,
  FritzChallengeError,
  generateFritzChallengeHand,
} from '../../fritzChallenge';
import {
  claimFritzChallengeOpponent,
  getOrCreateFritzChallengeHand,
  startOrResumeFritzChallengeAttempt,
  toFritzChallengeRow,
  type FritzChallengeRow,
  type FritzChallengeStoreDeps,
} from './fritzChallengeStore';

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_A_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_B_ID = '33333333-3333-4333-8333-333333333333';

describe('Fritz Challenge store', () => {
  it('uses one atomic database claim so concurrent server processes cannot both win', async () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: CREATOR_ID,
      recipientUserId: PLAYER_A_ID,
      fritzTier: 'elite',
      dealSize: 7,
      id: '44444444-4444-4444-8444-444444444444',
      shareCode: 'ABCDEFGH',
      seed: 'fixed-seed',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    let persisted: FritzChallengeRow = toFritzChallengeRow(challenge);
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/rest/v1/rpc/claim_fritz_challenge_opponent') {
        await Promise.resolve();
        const body = JSON.parse(String(init?.body)) as { p_user_id: string };
        if (persisted.opponent_user_id && persisted.opponent_user_id !== body.p_user_id) {
          return [];
        }
        persisted = {
          ...persisted,
          opponent_user_id: body.p_user_id,
          status: 'active',
        };
        return [{
          challenge_id: persisted.id,
          opponent_user_id: body.p_user_id,
          challenge_status: 'active',
        }];
      }
      if (path.startsWith('/rest/v1/fritz_challenges?')) {
        return [persisted];
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as FritzChallengeStoreDeps['fetch'];
    const deps = { fetch };
    const now = new Date('2026-07-26T12:05:00.000Z');

    const outcomes = await Promise.allSettled([
      claimFritzChallengeOpponent({ challenge, userId: PLAYER_A_ID, now }, deps),
      claimFritzChallengeOpponent({ challenge, userId: PLAYER_B_ID, now }, deps),
    ]);

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(FritzChallengeError);
    expect((rejected?.reason as FritzChallengeError).code).toBe('opponent_already_claimed');
    expect([PLAYER_A_ID, PLAYER_B_ID]).toContain(persisted.opponent_user_id);
    expect(fetch).toHaveBeenCalledWith(
      '/rest/v1/rpc/claim_fritz_challenge_opponent',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('starts the same durable attempt across concurrent process-like requests', async () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: CREATOR_ID,
      fritzTier: 'elite',
      dealSize: 7,
      id: '44444444-4444-4444-8444-444444444444',
      shareCode: 'ABCDEFGH',
      seed: 'fixed-seed',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    const persistedAttempt = {
      attempt_id: '55555555-5555-4555-8555-555555555555',
      challenge_id: challenge.id,
      user_id: CREATOR_ID,
      attempt_status: 'started' as const,
      current_game_number: 1 as const,
      current_hand_index: 0,
      attempt_result: null,
      final_score: null,
      opponent_score: null,
      point_diff: null,
      won: null,
      moves_used: null,
      hands_played: null,
      started_at: '2026-07-26T12:00:00.000Z',
      updated_at: '2026-07-26T12:00:00.000Z',
      completed_at: null,
      revision: 0,
    };
    const fetch = vi.fn(async (path: string) => {
      if (path === '/rest/v1/rpc/start_fritz_challenge_attempt') {
        await Promise.resolve();
        return [persistedAttempt];
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as FritzChallengeStoreDeps['fetch'];

    const [first, second] = await Promise.all([
      startOrResumeFritzChallengeAttempt({ challenge, userId: CREATOR_ID, now: new Date('2026-07-26T12:00:00.000Z') }, { fetch }),
      startOrResumeFritzChallengeAttempt({ challenge, userId: CREATOR_ID, now: new Date('2026-07-26T12:00:00.000Z') }, { fetch }),
    ]);

    expect(first.id).toBe(persistedAttempt.attempt_id);
    expect(second.id).toBe(persistedAttempt.attempt_id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses a persisted hand that differs from deterministic authority', async () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: CREATOR_ID,
      fritzTier: 'elite',
      dealSize: 7,
      id: '44444444-4444-4444-8444-444444444444',
      shareCode: 'ABCDEFGH',
      seed: 'fixed-seed',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    const fetch = vi.fn(async () => [{
      challenge_id: challenge.id,
      game_number: 1,
      hand_index: 0,
      deal: {
        player_tiles: [{ low: 6, high: 6 }],
        fritz_tiles: [{ low: 5, high: 5 }],
        boneyard: [],
        locked: [],
      },
      generated_at: '2026-07-26T12:00:00.000Z',
    }]) as FritzChallengeStoreDeps['fetch'];

    await expect(getOrCreateFritzChallengeHand(
      { challenge, gameNumber: 1, handIndex: 0 },
      { fetch },
    )).rejects.toMatchObject({ code: 'hand_integrity_failed' });
  });

  it('accepts deterministic hands when JSONB reorders object keys', async () => {
    const challenge = createGeneratedFritzChallenge({
      creatorUserId: CREATOR_ID,
      fritzTier: 'elite',
      dealSize: 7,
      id: '55555555-5555-4555-8555-555555555555',
      shareCode: 'HJKLMNPQ',
      seed: 'fixed-seed',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });
    const expected = generateFritzChallengeHand(challenge.seed, 1, 0, challenge.config.dealSize);
    const reorderedDeal = {
      locked: expected.locked,
      boneyard: expected.boneyard,
      fritz_tiles: expected.fritz_tiles,
      player_tiles: expected.player_tiles,
    };
    const fetch = vi.fn(async () => [{
      challenge_id: challenge.id,
      game_number: 1,
      hand_index: 0,
      deal: reorderedDeal,
      generated_at: '2026-07-26T12:00:00.000Z',
    }]) as FritzChallengeStoreDeps['fetch'];

    await expect(getOrCreateFritzChallengeHand(
      { challenge, gameNumber: 1, handIndex: 0 },
      { fetch },
    )).resolves.toEqual(reorderedDeal);
  });
});
