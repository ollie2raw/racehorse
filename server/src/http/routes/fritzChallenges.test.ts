import { describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  FritzChallengeError,
  createGeneratedFritzChallenge,
  type GeneratedFritzChallenge,
} from '../../fritzChallenge';
import {
  registerFritzChallengeRoutes,
  type FritzChallengeRoutesDeps,
} from './fritzChallenges';

type Method = 'GET' | 'POST';
type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_A_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_B_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-07-26T12:00:00.000Z');

function challengeFixture(): GeneratedFritzChallenge {
  return createGeneratedFritzChallenge({
    creatorUserId: CREATOR_ID,
    recipientUserId: PLAYER_A_ID,
    fritzTier: 'elite',
    dealSize: 7,
    id: '44444444-4444-4444-8444-444444444444',
    shareCode: 'ABCDEFGH',
    seed: 'private-authority-seed',
    now: NOW,
  });
}

function makeHarness(overrides: Partial<FritzChallengeRoutesDeps> = {}) {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
  };
  const challenge = { ...challengeFixture(), acceptedAt: NOW.toISOString() };
  const deps: FritzChallengeRoutesDeps = {
    getAuthenticatedUserId: async (req) => (
      typeof req.headers['x-test-user'] === 'string' ? req.headers['x-test-user'] : null
    ),
    createChallenge: vi.fn(async () => challenge),
    getChallengeByCode: vi.fn(async (code) => code === challenge.shareCode ? challenge : null),
    claimOpponent: vi.fn(async ({ userId }) => ({
      ...challenge,
      opponentUserId: userId,
      status: 'active',
    })),
    getOrCreateHand: vi.fn(async () => ({
      player_tiles: [{ low: 0, high: 0 }],
      fritz_tiles: [{ low: 1, high: 1 }],
      boneyard: [],
      locked: [],
    })),
    getAttempt: vi.fn(async ({ userId }) => ({
      id: '55555555-5555-4555-8555-555555555555',
      challengeId: challenge.id,
      userId,
      status: 'started' as const,
      currentGameNumber: 1 as const,
      currentHandIndex: 0,
      result: null,
      finalScore: null,
      opponentScore: null,
      pointDiff: null,
      won: null,
      movesUsed: null,
      handsPlayed: null,
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      completedAt: null,
      revision: 0,
    })),
    startCommand: vi.fn(async () => ({
      outcome: 'committed' as const,
      errorCode: null,
      replayed: false,
      committedRevision: 1,
      response: { attempt_id: '55555555-5555-4555-8555-555555555555' },
    })),
    commitCommand: vi.fn(async () => ({
      outcome: 'committed' as const,
      errorCode: null,
      replayed: false,
      committedRevision: 1,
      response: { attempt_id: '55555555-5555-4555-8555-555555555555' },
    })),
    now: () => NOW,
    ...overrides,
  };
  registerFritzChallengeRoutes(app as unknown as Application, deps);

  return {
    deps,
    challenge,
    async request(
      method: Method,
      path: string,
      input: {
        userId?: string;
        body?: unknown;
        params?: Record<string, string>;
      } = {},
    ) {
      const handler = routes.get(`${method} ${path}`);
      if (!handler) throw new Error(`Missing route ${method} ${path}`);
      let statusCode = 200;
      let body: unknown;
      const res = {
        status(code: number) {
          statusCode = code;
          return res;
        },
        json(payload: unknown) {
          body = payload;
          return res;
        },
      };
      await handler({
        headers: input.userId ? { 'x-test-user': input.userId } : {},
        body: input.body ?? {},
        params: input.params ?? {},
      }, res);
      return { status: statusCode, body };
    },
  };
}

