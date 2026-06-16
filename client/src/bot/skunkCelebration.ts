import { isDailyFritzSkunk } from '../dailyFritz/skunk';

export type SkunkCelebrationSide = 'player' | 'fritz';

export function resolveSkunkCelebrationSide(params: {
  active: boolean;
  youScore: number;
  opponentScore: number;
  localWon: boolean | null;
}): SkunkCelebrationSide | null {
  if (!params.active) return null;
  const { youScore, opponentScore, localWon } = params;

  if (localWon === true && isDailyFritzSkunk(opponentScore)) return 'player';
  if (localWon === false && isDailyFritzSkunk(youScore)) return 'fritz';

  if (localWon === null) {
    if (youScore > opponentScore && isDailyFritzSkunk(opponentScore)) return 'player';
    if (opponentScore > youScore && isDailyFritzSkunk(youScore)) return 'fritz';
  }

  return null;
}

export const SKUNK_RUN_DURATION_MS = 2800;
