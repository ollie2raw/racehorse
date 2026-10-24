/**
 * Never-strand keeps saving a game whose evidence is missing or rejected, but the run is withheld from every public
 * surface (leaderboard, streak). The social activity feed is a public surface too: it publishes the result to the player's
 * friends. It must therefore only ever carry a result the verifier derived, never the client's claim.
 *
 * Before the fix `record-game` wrote the activity row for every recorded game, so any authenticated user could post an
 * arbitrary "won 150-0" to their friends' feeds by submitting a score-only (or tampered) game.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  parseDailyFritzTranscript,
} from '@racehorse/game-core';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { getDailyFritzSeed } from '../../dailyFritz';
import { digestDailyFritzTranscript } from '../../dailyFritzVerifier';
import {
  isDailyFritzAttemptLeaderboardEligible,
  isDailyFritzAttemptStreakEligible,
  type DailyFritzAttemptRecord,
  type DailyFritzRunRecord,
} from '../stores/dailyFritzStore';

const { authUserMock, getAttemptByIdMock, getAttemptMock, upsertAttemptMock, getRunMock, activityMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
  activityMock: vi.fn(),
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

vi.mock('../../social/activityWriter', () => ({ writeDailyFritzGameActivity: activityMock }));

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const RUN_DATE = '2026-08-24';
const USER_ID = 'user-feed';
const ATTEMPT_ID = 'attempt-feed';
const VERIFIED_MATCH_ID = 'verified-match-feed';
const TERMINAL_HAND_INDEX = 5;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);
  return async function request(path: string, body: Record<string, unknown>) {
    const handler = routes.get(`POST ${path}`);
    if (!handler) throw new Error(`Missing route POST ${path}`);
    let status = 200;
    let responseBody: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { responseBody = value; return res; },
      setHeader() { return res; },
      once() { return res; },
    };
    await handler({ headers: {}, params: {}, query: {}, body, method: 'POST', path, get() { return undefined; } }, res);
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

/** A parseable transcript for the terminal hand (its content is irrelevant when a receipt for it already exists). */
function terminalTranscript(gameNumber: number) {
  return parseDailyFritzTranscript({
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    challengeId: buildDailyFritzChallengeId(RUN_DATE),
    attemptId: ATTEMPT_ID,
    gameNumber,
    handIndex: TERMINAL_HAND_INDEX,
    actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }],
  });
}

function attemptWith(extraAuthorityHands: unknown[] = []): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: TERMINAL_HAND_INDEX,
    currentGameNumber: 3,
    revision: 19,
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
      authority: { version: 1, games: [], hands: extraAuthorityHands },
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
    movesUsed: null,
    handsPlayed: null,
  } as unknown as DailyFritzAttemptRecord;
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

let stored: DailyFritzAttemptRecord;
function useAttempt(attempt: DailyFritzAttemptRecord) {
  stored = attempt;
  getAttemptByIdMock.mockImplementation(async () => ({ ...stored }));
  getAttemptMock.mockImplementation(async () => ({ ...stored }));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => { stored = { ...record }; return { ...stored }; });
}

beforeEach(() => {
  vi.clearAllMocks();
  authUserMock.mockResolvedValue(USER_ID);
  getRunMock.mockResolvedValue(buildRun());
  activityMock.mockResolvedValue(undefined);
});

const claim = { attempt_id: ATTEMPT_ID, verified_match_id: VERIFIED_MATCH_ID, run_date: RUN_DATE, game_number: 3, moves_used: 90, hands_played: 6 };

describe('an evidence-free game on a protocol attempt is an unverified advance, never a streak', () => {
  it('records the missing transcript in unverified_hands (sticky rejected) so the run earns no streak credit', async () => {
    useAttempt(attemptWith());
    const response = await makeHarness()('/api/daily-fritz/record-game', { ...claim, player_score: 62, fritz_score: 33 });
    expect(response.status).toBe(200);
    const result = stored.result as Record<string, unknown>;
    expect(result.verification_status).toBe('rejected');
    expect(result.unverified_hands).toEqual([
      expect.objectContaining({ game_number: 3, hand_index: TERMINAL_HAND_INDEX, verifier_code: 'missing_transcript', player_score_after: 62, fritz_score_after: 33 }),
    ]);
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result })).toBe(false);
    expect(isDailyFritzAttemptLeaderboardEligible({ status: 'completed', result })).toBe(false);
  });

  it('a pre-protocol legacy attempt is unchanged: it stays a plain legacy finish (still streak-eligible)', async () => {
    const legacy = attemptWith();
    const result = { ...(legacy.result as Record<string, unknown>) };
    delete result.verification_protocol_version;
    delete result.authority_contract;
    delete result.verification_status;
    useAttempt({ ...legacy, result } as DailyFritzAttemptRecord);
    const response = await makeHarness()('/api/daily-fritz/record-game', { ...claim, player_score: 62, fritz_score: 33 });
    expect(response.status).toBe(200);
    const saved = stored.result as Record<string, unknown>;
    expect(saved.verification_status).toBe('legacy_unverified');
    expect(saved.unverified_hands).toBeUndefined();
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: saved })).toBe(true);
  });
});

describe('the activity feed only carries a verified result', () => {
  it('a score-only claim is saved (never-strand) but is NOT published to friends', async () => {
    useAttempt(attemptWith());
    const response = await makeHarness()('/api/daily-fritz/record-game', { ...claim, player_score: 150, fritz_score: 0 });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(activityMock).not.toHaveBeenCalled();
  });

  it('a transcript that fails verification advances unverified and is NOT published to friends', async () => {
    useAttempt(attemptWith());
    const response = await makeHarness()('/api/daily-fritz/record-game', {
      ...claim,
      player_score: 150,
      fritz_score: 0,
      transcript: terminalTranscript(3),
    });
    expect(response.status).toBe(200);
    expect(response.body.unverified).toBe(true);
    expect(activityMock).not.toHaveBeenCalled();
  });

  it('positive control: a game backed by a verified receipt IS published, with the receipt\'s scores, not the claim', async () => {
    const transcript = terminalTranscript(3);
    useAttempt(attemptWith([{
      gameNumber: 3,
      handIndex: TERMINAL_HAND_INDEX,
      transcriptDigest: digestDailyFritzTranscript(transcript),
      actionCount: 40,
      playerScoreAfter: 62,
      fritzScoreAfter: 33,
      winner: 'player',
      verificationVersion: 2,
    }]));
    const response = await makeHarness()('/api/daily-fritz/record-game', {
      ...claim,
      player_score: 150,
      fritz_score: 0,
      transcript,
    });
    expect(response.status).toBe(200);
    expect(response.body.unverified).toBeUndefined();
    expect(activityMock).toHaveBeenCalledTimes(1);
    expect(activityMock.mock.calls[0]?.[0]).toMatchObject({ userId: USER_ID, gameNumber: 3, playerWon: true, playerScore: 62, fritzScore: 33 });
  });
});
