import type {
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
} from './dailyFritz';

export const DAILY_FRITZ_SKUNK_THRESHOLD = 30;

export type DailyFritzSkunkSide = 'player' | 'fritz';

export function isDailyFritzSkunk(losingScore: number): boolean {
  return Number.isFinite(losingScore) && losingScore < DAILY_FRITZ_SKUNK_THRESHOLD;
}

export function getDailyFritzSkunkBy(playerWon: boolean): DailyFritzSkunkSide {
  return playerWon ? 'player' : 'fritz';
}

export type DailyFritzSkunkGameLabel =
  | 'Game 1 Skunk'
  | 'Skunk Finish'
  | 'Decider Skunk'
  | 'Skunked by Fritz';

export function getDailyFritzSkunkGameLabel(
  gameNumber: DailyFritzSetGameNumber,
  skunkBy: DailyFritzSkunkSide,
): DailyFritzSkunkGameLabel {
  if (gameNumber === 1 && skunkBy === 'fritz') return 'Skunked by Fritz';
  if (gameNumber === 1) return 'Game 1 Skunk';
  if (gameNumber === 2) return 'Skunk Finish';
  return 'Decider Skunk';
}

export function getDailyFritzSkunkWinRank(setResult: DailyFritzSetResult): number {
  if (setResult.setWinner !== 'player') return 0;
  if (setResult.instantSkunk && setResult.skunkBy === 'player' && setResult.skunkGameNumber === 1) {
    return 50;
  }
  if (setResult.hasSkunk && setResult.skunkGameNumber === 2 && setResult.playerGamesWon === 2) {
    return 40;
  }
  if (setResult.playerGamesWon === 2 && setResult.fritzGamesWon === 0 && !setResult.hasSkunk) {
    return 30;
  }
  if (setResult.hasSkunk && setResult.skunkGameNumber === 3 && setResult.playerGamesWon === 2) {
    return 20;
  }
  if (setResult.playerGamesWon === 2 && setResult.fritzGamesWon === 1) {
    return 10;
  }
  return 0;
}

export function getDailyFritzSkunkLossRank(setResult: DailyFritzSetResult): number {
  if (setResult.setWinner !== 'fritz') return 0;
  if (setResult.instantSkunk && setResult.skunkBy === 'fritz' && setResult.skunkGameNumber === 1) {
    return 0;
  }
  if (setResult.playerGamesWon === 0 && setResult.fritzGamesWon === 2) {
    return 10;
  }
  if (setResult.hasSkunk && setResult.skunkBy === 'player' && setResult.playerGamesWon === 1) {
    return 25;
  }
  if (setResult.playerGamesWon === 1 && setResult.fritzGamesWon === 2) {
    return 20;
  }
  return 5;
}

export function resolveDailyFritzSetWins(
  games: DailyFritzSetGameResult[],
  setWinner: 'player' | 'fritz' | undefined,
  instantSkunk: boolean,
): { playerGamesWon: number; fritzGamesWon: number } {
  const playedWins = games.filter((game) => game.playerWon).length;
  const playedLosses = games.length - playedWins;
  if (instantSkunk && setWinner === 'player') {
    return { playerGamesWon: 2, fritzGamesWon: 0 };
  }
  if (instantSkunk && setWinner === 'fritz') {
    return { playerGamesWon: 0, fritzGamesWon: 2 };
  }
  return { playerGamesWon: playedWins, fritzGamesWon: playedLosses };
}

