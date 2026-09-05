// Regression coverage for the 2026-09-05 Daily Fritz outage: a challenge published a day
// ahead (during pre-generation) went stale the moment FRITZ_POLICY_VERSION was bumped by an
// unrelated same-day deploy before the run date rolled over. Every /start call recomputed the
// challenge package under the *new* live constant and called publish_daily_fritz_challenge,
// whose identity-conflict guard treats any digest mismatch (even a version-stamp-only one) as
// fatal — 500ing every caller. See HARDENING_PLAN.md's incident record for the full story.
//
// The fix: /start now fetches the already-published challenge for the day first and reuses it
// as-is when present, instead of re-deriving and re-verifying it against whatever constants are
// currently live. This asserts that behavior directly: publishDailyFritzChallenge must not be
// called, and the transactional start command must be issued against the *existing* challenge's
// identity, when a live published challenge already exists for the day.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
} from '@racehorse/game-core';
import { getDailyFritzSeed } from '../../dailyFritz';
import {
  buildDailyFritzPublishedChallenge,
  digestDailyFritzChallengeContent,
  getDailyFritzPublishedChallengeContent,
} from '../../dailyFritzPublishedChallenge';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import type { DailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';

const {
  authUserMock,
  getAttemptMock,
  getAttemptByIdMock,
  upsertAttemptMock,
  getRunMock,
  getPublishedChallengeMock,
  publishChallengeMock,
  startCommandMock,
  startVerifiedMatchMock,
} = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  upsertAttemptMock: vi.fn(),
  getRunMock: vi.fn(),
  getPublishedChallengeMock: vi.fn(),
  publishChallengeMock: vi.fn(),
  startCommandMock: vi.fn(),
  startVerifiedMatchMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
}));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>(
    '../stores/dailyFritzStore',
  );
  return {
    ...actual,
    getDailyFritzAttempt: getAttemptMock,
    getDailyFritzAttemptById: getAttemptByIdMock,
    upsertDailyFritzAttempt: upsertAttemptMock,
    ensureDailyFritzRunForDate: getRunMock,
  };
});

vi.mock('../stores/dailyFritzPublishedChallengeStore', () => ({
  getDailyFritzPublishedChallenge: getPublishedChallengeMock,
  publishDailyFritzChallenge: publishChallengeMock,
}));

vi.mock('../stores/dailyFritzCommandStore', () => ({
  startDailyFritzAttemptCommand: startCommandMock,
}));

vi.mock('../../shared/verifiedSinglePlayerMatch', () => ({
  startVerifiedSinglePlayerMatch: startVerifiedMatchMock,
}));

vi.mock('./dailyFritzVerificationGlue', async () => {
  const actual = await vi.importActual<typeof import('./dailyFritzVerificationGlue')>(
    './dailyFritzVerificationGlue',
  );
  return {
    ...actual,
    DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED: true,
    recordDailyFritzEventBestEffort: vi.fn().mockResolvedValue(undefined),
  };
});

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);

  return async function request(
    method: 'GET' | 'POST',
    path: string,
    input: { body?: Record<string, unknown> } = {},
  ) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value; return res; },
      setHeader() { return res; },
      once() { return res; },
    };
    await handler({
      headers: {},
      params: {},
      query: {},
      body: input.body ?? {},
      method,
      path,
      get() { return undefined; },
    }, res);
    return { status, body: body as Record<string, unknown> };
  };
}

const RUN_DATE = '2026-09-05';
const USER_ID = 'user-1';
const ATTEMPT_ID = 'attempt-1';

// buildDailyFritzPublishedChallenge derives hands purely from runDate/gameNumber/dealSize —
// version-independent (that's the whole point of the fix) — so game 1's hands here always
// match what the route's own sanity check (publishedChallenge vs. run.handDeals) expects,
// regardless of which policy version is live.
const REFERENCE_CHALLENGE = buildDailyFritzPublishedChallenge({
  runDate: RUN_DATE,
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  publishedAt: '2026-09-04T07:02:01.363Z',
});

function baseRun(): DailyFritzRunRecord {
  return {
    runDate: RUN_DATE,
    seed: getDailyFritzSeed(RUN_DATE),
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    status: 'live',
    handDeals: REFERENCE_CHALLENGE.games[0].hands,
    generatedAt: '2026-09-04T07:02:01.363Z',
    invalidatedAt: null,
    metadata: {},
  };
}

/** A published challenge stamped with a real, still-supported *prior* policy version/contract
 * — simulating yesterday's day-ahead pre-generation, published before today's (unrelated)
 * FRITZ_POLICY_VERSION bump moved the live constant forward. Content is otherwise fully
 * self-consistent (the digest genuinely matches the package, and the version/contract pair is
 * internally valid), exactly like a real pre-bump row would be — not a malformed fixture. */
function stalePolicyPublishedChallenge(): DailyFritzPublishedChallenge {
  const current = REFERENCE_CHALLENGE;
  const stalePolicyVersion = current.fritzPolicyVersion - 1;
  if (!isSupportedFritzPolicyVersion(stalePolicyVersion)) {
    throw new Error('Test fixture assumes at least two supported Fritz policy versions exist.');
  }
  const stale: DailyFritzPublishedChallenge = {
    ...current,
    fritzPolicyVersion: stalePolicyVersion,
    fritzPolicyContract: getFritzPolicyContract(stalePolicyVersion),
  };
  const content = getDailyFritzPublishedChallengeContent(stale);
  return { ...stale, contentDigest: digestDailyFritzChallengeContent(content) };
}

