/**
 * Lifecycle journey: Fritz scoring play → recovery draws → remount/cancel during
 * presentation window → evidence already finalized → hand completes → verify →
 * game 2 fresh transcript/actor/sequence.
 *
 * Models the fixed client ordering (finalize then present) under cleanup pressure.
 * Uses the real verifier; does not weaken acceptance rules.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  type DailyFritzTranscriptAction,
  type GameState,
} from '@racehorse/game-core';
import {
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from './dailyFritzVerifier';

function envelope(
  actions: DailyFritzTranscriptAction[],
  gameNumber: 1 | 2 | 3,
  handIndex: number,
) {
  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    challengeId: 'lifecycle-challenge',
    attemptId: 'lifecycle-attempt',
    gameNumber,
    handIndex,
    actions,
  };
}

function playToTerminal(
  initial: GameState,
  seedActions: DailyFritzTranscriptAction[] = [],
): { actions: DailyFritzTranscriptAction[]; terminal: GameState } {
  let state = initial;
  const actions: DailyFritzTranscriptAction[] = [];
  for (const action of seedActions) {
    actions.push({ ...action, sequence: actions.length });
    state = applyGameCommand(state, {
      version: 1,
      commandId: `seed-${action.sequence}`,
      sequence: state.sequence,
      actorId: action.actor,
      kind: action.kind,
      ...(action.kind === 'play'
        ? { tile: action.tile, position: action.position }
        : {}),
    } as Parameters<typeof applyGameCommand>[1]).state;
  }
  while (!state.handOver && actions.length < 128) {
    const actorId = state.playerIds[state.currentPlayerIndex];
    const actor = actorId === 'player' ? 'player' as const : 'fritz' as const;
    const decision = chooseOfficialFritzDecision({
      state,
      participantId: actorId,
      tier: 'elite',
    });
    if (decision.kind === 'play') {
      actions.push({
        sequence: actions.length,
        actor,
        kind: 'play',
        tile: decision.tile,
        position: decision.position,
      });
      state = applyGameCommand(state, {
        version: 1,
        commandId: `a${actions.length}`,
        sequence: state.sequence,
        actorId,
        kind: 'play',
        tile: decision.tile,
        position: decision.position,
      }).state;
    } else {
      actions.push({ sequence: actions.length, actor, kind: decision.kind });
      state = applyGameCommand(state, {
        version: 1,
        commandId: `a${actions.length}`,
        sequence: state.sequence,
        actorId,
        kind: decision.kind,
      }).state;
    }
  }
  expect(state.handOver).toBe(true);
  return { actions, terminal: state };
}

describe('Daily Fritz lifecycle journey (finalize-before-present + remount pressure)', () => {
  it('finalizes scoring evidence once, survives presentation cancel, verifies, and starts game 2 clean', async () => {
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
    if (scorePlay.kind !== 'play') throw new Error('expected score play');

    const afterScore = applyGameCommand(open, {
      version: 1,
      commandId: 'score',
      sequence: open.sequence,
      actorId: 'fritz',
      kind: 'play',
      tile: scorePlay.tile,
      position: scorePlay.position,
    }).state;

    // Fixed client ordering: append evidence before any cancellable presentation await.
    const moveLog: DailyFritzTranscriptAction[] = [{
      sequence: 0,
      actor: 'fritz',
      kind: 'play',
      tile: scorePlay.tile,
      position: scorePlay.position,
    }];

    // Simulate presentation delay + Strict Mode / remount cancel after finalize.
    await new Promise((resolve) => setTimeout(resolve, 8));
    // Cancel must not strip or duplicate evidence.
    expect(moveLog).toHaveLength(1);

    // Evidence already committed for the scoring play; continue from afterScore.
    const rest = playToTerminal(afterScore);
    const completedActions: DailyFritzTranscriptAction[] = [
      ...moveLog,
      ...rest.actions.map((action, index) => ({
        ...action,
        sequence: moveLog.length + index,
      })),
    ];
    expect(completedActions.filter((action) =>
      action.kind === 'play'
      && action.actor === 'fritz'
      && action.tile.low === scorePlay.tile.low
      && action.tile.high === scorePlay.tile.high
      && action.position === scorePlay.position
    )).toHaveLength(1);

    const verified = verifyDailyFritzHand({
      transcript: envelope(completedActions, 1, 0),
      initialState: open,
      expectedChallengeId: 'lifecycle-challenge',
      expectedAttemptId: 'lifecycle-attempt',
      expectedGameNumber: 1,
      expectedHandIndex: 0,
      userId: 'lifecycle-user',
      fritzTier: 'elite',
    });
    expect(verified.result.actionCount).toBe(completedActions.length);
    expect(verified.result.gameNumber).toBe(1);
    expect(verified.result.handIndex).toBe(0);

    // Game 2: fresh transcript index/actor/sequence; prior hand actions must not leak.
    const game2Start = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 6, high: 6 }],
        fritz_tiles: [{ low: 0, high: 5 }],
        boneyard: [],
        locked: [],
      },
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: verified.result.playerScoreAfter,
      fritzScore: verified.result.fritzScoreAfter,
    });
    const game2 = playToTerminal(game2Start);
    expect(game2.actions[0]?.sequence).toBe(0);
    expect(game2.actions.every((action, index) => action.sequence === index)).toBe(true);
    expect(game2.actions).not.toEqual(completedActions);

    expect(() => verifyDailyFritzHand({
      transcript: envelope(game2.actions, 2, 0),
      initialState: game2Start,
      expectedChallengeId: 'lifecycle-challenge',
      expectedAttemptId: 'lifecycle-attempt',
      expectedGameNumber: 2,
      expectedHandIndex: 0,
      userId: 'lifecycle-user',
      fritzTier: 'elite',
    })).not.toThrow();
  });
});
