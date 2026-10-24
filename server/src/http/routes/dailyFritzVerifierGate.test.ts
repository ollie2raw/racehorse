/**
 * Independent integration-gate checks at the route/policy layer (separate from the branch's own route tests):
 *
 *  A. a new Daily Fritz attempt cannot be started under an older Fritz policy, and a pinned attempt cannot be resumed by a
 *     client that advertises only older policies (the policy version comes from the server-written contract);
 *  B. verified / rejected / unverified status matrix: any unverified evidence is permanent, a legitimate run stays eligible;
 *  C. a client claim that contradicts the verifier's receipt never becomes the stored result, the winner, or the feed payload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
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
import { applyDailyFritzAttemptFinalization } from './dailyFritzAttemptFinalize';
import { buildRecordedDailyFritzAttemptResult } from './dailyFritzVerificationPolicy';
import { writeUnverifiedDailyFritzHand } from './dailyFritzVerificationGlue';

const { authUserMock, getAttemptByIdMock, getAttemptMock, upsertAttemptMock, createAttemptMock, getRunMock, activityMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  getAttemptMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  createAttemptMock: vi.fn(),
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
    createDailyFritzAttempt: createAttemptMock,
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
const USER_ID = 'user-gate';
const ATTEMPT_ID = 'attempt-gate';
const VERIFIED_MATCH_ID = 'verified-match-gate';
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
    gameNumber, seed: `daily-fritz-${RUN_DATE}:game:${gameNumber}`, playerWon: playerScore > fritzScore, playerScore, fritzScore,
    pointDiff: playerScore - fritzScore, movesUsed: 100, handsPlayed: 6, completedAt: '2026-08-24T07:06:54.672Z',
  };
}

const contract = (version: number) => ({
  transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  gameRulesVersion: GAME_RULES_VERSION,
  fritzPolicyVersion: version,
  fritzPolicyContract: getFritzPolicyContract(version as 1 | 2 | 3),
  stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  stateDigestRequired: true,
  clientRelease: 'gate',
  challengeId: buildDailyFritzChallengeId(RUN_DATE),
  runFingerprint: 'fp',
});

function attemptRecord(result: Record<string, unknown> | null, over: Record<string, unknown> = {}): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID, runDate: RUN_DATE, userId: USER_ID, status: 'started', currentHandIndex: TERMINAL_HAND_INDEX, currentGameNumber: 3,
    revision: 19, challengeId: null, challengeContractVersion: 1, generationVersion: 1, gameRulesVersion: GAME_RULES_VERSION,
    transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION, fritzPolicyVersion: FRITZ_POLICY_VERSION, rankingVersion: 1,
    authoritySchemaVersion: 1, startedAt: '2026-08-24T07:00:32.714Z', completedAt: null, verifiedMatchId: VERIFIED_MATCH_ID,
    completionHash: null, result, finalScore: null, opponentScore: null, pointDiff: null, movesUsed: null, handsPlayed: null, ...over,
  } as unknown as DailyFritzAttemptRecord;
}

function buildRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE, seed: getDailyFritzSeed(RUN_DATE), fritzTier: 'standard', dealSize: 7, winningScore: 60, status: 'live',
    handDeals: [], generatedAt: '2026-08-24T00:00:00.000Z', invalidatedAt: null, metadata: {},
  };
}

let stored: DailyFritzAttemptRecord;
function useAttempt(attempt: DailyFritzAttemptRecord | null) {
  if (attempt) stored = attempt;
  getAttemptByIdMock.mockImplementation(async () => (attempt ? { ...stored } : null));
  getAttemptMock.mockImplementation(async () => (attempt ? { ...stored } : null));
  upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => { stored = { ...record }; return { ...stored }; });
}

beforeEach(() => {
  vi.clearAllMocks();
  authUserMock.mockResolvedValue(USER_ID);
  getRunMock.mockResolvedValue(buildRun());
  activityMock.mockResolvedValue(undefined);
});

// ───────────────────────────── A. policy pinning at /start ─────────────────────────────

describe('A. the Fritz policy version is server-pinned: no downgrade at start or resume', () => {
  const startBody = (over: Record<string, unknown> = {}) => ({
    verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    game_rules_version: GAME_RULES_VERSION,
    fritz_policy_version: FRITZ_POLICY_VERSION,
    fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    ...over,
  });

  it('is on policy v3 (so the exact-selection rule is what new attempts are pinned to)', () => {
    expect(FRITZ_POLICY_VERSION).toBe(3);
  });

  const downgrades: Array<[string, Record<string, unknown>]> = [
    ['v1 with its own contract', { fritz_policy_version: 1, fritz_policy_contract: getFritzPolicyContract(1) }],
    ['v2 with its own contract', { fritz_policy_version: 2, fritz_policy_contract: getFritzPolicyContract(2) }],
    ['v1 advertised in supported_fritz_policies only', { fritz_policy_version: 1, fritz_policy_contract: getFritzPolicyContract(1), supported_fritz_policies: [{ version: 1, contract: getFritzPolicyContract(1) }] }],
    ['v3 version with a v1 contract string', { fritz_policy_contract: getFritzPolicyContract(1) }],
    ['no policy fields at all', { fritz_policy_version: undefined, fritz_policy_contract: undefined }],
    ['an older transcript protocol', { verification_protocol_version: 1 }],
    ['an older digest version', { state_digest_version: 1 }],
  ];
  for (const [name, over] of downgrades) {
    it(`a NEW attempt is refused (426) and nothing is created: ${name}`, async () => {
      useAttempt(null);
      const response = await makeHarness()('/api/daily-fritz/start', startBody(over));
      expect(response.status).toBe(426);
      expect(response.body.code).toBe('authority_contract_unsupported');
      expect(createAttemptMock).not.toHaveBeenCalled();
      expect(upsertAttemptMock).not.toHaveBeenCalled();
    });
  }

  it('a v3-pinned attempt is not resumable by a client that only supports older policies, and is left untouched', async () => {
    useAttempt(attemptRecord({ authority_contract: contract(3), verification_protocol_version: 2, verification_status: 'in_progress' }));
    const before = JSON.stringify(stored);
    const response = await makeHarness()('/api/daily-fritz/start', startBody({
      fritz_policy_version: 2, fritz_policy_contract: getFritzPolicyContract(2),
      supported_fritz_policies: [{ version: 1, contract: getFritzPolicyContract(1) }, { version: 2, contract: getFritzPolicyContract(2) }],
    }));
    expect(response.status).toBe(426);
    expect(JSON.stringify(stored)).toBe(before);
    expect(upsertAttemptMock).not.toHaveBeenCalled();
  });

  it('control: a current client is not refused with 426 on a pinned attempt', async () => {
    useAttempt(attemptRecord({ authority_contract: contract(3), verification_protocol_version: 2, verification_status: 'in_progress' }));
    const response = await makeHarness()('/api/daily-fritz/start', startBody({
      supported_transcript_protocol_versions: [2], supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
      supported_fritz_policies: [{ version: 3, contract: getFritzPolicyContract(3) }],
    }));
    expect(response.status).not.toBe(426);
  });
});

// ───────────────────────────── B. verified / streak status matrix ─────────────────────────────

describe('B. unverified evidence is permanent; a legitimate verified run stays eligible', () => {
  const finishedSet = (over: Record<string, unknown> = {}) => ({
    version: 2, format: 'best_of_3', playerGamesWon: 2, fritzGamesWon: 0, totalPointDiff: 34, setWinner: 'player', instantSkunk: true, skunkGameNumber: 1,
    verification_protocol_version: 2, verification_status: 'in_progress',
    games: [{ ...game(1, 61, 27), skunk: true, skunkBy: 'player' }],
    authority: { version: 1, hands: [{ gameNumber: 1, handIndex: 0, transcriptDigest: 'd0', actionCount: 20, playerScoreAfter: 61, fritzScoreAfter: 27, winner: 'player', verificationVersion: 2 }],
      games: [{ verificationVersion: 2, gameNumber: 1, playerScore: 61, fritzScore: 27, handDigests: ['d0'], resultDigest: 'r0' }] },
    ...over,
  });
  const finalize = (result: Record<string, unknown>) => {
    const attempt = attemptRecord(result, { status: 'started' });
    const out = applyDailyFritzAttemptFinalization(attempt, RUN_DATE);
    return { attempt, out };
  };
  const unverified = (code: string) => ({ game_number: 1, hand_index: 3, verifier_code: code });

  it('positive control: a fully verified run finalizes verified and is leaderboard- and streak-eligible', () => {
    const { attempt, out } = finalize(finishedSet());
    expect(out?.isVerified).toBe(true);
    expect(attempt.result?.verification_status).toBe('verified');
    expect(isDailyFritzAttemptLeaderboardEligible(attempt)).toBe(true);
    expect(isDailyFritzAttemptStreakEligible(attempt)).toBe(true);
  });

  it('never-strand unverified advance (writeUnverifiedDailyFritzHand) makes the run permanently rejected and ineligible', () => {
    const rejected = writeUnverifiedDailyFritzHand(finishedSet(), { gameNumber: 1, handIndex: 3, verifierCode: 'fritz_action_mismatch', playerScoreAfter: 61, fritzScoreAfter: 27 });
    expect(rejected.verification_status).toBe('rejected');
    const { attempt, out } = finalize(rejected);
    expect(out?.isVerified).toBe(false);
    expect(isDailyFritzAttemptLeaderboardEligible(attempt)).toBe(false);
    expect(isDailyFritzAttemptStreakEligible(attempt)).toBe(false);
    expect(attempt.result?.unverified_hands).toEqual([expect.objectContaining({ game_number: 1, hand_index: 3, verifier_code: 'fritz_action_mismatch' })]);
  });

  it('mixed verified + unverified hands: one unverified hand taints the whole run, even with a complete authority ledger', () => {
    const mixed = finishedSet({ unverified_hands: [unverified('missing_transcript')] });
    const { attempt, out } = finalize(mixed);
    expect(out?.isVerified, 'ledger is complete but a hand advanced without a receipt').toBe(false);
    expect(attempt.result?.verification_status, 'the persisted label must not claim verified').toBe('legacy_unverified');
    expect(isDailyFritzAttemptLeaderboardEligible(attempt)).toBe(false);
    expect(isDailyFritzAttemptStreakEligible(attempt)).toBe(false);
  });

  it('a later VERIFIED transcript cannot promote a rejected run back to eligible', () => {
    const next = buildRecordedDailyFritzAttemptResult({
      previousResult: writeUnverifiedDailyFritzHand(finishedSet(), { gameNumber: 1, handIndex: 3, verifierCode: 'fritz_state_mismatch' }),
      setResult: { version: 2, format: 'best_of_3', games: [] },
      hasTranscript: true,
    });
    expect(next.verification_status).toBe('rejected');
    expect(next.unverified_hands).toEqual([expect.objectContaining({ verifier_code: 'fritz_state_mismatch' })]);
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: next })).toBe(false);
  });

  it('a later game with NO transcript cannot erase earlier evidence or the rejected status', () => {
    const previous = writeUnverifiedDailyFritzHand(finishedSet(), { gameNumber: 1, handIndex: 3, verifierCode: 'fritz_action_mismatch' });
    const next = buildRecordedDailyFritzAttemptResult({ previousResult: previous, setResult: { version: 2, format: 'best_of_3', games: [] }, hasTranscript: false });
    expect(next.verification_status).toBe('rejected');
    expect(next.unverified_hands).toEqual(previous.unverified_hands);
  });

  it('re-finalizing is idempotent and never launders the run (second pass keeps the evidence and the ineligibility)', () => {
    const { attempt } = finalize(writeUnverifiedDailyFritzHand(finishedSet(), { gameNumber: 1, handIndex: 3, verifierCode: 'x' }));
    const again = { ...attempt, status: 'started' } as DailyFritzAttemptRecord;
    applyDailyFritzAttemptFinalization(again, RUN_DATE);
    expect(again.result?.unverified_hands).toEqual(attempt.result?.unverified_hands);
    expect(isDailyFritzAttemptStreakEligible(again)).toBe(false);
    expect(isDailyFritzAttemptLeaderboardEligible(again)).toBe(false);
  });

  it('a record-game with no transcript on a protocol-pinned attempt is an unverified advance (route level)', async () => {
    useAttempt(attemptRecord({
      version: 2, format: 'best_of_3', playerGamesWon: 1, fritzGamesWon: 1, totalPointDiff: 10, games: [game(1, 70, 44), game(2, 54, 70)],
      authority: { version: 1, games: [], hands: [] }, verification_status: 'in_progress', verification_protocol_version: 2, authority_contract: contract(3),
    }));
    const response = await makeHarness()('/api/daily-fritz/record-game', {
      attempt_id: ATTEMPT_ID, verified_match_id: VERIFIED_MATCH_ID, run_date: RUN_DATE, game_number: 3, moves_used: 90, hands_played: 6, player_score: 62, fritz_score: 33,
    });
    expect(response.status).toBe(200);
    const result = stored.result as Record<string, unknown>;
    expect(result.verification_status).toBe('rejected');
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result })).toBe(false);
    expect(activityMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── C. claimed result vs receipt ─────────────────────────────

describe('C. only the verifier-derived result is authoritative', () => {
  const transcript = parseDailyFritzTranscript({
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION, rulesVersion: GAME_RULES_VERSION, fritzPolicyVersion: FRITZ_POLICY_VERSION,
    challengeId: buildDailyFritzChallengeId(RUN_DATE), attemptId: ATTEMPT_ID, gameNumber: 3, handIndex: TERMINAL_HAND_INDEX,
    actions: [{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }],
  });
  const receiptAttempt = () => attemptRecord({
    version: 2, format: 'best_of_3', playerGamesWon: 1, fritzGamesWon: 1, totalPointDiff: 10, games: [game(1, 70, 44), game(2, 54, 70)],
    authority: { version: 1, games: [], hands: [{
      gameNumber: 3, handIndex: TERMINAL_HAND_INDEX, transcriptDigest: digestDailyFritzTranscript(transcript), actionCount: 40,
      playerScoreAfter: 62, fritzScoreAfter: 33, winner: 'player', verificationVersion: 2,
    }] },
    verification_status: 'in_progress', verification_protocol_version: 2, authority_contract: contract(3),
  });
  const claim = { attempt_id: ATTEMPT_ID, verified_match_id: VERIFIED_MATCH_ID, run_date: RUN_DATE, game_number: 3, moves_used: 90, hands_played: 6, transcript };

  it('a claim of a 0-150 LOSS against a receipt of a 62-33 WIN is stored and published as the receipt (winner, scores, points)', async () => {
    useAttempt(receiptAttempt());
    const response = await makeHarness()('/api/daily-fritz/record-game', { ...claim, player_score: 0, fritz_score: 150 });
    expect(response.status).toBe(200);
    const recorded = ((stored.result as { games: Array<Record<string, unknown>> }).games).find((g) => g.gameNumber === 3)!;
    expect(recorded).toMatchObject({ playerScore: 62, fritzScore: 33, playerWon: true, pointDiff: 29 });
    expect(activityMock).toHaveBeenCalledTimes(1);
    expect(activityMock.mock.calls[0]?.[0]).toMatchObject({ gameNumber: 3, playerWon: true, playerScore: 62, fritzScore: 33 });
    expect(JSON.stringify(activityMock.mock.calls)).not.toContain('150');
  });

  it('a claim of a 150-0 WIN against a receipt of a 33-62 LOSS is stored and published as the loss', async () => {
    const attempt = receiptAttempt();
    (attempt.result as { authority: { hands: Array<Record<string, unknown>> } }).authority.hands[0] = {
      ...(attempt.result as { authority: { hands: Array<Record<string, unknown>> } }).authority.hands[0], playerScoreAfter: 33, fritzScoreAfter: 62, winner: 'fritz',
    };
    useAttempt(attempt);
    const response = await makeHarness()('/api/daily-fritz/record-game', { ...claim, player_score: 150, fritz_score: 0 });
    expect(response.status).toBe(200);
    const recorded = ((stored.result as { games: Array<Record<string, unknown>> }).games).find((g) => g.gameNumber === 3)!;
    expect(recorded).toMatchObject({ playerScore: 33, fritzScore: 62, playerWon: false });
    expect(activityMock.mock.calls[0]?.[0]).toMatchObject({ playerWon: false, playerScore: 33, fritzScore: 62 });
  });

  it('a score-only claim (no transcript) never reaches the feed, whatever it claims', async () => {
    useAttempt(receiptAttempt());
    for (const [p, f] of [[150, 0], [0, 150], [61, 60]] as const) {
      await makeHarness()('/api/daily-fritz/record-game', { attempt_id: ATTEMPT_ID, verified_match_id: VERIFIED_MATCH_ID, run_date: RUN_DATE, game_number: 3, moves_used: 90, hands_played: 6, player_score: p, fritz_score: f });
    }
    expect(activityMock).not.toHaveBeenCalled();
  });
});
