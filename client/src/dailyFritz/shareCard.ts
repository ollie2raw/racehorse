import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

export function buildShareText(vm: DailyFritzSetOverlayViewModel): string {
  const date = vm.shareDate ?? '';
  const result = vm.resultValue ?? '';
  const tier = vm.shareTier?.trim() || 'Fritz';
  const margin = vm.marginValue ?? '';
  const rating = vm.shareRating ? `${vm.shareRating} rating` : '';
  const streak = vm.shareStreak ? `🔥 ${vm.shareStreak} day streak` : '';

  const gameLines = (vm.games ?? [])
    .map((game) => {
      const isSkunk = Boolean(game.skunk);
      const playerScore = game.playerScore;
      const fritzScore = game.fritzScore;
      const won = playerScore > fritzScore;
      const icon = isSkunk ? '🦨' : won ? '✓' : '✗';
      const skunkLabel = isSkunk ? ' SKUNK' : '';
      return `G${game.gameNumber} ${icon}${skunkLabel} ${playerScore}-${fritzScore}`;
    })
    .join('\n');

  const lines = [
    `🏇 Daily Fritz · ${date}`,
    `${result} vs ${tier} Fritz`,
    gameLines,
    `${margin} margin${rating ? ' · ' + rating : ''}`,
    streak,
    'racehorsedoms.vercel.app',
  ].filter(Boolean);

  return lines.join('\n');
}
