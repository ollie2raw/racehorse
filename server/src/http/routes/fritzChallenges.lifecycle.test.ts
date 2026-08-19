import { describe, expect, it } from 'vitest';
import type { Application } from 'express';
import { DAILY_FRITZ_VERIFIER_VERSION, FRITZ_POLICY_VERSION, GAME_RULES_VERSION } from '@racehorse/game-core';
import {
  buildFritzChallengeIdentity,
  createGeneratedFritzChallenge,
  generateFritzChallengeHand,
  getFritzChallengeDrawWinner,
  type GeneratedFritzChallenge,
} from '../../fritzChallenge';
import { buildHonestDailyFritzHandTranscript } from '../../testing/dailyFritzTranscriptDriver';
import {
  registerFritzChallengeRoutes,
  type FritzChallengeRoutesDeps,
} from './fritzChallenges';
import type { FritzChallengeAttemptRecord } from '../stores/fritzChallengeStore';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-07-26T12:00:00.000Z');

function makeChallenge(): GeneratedFritzChallenge {
  return createGeneratedFritzChallenge({
    creatorUserId: USER_ID,
    fritzTier: 'elite',
    dealSize: 7,
    id: '33333333-3333-4333-8333-333333333333',
    shareCode: 'ABCDEFGH',
    seed: 'challenge-lifecycle-e2e-seed',
    now: NOW,
  });
}

function makeAttempt(challenge: GeneratedFritzChallenge): FritzChallengeAttemptRecord {
  return {
    id: ATTEMPT_ID,
    challengeId: challenge.id,
    userId: USER_ID,
    status: 'started',
    currentGameNumber: 1,
    currentHandIndex: 0,
    result: null,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: 0,
    handsPlayed: 0,
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    revision: 0,
  };
}

