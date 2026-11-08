/**
 * The self-play corpus generator: masks round-trip, features use public information only, the absence evidence matches
 * ground truth, outcomes join correctly (checked against the score chain the log itself carries), and a rerun with the
 * same seed is byte-identical.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
  type BotPlayerId,
} from '../modules/match/runtime/botEngine.ts';
import { getSearchBudgetMode } from '../modules/fritz/searchBudget.ts';
import type { Tile } from '../types.ts';
import {
  buildShard,
  dealCorpusHand,
  emptyTracker,
  extractFeatures,
  gameToJsonl,
  maskFromTiles,
  mulberry32,
  pipMask,
  playCorpusGame,
  tileFromIndex,
  tileIndex,
  tilesFromMask,
  type DecisionRecord,
  type PolicyMix,
} from './selfplayCorpus.ts';

const FAST_MIX: PolicyMix = { 'uniform-random': 50, 'fritz-casual': 50 };

describe('tile and pip masks', () => {
  it('index every tile 0..27 in the documented order and round-trip', () => {
    expect(tileIndex({ low: 0, high: 0 })).toBe(0);
    expect(tileIndex({ low: 0, high: 1 })).toBe(1);
    expect(tileIndex({ low: 1, high: 1 })).toBe(2);
    expect(tileIndex({ low: 0, high: 2 })).toBe(3);
    expect(tileIndex({ low: 6, high: 6 })).toBe(27);
    const seen = new Set<number>();
    for (let high = 0; high <= 6; high++) {
      for (let low = 0; low <= high; low++) {
        const index = tileIndex({ low, high });
        expect(tileFromIndex(index)).toEqual({ low, high });
        // The order of the pips on the tile does not matter.
        expect(tileIndex({ low: high, high: low })).toBe(index);
        seen.add(index);
      }
    }
    expect(seen.size).toBe(28);
  });

  it('round-trip arbitrary tile sets through the 28-bit mask', () => {
    const rng = mulberry32(123);
    for (let trial = 0; trial < 200; trial++) {
      const indexes = new Set<number>();
      const count = Math.floor(rng() * 15);
      while (indexes.size < count) indexes.add(Math.floor(rng() * 28));
      const tiles = [...indexes].sort((a, b) => a - b).map(tileFromIndex);
      const mask = maskFromTiles(tiles);
      expect(mask).toBeGreaterThanOrEqual(0);
      expect(mask).toBeLessThan(2 ** 28);
      expect(tilesFromMask(mask).map(tileIndex)).toEqual(tiles.map(tileIndex));
    }
    expect(maskFromTiles([])).toBe(0);
    expect(pipMask([0, 3, 6])).toBe(0b1001001);
  });
});

/** Plays a few moves so the board has structure, and returns the state with the seat to move. */
function midGameState(seed: number, plays: number): BotMatchState {
  const rng = mulberry32(seed);
  let state = dealCorpusHand(rng, { you: 17, bot: 23 }, 3);
  for (let i = 0; i < plays && !state.handOver; i++) {
    const seat: BotPlayerId = state.currentPlayer;
    const moves = getLegalMoves(state, seat).filter((m) => m.type === 'play');
    if (moves.length === 0) break;
    state = applyPlayMove(state, seat, moves[Math.floor(rng() * moves.length)]!).state;
  }
  return state;
}

describe('features use public information only', () => {
  it('do not change when the opponent hand and the boneyard are rearranged', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = midGameState(seed, 5);
      if (state.handOver) continue;
      const seat = state.currentPlayer;
      const opp: BotPlayerId = seat === 'you' ? 'bot' : 'you';
      const plays = getLegalMoves(state, seat).filter((m) => m.type === 'play').length;
      const base = extractFeatures(state, seat, emptyTracker(), plays, 'you');

      // Swap the opponent's whole hand with an equal number of boneyard tiles: same counts, different hidden contents.
      const oppHand = state.players[opp].hand;
      const yard = state.boneyard;
      const swapped: BotMatchState = {
        ...state,
        players: {
          ...state.players,
          [opp]: { ...state.players[opp], hand: yard.slice(0, oppHand.length) as Tile[] },
        },
        boneyard: [...oppHand, ...yard.slice(oppHand.length)],
      };
      expect(swapped.players[opp].hand.length).toBe(oppHand.length);
      expect(swapped.boneyard.length).toBe(yard.length);
      expect(extractFeatures(swapped, seat, emptyTracker(), plays, 'you')).toEqual(base);

      // Reordering the boneyard changes nothing either.
      const reversed: BotMatchState = { ...state, boneyard: [...yard].reverse() };
      expect(extractFeatures(reversed, seat, emptyTracker(), plays, 'you')).toEqual(base);
    }
  });

  it('report the acting seat\'s own tiles, the tiles on the board, and the open ends', () => {
    const state = midGameState(3, 6);
    const seat = state.currentPlayer;
    const features = extractFeatures(state, seat, emptyTracker(), 1, 'you');
    expect(tilesFromMask(features.ownHandMask).map(tileIndex).sort()).toEqual(state.players[seat].hand.map(tileIndex).sort());
    expect(features.ownHandMask & features.playedMask).toBe(0);
    expect(features.numEnds).toBe(features.openEndPips.length);
    expect(features.openSumMod5).toBe(features.openSum % 5);
    expect(features.oppTileCount).toBe(state.players[seat === 'you' ? 'bot' : 'you'].hand.length);
    expect(features.boneyardCount).toBe(state.boneyard.length);
  });
});

