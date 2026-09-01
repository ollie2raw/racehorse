import type { DailyFritzSetGameNumber } from './api';

const SET_GAME_NUMBERS: DailyFritzSetGameNumber[] = [1, 2, 3];
const DAILY_FRITZ_LAUNCH_DATE = new Date('2026-04-10');

import { SITE_DOMAIN } from '../lib/siteUrl';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

function calculatePuzzleNumber(runDate: string): number {
  const date = new Date(`${runDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 1;
  const daysSinceLaunch = Math.floor(
    (date.getTime() - DAILY_FRITZ_LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(1, daysSinceLaunch + 1);
}

function buildEmojiGrid(vm: DailyFritzSetOverlayViewModel): string {
  const byNumber = new Map((vm.games ?? []).map((game) => [game.gameNumber, game] as const));
  const emojis = SET_GAME_NUMBERS
    .map((gameNumber) => {
      const game = byNumber.get(gameNumber);
      if (!game) return '⬜';
      const won = game.playerScore > game.fritzScore;
      return won ? '🟩' : '🟥';
    })
    .join('');
  return emojis;
}

export function buildShareText(vm: DailyFritzSetOverlayViewModel): string {
  const runDate = vm.shareRunDate ?? '';
  const margin = vm.marginValue ?? '';
  const streak = vm.shareStreak ? `${vm.shareStreak} day streak` : '';
  const puzzleNumber = calculatePuzzleNumber(runDate);

  const emojiGrid = buildEmojiGrid(vm);
  const statLine = [margin, streak].filter(Boolean).join(' · ');

  return [
    `Racehorse Daily Fritz #${puzzleNumber}`,
    emojiGrid,
    '',
    statLine,
    SITE_DOMAIN,
  ].filter(Boolean).join('\n');
}
