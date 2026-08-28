import { SITE_DOMAIN } from '../lib/siteUrl';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

export function buildShareText(vm: DailyFritzSetOverlayViewModel): string {
  const date = vm.shareDate ?? '';
  const result = vm.resultValue ?? '';
  const tier = vm.shareTier?.trim() || 'Fritz';
  const margin = vm.marginValue ?? '';
  const rating = vm.shareRating ? `${vm.shareRating} rating` : '';
  const streak = vm.shareStreak ? `${vm.shareStreak}-day streak` : '';

  const gameLines = (vm.games ?? [])
    .map((game) => {
      const isSkunk = Boolean(game.skunk);
      const playerScore = game.playerScore;
      const fritzScore = game.fritzScore;
      const won = playerScore > fritzScore;
      const mark = isSkunk ? 'SKUNK' : won ? 'W' : 'L';
      return `G${game.gameNumber} ${mark} ${playerScore}-${fritzScore}`;
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
