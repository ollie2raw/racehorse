import type { DailyFritzSetGameResult, DailyFritzSetResult } from './api';
import { formatOrdinalPlace } from './format';
import { getGameSkunkChipLabel, getSetSkunkBadge, getSkunkOverlayCopy } from './skunk';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

function formatMargin(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value}`;
}

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function titleCaseTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export type BuildFinalOverlayInput = {
  setResult: DailyFritzSetResult;
  completedGame?: DailyFritzSetGameResult | null;
  rank: number | null;
  runDate: string;
  fritzTier: string;
  shareRating?: number;
  shareStreak?: number;
  canViewLeaderboard: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
};

export function buildDailyFritzFinalOverlayViewModel({
  setResult: sr,
  completedGame,
  rank,
  runDate,
  fritzTier,
  shareRating,
  shareStreak,
  canViewLeaderboard,
  onPrimary,
  onSecondary,
}: BuildFinalOverlayInput): DailyFritzSetOverlayViewModel {
  const g = completedGame ?? sr.games[sr.games.length - 1] ?? null;

  const margin = formatMargin(sr.totalPointDiff);
  const marginTone: 'win' | 'loss' | 'idle' =
    sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
  const skunkCopy = g ? getSkunkOverlayCopy(sr, g) : null;
  const setWonPlayer = sr.setWinner === 'player';

  const games = sr.games.map((game) => {
    const playerScore = Number.isFinite(game.playerScore) ? game.playerScore : 0;
    const fritzScore = Number.isFinite(game.fritzScore) ? game.fritzScore : 0;
    const youWon = playerScore > fritzScore;
    return {
      gameNumber: game.gameNumber,
      value: `${playerScore}–${fritzScore}`,
      tone: youWon ? ('win' as const) : ('loss' as const),
      playerScore,
      fritzScore,
      skunk: Boolean(game.skunk),
      skunkLabel: getGameSkunkChipLabel(game),
    };
  });

  return {
    kind: 'final',
    eyebrow: 'Daily Fritz',
    headline: skunkCopy?.headline ?? 'Daily Fritz Complete',
    subheadline:
      skunkCopy?.subheadline ??
      (setWonPlayer
        ? `You won the set ${sr.playerGamesWon}–${sr.fritzGamesWon}.`
        : `Fritz won the set ${sr.fritzGamesWon}–${sr.playerGamesWon}.`),
    objective: null,
    nextLabel: null,
    skunkBadge: getSetSkunkBadge(sr),
    primaryTone: skunkCopy?.primaryTone ?? (setWonPlayer ? 'success' : 'default'),
    gameScoreLabel: 'Final game',
    gameScoreValue: g
      ? `${Number.isFinite(g.playerScore) ? g.playerScore : 0}–${Number.isFinite(g.fritzScore) ? g.fritzScore : 0}`
      : '—',
    setScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
    marginValue: margin,
    marginTone,
    resultValue: setWonPlayer ? 'Victory' : 'Defeat',
    rankValue: formatOrdinalPlace(rank),
    shareDate: formatDateLabel(runDate),
    shareTier: titleCaseTier(fritzTier),
    shareRating,
    shareStreak,
    games,
    tracker: [],
    primaryLabel: canViewLeaderboard ? 'View Leaderboard' : 'Back Home',
    onPrimary,
    secondaryLabel: canViewLeaderboard ? 'Back Home' : null,
    onSecondary,
    primaryDisabled: false,
    errorMessage: null,
  };
}
