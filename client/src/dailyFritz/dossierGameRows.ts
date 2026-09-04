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
    };

/**
 * Builds the three fixed game rows on a dossier card.
 *
 * All three are always present — an unplayed decider is greyed rather than
 * dropped, so the card keeps one shape whatever happened. The bar is a solid
 * color keyed to `tone` only — it does not scale to the score margin (the
 * score text next to it carries that), so every row is the same full-width
 * shape regardless of how close the game was.
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
    const playerWon = player > fritz;

    return {
      gameNumber,
      played: true as const,
      score: `${player}–${fritz}`,
      tone: game.skunk && playerWon ? ('skunk' as const) : playerWon ? ('win' as const) : ('loss' as const),
    };
  });
}