describe('Fritz Challenge routes', () => {
  it('requires authentication and validates creation settings', async () => {
    const harness = makeHarness();
    const unauthenticated = await harness.request('POST', '/api/fritz-challenges', {
      body: { fritz_tier: 'elite', deal_size: 7 },
    });
    expect(unauthenticated.status).toBe(401);

    const invalid = await harness.request('POST', '/api/fritz-challenges', {
      userId: CREATOR_ID,
      body: { fritz_tier: 'impossible', deal_size: 9 },
    });
    expect(invalid.status).toBe(400);
    expect(harness.deps.createChallenge).not.toHaveBeenCalled();
  });

  it('returns a shareable challenge without exposing its authority seed', async () => {
    const harness = makeHarness();
    const response = await harness.request('POST', '/api/fritz-challenges', {
      userId: CREATOR_ID,
      body: { fritz_tier: 'elite', deal_size: 7, recipient_user_id: PLAYER_A_ID },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      share_path: '/fritz/challenge/ABCDEFGH',
      challenge: {
        share_code: 'ABCDEFGH',
        viewer_role: 'creator',
        format: 'best_of_3',
        winning_score: 60,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-authority-seed');
  });

  it('allows only one opponent to win a concurrent claim race', async () => {
    const challenge = challengeFixture();
    let claimedBy: string | null = null;
    const atomicClaim: FritzChallengeRoutesDeps['claimOpponent'] = vi.fn(
      async ({ userId }) => {
        await Promise.resolve();
        if (claimedBy && claimedBy !== userId) {
          throw new FritzChallengeError(
            'Another player has already joined this challenge.',
            'opponent_already_claimed',
          );
        }
        claimedBy = userId;
        return { ...challenge, opponentUserId: userId, status: 'active' };
      },
    );
    const harness = makeHarness({ claimOpponent: atomicClaim });

    const [first, second] = await Promise.all([
      harness.request('POST', '/api/fritz-challenges/:shareCode/join', {
        userId: PLAYER_A_ID,
        params: { shareCode: 'ABCDEFGH' },
      }),
      harness.request('POST', '/api/fritz-challenges/:shareCode/join', {
        userId: PLAYER_B_ID,
        params: { shareCode: 'ABCDEFGH' },
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([PLAYER_A_ID, PLAYER_B_ID]).toContain(claimedBy);
  });

  it('rejects the creator from claiming their own opponent slot', async () => {
    const harness = makeHarness({
      claimOpponent: vi.fn(async () => {
        throw new FritzChallengeError(
          'The challenge creator cannot claim the opponent slot.',
          'creator_cannot_join',
        );
      }),
    });
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/join',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
      },
    );
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'creator_cannot_join' });
  });

  it('starts or resumes an authoritative attempt without exposing the seed', async () => {
    const harness = makeHarness();
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/start',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
        body: {
          verification_protocol_version: 2,
          game_rules_version: harness.challenge.versions.rulesVersion,
          fritz_policy_version: harness.challenge.versions.fritzPolicyVersion,
          verifier_version: harness.challenge.versions.verifierVersion,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      current_game_number: 1,
      current_hand_index: 0,
      current_game_scores: { you: 0, fritz: 0 },
      attempt: {
        status: 'started',
        current_game_number: 1,
        current_hand_index: 0,
      },
      first_hand: {
        player_tiles: [{ low: 0, high: 0 }],
        fritz_tiles: [{ low: 1, high: 1 }],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-authority-seed');
    expect(harness.deps.startCommand).toHaveBeenCalledTimes(1);
    expect(harness.deps.getOrCreateHand).toHaveBeenCalledTimes(1);
  });

  it('returns the participant attempt summary with the challenge room', async () => {
    const harness = makeHarness({
      getAttempt: vi.fn(async ({ userId }) => ({
        id: '55555555-5555-4555-8555-555555555555',
        challengeId: harnessChallengeId(),
        userId,
        status: 'completed' as const,
        currentGameNumber: 2 as const,
        currentHandIndex: 4,
        result: {
          set_result: {
            setWinner: 'player',
            playerGamesWon: 2,
            fritzGamesWon: 0,
            games: [],
          },
        },
        finalScore: 60,
        opponentScore: 41,
        pointDiff: 19,
        won: true,
        movesUsed: 18,
        handsPlayed: 4,
        startedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        completedAt: NOW.toISOString(),
        revision: 5,
      })),
    });
    const response = await harness.request('GET', '/api/fritz-challenges/:shareCode', {
      userId: CREATOR_ID,
      params: { shareCode: 'ABCDEFGH' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      challenge: {
        status: 'open',
        attempt: {
          status: 'completed',
          final_score: 60,
          set_result: { setWinner: 'player', playerGamesWon: 2 },
        },
      },
    });
  });

  it('does not let the creator start before the recipient accepts', async () => {
    const pendingChallenge = challengeFixture();
    const harness = makeHarness({
      getChallengeByCode: vi.fn(async () => pendingChallenge),
    });
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/start',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
        body: {
          verification_protocol_version: 2,
          game_rules_version: pendingChallenge.versions.rulesVersion,
          fritz_policy_version: pendingChallenge.versions.fritzPolicyVersion,
          verifier_version: pendingChallenge.versions.verifierVersion,
        },
      },
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'invite_not_accepted' });
    expect(harness.deps.startCommand).not.toHaveBeenCalled();
    expect(harness.deps.getOrCreateHand).not.toHaveBeenCalled();
  });

  it('does not start an expired challenge even when the invite was accepted', async () => {
    const expiredChallenge = {
      ...challengeFixture(),
      acceptedAt: NOW.toISOString(),
      expiresAt: '2026-07-25T12:00:00.000Z',
    };
    const harness = makeHarness({
      getChallengeByCode: vi.fn(async () => expiredChallenge),
    });
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/start',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
        body: {
          verification_protocol_version: 2,
          game_rules_version: expiredChallenge.versions.rulesVersion,
          fritz_policy_version: expiredChallenge.versions.fritzPolicyVersion,
          verifier_version: expiredChallenge.versions.verifierVersion,
        },
      },
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'expired' });
    expect(harness.deps.startCommand).not.toHaveBeenCalled();
  });

  it('rejects an outdated client before creating an attempt or hand', async () => {
    const harness = makeHarness();
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/start',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
        body: {
          verification_protocol_version: 1,
          game_rules_version: 0,
          fritz_policy_version: 0,
          verifier_version: 0,
        },
      },
    );

    expect(response.status).toBe(426);
    expect(response.body).toMatchObject({ code: 'version_mismatch' });
    expect(harness.deps.startCommand).not.toHaveBeenCalled();
    expect(harness.deps.getOrCreateHand).not.toHaveBeenCalled();
  });

  it('restores persisted current-game scores when resuming an attempt', async () => {
    const base = makeHarness();
    const harness = makeHarness({
      getAttempt: vi.fn(async ({ userId }) => ({
        id: '55555555-5555-4555-8555-555555555555',
        challengeId: base.challenge.id,
        userId,
        status: 'started',
        currentGameNumber: 2,
        currentHandIndex: 3,
        result: {
          active_game: { game_number: 2, you: 35, fritz: 24 },
        },
        finalScore: null,
        opponentScore: null,
        pointDiff: null,
        won: null,
        movesUsed: null,
        handsPlayed: null,
        startedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        completedAt: null,
        revision: 0,
      })),
    });
    const response = await harness.request(
      'POST',
      '/api/fritz-challenges/:shareCode/start',
      {
        userId: CREATOR_ID,
        params: { shareCode: 'ABCDEFGH' },
        body: {
          verification_protocol_version: 2,
          game_rules_version: harness.challenge.versions.rulesVersion,
          fritz_policy_version: harness.challenge.versions.fritzPolicyVersion,
          verifier_version: harness.challenge.versions.verifierVersion,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      current_game_number: 2,
      current_hand_index: 3,
      current_game_scores: { you: 35, fritz: 24 },
    });
    expect(harness.deps.getOrCreateHand).toHaveBeenCalledWith(
      expect.objectContaining({ gameNumber: 2, handIndex: 3 }),
    );
  });
});

function harnessChallengeId(): string {
  return '44444444-4444-4444-8444-444444444444';
}
