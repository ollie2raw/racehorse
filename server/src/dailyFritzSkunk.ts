import type {
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
} from './dailyFritz';

/**
 * Daily Fritz skunk rules (see docs/daily-fritz-skunk-source-of-truth.md).
 *
 * Definition: winning a game while the opponent finishes under 30 points (games 1–3).
 *
 * Mechanical set impact (games 1–2 only): a skunk counts as two game wins and ends the
 * best-of-3 set immediately — including game 2 after a split (e.g. player wins G1, Fritz
 * skunks player in G2 → Fritz wins the full set at 1–1 in games played).
 *
 * Game 3 skunk: recorded for display/ranking only; the set is already decided by the decider.
 */

export const DAILY_FRITZ_SKUNK_THRESHOLD = 30;

export type DailyFritzSkunkSide = 'player' | 'fritz';

export function isDailyFritzSkunk(losingScore: number): boolean {
  // Opponent under 30 at game end — applies to games 1, 2, and 3 (G3 is metadata-only downstream).
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
  if (
    setResult.setWinner !== 'player' ||
    !setResult.hasSkunk ||
    setResult.skunkBy !== 'player' ||
    !setResult.skunkGameNumber
  ) return 0;

  // Every player-earned skunk outranks a normal set win. Earlier skunks are
  // stronger; equal-game skunks fall through to total point differential.
  return 4 - setResult.skunkGameNumber;
}

export function getDailyFritzPublishedSetScore(
  setResult: DailyFritzSetResult,
): { finalScore: number; opponentScore: number } {
  return {
    finalScore: setResult.playerGamesWon,
    opponentScore: setResult.fritzGamesWon,
  };
}

export function getDailyFritzSkunkLossRank(setResult: DailyFritzSetResult): number {
  if (setResult.setWinner !== 'fritz') return 0;
  if (setResult.instantSkunk && setResult.skunkBy === 'fritz' && setResult.skunkGameNumber === 1) {
    return 0;
  }
  if (
    setResult.hasSkunk &&
    setResult.skunkGameNumber === 2 &&
    setResult.skunkBy === 'fritz' &&
    setResult.setWinner === 'fritz' &&
    setResult.playerGamesWon === 1 &&
    setResult.fritzGamesWon === 1
  ) {
    return 8;
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

export type DailyFritzSetWinner = 'player' | 'fritz';

export function resolveDailyFritzSetWinnerFromGames(
  playedWins: number,
  playedLosses: number,
): DailyFritzSetWinner | undefined {
  if (playedWins >= 2) return 'player';
  if (playedLosses >= 2) return 'fritz';
  return undefined;
}

/**
 * Game 2 skunk with the set tied 1–1 in games played: the skunking side wins the full set
 * immediately even though only one game is recorded for each side. Other G2 skunk paths
 * (2–0 or 0–2 after G1) are resolved by normal two-win logic in resolveDailyFritzSetWinnerFromGames.
 */
export function resolveGame2SkunkSetWinner(
  gameNumber: DailyFritzSetGameNumber,
  skunk: boolean,
  gamesPlayed: number,
  playedWins: number,
  playedLosses: number,
  playerWonGame: boolean,
): DailyFritzSetWinner | undefined {
  if (
    gameNumber === 2 &&
    skunk &&
    gamesPlayed === 2 &&
    playedWins === 1 &&
    playedLosses === 1
  ) {
    return playerWonGame ? 'player' : 'fritz';
  }
  return undefined;
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

  // Game 1 skunk: mechanical 2–0 / 0–2 set win (instantSkunk).
  if (game.gameNumber === 1 && skunk && skunkBy) {
    const setWinner: DailyFritzSetWinner = skunkBy === 'player' ? 'player' : 'fritz';
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
  let setWinner: DailyFritzSetWinner | undefined = resolveDailyFritzSetWinnerFromGames(
    playedWins,
    playedLosses,
  );

  const game2SkunkWinner = resolveGame2SkunkSetWinner(
    game.gameNumber,
    skunk,
    games.length,
    playedWins,
    playedLosses,
    game.playerWon,
  );
  if (game2SkunkWinner) {
    setWinner = game2SkunkWinner;
  }

  // Game 3+: skunk flag on the game is metadata/ranking only (instantSkunk stays false).
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
  let setWinner: DailyFritzSetWinner | undefined = resolveDailyFritzSetWinnerFromGames(
    playedWins,
    playedLosses,
  );
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
