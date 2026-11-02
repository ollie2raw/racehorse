import { createHash } from 'crypto';
import { DAILY_FRITZ_VERIFIER_VERSION, FRITZ_POLICY_VERSION } from '@racehorse/game-core';
import { getDailyFritzSeed, resolveDailyFritzDrawWinner, type DailyFritzSetGameNumber } from './dailyFritz';
import { buildDailyFritzChallengeId } from './dailyFritzIdentity';
import type { StoredDailyFritzHandRecord } from './dailyFritzHandRecords';
import { attemptVerifyHand, writeVerifiedGame, writeVerifiedHand } from './http/routes/dailyFritzVerificationGlue';
import { getDailyFritzHandForGame, type DailyFritzAttemptRecord, type DailyFritzRunRecord } from './http/stores/dailyFritzStore';
import { buildHonestDailyFritzHandTranscript } from './testing/dailyFritzTranscriptDriver';

/**
 * Test support: a whole Daily Fritz game played and verified the way the routes do it (each hand through `attemptVerifyHand`, the ledger growing hand by hand,
 * then the verified game), with the transcripts kept as stored hand rows. Tests that import this must mock '@sentry/node' and the Daily Fritz event store, as
 * the other tests that call `attemptVerifyHand` do. Not imported by any production file.
 */

export const RUN_DATE = '2026-08-01';
export const CHALLENGE_ID = buildDailyFritzChallengeId(RUN_DATE);
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';

export const run: DailyFritzRunRecord = {
  runDate: RUN_DATE,
  seed: getDailyFritzSeed(RUN_DATE),
  fritzTier: 'elite',
  dealSize: 7,
  winningScore: 60,
  status: 'live',
  handDeals: [],
  generatedAt: '2026-08-01T00:00:00.000Z',
  invalidatedAt: null,
  metadata: { draw_winners_by_game: { 1: 'you', 2: 'bot', 3: 'you' } },
};

export function makeAttempt(result: Record<string, unknown>): DailyFritzAttemptRecord {
  return {
    id: ATTEMPT_ID,
    userId: USER_ID,
    runDate: RUN_DATE,
    status: 'completed',
    revision: 1,
    currentGameNumber: 1,
    currentHandIndex: 0,
    verifiedMatchId: 'verified-match-saved-game',
    challengeId: CHALLENGE_ID,
    challengeContractVersion: 1,
    generationVersion: 1,
    gameRulesVersion: 1,
    transcriptProtocolVersion: 2,
    fritzPolicyVersion: 2,
    rankingVersion: 1,
    authoritySchemaVersion: 1,
    result,
    startedAt: '2026-08-01T00:00:00.000Z',
    completedAt: '2026-08-01T01:00:00.000Z',
    completionHash: null,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
}

export type VerifiedGameFixture = { attempt: DailyFritzAttemptRecord; rows: StoredDailyFritzHandRecord[]; you: number; fritz: number };

export function verifiedGame(
  gameNumber: DailyFritzSetGameNumber,
  playerPolicy: 'first_legal' | 'last_legal',
  base: Record<string, unknown> = { authority: { version: 1, hands: [], games: [] } },
): VerifiedGameFixture {
  let result: Record<string, unknown> = base;
  const rows: StoredDailyFritzHandRecord[] = [];
  let you = 0;
  let fritz = 0;
  const drawWinner = resolveDailyFritzDrawWinner({ runDate: RUN_DATE, gameNumber, metadata: run.metadata });
  for (let handIndex = 0; handIndex < 40; handIndex += 1) {
    const { transcript } = buildHonestDailyFritzHandTranscript({
      challengeId: CHALLENGE_ID, attemptId: ATTEMPT_ID, gameNumber, handIndex,
      deal: getDailyFritzHandForGame(run, gameNumber, handIndex), drawWinner, winningScore: 60, dealSize: 7,
      // the driver types the policy as 1 | 2; the current policy (3) drives and verifies fine, as it does in the other tests
      playerScore: you, fritzScore: fritz, fritzTier: 'elite', fritzPolicyVersion: FRITZ_POLICY_VERSION as 1 | 2, playerPolicy,
    });
    const outcome = attemptVerifyHand({ transcript, attempt: makeAttempt(result), run, userId: USER_ID, gameNumber, handIndex, publishedChallenge: null });
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
    const { verified } = outcome;
    result = writeVerifiedHand(result, verified.result);
    rows.push({ hand_index: handIndex, transcript_digest: verified.result.transcriptDigest, transcript: verified.transcript });
    you = verified.result.playerScoreAfter;
    fritz = verified.result.fritzScoreAfter;
    if (Math.max(you, fritz) >= 60 && you !== fritz) break;
  }
  const hands = (result.authority as { hands: Array<{ gameNumber: number; transcriptDigest: string }> }).hands.filter((h) => h.gameNumber === gameNumber);
  const handDigests = hands.map((h) => h.transcriptDigest);
  result = writeVerifiedGame(result, {
    verificationVersion: DAILY_FRITZ_VERIFIER_VERSION,
    gameNumber,
    playerScore: you,
    fritzScore: fritz,
    handDigests,
    resultDigest: createHash('sha256').update(`${ATTEMPT_ID}:${gameNumber}:${you}:${fritz}:${handDigests.join(':')}`).digest('hex'),
  });
  return { attempt: makeAttempt(result), rows, you, fritz };
}
