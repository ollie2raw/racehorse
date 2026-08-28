import type {
  DailyFritzSetGameResult,
  DailyFritzSetResult,
  DailyFritzVerificationStatus,
} from './api';
import { formatOrdinal, formatOrdinalPlace } from './format';
import {
  getDailyFritzPublishedSetScore,
  getGameSkunkChipLabel,
  getSetSkunkBadge,
  getSkunkOverlayCopy,
} from './skunk';
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
  /**
   * The run's verification state. Omitted by callers that don't know it, which
   * are treated as ranked so nothing regresses to "Unranked" by accident.
   */
  verificationStatus?: DailyFritzVerificationStatus;
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
  verificationStatus,
  onPrimary,
  onSecondary,
}: BuildFinalOverlayInput): DailyFritzSetOverlayViewModel {
  const g = completedGame ?? sr.games[sr.games.length - 1] ?? null;

  const margin = formatMargin(sr.totalPointDiff);
  const marginTone: 'win' | 'loss' | 'idle' =
    sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
  const skunkCopy = g ? getSkunkOverlayCopy(sr, g) : null;
  const setWonPlayer = sr.setWinner === 'player';
  const publishedScore = getDailyFritzPublishedSetScore(sr);

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

  // Only a verified run can be ranked. A caller that doesn't know the status
  // gets the old behaviour rather than a false "Unranked".
  const ranked = verificationStatus === undefined || verificationStatus === 'verified';
  // The daily streak counts consecutive days *completed*, not days won, so a
  // lost set leaves it standing. Worth saying, because a loss reads like a break.
  const streakHeld = !setWonPlayer && (shareStreak ?? 0) > 0;

  const note = !ranked
    ? "The set counted and your streak is intact — it just can't be ranked against players whose runs were verified."
    : streakHeld
      ? 'Your streak survives a loss — only a missed day breaks it.'
      : null;

  // The dossier headline states the outcome; a card that just said "Daily Fritz
  // Complete" for a win and a loss alike made the reader hunt for the result.
  const headline = !ranked
    ? 'Finished, but unranked'
    : (skunkCopy?.headline ?? (setWonPlayer ? 'Set won' : 'Fritz takes it'));

  return {
    kind: 'final',
    runId: `DF-${runDate}`,
    provenance: ranked ? `${titleCaseTier(fritzTier)} · Verified` : 'Unranked',
    ranked,
    streakHeld,
    note,
    eyebrow: 'Daily Fritz',
    headline,
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
    setScoreValue: publishedScore.label,
    marginValue: margin,
    marginTone,
    resultValue: setWonPlayer ? 'Victory' : 'Defeat',
    rankValue: ranked ? formatOrdinalPlace(rank) : null,
    rankShort: ranked ? formatOrdinal(rank) : null,
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
