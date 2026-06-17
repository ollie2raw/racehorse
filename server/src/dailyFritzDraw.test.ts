import { describe, expect, it } from 'vitest';
import {
  dailyFritzDrawTilesMatchWinner,
  dailyFritzTilePipSum,
  generateDailyFritzRun,
  getDailyFritzDrawTiles,
  getDailyFritzDrawWinner,
  resolveDailyFritzDrawTiles,
  type DailyFritzDrawTiles,
  type DailyFritzSetGameNumber,
} from './dailyFritz';

const SAMPLE_RUN_DATE = '2026-06-17';

function expectTilesMatchWinner(
  tiles: DailyFritzDrawTiles,
  drawWinner: 'you' | 'bot',
  label: string,
): void {
  expect(dailyFritzDrawTilesMatchWinner(tiles, drawWinner), label).toBe(true);
  const playerPips = dailyFritzTilePipSum(tiles.playerTile);
  const fritzPips = dailyFritzTilePipSum(tiles.fritzTile);
  expect(playerPips).not.toBe(fritzPips);
  if (drawWinner === 'you') {
    expect(playerPips).toBeGreaterThan(fritzPips);
  } else {
    expect(fritzPips).toBeGreaterThan(playerPips);
  }
}

describe('Daily Fritz scripted draw tiles', () => {
  it('aligns pip totals with draw winner for all three games', () => {
    for (const gameNumber of [1, 2, 3] as const satisfies DailyFritzSetGameNumber[]) {
      const drawWinner = getDailyFritzDrawWinner(SAMPLE_RUN_DATE, gameNumber);
      const tiles = getDailyFritzDrawTiles(SAMPLE_RUN_DATE, gameNumber);
      expectTilesMatchWinner(tiles, drawWinner, `game ${gameNumber}`);
    }
  });

  it('stores aligned draw tiles in generated run metadata', () => {
    const run = generateDailyFritzRun(SAMPLE_RUN_DATE, 'standard', 7, 60);
    const winners = run.metadata?.draw_winners_by_game as Record<string, 'you' | 'bot'>;
    const tilesByGame = run.metadata?.draw_tiles_by_game as Record<
      string,
      DailyFritzDrawTiles
    >;

    for (const gameNumber of ['1', '2', '3']) {
      const drawWinner = winners[gameNumber]!;
      const tiles = tilesByGame[gameNumber]!;
      expectTilesMatchWinner(tiles, drawWinner, `metadata game ${gameNumber}`);
    }
  });

  it('rejects misaligned metadata and returns aligned tiles from seed', () => {
    const drawWinner = getDailyFritzDrawWinner(SAMPLE_RUN_DATE, 2);
    const misaligned: DailyFritzDrawTiles = {
      playerTile: { low: 0, high: 6 },
      fritzTile: { low: 2, high: 5 },
    };
    expect(dailyFritzTilePipSum(misaligned.playerTile)).toBe(6);
    expect(dailyFritzTilePipSum(misaligned.fritzTile)).toBe(7);
    expect(dailyFritzDrawTilesMatchWinner(misaligned, 'you')).toBe(false);

    const resolved = resolveDailyFritzDrawTiles({
      runDate: SAMPLE_RUN_DATE,
      gameNumber: 2,
      drawWinner: 'you',
      metadata: {
        draw_tiles_by_game: { 2: misaligned },
      },
    });
    expectTilesMatchWinner(resolved, drawWinner, 'resolved game 2');
    expect(resolved).not.toEqual(misaligned);
  });
});
