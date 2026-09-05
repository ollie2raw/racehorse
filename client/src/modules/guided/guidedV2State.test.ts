import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BoardState } from '../../types.ts';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { makeLessonV2Event } from './guidedTestFixtures.ts';
import {
  resolveNextPlayerAfterV2Event,
  parseV2EventHands,
  buildBotMatchStateFromV2Event,
} from './guidedV2State.ts';

const { parseLessonV2BoardState } = vi.hoisted(() => ({
  parseLessonV2BoardState: vi.fn<(boardAfter: string) => BoardState | null>(),
}));

vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', () => ({
  parseLessonV2BoardState,
}));

beforeEach(() => {
  parseLessonV2BoardState.mockReset();
  parseLessonV2BoardState.mockReturnValue(null);
});

describe('resolveNextPlayerAfterV2Event', () => {
  it('returns "you" when the event ends the hand, regardless of actor/turnContinues', () => {
    const event = makeLessonV2Event({ actor: 'fritz', turnContinues: true, handOver: true });
    expect(resolveNextPlayerAfterV2Event(event)).toBe('you');
  });

  it('returns "you" when the event ends the game (handOver still false)', () => {
    const event = makeLessonV2Event({ actor: 'fritz', turnContinues: true, gameOver: true });
    expect(resolveNextPlayerAfterV2Event(event)).toBe('you');
  });

  it('turnContinues + fritz actor -> "bot" (fritz plays again)', () => {
    expect(
      resolveNextPlayerAfterV2Event(makeLessonV2Event({ actor: 'fritz', turnContinues: true })),
    ).toBe('bot');
  });

  it('turnContinues + player actor -> "you" (player plays again)', () => {
    expect(
      resolveNextPlayerAfterV2Event(makeLessonV2Event({ actor: 'player', turnContinues: true })),
    ).toBe('you');
  });

  it('turn ends + fritz actor -> "you" (hand back to player)', () => {
    expect(
      resolveNextPlayerAfterV2Event(makeLessonV2Event({ actor: 'fritz', turnContinues: false })),
    ).toBe('you');
  });

  it('turn ends + player actor -> "bot"', () => {
    expect(
      resolveNextPlayerAfterV2Event(makeLessonV2Event({ actor: 'player', turnContinues: false })),
    ).toBe('bot');
  });
});

describe('parseV2EventHands', () => {
  it('parses well-formed tile keys, preserving order', () => {
    const event = makeLessonV2Event({
      playerHandAfter: ['2|4', '0|0', '6|6'],
      fritzHandAfter: ['1|3'],
    });
    const { playerHand, fritzHand } = parseV2EventHands(event);
    expect(playerHand).toEqual([
      { low: 2, high: 4 },
      { low: 0, high: 0 },
      { low: 6, high: 6 },
    ]);
    expect(fritzHand).toEqual([{ low: 1, high: 3 }]);
  });

  it('drops malformed keys and keeps the valid ones', () => {
    const event = makeLessonV2Event({
      playerHandAfter: ['2|4', 'garbage', '', 'x|y', '5|1'],
      fritzHandAfter: ['not-a-key'],
    });
    const { playerHand, fritzHand } = parseV2EventHands(event);
    // '5|1' normalizes low/high.
    expect(playerHand).toEqual([
      { low: 2, high: 4 },
      { low: 1, high: 5 },
    ]);
    expect(fritzHand).toEqual([]);
  });

  it('returns empty arrays for empty hands', () => {
    const event = makeLessonV2Event({ playerHandAfter: [], fritzHandAfter: [] });
    expect(parseV2EventHands(event)).toEqual({ playerHand: [], fritzHand: [] });
  });
});

