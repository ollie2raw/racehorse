/**
 * Regression for the 2026-08-24 production incident.
 *
 * A hand that failed verification mid-set left its game recorded in the set
 * result but absent from the authority ledger. `record-game` for the NEXT game
 * then rejected forever with 409 "Earlier Daily Fritz games are missing
 * verification receipts", because the gate demanded a receipt for every
 * already-recorded game. The state was unrecoverable: the earlier game could
 * never be re-verified, so every retry and every resume hit the same 409.
 *
 * Four users across four consecutive days were trapped this way. Verification
 * no longer gates play at all — evidence is still recorded, but a missing
 * receipt must never block a player from finishing their set.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { Application } from 'express';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
} from '@racehorse/game-core';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';

const { authUserMock, getAttemptByIdMock, getAttemptMock, upsertAttemptMock, getRunMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
  getAuthenticatedUserIdFromToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>('../stores/dailyFritzStore');
  return {
    ...actual,
    getDailyFritzAttemptById: getAttemptByIdMock,
    getDailyFritzAttempt: getAttemptMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
    getDailyFritzRun: getRunMock,
    ensureDailyFritzRunForDate: getRunMock,
  };
});

vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>('../stores/dailyFritzEventStore');
  return { ...actual, recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../social/activityWriter', () => ({
  writeDailyFritzGameActivity: vi.fn().mockResolvedValue(undefined),
}));

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const RUN_DATE = '2026-08-24';
const USER_ID = 'user-trapped';
const ATTEMPT_ID = 'attempt-trapped';
const VERIFIED_MATCH_ID = 'verified-match-trapped';
const TERMINAL_HAND_INDEX = 5;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);
  return async function request(method: 'GET' | 'POST', path: string, body: Record<string, unknown>) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let responseBody: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { responseBody = value; return res; },
      setHeader() { return res; },
      once() { return res; },
    };
    await handler(
      { headers: {}, params: {}, query: {}, body, method, path, get() { return undefined; } },
      res,
    );
    return { status, body: responseBody as Record<string, unknown> };
  };
}

function game(gameNumber: number, playerScore: number, fritzScore: number) {
  return {
    gameNumber,
    seed: `daily-fritz-${RUN_DATE}:game:${gameNumber}`,
    playerWon: playerScore > fritzScore,
    playerScore,
    fritzScore,
    pointDiff: playerScore - fritzScore,
    movesUsed: 100,
    handsPlayed: 6,
    completedAt: '2026-08-24T07:06:54.672Z',
  };
}

/** The exact production shape: game 2 recorded, but only game 1 has a receipt. */
function trappedAttempt(): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: TERMINAL_HAND_INDEX,
    currentGameNumber: 3,
    revision: 19,
    // Null, as the sibling route tests do: a challengeId routes through the
    // transactional authority path, which needs infrastructure this harness
    // does not stand up. The receipt gate under test is independent of it.
    challengeId: null,
    challengeContractVersion: 1,
    generationVersion: 1,
    gameRulesVersion: GAME_RULES_VERSION,
    transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    startedAt: '2026-08-24T07:00:32.714Z',
    completedAt: null,
    verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null,
    result: {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: 1,
      fritzGamesWon: 1,
      totalPointDiff: 10,
      games: [game(1, 70, 44), game(2, 54, 70)],
      // Only game 1 earned a receipt. Game 2's hand 7 failed verification.
      authority: {
        version: 1,
        games: [{
          gameNumber: 1,
          playerScore: 70,
          fritzScore: 44,
          handDigests: ['digest-g1h0'],
          resultDigest: 'result-g1',
          verificationVersion: 2,
        }],
        hands: [{ gameNumber: 1, handIndex: 0, transcriptDigest: 'digest-g1h0', actionCount: 10 }],
      },
      unverified_hands: [
        { hand_index: 7, game_number: 2, recorded_at: '2026-08-24T14:40:28.700Z', verifier_code: 'fritz_state_mismatch' },
      ],
      verification_status: 'in_progress',
      verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      authority_contract: {
        transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
        gameRulesVersion: GAME_RULES_VERSION,
        fritzPolicyVersion: FRITZ_POLICY_VERSION,
        fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
        stateDigestVersion: 1,
        stateDigestRequired: false,
        clientRelease: 'test',
        challengeId: buildDailyFritzChallengeId(RUN_DATE),
        runFingerprint: 'fp',
      },
    },
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
}

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: [],
    generatedAt: '2026-08-24T00:00:00.000Z',
    invalidatedAt: null,
    metadata: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authUserMock.mockResolvedValue(USER_ID);
  getAttemptByIdMock.mockImplementation(async () => trappedAttempt());
  getAttemptMock.mockImplementation(async () => trappedAttempt());
  getRunMock.mockResolvedValue(buildRun());
  upsertAttemptMock.mockImplementation(async (attempt: DailyFritzAttemptRecord) => attempt);
});

describe('a game without an authority receipt does not block the next game', () => {
  it('records game 3 even though game 2 has no receipt', async () => {
    const request = makeHarness();
    const response = await request('POST', '/api/daily-fritz/record-game', {
      attempt_id: ATTEMPT_ID,
      verified_match_id: VERIFIED_MATCH_ID,
      run_date: RUN_DATE,
      game_number: 3,
      player_score: 62,
      fritz_score: 33,
      moves_used: 90,
      hands_played: 6,
    });

    expect(response.status).not.toBe(409);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('does not reject a score-only submission for missing evidence', async () => {
    // The 426 "Update required" gate is gone too: no transcript is not a reason
    // to refuse to save a game the player already finished.
    const request = makeHarness();
    const response = await request('POST', '/api/daily-fritz/record-game', {
      attempt_id: ATTEMPT_ID,
      verified_match_id: VERIFIED_MATCH_ID,
      run_date: RUN_DATE,
      game_number: 3,
      player_score: 62,
      fritz_score: 33,
      moves_used: 90,
      hands_played: 6,
    });
    expect(response.status).not.toBe(426);
  });
});