function attemptPinnedTo(challenge: DailyFritzPublishedChallenge): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    runDate: RUN_DATE,
    userId: USER_ID,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 1,
    revision: 1,
    challengeId: challenge.challengeId,
    challengeContractVersion: challenge.contractVersion,
    generationVersion: challenge.generationVersion,
    gameRulesVersion: challenge.gameRulesVersion,
    transcriptProtocolVersion: challenge.transcriptProtocolVersion,
    fritzPolicyVersion: challenge.fritzPolicyVersion,
    rankingVersion: challenge.rankingVersion,
    authoritySchemaVersion: 1,
    startedAt: '2026-09-05T07:04:00.000Z',
    completedAt: null,
    verifiedMatchId: 'verified-match-1',
    completionHash: null,
    result: {
      authority_contract: {
        transcriptProtocolVersion: challenge.transcriptProtocolVersion,
        gameRulesVersion: challenge.gameRulesVersion,
        fritzPolicyVersion: challenge.fritzPolicyVersion,
        fritzPolicyContract: challenge.fritzPolicyContract,
        stateDigestVersion: 1,
        stateDigestRequired: true,
        clientRelease: 'test',
        challengeId: challenge.challengeId,
        runFingerprint: 'fingerprint-1',
      },
      verification_status: 'in_progress',
    },
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
}

// A real, currently-supported client request — matching what an up-to-date client actually
// sends, i.e. the exact situation that broke: a fully valid, current-code client hitting a
// challenge published a day earlier under an older policy stamp.
function startBody() {
  return {
    verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    game_rules_version: GAME_RULES_VERSION,
    fritz_policy_version: FRITZ_POLICY_VERSION,
    fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    supported_transcript_protocol_versions: [DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
    supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
    supported_fritz_policies: [{
      version: FRITZ_POLICY_VERSION,
      contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    }],
  };
}

describe('daily-fritz /start reuses an already-published challenge', () => {
  const request = makeHarness();

  beforeEach(() => {
    vi.clearAllMocks();
    authUserMock.mockResolvedValue(USER_ID);
    getRunMock.mockResolvedValue(baseRun());
    getAttemptMock.mockResolvedValue(null); // no attempt yet — first /start call of the day
    startVerifiedMatchMock.mockResolvedValue({ matchId: 'verified-match-1' });
    upsertAttemptMock.mockImplementation(async (record: DailyFritzAttemptRecord) => record);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the existing published challenge instead of re-publishing under current constants', async () => {
    const existingChallenge = stalePolicyPublishedChallenge();
    getPublishedChallengeMock.mockResolvedValue(existingChallenge);
    const attempt = attemptPinnedTo(existingChallenge);
    startCommandMock.mockResolvedValue({
      outcome: 'committed',
      response: { attempt_id: ATTEMPT_ID, created: true },
      committedRevision: 1,
    });
    getAttemptByIdMock.mockResolvedValue(attempt);

    const result = await request('POST', '/api/daily-fritz/start', { body: startBody() });

    // The core regression: no attempt to re-publish/re-verify against current constants.
    expect(publishChallengeMock).not.toHaveBeenCalled();
    // The transactional command must target the *existing* challenge's identity.
    expect(startCommandMock).toHaveBeenCalledTimes(1);
    expect(startCommandMock.mock.calls[0]?.[0]).toMatchObject({
      challengeId: existingChallenge.challengeId,
      operationId: `start:${existingChallenge.challengeId}`,
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.attempt_id).toBe(ATTEMPT_ID);
  });

  it('still publishes a fresh challenge when none exists yet (first caller of the day)', async () => {
    const fresh = REFERENCE_CHALLENGE;
    // Not yet published when /start's pre-check looks; present afterward (loadDailyFritzPublishedAuthority
    // re-fetches it later in the same handler once publishDailyFritzChallenge has created it).
    getPublishedChallengeMock.mockResolvedValueOnce(null).mockResolvedValue(fresh);
    publishChallengeMock.mockResolvedValue(fresh);
    const attempt = attemptPinnedTo(fresh);
    startCommandMock.mockResolvedValue({
      outcome: 'committed',
      response: { attempt_id: ATTEMPT_ID, created: true },
      committedRevision: 1,
    });
    getAttemptByIdMock.mockResolvedValue(attempt);

    const result = await request('POST', '/api/daily-fritz/start', { body: startBody() });

    expect(publishChallengeMock).toHaveBeenCalledTimes(1);
    expect(startCommandMock.mock.calls[0]?.[0]).toMatchObject({
      challengeId: fresh.challengeId,
    });
    expect(result.status).toBe(200);
  });

  it('rejects with a clear error rather than a confusing identity conflict when the published challenge was invalidated but its run was not', async () => {
    const existingChallenge = {
      ...stalePolicyPublishedChallenge(),
      status: 'invalidated' as const,
    };
    getPublishedChallengeMock.mockResolvedValue(existingChallenge);

    const result = await request('POST', '/api/daily-fritz/start', { body: startBody() });

    expect(publishChallengeMock).not.toHaveBeenCalled();
    expect(startCommandMock).not.toHaveBeenCalled();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('challenge_publication_invalidated');
  });
});
