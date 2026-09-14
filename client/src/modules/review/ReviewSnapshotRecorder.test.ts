import { describe, expect, it } from 'vitest';
import { createReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';
import {
  applyPlayMove,
  createBotMatch,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import { toCoreGameState } from '../match/runtime/gameCoreAdapter.ts';
import { createRunDrawSequence } from '../bot-turn/drawSequence.ts';
import {
  ReviewSnapshotRecorder,
  buildPlayerReviewGameCommand,
} from './ReviewSnapshotRecorder.ts';

function openedMatchWithPlayableDoubleSix(): BotMatchState {
  const shell = createBotMatch(60, 7);
  return {
    ...shell,
    handOpen: true,
    currentPlayer: 'you',
    turnIndex: 0,
    board: {
      mainLine: [
        {
          tile: { low: 6, high: 6 },
          orientation: 'horizontal-normal',
        },
      ],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    players: {
      you: {
        hand: [
          { low: 6, high: 5 },
          { low: 0, high: 1 },
          { low: 2, high: 3 },
          { low: 4, high: 4 },
          { low: 1, high: 1 },
          { low: 2, high: 2 },
          { low: 3, high: 3 },
        ],
        score: 0,
      },
      bot: {
        hand: [
          { low: 0, high: 0 },
          { low: 0, high: 2 },
          { low: 0, high: 3 },
          { low: 0, high: 4 },
          { low: 0, high: 5 },
          { low: 1, high: 2 },
          { low: 1, high: 3 },
        ],
        score: 0,
      },
    },
    boneyard: [
      { low: 1, high: 4 },
      { low: 1, high: 5 },
      { low: 2, high: 4 },
      { low: 2, high: 5 },
      { low: 3, high: 4 },
      { low: 3, high: 5 },
      { low: 4, high: 5 },
      { low: 5, high: 5 },
    ],
    deadTiles: [
      { low: 3, high: 6 },
      { low: 4, high: 6 },
    ],
    reviewMissingPipObservations: [],
  };
}

function stateNeedingDrawThenPass(): BotMatchState {
  const shell = createBotMatch(60, 7);
  return {
    ...shell,
    handOpen: true,
    currentPlayer: 'you',
    turnIndex: 3,
    handNumber: 2,
    board: {
      mainLine: [{ tile: { low: 6, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 6,
      rightEnd: 6,
      leftEndIsDouble: true,
      rightEndIsDouble: true,
      hubDoubles: [],
    },
    players: {
      you: {
        hand: [{ low: 1, high: 1 }],
        score: 0,
      },
      bot: {
        hand: [{ low: 2, high: 2 }],
        score: 0,
      },
    },
    // Locked boneyard — two non-matching drawable tiles then pass.
    boneyard: [
      { low: 0, high: 0 },
      { low: 5, high: 5 },
    ],
    deadTiles: [
      { low: 0, high: 0 },
      { low: 5, high: 5 },
    ],
    reviewMissingPipObservations: [],
  };
}

describe('ReviewSnapshotRecorder (A3)', () => {
  it('no-ops when capture is disabled', () => {
    const recorder = new ReviewSnapshotRecorder({ sessionId: 's1', gameId: 'g1' });
    const pre = openedMatchWithPlayableDoubleSix();
    const snap = recorder.recordPlayerDecision(
      pre,
      { kind: 'play', tile: { low: 6, high: 5 }, position: 'right' },
      false,
    );
    expect(snap).toBeNull();
    expect(recorder.getSnapshots()).toHaveLength(0);
  });

  it('records one place snapshot whose digests match toCoreGameState factory', () => {
    const recorder = new ReviewSnapshotRecorder({ sessionId: 's-place', gameId: 'g-place' });
    const pre = openedMatchWithPlayableDoubleSix();
    const action = {
      kind: 'play' as const,
      tile: { low: 6, high: 5 },
      position: 'right' as const,
    };

    const snap = recorder.recordPlayerDecision(pre, action, true);
    expect(snap).not.toBeNull();
    expect(recorder.getSnapshots()).toHaveLength(1);

    const command = buildPlayerReviewGameCommand(pre, action, snap!.identifiers.decisionId);
    const expected = createReviewPositionSnapshotV2({
      authorityPreState: toCoreGameState(pre),
      command,
      identifiers: {
        sessionId: 's-place',
        gameId: 'g-place',
        handId: `hand-${pre.handNumber}`,
        decisionId: snap!.identifiers.decisionId,
        mode: 'play-vs-fritz',
        gameNumber: 1,
        actionNumber: 1,
      },
    });
    expect(snap!.integrity).toEqual(expected.integrity);
    expect(snap!.actualAction).toEqual({ kind: 'play', tile: action.tile, position: 'right' });
    expect(snap!.identifiers.actorId).toBe('you');

    // Live place still applies cleanly after capture (capture is read-only).
    const applied = applyPlayMove(pre, 'you', {
      type: 'play',
      tile: action.tile,
      position: action.position,
    });
    expect(applied.error).toBeUndefined();
  });

  it('records one snapshot per draw and the terminal pass in a short hand', async () => {
    const recorder = new ReviewSnapshotRecorder({ sessionId: 's-draw', gameId: 'g-draw' });
    const pre = stateNeedingDrawThenPass();
    const run = createRunDrawSequence({
      setMatch: () => undefined,
      isMuted: true,
      isLocalRunCurrent: () => true,
      triggerDrawStepAnimation: () => undefined,
      drawStepMs: 0,
    });

    const result = await run(pre, 'you', undefined, (step) => {
      recorder.recordPlayerDecision(
        step.beforeState,
        { kind: step.actionKind },
        true,
      );
    });

    expect(result.passed?.player).toBe('you');
    const snaps = recorder.getSnapshots();
    // Locked yard: no successful draws, only pass.
    expect(snaps.map((s) => s.actualAction.kind)).toEqual(['pass']);
    expect(snaps[0]!.identifiers.actorId).toBe('you');
    expect(snaps[0]!.identifiers.actionNumber).toBe(1);

    const passCommand = buildPlayerReviewGameCommand(
      pre,
      { kind: 'pass' },
      snaps[0]!.identifiers.decisionId,
    );
    const expectedPass = createReviewPositionSnapshotV2({
      authorityPreState: toCoreGameState(pre),
      command: passCommand,
      identifiers: {
        sessionId: 's-draw',
        gameId: 'g-draw',
        handId: `hand-${pre.handNumber}`,
        decisionId: snaps[0]!.identifiers.decisionId,
        mode: 'play-vs-fritz',
        gameNumber: 1,
        actionNumber: 1,
      },
    });
    expect(snaps[0]!.integrity).toEqual(expectedPass.integrity);
  });

  it('records draw then playable-exit without a pass', async () => {
    const recorder = new ReviewSnapshotRecorder({ sessionId: 's-draw-play', gameId: 'g-draw-play' });
    const base = createBotMatch(60, 7);
    const pre: BotMatchState = {
      ...base,
      board: {
        mainLine: [
          { tile: { low: 1, high: 2 }, orientation: 'horizontal-normal' },
        ],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        you: {
          ...base.players.you,
          hand: [{ low: 5, high: 5 }, { low: 4, high: 4 }],
        },
        bot: {
          ...base.players.bot,
          hand: [{ low: 3, high: 3 }],
        },
      },
      boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }, { low: 0, high: 0 }],
      currentPlayer: 'you',
      handOpen: true,
      turnIndex: 4,
      reviewMissingPipObservations: [],
    };

    const run = createRunDrawSequence({
      setMatch: () => undefined,
      isMuted: true,
      isLocalRunCurrent: () => true,
      triggerDrawStepAnimation: () => undefined,
      drawStepMs: 0,
    });

    const result = await run(pre, 'you', undefined, (step) => {
      recorder.recordPlayerDecision(
        step.beforeState,
        { kind: step.actionKind },
        true,
      );
    });

    expect(result.passed).toBeUndefined();
    expect(result.drew?.player).toBe('you');
    const snaps = recorder.getSnapshots();
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps.every((s) => s.actualAction.kind === 'draw')).toBe(true);
    expect(snaps.every((s) => s.integrity.authorityPreStateDigest.length > 0)).toBe(true);
  });

  it('clear resets the bag for rematch', () => {
    const recorder = new ReviewSnapshotRecorder({ sessionId: 's-old', gameId: 'g-old' });
    const pre = openedMatchWithPlayableDoubleSix();
    recorder.recordPlayerDecision(
      pre,
      { kind: 'play', tile: { low: 6, high: 5 }, position: 'right' },
      true,
    );
    expect(recorder.getSnapshots()).toHaveLength(1);
    recorder.clear({ sessionId: 's-new', gameId: 'g-new' });
    expect(recorder.getSnapshots()).toHaveLength(0);
    const again = recorder.recordPlayerDecision(
      pre,
      { kind: 'play', tile: { low: 6, high: 5 }, position: 'right' },
      true,
    );
    expect(again?.identifiers.sessionId).toBe('s-new');
    expect(again?.identifiers.actionNumber).toBe(1);
  });
});