describe('a played game', () => {
  const audited: Array<{ passed: boolean; ends: readonly number[]; handBefore: readonly Tile[]; handAfter: readonly Tile[]; passMaskAfter: number }> = [];
  const game = playCorpusGame({
    gameId: 'test-g0',
    seed: 'test-g0|seed',
    mix: FAST_MIX,
    policies: ['uniform-random', 'fritz-casual'],
    audit: (event) => audited.push(event),
  });

  it('runs on the node budget so reruns are reproducible', () => {
    expect(getSearchBudgetMode()).toBe('nodes');
  });

  it('logs every decision with a unique id and joins outcomes (checked against the log\'s own score chain)', () => {
    expect(game.decisions.length).toBeGreaterThan(40);
    expect(new Set(game.decisions.map((d) => d.decisionId)).size).toBe(game.decisions.length);

    const byHand = new Map<number, DecisionRecord[]>();
    for (const d of game.decisions) byHand.set(d.hand, [...(byHand.get(d.hand) ?? []), d]);
    const hands = [...byHand.keys()].sort((a, b) => a - b);
    expect(hands.length).toBe(game.hands);

    // Score of each seat at the start of each hand = the scores carried by that hand's first logged decision.
    const startOf = (hand: number): [number, number] => {
      const first = byHand.get(hand)![0]!;
      return first.seat === 0 ? [first.features.ownScore, first.features.oppScore] : [first.features.oppScore, first.features.ownScore];
    };
    for (const hand of hands) {
      const next: [number, number] = hand === hands[hands.length - 1] ? game.finalScores : startOf(hand + 1);
      for (const d of byHand.get(hand)!) {
        const self = d.seat === 0 ? next[0] : next[1];
        const opp = d.seat === 0 ? next[1] : next[0];
        expect(d.outcome.ptsSelfToHandEnd).toBe(self - d.features.ownScore);
        expect(d.outcome.ptsOppToHandEnd).toBe(opp - d.features.oppScore);
        expect(d.outcome.handEndDiffDelta).toBe(self - opp - (d.features.ownScore - d.features.oppScore));
        expect(d.outcome.handEndDiffDelta).toBe(d.outcome.ptsSelfToHandEnd - d.outcome.ptsOppToHandEnd);
      }
    }
    // The game outcome matches the final scores from each seat's view.
    for (const d of game.decisions) {
      const self = d.seat === 0 ? game.finalScores[0] : game.finalScores[1];
      const opp = d.seat === 0 ? game.finalScores[1] : game.finalScores[0];
      expect(d.outcome.finalMargin).toBe(self - opp);
      expect(d.outcome.wonGame).toBe(self > opp ? 1 : 0);
      expect(d.outcome.gameHands).toBe(game.hands);
    }
    expect(Math.max(...game.finalScores)).toBeGreaterThanOrEqual(60);
  });

  it('flags forced decisions (exactly one legal play) and records which policy produced each move', () => {
    for (const d of game.decisions) {
      expect(d.moveSource === 'forced').toBe(d.features.legalActionCount === 1);
      expect(d.policy).toBe(d.seat === 0 ? 'uniform-random' : 'fritz-casual');
      if (d.policy === 'uniform-random' && d.moveSource !== 'forced') expect(d.moveSource).toBe('explore');
      if (d.policy === 'fritz-casual' && d.moveSource !== 'forced') expect(d.moveSource).toBe('greedy');
    }
  });

  it('records absence evidence that is true of the real hands', () => {
    expect(audited.length).toBeGreaterThan(0);
    for (const event of audited) {
      const pips = new Set(event.ends);
      // A player that could not play held no tile with an open-end pip when it started to draw.
      for (const tile of event.handBefore) {
        expect(pips.has(tile.low) || pips.has(tile.high)).toBe(false);
      }
      // A pass is permanent: nothing left to draw, and the final hand still holds no such tile.
      if (event.passed) {
        for (const tile of event.handAfter) expect(pips.has(tile.low) || pips.has(tile.high)).toBe(false);
      }
    }
  });
});

describe('determinism', () => {
  it('a shard rerun with the same seed is byte-identical, and a different seed is not', () => {
    const a = buildShard(7, 0, 2, FAST_MIX);
    const b = buildShard(7, 0, 2, FAST_MIX);
    expect(a.decisions).toBe(b.decisions);
    expect(a.bytes.equals(b.bytes)).toBe(true);
    const c = buildShard(8, 0, 2, FAST_MIX);
    expect(c.bytes.equals(a.bytes)).toBe(false);
  });

  it('a master-vs-hard game reruns identically (the node-budgeted search is reproducible)', { timeout: 300_000 }, () => {
    const play = () =>
      gameToJsonl(playCorpusGame({ gameId: 'master-g', seed: 'master-g|x', mix: FAST_MIX, policies: ['fritz-master', 'fritz-hard'] }));
    expect(play()).toBe(play());
  });
});