export function appendDailyFritzGameToSet(
  current: DailyFritzSetResult,
  game: Omit<DailyFritzSetGameResult, 'skunk' | 'skunkBy'>,
): DailyFritzSetResult {
  const losingScore = game.playerWon ? game.fritzScore : game.playerScore;
  const skunk = isDailyFritzSkunk(losingScore);
  const skunkBy = skunk ? getDailyFritzSkunkBy(game.playerWon) : null;
  const enrichedGame: DailyFritzSetGameResult = {
    ...game,
    skunk,
    ...(skunkBy ? { skunkBy } : {}),
  };
  const games = [...current.games, enrichedGame];

  if (game.gameNumber === 1 && skunk && skunkBy) {
    const setWinner = skunkBy === 'player' ? 'player' : 'fritz';
    return {
      version: 2,
      format: 'best_of_3',
      playerGamesWon: setWinner === 'player' ? 2 : 0,
      fritzGamesWon: setWinner === 'fritz' ? 2 : 0,
      totalPointDiff: enrichedGame.pointDiff,
      games,
      setWinner,
      hasSkunk: true,
      instantSkunk: true,
      skunkGameNumber: 1,
      skunkBy,
    };
  }

  const playedWins = games.filter((entry) => entry.playerWon).length;
  const playedLosses = games.length - playedWins;
  const setWinner =
    playedWins >= 2 ? 'player' : playedLosses >= 2 ? 'fritz' : undefined;
  const skunkGames = games.filter((entry) => entry.skunk);
  const skunkGameNumber = skunkGames.length
    ? skunkGames[skunkGames.length - 1]!.gameNumber
    : null;
  const latestSkunk = skunkGames.length ? skunkGames[skunkGames.length - 1]! : null;

  return {
    version: 2,
    format: 'best_of_3',
    playerGamesWon: playedWins,
    fritzGamesWon: playedLosses,
    totalPointDiff: games.reduce((sum, entry) => sum + entry.pointDiff, 0),
    games,
    ...(setWinner ? { setWinner } : {}),
    hasSkunk: skunkGames.length > 0,
    instantSkunk: false,
    ...(skunkGameNumber ? { skunkGameNumber } : {}),
    ...(latestSkunk?.skunkBy ? { skunkBy: latestSkunk.skunkBy } : {}),
  };
}

export function normalizeDailyFritzSetSkunkFields(
  games: DailyFritzSetGameResult[],
  rec: Record<string, unknown>,
): Pick<
  DailyFritzSetResult,
  | 'playerGamesWon'
  | 'fritzGamesWon'
  | 'setWinner'
  | 'hasSkunk'
  | 'instantSkunk'
  | 'skunkGameNumber'
  | 'skunkBy'
> {
  const instantSkunk = rec.instantSkunk === true || rec.instant_skunk === true;
  const hasSkunk =
    rec.hasSkunk === true ||
    rec.has_skunk === true ||
    games.some((game) => game.skunk);
  const skunkGameNumberRaw = rec.skunkGameNumber ?? rec.skunk_game_number;
  const skunkGameNumber =
    skunkGameNumberRaw === 1 || skunkGameNumberRaw === 2 || skunkGameNumberRaw === 3
      ? (skunkGameNumberRaw as DailyFritzSetGameNumber)
      : games.find((game) => game.skunk)?.gameNumber ?? null;
  const skunkByRaw = rec.skunkBy ?? rec.skunk_by;
  const skunkBy =
    skunkByRaw === 'player' || skunkByRaw === 'fritz'
      ? skunkByRaw
      : games.find((game) => game.skunkBy)?.skunkBy ?? null;

  const playedWins = games.filter((game) => game.playerWon).length;
  const playedLosses = games.length - playedWins;
  let setWinner: 'player' | 'fritz' | undefined =
    playedWins >= 2 ? 'player' : playedLosses >= 2 ? 'fritz' : undefined;
  if (rec.setWinner === 'player' || rec.setWinner === 'fritz') {
    setWinner = rec.setWinner;
  } else if (rec.set_winner === 'player' || rec.set_winner === 'fritz') {
    setWinner = rec.set_winner;
  }

  const wins = resolveDailyFritzSetWins(games, setWinner, instantSkunk);
  const storedPlayerGamesWon = Number(rec.playerGamesWon ?? rec.player_games_won);
  const storedFritzGamesWon = Number(rec.fritzGamesWon ?? rec.fritz_games_won);

  return {
    playerGamesWon:
      instantSkunk && setWinner
        ? wins.playerGamesWon
        : Number.isFinite(storedPlayerGamesWon)
          ? Math.round(storedPlayerGamesWon)
          : wins.playerGamesWon,
    fritzGamesWon:
      instantSkunk && setWinner
        ? wins.fritzGamesWon
        : Number.isFinite(storedFritzGamesWon)
          ? Math.round(storedFritzGamesWon)
          : wins.fritzGamesWon,
    ...(setWinner ? { setWinner } : {}),
    hasSkunk,
    instantSkunk,
    ...(skunkGameNumber ? { skunkGameNumber } : {}),
    ...(skunkBy ? { skunkBy } : {}),
  };
}
