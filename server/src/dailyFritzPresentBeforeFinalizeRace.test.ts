/**
 * Reconstructs the transcript shape produced when Fritz's scoring play is applied
 * in live UI (presentEmbeddedForcedDraws) but never appended to the move log
 * (finalize cancelled by bot-turn remount), then a later tenure logs the
 * post-recovery follow-up from the advanced live state.
 *
 * Verifier correctly rejects — class A (different input state / incomplete evidence).
 * Production surfaces this at the end-of-hand modal as fritz_action_mismatch with
 * different tiles at the same seat (got X expected Y @ branch-0-1).
 */
import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import {
  createOfficialDailyFritzHandState,
  DailyFritzVerificationError,
  verifyDailyFritzHand,
} from './dailyFritzVerifier';

describe('Daily Fritz present-before-finalize transcript race', () => {
  it('rejects a follow-up Fritz play whose prior scoring play was never logged', () => {
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

    // Race transcript: scoring play never logged; follow-up chosen from advanced live state.
    const raceActions: DailyFritzTranscriptAction[] = [
      {
        sequence: 0,
        actor: 'fritz',
        kind: 'play',
        tile: followUp.tile,
        position: followUp.position,
      },
    ];

    let caught: DailyFritzVerificationError | null = null;
    try {
      verifyDailyFritzHand({
        transcript: {
          protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
          rulesVersion: GAME_RULES_VERSION,
          fritzPolicyVersion: FRITZ_POLICY_VERSION,
          challengeId: 'c',
          attemptId: 'a',
          gameNumber: 1,
          handIndex: 0,
          actions: raceActions,
        },
        initialState: open,
        expectedChallengeId: 'c',
        expectedAttemptId: 'a',
        expectedGameNumber: 1,
        expectedHandIndex: 0,
        userId: 'u',
        fritzTier: 'elite',
      });
    } catch (error) {
      caught = error as DailyFritzVerificationError;
    }

    expect(caught).toBeInstanceOf(DailyFritzVerificationError);
    expect(caught?.code).toBe('fritz_action_mismatch');
    expect(caught?.message).toMatch(/Fritz action does not match the official policy/);
    // Same seat class as production screenshot: different tiles, not empty-arm siblings.
    expect(caught?.message).toMatch(/got play /);
    expect(caught?.message).toMatch(/expected play /);
    const gotTile = followUp.tile;
    const expectedTile = scorePlay.kind === 'play' ? scorePlay.tile : null;
    expect(expectedTile).not.toBeNull();
    expect(`${gotTile.low}|${gotTile.high}`).not.toBe(`${expectedTile!.low}|${expectedTile!.high}`);
  });

  it('rejects a Fritz action logged after an absorbed auto-pass when the scoring play was omitted', () => {
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
    expect(afterScore.playerIds[afterScore.currentPlayerIndex]).toBe('player');

    // Presentation forces currentPlayer back to bot while animating; a stale tenure
    // can then append a Fritz action though authoritative turn is already player's.
    let caught: DailyFritzVerificationError | null = null;
    try {
      verifyDailyFritzHand({
        transcript: {
          protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
          rulesVersion: GAME_RULES_VERSION,
          fritzPolicyVersion: FRITZ_POLICY_VERSION,
          challengeId: 'c',
          attemptId: 'a',
          gameNumber: 1,
          handIndex: 0,
          actions: [
            { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
            { sequence: 1, actor: 'fritz', kind: 'pass' },
          ],
        },
        initialState: open,
        expectedChallengeId: 'c',
        expectedAttemptId: 'a',
        expectedGameNumber: 1,
        expectedHandIndex: 0,
        userId: 'u',
        fritzTier: 'elite',
      });
    } catch (error) {
      caught = error as DailyFritzVerificationError;
    }

    expect(caught).toBeInstanceOf(DailyFritzVerificationError);
    expect(caught?.code).toBe('wrong_actor');
    expect(caught?.message).toMatch(/Transcript actor does not own the turn/);
  });

  it('accepts an honest scoring play with absorbed recovery draws and follow-up', () => {
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

    let state = open;
    const actions: DailyFritzTranscriptAction[] = [];
    // Lifecycle: finalize evidence for scoring play (presentation may then remount).
    actions.push({
      sequence: 0,
      actor: 'fritz',
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    });
    state = applyGameCommand(state, {
      version: 1,
      commandId: 'score',
      sequence: state.sequence,
      actorId: 'fritz',
      kind: 'play',
      tile: { low: 1, high: 6 },
      position: 'left',
    }).state;

    while (!state.handOver && actions.length < 64) {
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
    expect(() => verifyDailyFritzHand({
      transcript: {
        protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
        rulesVersion: GAME_RULES_VERSION,
        fritzPolicyVersion: FRITZ_POLICY_VERSION,
        challengeId: 'c',
        attemptId: 'a',
        gameNumber: 1,
        handIndex: 0,
        actions,
      },
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
