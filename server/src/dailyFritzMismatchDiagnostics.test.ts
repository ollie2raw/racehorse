/**
 * When a hand fails verification with a state-divergence code, the only thing
 * we currently learn is the label ("fritz_state_mismatch") and two opaque
 * 8-hex digests. That is enough to know something diverged and nothing about
 * WHAT diverged, which is exactly why the 2026-08 incidents needed transcript
 * reconstruction by hand.
 *
 * The client submits only a digest, never its full state, so a true two-sided
 * field diff is not available without a wire-format change. What IS available
 * is the server's canonical digest pre-image — the exact structure the digest
 * is computed over. Capturing it at the moment of mismatch means the next
 * occurrence can be diffed against a client-side recomputation instead of
 * being reverse-engineered.
 */
import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  FRITZ_POLICY_VERSION,
  getDailyFritzAuthorityStateDigest,
  getFritzPolicyContract,
} from '@racehorse/game-core';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from './dailyFritzVerifier';

const CHALLENGE_ID = 'challenge-1';
const ATTEMPT_ID = 'attempt-1';

function officialState() {
  return createOfficialDailyFritzHandState({
    deal: {
      player_tiles: [{ low: 4, high: 4 }, { low: 1, high: 2 }],
      fritz_tiles: [{ low: 0, high: 5 }, { low: 6, high: 6 }],
      boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }],
      locked: [],
    } as never,
    handIndex: 0,
    drawWinner: 'fritz',
    winningScore: 60,
    dealSize: 7,
    playerScore: 0,
    fritzScore: 0,
  });
}

function transcriptWithDigest(preStateDigest: string) {
  return {
    protocolVersion: 2 as const,
    rulesVersion: 1 as never,
    challengeId: CHALLENGE_ID,
    attemptId: ATTEMPT_ID,
    gameNumber: 1 as const,
    handIndex: 0,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    actions: [{
      sequence: 0,
      actor: 'fritz' as const,
      kind: 'play' as const,
      tile: { low: 0, high: 5 },
      position: 'left' as const,
      preStateDigest,
    }],
  };
}

function verifyWithDigest(preStateDigest: string) {
  const initial = officialState();
  return verifyDailyFritzHand({
    transcript: transcriptWithDigest(preStateDigest) as never,
    initialState: initial,
    expectedChallengeId: CHALLENGE_ID,
    expectedAttemptId: ATTEMPT_ID,
    expectedGameNumber: 1,
    expectedHandIndex: 0,
    userId: 'user-1',
    fritzTier: 'bot',
    requireStateDigests: true,
  } as never);
}

describe('fritz_state_mismatch diagnostics', () => {
  it('carries the server canonical state and both digests on the error', () => {
    const clientDigest = 'df-state-v1:00000000';
    let caught: DailyFritzVerificationError | null = null;
    try {
      verifyWithDigest(clientDigest);
    } catch (error) {
      caught = error as DailyFritzVerificationError;
    }

    expect(caught).toBeInstanceOf(DailyFritzVerificationError);
    expect(caught?.code).toBe('fritz_state_mismatch');

    const diagnostics = caught?.diagnostics;
    expect(diagnostics).toBeTruthy();
    expect(diagnostics?.clientStateDigest).toBe(clientDigest);
    // The server digest must be the real one, so a future report can be
    // matched against a client-side recomputation.
    expect(diagnostics?.serverStateDigest).toBe(
      getDailyFritzAuthorityStateDigest(officialState()),
    );
    expect(diagnostics?.actionSequence).toBe(0);
    expect(diagnostics?.actor).toBe('fritz');

    // The whole point: the fields the digest is computed over, not just a hash.
    const serverState = diagnostics?.serverState as Record<string, unknown>;
    expect(serverState).toBeTruthy();
    expect(serverState.board).toBeDefined();
    expect(serverState.boneyard).toBeDefined();
    expect(serverState.handNumber).toBeDefined();
    expect(serverState.sequence).toBeDefined();
    expect(Array.isArray(serverState.players)).toBe(true);
    // Per-side tile counts are the first thing to check on a divergence.
    const players = serverState.players as Array<{ hand: string[]; score: number }>;
    expect(players.length).toBe(2);
    expect(Array.isArray(players[0].hand)).toBe(true);
  });

  it('does not attach diagnostics to an unrelated failure code', () => {
    let caught: DailyFritzVerificationError | null = null;
    try {
      verifyDailyFritzHand({
        transcript: {
          ...transcriptWithDigest('df-state-v1:00000000'),
          challengeId: 'other-challenge',
        } as never,
        initialState: officialState(),
        expectedChallengeId: CHALLENGE_ID,
        expectedAttemptId: ATTEMPT_ID,
        expectedGameNumber: 1,
        expectedHandIndex: 0,
        userId: 'user-1',
        fritzTier: 'bot',
        requireStateDigests: true,
      } as never);
    } catch (error) {
      caught = error as DailyFritzVerificationError;
    }
    expect(caught?.code).toBe('challenge_mismatch');
    expect(caught?.diagnostics).toBeUndefined();
  });
});
