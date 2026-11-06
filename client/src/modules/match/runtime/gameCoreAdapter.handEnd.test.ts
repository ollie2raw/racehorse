/**
 * What the hand-end report says (gameCoreAdapter.handEndDetails), against what game-core actually did.
 *
 * The report used to name the hand's winner as whoever gained more score across the move, so a hand that ended with no score movement at all
 * reported no winner, measured the loser's pips on the wrong hand, and (with the end bonus off) still claimed go-out points. It now reads the
 * winner from the hands and the rules. Each case below fails on the old code. Learn and Journey summaries and the guided-match capture read this report.
 */
import { describe, expect, it } from 'vitest';
import { applyPlayMove, createFixedBotMatch, getLegalMoves, type BotMatchState } from './botEngine.ts';
import type { Tile } from '../../../types.ts';

const ALL_TILES: Tile[] = [];
for (let high = 0; high <= 6; high++) for (let low = 0; low <= high; low++) ALL_TILES.push({ low, high });
const key = (tile: Tile) => `${tile.low}-${tile.high}`;

/**
 * A hand where `you` is about to play their last tile (a double, so it is a legal opener) and `bot` holds `botHand`. The boneyard is empty:
 * game-core runs the forced-draw chain before it checks for a go-out when a double or scoring play still has drawable boneyard tiles behind it,
 * and these cases are about the report for a hand that really ends.
 */
function lastTileOpener(botHand: Tile[], overrides?: Parameters<typeof createFixedBotMatch>[3]): BotMatchState {
  const youHand: Tile[] = [{ low: 1, high: 1 }];
  const base = createFixedBotMatch(
    {
      player_tiles: ALL_TILES.slice(0, 7),
      fritz_tiles: ALL_TILES.slice(7, 14),
      boneyard: ALL_TILES.slice(14),
      locked: [],
    },
    60,
    7,
    overrides,
  );
  return {
    ...base,
    players: { you: { hand: youHand, score: 0 }, bot: { hand: botHand, score: 0 } },
    boneyard: [],
    deadTiles: [],
  };
}

function goOut(state: BotMatchState) {
  const move = getLegalMoves(state, 'you').find((m) => m.type === 'play' && m.tile && key(m.tile) === '1-1');
  expect(move, 'the double is a legal opener').toBeDefined();
  const result = applyPlayMove(state, 'you', move!);
  expect(result.error, 'the play is accepted').toBeUndefined();
  return result;
}

describe('hand-end report when no score moves', () => {
  it('names the player who went out as the winner when the last play scores nothing and the loser holds 1 pip (bonus rounds to 0)', () => {
    const result = goOut(lastTileOpener([{ low: 0, high: 1 }]));
    expect(result.state.handOver).toBe(true);
    expect(result.state.players.you.score).toBe(0);
    expect(result.state.players.bot.score).toBe(0);
    expect(result.handEnded).toMatchObject({ winner: 'you', reason: 'domino', pointsAwarded: 0 });
    expect(result.state.lastHandWinner).toBe('you');
  });

  it("measures the loser's pips on the loser's hand, not on a default seat", () => {
    const result = goOut(lastTileOpener([{ low: 0, high: 2 }]));
    expect(result.handEnded?.winner).toBe('you');
    // The bot (the loser) holds 2 pips. The old code named no winner and measured `you`, who holds nothing: 0.
    expect(result.handEnded?.loserPips).toBe(2);
  });

  it('is the same when the player who goes out is the bot', () => {
    const base = lastTileOpener([{ low: 0, high: 1 }]);
    const swapped: BotMatchState = {
      ...base,
      players: { you: base.players.bot, bot: base.players.you },
      currentPlayer: 'bot',
    };
    const move = getLegalMoves(swapped, 'bot').find((m) => m.type === 'play' && m.tile && key(m.tile) === '1-1');
    expect(move).toBeDefined();
    const result = applyPlayMove(swapped, 'bot', move!);
    expect(result.handEnded).toMatchObject({ winner: 'bot', reason: 'domino', loserPips: 1, pointsAwarded: 0 });
  });
});

describe("hand-end report under endHandBonus 'none'", () => {
  it('names the winner and claims no go-out points that were never awarded', () => {
    // The loser holds 20 pips: the default rules would award round(20/5) = 4. With the end bonus off game-core awards nothing.
    const state = lastTileOpener([{ low: 6, high: 6 }, { low: 4, high: 4 }], { endHandBonus: 'none' });
    const result = goOut(state);
    expect(result.state.players.you.score).toBe(0);
    expect(result.handEnded).toMatchObject({ winner: 'you', reason: 'domino', pointsAwarded: 0, loserPips: 20 });
    expect(result.handEnded?.calcText).toBe('no hand bonus');
  });

  it('still awards the go-out bonus under the default rules (the report matches what game-core added to the score)', () => {
    const result = goOut(lastTileOpener([{ low: 6, high: 6 }, { low: 4, high: 4 }]));
    expect(result.handEnded).toMatchObject({ winner: 'you', reason: 'domino', loserPips: 20, pointsAwarded: 4 });
    expect(result.state.players.you.score).toBe(4);
    expect(result.handEnded?.calcText).toBe('round(20/5) = 4');
  });
});