describe('Fritz Challenge lifecycle authority', () => {
  it('runs a real shared-core best-of-three set through verified completion and replay-safe game records', async () => {
    const routes = new Map<string, Handler>();
    const app = {
      get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
      post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
    };
    const challenge = makeChallenge();
    let attempt = makeAttempt(challenge);
    const operationResponses = new Map<string, Record<string, unknown>>();
    const commitCalls: Array<Record<string, unknown>> = [];
    const deps: FritzChallengeRoutesDeps = {
      getAuthenticatedUserId: async () => USER_ID,
      createChallenge: async () => challenge,
      getChallengeByCode: async () => challenge,
      claimOpponent: async () => challenge,
      getOrCreateHand: async ({ gameNumber, handIndex }) => generateFritzChallengeHand(
        challenge.seed, gameNumber, handIndex, challenge.config.dealSize,
      ),
      getAttempt: async () => attempt,
      startCommand: async () => {
        if (attempt.revision === 0) attempt = { ...attempt, revision: 1 };
        return {
          outcome: 'committed', errorCode: null, replayed: false,
          committedRevision: attempt.revision, response: { attempt_id: ATTEMPT_ID },
        };
      },
      commitCommand: async (input) => {
        const prior = operationResponses.get(input.operationId);
        if (prior) {
          return {
            outcome: 'committed', errorCode: null, replayed: true,
            committedRevision: Number(prior.revision), response: prior,
          };
        }
        if (input.expectedRevision !== attempt.revision) {
          return {
            outcome: 'conflict', errorCode: 'stale_revision', replayed: false,
            committedRevision: attempt.revision, response: null,
          };
        }
        attempt = {
          ...attempt,
          status: input.next.status,
          currentGameNumber: input.next.currentGameNumber,
          currentHandIndex: input.next.currentHandIndex,
          result: input.next.result,
          finalScore: input.next.finalScore ?? attempt.finalScore,
          opponentScore: input.next.opponentScore ?? attempt.opponentScore,
          pointDiff: input.next.pointDiff ?? attempt.pointDiff,
          won: input.next.won ?? attempt.won,
          movesUsed: input.next.movesUsed ?? attempt.movesUsed,
          handsPlayed: input.next.handsPlayed ?? attempt.handsPlayed,
          revision: attempt.revision + 1,
        };
        const response = { attempt_id: attempt.id, revision: attempt.revision };
        operationResponses.set(input.operationId, response);
        commitCalls.push({ operationId: input.operationId, commandType: input.commandType });
        return {
          outcome: 'committed', errorCode: null, replayed: false,
          committedRevision: attempt.revision, response,
        };
      },
      now: () => NOW,
    };
    registerFritzChallengeRoutes(app as unknown as Application, deps);

    async function request(path: string, body: Record<string, unknown>) {
      const handler = routes.get(`POST ${path}`);
      if (!handler) throw new Error(`Missing ${path}`);
      let status = 200;
      let response: any;
      const res = {
        status(code: number) { status = code; return res; },
        json(payload: unknown) { response = payload; return res; },
      };
      await handler({ headers: {}, body, params: { shareCode: challenge.shareCode } }, res);
      return { status, body: response };
    }

    const start = await request('/api/fritz-challenges/:shareCode/start', {
      verification_protocol_version: 2,
      game_rules_version: GAME_RULES_VERSION,
      fritz_policy_version: FRITZ_POLICY_VERSION,
      verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
    });
    expect(start.status).toBe(200);
    expect(attempt.revision).toBe(1);

    let terminalRequest: Record<string, unknown> | null = null;
    for (let gameNumber = 1 as 1 | 2 | 3; gameNumber <= 3; gameNumber = (gameNumber + 1) as 1 | 2 | 3) {
      for (let handCount = 0; handCount < 32; handCount += 1) {
        const active = (attempt.result?.active_game ?? {}) as Record<string, unknown>;
        const driven = buildHonestDailyFritzHandTranscript({
          challengeId: buildFritzChallengeIdentity(challenge),
          attemptId: ATTEMPT_ID,
          gameNumber,
          handIndex: attempt.currentHandIndex,
          deal: generateFritzChallengeHand(
            challenge.seed, gameNumber, attempt.currentHandIndex, challenge.config.dealSize,
          ),
          drawWinner: getFritzChallengeDrawWinner(challenge.seed, gameNumber),
          winningScore: challenge.config.winningScore,
          dealSize: challenge.config.dealSize,
          playerScore: Number(active.you) || 0,
          fritzScore: Number(active.fritz) || 0,
          fritzTier: challenge.config.fritzTier,
          fritzPolicyVersion: challenge.versions.fritzPolicyVersion as 1 | 2,
        });
        const common = { attempt_id: ATTEMPT_ID, game_number: gameNumber, transcript: driven.transcript };
        if (driven.terminalState.gameOver) {
          terminalRequest = common;
          const record = await request('/api/fritz-challenges/:shareCode/record-game', terminalRequest);
          expect(record.status).toBe(200);
          break;
        }
        const next = await request('/api/fritz-challenges/:shareCode/next-hand', {
          ...common,
          verified_match_id: ATTEMPT_ID,
          completed_hand_index: attempt.currentHandIndex,
        });
        expect(next.status).toBe(200);
      }
      expect(terminalRequest).not.toBeNull();
      if (attempt.status === 'completed') break;
      expect(attempt.currentGameNumber).toBe((gameNumber + 1) as 1 | 2 | 3);
      expect(attempt.currentHandIndex).toBe(0);
    }

    expect(attempt.status).toBe('completed');
    const games = (attempt.result?.set_result as { games?: unknown[] } | undefined)?.games ?? [];
    expect(games.length).toBeGreaterThanOrEqual(2);
    expect(games.length).toBeLessThanOrEqual(3);
    expect(attempt.result?.set_result).toMatchObject({ setWinner: expect.any(String) });

    const replay = await request('/api/fritz-challenges/:shareCode/record-game', terminalRequest!);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ ok: true, replayed: true, next_game_number: null });
    expect(commitCalls.filter((call) => call.commandType === 'record_verified_game').length).toBe(games.length);
  });
});
