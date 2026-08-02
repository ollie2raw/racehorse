import { describe, expect, it } from 'vitest';
import { FRITZ_POLICY_VERSION } from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand, getDailyFritzDrawWinner } from '../dailyFritz';
import { verifyDailyFritzHand, createOfficialDailyFritzHandState } from '../dailyFritzVerifier';
import { buildDailyFritzChallengeId } from '../dailyFritzIdentity';
import { buildHonestDailyFritzHandTranscript } from './dailyFritzTranscriptDriver';

describe('Daily Fritz protocol driver', () => {
  it('produces evidence accepted by the real verifier with state digests required', () => {
    const runDate = '2026-08-01';
    const deal = generateSingleDailyFritzGameHand(runDate, 1, 0, 7);
    const drawWinner = getDailyFritzDrawWinner(runDate, 1);
    const input = {
      challengeId: buildDailyFritzChallengeId(runDate),
      attemptId: '00000000-0000-4000-8000-000000000001',
      gameNumber: 1 as const,
      handIndex: 0,
      deal,
      drawWinner,
      winningScore: 60,
      dealSize: 7 as const,
      playerScore: 0,
      fritzScore: 0,
      fritzTier: 'elite' as const,
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
    };
    const driven = buildHonestDailyFritzHandTranscript(input);
    const verified = verifyDailyFritzHand({
      transcript: driven.transcript,
      initialState: createOfficialDailyFritzHandState(input),
      expectedChallengeId: input.challengeId,
      expectedAttemptId: input.attemptId,
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: 'user-1',
      fritzTier: input.fritzTier,
      expectedFritzPolicyVersion: input.fritzPolicyVersion,
      expectedFritzPolicyContract: driven.transcript.fritzPolicyContract,
      requireStateDigests: true,
    });
    expect(verified.terminalState.handOver).toBe(true);
    expect(verified.result.actionCount).toBe(driven.transcript.actions.length);
  });
});
