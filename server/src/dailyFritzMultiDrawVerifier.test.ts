import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getOfficialFritzDecisionSeed,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import { createOfficialDailyFritzHandState, verifyDailyFritzHand } from './dailyFritzVerifier';

describe('Daily Fritz multi-draw transcript verification', () => {
  it('accepts one draw action per tile and rejects collapsed multi-draws', () => {
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
      random: createDeterministicRandom(getOfficialFritzDecisionSeed(cur)),
    })).toEqual({ kind: 'draw' });
    cur = applyGameCommand(cur, {
      version: 1, commandId: 'd1', sequence: cur.sequence, actorId: 'fritz', kind: 'draw',
    }).state;
    expect(chooseOfficialFritzDecision({
      state: cur,
      participantId: 'fritz',
      tier: 'elite',
      random: createDeterministicRandom(getOfficialFritzDecisionSeed(cur)),
    })).toEqual({ kind: 'draw' });
    cur = applyGameCommand(cur, {
      version: 1, commandId: 'd2', sequence: cur.sequence, actorId: 'fritz', kind: 'draw',
    }).state;
    const play = chooseOfficialFritzDecision({
      state: cur,
      participantId: 'fritz',
      tier: 'elite',
      random: createDeterministicRandom(getOfficialFritzDecisionSeed(cur)),
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
    ])).toThrow(/Fritz action does not match the official policy/);
  });
});
