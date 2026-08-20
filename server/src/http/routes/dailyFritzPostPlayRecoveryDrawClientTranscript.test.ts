/**
 * Regression: aunt G2H6 (attempt e1f0a2f2-ce10-4c65-aab5-c71dc02b1be7,
 * run_date 2026-08-20) logged a post-play recovery `draw` after `play 1|5`
 * whose applyMove had already embedded boneyard tiles 2|2 and 1|6.
 *
 * Against main (no strip / no distinct code): raw transcript → illegal_action.
 * After the fix: client strip yields a 15-action transcript that verifies;
 * raw still fails, but with post_play_recovery_draw.
 */
import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import { stripPostPlayRecoveryTranscriptActions } from '../../../../client/src/dailyFritz/dailyFritzPostPlayRecovery.ts';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from '../../dailyFritzVerifier';

/** Official deal: published challenge daily-fritz:2026-08-20:r2:s1, game 2 hand 6. */
const AUNT_G2H6_DEAL = {
  locked: [
    { low: 2, high: 3 },
    { low: 4, high: 5 },
  ],
  boneyard: [
    { low: 2, high: 2 },
    { low: 1, high: 6 },
    { low: 0, high: 3 },
    { low: 3, high: 5 },
    { low: 6, high: 6 },
    { low: 5, high: 5 },
    { low: 0, high: 5 },
    { low: 4, high: 4 },
    { low: 3, high: 4 },
    { low: 0, high: 1 },
    { low: 3, high: 3 },
    { low: 0, high: 4 },
    { low: 2, high: 3 },
    { low: 4, high: 5 },
  ],
  fritz_tiles: [
    { low: 1, high: 2 },
    { low: 1, high: 3 },
    { low: 0, high: 2 },
    { low: 2, high: 4 },
    { low: 4, high: 6 },
    { low: 5, high: 6 },
    { low: 1, high: 4 },
  ],
  player_tiles: [
    { low: 2, high: 5 },
    { low: 2, high: 6 },
    { low: 0, high: 6 },
    { low: 1, high: 5 },
    { low: 3, high: 6 },
    { low: 1, high: 1 },
    { low: 0, high: 0 },
  ],
} as const;

/**
 * Reconstructed from checkpoint moveLog for handNumber 7 (G2 handIndex 6).
 * Sequence 7 is the illegal post-play recovery draw.
 */
const AUNT_G2H6_ACTIONS_WITH_RECOVERY_DRAW: DailyFritzTranscriptAction[] = [
  { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 4, high: 6 }, position: 'left', preStateDigest: 'df-state-v1:c2c2df2f' },
  { sequence: 1, actor: 'fritz', kind: 'play', tile: { low: 2, high: 4 }, position: 'left', preStateDigest: 'df-state-v1:619a56ea' },
  { sequence: 2, actor: 'player', kind: 'play', tile: { low: 3, high: 6 }, position: 'right' },
  { sequence: 3, actor: 'player', kind: 'play', tile: { low: 2, high: 5 }, position: 'left' },
  { sequence: 4, actor: 'fritz', kind: 'play', tile: { low: 1, high: 3 }, position: 'right', preStateDigest: 'df-state-v1:3fb90366' },
  { sequence: 5, actor: 'player', kind: 'play', tile: { low: 1, high: 1 }, position: 'right' },
  { sequence: 6, actor: 'player', kind: 'play', tile: { low: 1, high: 5 }, position: 'right' },
  { sequence: 7, actor: 'player', kind: 'draw' },
  { sequence: 8, actor: 'player', kind: 'play', tile: { low: 1, high: 6 }, position: 'branch-0-0' },
  { sequence: 9, actor: 'fritz', kind: 'play', tile: { low: 1, high: 4 }, position: 'branch-0-1', preStateDigest: 'df-state-v1:3f9ee75c' },
  { sequence: 10, actor: 'fritz', kind: 'play', tile: { low: 5, high: 6 }, position: 'left', preStateDigest: 'df-state-v1:42fce2d7' },
  { sequence: 11, actor: 'player', kind: 'play', tile: { low: 0, high: 6 }, position: 'branch-0-0' },
  { sequence: 12, actor: 'player', kind: 'play', tile: { low: 0, high: 0 }, position: 'branch-0-0' },
  { sequence: 13, actor: 'player', kind: 'play', tile: { low: 2, high: 6 }, position: 'left' },
  { sequence: 14, actor: 'fritz', kind: 'play', tile: { low: 1, high: 2 }, position: 'left', preStateDigest: 'df-state-v1:6c523d68' },
  { sequence: 15, actor: 'fritz', kind: 'play', tile: { low: 0, high: 2 }, position: 'branch-0-0', preStateDigest: 'df-state-v1:4887aadb' },
];

