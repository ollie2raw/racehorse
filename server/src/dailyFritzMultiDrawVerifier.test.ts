import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import { createOfficialDailyFritzHandState, DailyFritzVerificationError, verifyDailyFritzHand } from './dailyFritzVerifier';

describe('Daily Fritz multi-draw transcript verification', () => {
  it('accepts explicit draws and safely reconstructs omitted mandatory draws', () => {
    const start = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 1, high: 3 }],
        fritz_tiles: [{ low: 1, high: 2 }],
        boneyard: [
          { low: 0, high: 4 },
          { low: 6, high: 6 },
          { low: 0, high: 0 },
          { low: 0, high: 5 },
        ],
        locked: [{ low: 0, high: 0 }, { low: 0, high: 5 }],
      },
      handIndex: 0,
      drawWinner: 'bot',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    let cur = start;
    expect(chooseOfficialFritzDecision({
      state: cur,
      participantId: 'fritz',
      tier: 'elite',
    })).toEqual({ kind: 'draw' });
    cur = applyGameCommand(cur, {
      version: 1, commandId: 'd1', sequence: cur.sequence, actorId: 'fritz', kind: 'draw',
    }).state;
    expect(chooseOfficialFritzDecision({
      state: cur,
      participantId: 'fritz',
      tier: 'elite',
    })).toEqual({ kind: 'draw' });
    cur = applyGameCommand(cur, {
      version: 1, commandId: 'd2', sequence: cur.sequence, actorId: 'fritz', kind: 'draw',
    }).state;
    const play = chooseOfficialFritzDecision({
      state: cur,
      participantId: 'fritz',
      tier: 'elite',
    });
    expect(play.kind).toBe('play');
    if (play.kind !== 'play') throw new Error('expected play');

    const envelope = (actions: DailyFritzTranscriptAction[]) => ({
      protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      rulesVersion: GAME_RULES_VERSION,
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
      challengeId: 'c',
      attemptId: 'a',
      gameNumber: 1 as const,
      handIndex: 0,
      actions,
    });

    const verify = (actions: DailyFritzTranscriptAction[]) => verifyDailyFritzHand({
      transcript: envelope(actions),
      initialState: start,
      expectedChallengeId: 'c',
      expectedAttemptId: 'a',
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: 'u',
      fritzTier: 'elite',
    });

    // Honest expanded multi-draw is accepted through the Fritz play (hand incomplete is fine here —
    // we only assert the policy check does not reject the draws).
    expect(() => verify([
      { sequence: 0, actor: 'fritz', kind: 'draw' },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
      { sequence: 2, actor: 'fritz', kind: 'play', tile: play.tile, position: play.position },
    ])).toThrow(/does not complete the hand/i);

    expect(() => verify([
      { sequence: 0, actor: 'fritz', kind: 'draw' },
      { sequence: 1, actor: 'fritz', kind: 'play', tile: play.tile, position: play.position },
    ])).toThrow(/does not complete the hand/i);
  });

  it('accepts a post-score follow-up play without separate forced-draw transcript actions', () => {
    const start = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 0, high: 0 }],
        fritz_tiles: [{ low: 1, high: 6 }],
        boneyard: [
          { low: 2, high: 3 },
          { low: 3, high: 5 },
          { low: 4, high: 4 },
          { low: 0, high: 2 },
          { low: 0, high: 5 },
        ],
        locked: [{ low: 0, high: 2 }, { low: 0, high: 5 }],
      },
      handIndex: 0,
      drawWinner: 'bot',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    let open = {
      ...start,
      board: {
        mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' as const }],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      handOpen: true,
      sequence: 0,
      currentPlayerIndex: 1,
    };

    const scorePlay = chooseOfficialFritzDecision({
      state: open,
      participantId: 'fritz',
      tier: 'elite',
    });
    expect(scorePlay).toEqual({
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    });

    open = applyGameCommand(open, {
      version: 1,
      commandId: 'score',
      sequence: open.sequence,
      actorId: 'fritz',
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    }).state;

    // Full forced-draw chain is resolved inside the play command.
    const followUp = chooseOfficialFritzDecision({
      state: open,
      participantId: 'fritz',
      tier: 'elite',
    });
    expect(followUp.kind).toBe('play');
  });

  it('skips obsolete post-score draw actions from older client transcripts', () => {
    const start = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 0, high: 0 }],
        fritz_tiles: [{ low: 1, high: 6 }],
        boneyard: [
          { low: 2, high: 3 },
          { low: 3, high: 5 },
          { low: 4, high: 4 },
          { low: 0, high: 2 },
          { low: 0, high: 5 },
        ],
        locked: [{ low: 0, high: 2 }, { low: 0, high: 5 }],
      },
      handIndex: 0,
      drawWinner: 'bot',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    const open = {
      ...start,
      board: {
        mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' as const }],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      handOpen: true,
      sequence: 0,
      currentPlayerIndex: 1,
    };

    const afterScore = applyGameCommand(open, {
      version: 1,
      commandId: 'score',
      sequence: open.sequence,
      actorId: 'fritz',
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    }).state;

    const followUp = chooseOfficialFritzDecision({
      state: afterScore,
      participantId: 'fritz',
      tier: 'elite',
    });
    expect(followUp.kind).toBe('play');
    if (followUp.kind !== 'play') throw new Error('expected follow-up play');

    const envelope = (actions: DailyFritzTranscriptAction[], protocolVersion: 1 | 2 = 1) => ({
      protocolVersion,
      rulesVersion: GAME_RULES_VERSION,
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
      challengeId: 'c',
      attemptId: 'a',
      gameNumber: 1 as const,
      handIndex: 0,
      actions,
    });

    // Legacy shape (protocol 1): play then client-logged recovery draws, then follow-up play.
    // Without the skip, replay throws "Draw is not legal".
    expect(() => verifyDailyFritzHand({
      transcript: envelope([
        { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
        { sequence: 1, actor: 'fritz', kind: 'draw' },
        { sequence: 2, actor: 'fritz', kind: 'draw' },
        { sequence: 3, actor: 'fritz', kind: 'play', tile: followUp.tile, position: followUp.position },
      ], 1),
      initialState: open,
      expectedChallengeId: 'c',
      expectedAttemptId: 'a',
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: 'u',
      fritzTier: 'elite',
    })).toThrow(/does not complete the hand/i);

    // Protocol 2 must not silently skip obsolete recovery draws — reject with a
    // distinct code so incidents are distinguishable from other illegal_action.
    try {
      verifyDailyFritzHand({
        transcript: envelope([
          { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
          { sequence: 1, actor: 'fritz', kind: 'draw' },
        ], 2),
        initialState: open,
        expectedChallengeId: 'c',
        expectedAttemptId: 'a',
        expectedGameNumber: 1,
        expectedHandIndex: 0,
        userId: 'u',
        fritzTier: 'elite',
      });
      expect.fail('expected post_play_recovery_draw');
    } catch (error) {
      expect(error).toBeInstanceOf(DailyFritzVerificationError);
      expect((error as DailyFritzVerificationError).code).toBe('post_play_recovery_draw');
    }
  });

  it('skips obsolete post-score draw+pass after absorbed auto-pass advances the turn', () => {
    const start = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 0, high: 0 }],
        fritz_tiles: [{ low: 1, high: 6 }],
        boneyard: [
          { low: 2, high: 3 },
          { low: 0, high: 2 },
          { low: 0, high: 5 },
        ],
        locked: [{ low: 0, high: 2 }, { low: 0, high: 5 }],
      },
      handIndex: 0,
      drawWinner: 'bot',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    const open = {
      ...start,
      board: {
        mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' as const }],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      handOpen: true,
      sequence: 0,
      currentPlayerIndex: 1,
    };

    const afterScore = applyGameCommand(open, {
      version: 1,
      commandId: 'score',
      sequence: open.sequence,
      actorId: 'fritz',
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    }).state;
    // Forced recovery drew the only drawable tile then auto-passed — turn is player's.
    expect(afterScore.playerIds[afterScore.currentPlayerIndex]).toBe('player');

    const envelope = (actions: DailyFritzTranscriptAction[]) => ({
      protocolVersion: 1 as const,
      rulesVersion: GAME_RULES_VERSION,
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
      challengeId: 'c',
      attemptId: 'a',
      gameNumber: 1 as const,
      handIndex: 0,
      actions,
    });

    // Legacy leftovers after absorbed auto-pass must not fail verification.
    expect(() => verifyDailyFritzHand({
      transcript: envelope([
        { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
        { sequence: 1, actor: 'fritz', kind: 'draw' },
        { sequence: 2, actor: 'fritz', kind: 'pass' },
        { sequence: 3, actor: 'player', kind: 'pass' },
      ]),
      initialState: open,
      expectedChallengeId: 'c',
      expectedAttemptId: 'a',
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: 'u',
      fritzTier: 'elite',
    })).not.toThrow();
  });
});
