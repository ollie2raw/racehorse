/**
 * Daily Fritz end-of-hand verifier races — present-before-finalize (fixed).
 *
 * Invariant: Fritz presentation never mutates authoritative match; finalize
 * (evidence + apply) must precede any cancellable presentation await.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import {
  listEmbeddedForcedDrawTiles,
  presentEmbeddedForcedDraws,
} from './embeddedForcedDrawPresentation.ts';
import { buildBotTurnScheduleKey } from './useBotTurnEffect.ts';

function scoringRecoveryFixture(): {
  beforePlay: BotMatchState;
  afterPlay: BotMatchState;
  drawnTiles: ReturnType<typeof listEmbeddedForcedDrawTiles>;
} {
  const beforePlay = createBotMatch(60, 7);
  beforePlay.currentPlayer = 'bot';
  beforePlay.handOpen = true;
  beforePlay.board = {
    mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' }],
    leftEnd: 1,
    rightEnd: 4,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [],
  };
  beforePlay.players.bot.hand = [{ low: 1, high: 6 }];
  beforePlay.boneyard = [
    { low: 2, high: 3 },
    { low: 3, high: 5 },
    { low: 4, high: 4 },
  ];

  const drawnTiles = [
    { low: 2, high: 3 },
    { low: 3, high: 5 },
  ];
  const afterPlay: BotMatchState = {
    ...beforePlay,
    board: {
      mainLine: [
        { tile: { low: 1, high: 6 }, orientation: 'horizontal-normal' },
        { tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 6,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [{ low: 4, high: 4 }],
    players: {
      ...beforePlay.players,
      bot: {
        ...beforePlay.players.bot,
        hand: [...drawnTiles],
        score: 5,
      },
    },
    currentPlayer: 'bot',
  };

  expect(listEmbeddedForcedDrawTiles(beforePlay, afterPlay)).toEqual(drawnTiles);
  return { beforePlay, afterPlay, drawnTiles };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('present-before-finalize bot-turn race (Daily Fritz)', () => {
  it('must not mutate Fritz match fields that remount the bot-turn schedule key', async () => {
    const { beforePlay, afterPlay, drawnTiles } = scoringRecoveryFixture();
    let live: BotMatchState = structuredClone(beforePlay);
    const tenureKey = () => buildBotTurnScheduleKey({
      currentPlayer: live.currentPlayer,
      handNumber: live.handNumber,
      handOver: live.handOver,
      gameOver: live.gameOver,
      retryNonce: 0,
    });
    const keys: string[] = [tenureKey()];

    await presentEmbeddedForcedDraws({
      player: 'bot',
      beforePlay,
      afterPlay,
      drawnTiles,
      setMatch: (next) => {
        live = typeof next === 'function' ? next(live) : next;
        keys.push(tenureKey());
      },
      onDrawVisualStep: vi.fn(),
      triggerDrawStepAnimation: vi.fn(),
      setDrawSequenceActiveBoth: vi.fn(),
      drawStepMs: 0,
      isMuted: true,
    });

    expect(new Set(keys).size).toBe(1);
    expect(live.board?.mainLine).toEqual(beforePlay.board?.mainLine);
    expect(live.boneyard).toEqual(beforePlay.boneyard);
    expect(live.players.bot.hand).toEqual(beforePlay.players.bot.hand);
  });

  it('must not call setMatch for Fritz embedded recovery draws', async () => {
    const { beforePlay, afterPlay, drawnTiles } = scoringRecoveryFixture();
    const setMatch = vi.fn();

    await presentEmbeddedForcedDraws({
      player: 'bot',
      beforePlay,
      afterPlay,
      drawnTiles,
      setMatch,
      onDrawVisualStep: vi.fn(),
      triggerDrawStepAnimation: vi.fn(),
      setDrawSequenceActiveBoth: vi.fn(),
      drawStepMs: 0,
      isMuted: true,
    });

    expect(setMatch).not.toHaveBeenCalled();
  });

  it('presentation cancel cannot leave live board ahead of empty move log', async () => {
    const { beforePlay, afterPlay, drawnTiles } = scoringRecoveryFixture();
    let live: BotMatchState = structuredClone(beforePlay);
    const moveLog: Array<{ action: string }> = [];

    // Correct order: finalize evidence first, then present (cancellable).
    moveLog.push({ action: 'place' });
    live = structuredClone(afterPlay);

    await presentEmbeddedForcedDraws({
      player: 'bot',
      beforePlay,
      afterPlay,
      drawnTiles,
      setMatch: (next) => {
        live = typeof next === 'function' ? next(live) : next;
      },
      onDrawVisualStep: vi.fn(),
      triggerDrawStepAnimation: vi.fn(),
      setDrawSequenceActiveBoth: vi.fn(),
      drawStepMs: 0,
      isMuted: true,
    });

    // Simulate cleanup cancel after finalize — presentation must not rewind or
    // strip evidence; live stays at authoritative afterPlay.
    expect(moveLog).toHaveLength(1);
    expect(live.board?.mainLine).toEqual(afterPlay.board?.mainLine);
    expect(live.players.bot.hand).toEqual(afterPlay.players.bot.hand);
  });

  it('finalize-before-present ordering: evidence commits before cancellable await', async () => {
    const events: string[] = [];
    const { beforePlay, afterPlay, drawnTiles } = scoringRecoveryFixture();

    const finalize = () => {
      events.push('finalize');
    };
    const present = async () => {
      events.push('present-start');
      await presentEmbeddedForcedDraws({
        player: 'bot',
        beforePlay,
        afterPlay,
        drawnTiles,
        setMatch: () => {
          events.push('setMatch');
        },
        onDrawVisualStep: vi.fn(),
        triggerDrawStepAnimation: vi.fn(),
        setDrawSequenceActiveBoth: vi.fn(),
        drawStepMs: 0,
        isMuted: true,
      });
      events.push('present-end');
    };

    finalize();
    await present();

    expect(events).toEqual(['finalize', 'present-start', 'present-end']);
  });
});