const CHALLENGE_ID = 'daily-fritz:2026-08-20:r2:s1';
const ATTEMPT_ID = 'e1f0a2f2-ce10-4c65-aab5-c71dc02b1be7';

function envelope(actions: DailyFritzTranscriptAction[]) {
  return {
    protocolVersion: 2 as const,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: 2 as const,
    fritzPolicyContract: getFritzPolicyContract(2),
    stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    clientRelease: 'test-client',
    challengeId: CHALLENGE_ID,
    attemptId: ATTEMPT_ID,
    gameNumber: 2 as const,
    handIndex: 6,
    actions,
  };
}

function initialState() {
  return createOfficialDailyFritzHandState({
    deal: AUNT_G2H6_DEAL,
    handIndex: 6,
    drawWinner: 'bot',
    winningScore: 60,
    dealSize: 7,
    // Scores after verified G2H5 receipt.
    playerScore: 38,
    fritzScore: 43,
  });
}

function verify(actions: DailyFritzTranscriptAction[]) {
  // Aunt's checkpoint digests were captured on the polluted (post-draw) timeline;
  // strip them so this fixture asserts action legality / strip behavior, not
  // digest regeneration. Production clients that never emit the recovery draw
  // keep digests aligned with authority.
  const withoutPollutedDigests = actions.map((action) => {
    if (action.kind !== 'play' || action.actor !== 'fritz') return action;
    const { preStateDigest: _drop, ...rest } = action;
    return rest;
  });
  return verifyDailyFritzHand({
    transcript: envelope(withoutPollutedDigests),
    initialState: initialState(),
    expectedChallengeId: CHALLENGE_ID,
    expectedAttemptId: ATTEMPT_ID,
    expectedGameNumber: 2,
    expectedHandIndex: 6,
    userId: 'a7442fca-73b1-42a0-8507-1071c06505c4',
    fritzTier: 'elite',
  });
}

describe('Daily Fritz aunt G2H6 post-play recovery draw', () => {
  it('raw fixture fails with post_play_recovery_draw (not generic illegal_action)', () => {
    expect(AUNT_G2H6_ACTIONS_WITH_RECOVERY_DRAW).toHaveLength(16);
    expect(AUNT_G2H6_ACTIONS_WITH_RECOVERY_DRAW[7]).toEqual({
      sequence: 7,
      actor: 'player',
      kind: 'draw',
    });

    try {
      verify(AUNT_G2H6_ACTIONS_WITH_RECOVERY_DRAW);
      expect.fail('expected verification to reject the recovery draw');
    } catch (error) {
      expect(error).toBeInstanceOf(DailyFritzVerificationError);
      expect((error as DailyFritzVerificationError).code).toBe('post_play_recovery_draw');
      expect((error as DailyFritzVerificationError).message).toMatch(/action 7.*draw/i);
    }
  });

  it('client strip removes the recovery draw and the hand verifies (15 actions)', () => {
    const stripped = stripPostPlayRecoveryTranscriptActions(AUNT_G2H6_ACTIONS_WITH_RECOVERY_DRAW);
    expect(stripped).toHaveLength(15);
    expect(stripped.some((action) => action.kind === 'draw')).toBe(false);
    expect(stripped[6]).toMatchObject({
      sequence: 6,
      actor: 'player',
      kind: 'play',
      tile: { low: 1, high: 5 },
    });
    expect(stripped[7]).toMatchObject({
      sequence: 7,
      actor: 'player',
      kind: 'play',
      tile: { low: 1, high: 6 },
    });

    const result = verify(stripped);
    expect(result.result.winner).toBe('player');
    expect(result.result.reason).toBe('domino');
    expect(result.result.playerScoreAfter).toBe(47);
    expect(result.result.fritzScoreAfter).toBe(52);
  });
});
