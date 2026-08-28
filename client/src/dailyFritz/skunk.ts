/**
 * Daily Fritz skunk — client labels and overlays.
 * Rules: docs/daily-fritz-skunk-source-of-truth.md
 * (G1–G2 skunk can end the set; G3 skunk is display/ranking metadata only.)
 */
import type {
  DailyFritzLeaderboardRow,
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
} from './api';

export const DAILY_FRITZ_SKUNK_THRESHOLD = 30;

export type DailyFritzSkunkSide = 'player' | 'fritz';

export function getDailyFritzPublishedSetScore(
  setResult: DailyFritzSetResult,
): { finalScore: number; opponentScore: number; label: string } {
  const score = {
    finalScore: setResult.playerGamesWon,
    opponentScore: setResult.fritzGamesWon,
  };
  return { ...score, label: `${score.finalScore}–${score.opponentScore}` };
}

export function isDailyFritzSkunk(losingScore: number): boolean {
  return Number.isFinite(losingScore) && losingScore < DAILY_FRITZ_SKUNK_THRESHOLD;
}

export function getGameSkunkChipLabel(game: {
  gameNumber: DailyFritzSetGameNumber;
  playerWon: boolean;
  playerScore: number;
  fritzScore: number;
  skunk?: boolean;
  skunkBy?: DailyFritzSkunkSide;
}): string | null {
  if (!game.skunk) return null;
  const prefix =
    game.gameNumber === 1 && game.skunkBy === 'fritz'
      ? 'G1 SKUNKED'
      : game.gameNumber === 1
        ? 'G1 SKUNK'
        : game.gameNumber === 2
          ? 'G2 SKUNK'
          : 'G3 SKUNK';
  return `${prefix} ${game.playerScore}–${game.fritzScore}`;
}

export function getSetSkunkBadgeFromLeaderboardRow(row: DailyFritzLeaderboardRow): string | null {
  const games = row.games;
  if (!games?.length) return null;
  const skunkGame = games.find((game) => game.skunk);
  if (!skunkGame) return null;
  const setResult: DailyFritzSetResult = {
    version: 2,
    format: 'best_of_3',
    playerGamesWon: row.finalScore,
    fritzGamesWon: row.opponentScore,
    totalPointDiff: row.pointDiff,
    games: games.map((game) => ({
      gameNumber: game.gameNumber,
      seed: '',
      playerWon: game.playerWon,
      playerScore: game.playerScore,
      fritzScore: game.fritzScore,
      pointDiff: game.pointDiff,
      completedAt: row.completedAt,
      ...(game.skunk ? { skunk: true } : {}),
      ...(game.skunkBy ? { skunkBy: game.skunkBy } : {}),
    })),
    setWinner: row.won ? 'player' : 'fritz',
    hasSkunk: true,
    instantSkunk: games.length === 1 && skunkGame.gameNumber === 1 && Boolean(skunkGame.skunk),
    skunkGameNumber: skunkGame.gameNumber,
    skunkBy: skunkGame.skunkBy ?? (skunkGame.playerWon ? 'player' : 'fritz'),
  };
  return getSetSkunkBadge(setResult);
}

export function getSetSkunkBadge(setResult: DailyFritzSetResult | null): string | null {
  if (!setResult?.hasSkunk) return null;
  if (setResult.instantSkunk && setResult.skunkBy === 'player') return 'G1 SKUNK';
  if (setResult.instantSkunk && setResult.skunkBy === 'fritz') return 'SKUNKED';
  if (setResult.skunkGameNumber === 2 && setResult.setWinner === 'player') return 'SKUNK FINISH';
  if (setResult.skunkGameNumber === 3 && setResult.setWinner === 'player') return 'DECIDER SKUNK';
  if (setResult.skunkBy === 'player') return 'SKUNK';
  return 'SKUNKED';
}

export type DailyFritzSkunkOverlayCopy = {
  eyebrow: string;
  headline: string;
  subheadline: string;
  primaryTone: 'default' | 'decider' | 'success';
};

export function getSkunkOverlayCopy(
  setResult: DailyFritzSetResult,
  completedGame: DailyFritzSetGameResult,
): DailyFritzSkunkOverlayCopy | null {
  if (!completedGame.skunk) return null;
  const playerWonGame = completedGame.playerWon;
  const setWon = setResult.setWinner === 'player';
  const setLost = setResult.setWinner === 'fritz';

  if (completedGame.gameNumber === 1 && setResult.instantSkunk && playerWonGame && setWon) {
    return {
      eyebrow: 'Daily Fritz',
      headline: 'Skunk',
      subheadline: 'You beat Fritz before he reached 30. Set won 2–0.',
      primaryTone: 'success',
    };
  }
  if (completedGame.gameNumber === 1 && setResult.instantSkunk && !playerWonGame && setLost) {
    return {
      eyebrow: 'Daily Fritz',
      headline: 'Skunked by Fritz',
      subheadline: 'Fritz won before you reached 30. Set lost 0–2.',
      primaryTone: 'default',
    };
  }
  if (completedGame.gameNumber === 2 && playerWonGame && setWon) {
    const setLine = `${setResult.playerGamesWon}–${setResult.fritzGamesWon}`;
    return {
      eyebrow: 'Daily Fritz',
      headline: 'Skunk finish',
      subheadline: `You skunked Fritz in game 2. Set won ${setLine}.`,
      primaryTone: 'success',
    };
  }
  if (completedGame.gameNumber === 2 && !playerWonGame && setLost) {
    const setLine = `${setResult.playerGamesWon}–${setResult.fritzGamesWon}`;
    return {
      eyebrow: 'Daily Fritz',
      headline: 'Skunked in Game 2',
      subheadline: `Fritz skunked you in game 2. Set lost ${setLine}.`,
      primaryTone: 'default',
    };
  }
  if (completedGame.gameNumber === 3 && playerWonGame && setWon) {
    return {
      eyebrow: 'Daily Fritz',
      headline: 'Decider skunk',
      subheadline: 'You crushed the deciding game before Fritz reached 30.',
      primaryTone: 'success',
    };
  }
  return null;
}
