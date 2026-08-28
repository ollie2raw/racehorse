import { buildShareGridRow, pointsShare } from '../lib/shareGrid';
import type { DailyFritzSetGameNumber } from './api';

const SET_GAME_NUMBERS: DailyFritzSetGameNumber[] = [1, 2, 3];

import { SITE_DOMAIN } from '../lib/siteUrl';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

export function buildShareText(vm: DailyFritzSetOverlayViewModel): string {
  const date = vm.shareDate ?? '';
  const result = vm.resultValue ?? '';
  const tier = vm.shareTier?.trim() || 'Fritz';
  const margin = vm.marginValue ?? '';
  const rating = vm.shareRating ? `${vm.shareRating} rating` : '';
  const streak = vm.shareStreak ? `${vm.shareStreak}-day streak` : '';

  // Three rows always, so the block is the same height whether the set went two
  // games or three — an unplayed decider reads as unplayed, not as absent.
  const byNumber = new Map((vm.games ?? []).map((game) => [game.gameNumber, game] as const));
  const gameLines = SET_GAME_NUMBERS
    .map((gameNumber) => {
      const game = byNumber.get(gameNumber);
      if (!game) return buildShareGridRow(null, 'none');
      const won = game.playerScore > game.fritzScore;
      const tone = game.skunk && won ? 'skunk' : won ? 'win' : 'loss';
      return buildShareGridRow(pointsShare(game.playerScore, game.fritzScore), tone);
    })
    .join('\n');

  const lines = [
    `Daily Fritz · ${date}`,
    `${result} vs ${tier} Fritz`,
    gameLines,
    `${margin} margin${rating ? ' · ' + rating : ''}`,
    streak,
    SITE_DOMAIN,
  ].filter(Boolean);

  return lines.join('\n');
}
