import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRITZ_POLICY_VERSION } from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand, getDailyFritzDrawWinner, getDailyFritzSeed } from '../../dailyFritz';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import { buildHonestDailyFritzHandTranscript } from '../../testing/dailyFritzTranscriptDriver';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from '../stores/dailyFritzStore';
import { attemptVerifyHand } from './dailyFritzVerificationGlue';
import { saveVerifiedDailyFritzHandRecord } from '../../dailyFritzHandRecords';

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));
vi.mock('../stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined),
  countRecentDailyFritzVerificationFailures: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../dailyFritzHandRecords', () => ({ saveVerifiedDailyFritzHandRecord: vi.fn() }));

/**
 * DF-2 hook: every route verifies through `attemptVerifyHand`, so that is the one place a verified hand's transcript is handed to the review's store. It must
 * fire exactly once per verified hand, never for a hand that did not verify, and nothing it does may change what verification returns.
 */
const RUN_DATE = '2026-08-01';
const CHALLENGE_ID = buildDailyFritzChallengeId(RUN_DATE);
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';

const run: DailyFritzRunRecord = {
  runDate: RUN_DATE,
  seed: getDailyFritzSeed(RUN_DATE),
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  status: 'live',
  handDeals: [],
  metadata: { draw_winners_by_game: { 1: 'you' } },
};

const attempt: DailyFritzAttemptRecord = {
  id: ATTEMPT_ID,
  userId: USER_ID,
  runDate: RUN_DATE,
  status: 'started',
  revision: 1,
  currentGameNumber: 1,
  currentHandIndex: 0,
  verifiedMatchId: 'verified-match-hook',
  challengeId: CHALLENGE_ID,
  challengeContractVersion: 1,
  generationVersion: 1,
  gameRulesVersion: 1,
  transcriptProtocolVersion: 2,
  fritzPolicyVersion: 2,
  rankingVersion: 1,
  authoritySchemaVersion: 1,
  result: { authority: { version: 1, hands: [], games: [] } },
  startedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function firstHand() {
  const deal = generateSingleDailyFritzGameHand(RUN_DATE, 1, 0, 7);
  const { transcript } = buildHonestDailyFritzHandTranscript({
    challengeId: CHALLENGE_ID, attemptId: ATTEMPT_ID, gameNumber: 1, handIndex: 0, deal,
    drawWinner: getDailyFritzDrawWinner(RUN_DATE, 1), winningScore: 60, dealSize: 7, playerScore: 0, fritzScore: 0,
    fritzTier: 'elite', fritzPolicyVersion: FRITZ_POLICY_VERSION,
  });
  return { deal, transcript };
}

const verify = (transcript: unknown, deal: ReturnType<typeof firstHand>['deal']) =>
  attemptVerifyHand({ transcript, attempt, run: { ...run, handDeals: [deal] }, userId: USER_ID, gameNumber: 1, handIndex: 0, publishedChallenge: null });

describe('attemptVerifyHand hands a verified hand to the review store', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls it exactly once with the verified transcript and receipt when the hand verifies', () => {
    const { deal, transcript } = firstHand();
    const outcome = verify(transcript, deal);
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
    expect(saveVerifiedDailyFritzHandRecord).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveVerifiedDailyFritzHandRecord).mock.calls[0]![0]).toBe(outcome.verified);
  });

  it('does not call it for a hand that fails verification', () => {
    const { deal, transcript } = firstHand();
    const outcome = verify({ ...transcript, actions: transcript.actions.slice(0, 2) }, deal);
    expect(outcome.ok).toBe(false);
    expect(saveVerifiedDailyFritzHandRecord).not.toHaveBeenCalled();
  });

  it('returns the same verification whether the save works, throws, or is absent', () => {
    const { deal, transcript } = firstHand();
    const normal = verify(transcript, deal);
    vi.mocked(saveVerifiedDailyFritzHandRecord).mockImplementationOnce(() => {
      throw new Error('store exploded');
    });
    const withThrowingSave = verify(transcript, deal);
    expect(normal.ok && withThrowingSave.ok).toBe(true);
    if (!normal.ok || !withThrowingSave.ok) return;
    // everything but the wall-clock `verifiedAt`, which differs between any two calls
    const stable = (r: typeof normal.verified.result) => JSON.stringify({ ...r, verifiedAt: null });
    expect(stable(withThrowingSave.verified.result)).toBe(stable(normal.verified.result));
  });
});