describe('buildBotMatchStateFromV2Event', () => {
  const boardWithTiles = (count: number): BoardState =>
    ({ mainLine: Array.from({ length: count }, () => ({})) } as unknown as BoardState);

  it('handOpen is false when the parsed board is null', () => {
    parseLessonV2BoardState.mockReturnValue(null);
    const next = buildBotMatchStateFromV2Event(createBotMatch(), makeLessonV2Event());
    expect(next.board).toBeNull();
    expect(next.handOpen).toBe(false);
  });

  it('handOpen is true when the parsed board has a non-empty mainLine', () => {
    parseLessonV2BoardState.mockReturnValue(boardWithTiles(3));
    const next = buildBotMatchStateFromV2Event(createBotMatch(), makeLessonV2Event());
    expect(next.handOpen).toBe(true);
  });

  it('handOpen is false when the parsed board has an empty mainLine', () => {
    parseLessonV2BoardState.mockReturnValue(boardWithTiles(0));
    const next = buildBotMatchStateFromV2Event(createBotMatch(), makeLessonV2Event());
    expect(next.handOpen).toBe(false);
  });

  it('trims the boneyard down to boneyardCountAfter (prefix slice)', () => {
    const base = createBotMatch();
    const target = base.boneyard.length - 2;
    const next = buildBotMatchStateFromV2Event(base, makeLessonV2Event({ boneyardCountAfter: target }));
    expect(next.boneyard).toHaveLength(target);
    expect(next.boneyard).toEqual(base.boneyard.slice(0, target));
  });

  it('pads the boneyard up to boneyardCountAfter with {0,0} placeholders', () => {
    const base = createBotMatch();
    const target = base.boneyard.length + 3;
    const next = buildBotMatchStateFromV2Event(base, makeLessonV2Event({ boneyardCountAfter: target }));
    expect(next.boneyard).toHaveLength(target);
    expect(next.boneyard.slice(base.boneyard.length)).toEqual([
      { low: 0, high: 0 },
      { low: 0, high: 0 },
      { low: 0, high: 0 },
    ]);
  });

  it('sets winnerId to "you" on gameOver when the player is ahead or level', () => {
    const next = buildBotMatchStateFromV2Event(
      createBotMatch(),
      makeLessonV2Event({ gameOver: true, playerScoreAfter: 60, fritzScoreAfter: 42 }),
    );
    expect(next.gameOver).toBe(true);
    expect(next.winnerId).toBe('you');
  });

  it('sets winnerId to "bot" on gameOver when fritz is ahead', () => {
    const next = buildBotMatchStateFromV2Event(
      createBotMatch(),
      makeLessonV2Event({ gameOver: true, playerScoreAfter: 33, fritzScoreAfter: 60 }),
    );
    expect(next.winnerId).toBe('bot');
  });

  it('passes through the existing winnerId when the event is not gameOver', () => {
    const base = { ...createBotMatch(), winnerId: 'you' as const };
    const next = buildBotMatchStateFromV2Event(base, makeLessonV2Event({ gameOver: false }));
    expect(next.winnerId).toBe('you');
  });

  it('maps scores/hands/currentPlayer from the event and preserves untouched fields', () => {
    const base = createBotMatch(100, 7);
    const event = makeLessonV2Event({
      actor: 'fritz',
      turnContinues: false,
      handNumber: 4,
      handOver: true,
      playerScoreAfter: 21,
      fritzScoreAfter: 34,
      playerHandAfter: ['1|1'],
      fritzHandAfter: ['2|2', '3|3'],
    });
    const next = buildBotMatchStateFromV2Event(base, event);

    expect(next.players.you.score).toBe(21);
    expect(next.players.bot.score).toBe(34);
    expect(next.players.you.hand).toEqual([{ low: 1, high: 1 }]);
    expect(next.players.bot.hand).toEqual([{ low: 2, high: 2 }, { low: 3, high: 3 }]);
    expect(next.handNumber).toBe(4);
    expect(next.handOver).toBe(true);
    // fritz actor, turn ends, hand over -> terminal guard -> 'you'
    expect(next.currentPlayer).toBe('you');
    // untouched passthrough
    expect(next.winningScore).toBe(100);
    expect(next.dealSize).toBe(base.dealSize);
    expect(next.deadTiles).toBe(base.deadTiles);
  });
});
