import type { DailyFritzSetGameNumber } from './api';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

export const DAILY_FRITZ_GAME_NUMBERS: DailyFritzSetGameNumber[] = [1, 2, 3];

export type DossierGameRow =
  | { gameNumber: DailyFritzSetGameNumber; played: false }
  | {
      gameNumber: DailyFritzSetGameNumber;
      played: true;
      score: string;
      tone: 'win' | 'loss' | 'skunk';
      /** The winner's share of the points, as a percentage of the track. */
      sharePercent: number;
      /** Which edge the fill is anchored to. */
      side: 'player' | 'fritz';
    };

/**
 * Builds the three fixed game rows on a dossier card.
 *
 * All three are always present — an unplayed decider is greyed rather than
 * dropped, so the card keeps one shape whatever happened. The bar carries the
 * winner's share of that game's points, which is why a shutout reads as a near
 * full bar and a tight game as a near half.
 */
export function buildDossierGameRows(
  games: DailyFritzSetOverlayViewModel['games'],
): DossierGameRow[] {
  const byNumber = new Map(games.map((game) => [game.gameNumber, game] as const));

  return DAILY_FRITZ_GAME_NUMBERS.map((gameNumber) => {
    const game = byNumber.get(gameNumber);
    if (!game) return { gameNumber, played: false as const };

    const player = Math.max(0, game.playerScore);
    const fritz = Math.max(0, game.fritzScore);
    const total = player + fritz;
    const playerWon = player > fritz;
    const winnerShare = total === 0 ? 50 : ((playerWon ? player : fritz) / total) * 100;

    return {
      gameNumber,
      played: true as const,
      score: `${player}–${fritz}`,
      tone: game.skunk && playerWon ? ('skunk' as const) : playerWon ? ('win' as const) : ('loss' as const),
      sharePercent: Math.round(winnerShare),
      side: playerWon ? ('player' as const) : ('fritz' as const),
    };
  });
}
