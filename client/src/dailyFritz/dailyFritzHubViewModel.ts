import type { DailyFritzSetResult, DailyFritzTodayResponse } from './api';
import { formatOrdinalPlace } from './format';
import {
  formatCountdownHms,
  formatDateLabel,
  secondsUntilNextPacificMidnight,
  tierDisplayLabel,
  titleCaseTier,
} from './dailyFritzScreenHelpers';
import type { DailyFritzGameCardState } from './dailyFritzScreenTypes';

export type DailyFritzHubGameCard = {
  n: number;
  statusSub: string;
  unlockHint: string | null;
  showPlay: boolean;
  scoreLine: string | null;
  gameState: DailyFritzGameCardState;
  isLocked: boolean;
  isDone: boolean;
  isActive: boolean;
  isNotNeeded: boolean;
};

export type DailyFritzHubViewModel = {
  dateLabel: string;
  tierLabel: string;
  formatLabel: string;
  streakLabel: string;
  winTarget: number;
  isComplete: boolean;
  isStarted: boolean;
  primaryCtaLabel: string;
  games: DailyFritzHubGameCard[];
  fritzTierShort: string;
  leaderboardRankLabel: string | null;
  leaderboardSupportLine: string;
  setStatusLabel: string;
  setStakesLabel: string;
  opponentBadgeLabel: string;
  resetCountdownLabel: string;
};

export function buildDailyFritzHubGameCards(
  todaySetResult: DailyFritzSetResult | null,
  options: {
    isComplete: boolean;
    isStarted: boolean;
    startActionPending: boolean;
    winTarget: number;
  },
): DailyFritzHubGameCard[] {
  const { isComplete, isStarted, startActionPending, winTarget } = options;
  const matchClinched =
    todaySetResult != null &&
    (todaySetResult.setWinner != null ||
      todaySetResult.playerGamesWon >= 2 ||
      todaySetResult.fritzGamesWon >= 2);
  const skunkGameNumber =
    todaySetResult?.skunkGameNumber ?? todaySetResult?.games.find((game) => game.skunk)?.gameNumber ?? null;

  return [1, 2, 3].map((n) => {
    const res = todaySetResult?.games.find((g) => g.gameNumber === n);
    const isNext = todaySetResult ? todaySetResult.games.length + 1 === n && !todaySetResult.setWinner : n === 1;
    const skippedAfterSkunk = !res && skunkGameNumber != null && n > skunkGameNumber;
    const gameNotRequired = !res && (skippedAfterSkunk || (n === 3 && matchClinched));
    const gameState: DailyFritzGameCardState = res
      ? res.playerWon
        ? 'won'
        : 'lost'
      : gameNotRequired
        ? 'not-needed'
        : isNext
          ? 'active'
          : 'locked';
    const isDone = gameState === 'won' || gameState === 'lost';
    const isLocked = gameState === 'locked';
    const isNotNeeded = gameState === 'not-needed';
    const isActive = gameState === 'active';

    let statusSub: string;
    let unlockHint: string | null = null;
    let showPlay = false;
    if (res) {
      statusSub = res.playerWon ? 'Won' : 'Lost';
    } else if (isActive) {
      statusSub = n === 3 ? 'Decider' : 'Your move';
      showPlay = !isComplete && !startActionPending;
      unlockHint = isStarted ? 'Resume now' : `First to ${winTarget}`;
    } else if (isNotNeeded) {
      statusSub = 'Not needed';
      unlockHint = skippedAfterSkunk && skunkGameNumber != null ? `Skunk ended set in G${skunkGameNumber}` : 'Game 3 not required';
    } else {
      statusSub = n === 3 ? 'Decider' : 'Locked';
      unlockHint =
        n === 2 ? 'Defeat Fritz in Game 1 to unlock' : n === 3 ? 'Decider if needed' : null;
    }

    const scoreLine = res ? `${res.playerScore}–${res.fritzScore}` : null;

    return {
      n,
      statusSub,
      unlockHint,
      showPlay,
      scoreLine,
      gameState,
      isLocked,
      isDone,
      isActive,
      isNotNeeded,
    };
  });
}

export function buildDailyFritzHubViewModel(
  today: DailyFritzTodayResponse | null,
  todaySetResult: DailyFritzSetResult | null,
  countdownTick: number,
  startActionPending: boolean,
): DailyFritzHubViewModel {
  void countdownTick;

  const dateLabel = today ? formatDateLabel(today.run_date) : '—';
  const tierLabel = today ? tierDisplayLabel(today.fritz_tier) : '—';
  const formatLabel = today ? 'Best of 3' : '—';
  const streakLabel = today ? `${today.streak} day${today.streak === 1 ? '' : 's'}` : '0 days';
  const winTarget = today?.winning_score ?? 60;

  const isComplete = today?.attempt_status === 'completed';
  const isStarted = today?.attempt_status === 'started';

  const primaryCtaLabel = isComplete
    ? "View Today's Result"
    : isStarted
      ? "Resume Today's Set"
      : "Play Today's Set";

  const games = buildDailyFritzHubGameCards(todaySetResult, {
    isComplete,
    isStarted,
    startActionPending,
    winTarget,
  });

  const fritzTierShort = today ? titleCaseTier(today.fritz_tier) : 'Elite';
  const leaderboardRankLabel =
    isComplete && today?.rank != null ? formatOrdinalPlace(today.rank) : null;
  const leaderboardSupportLine = leaderboardRankLabel
    ? `${leaderboardRankLabel} today`
    : isComplete
      ? today?.verification_status === 'verified'
        ? 'Verified result recorded'
        : 'Result saved locally — not ranked'
      : today?.competitive_verification_available === false
        ? 'Competitive verification temporarily unavailable'
        : 'Play today to appear on the leaderboard';
  const setStatusLabel = isComplete ? 'Complete' : isStarted ? 'In Progress' : 'Ready';
  const setStakesLabel = isComplete
    ? 'Return tomorrow for a new set'
    : today?.competitive_verification_available === false
      ? 'Daily challenge — unranked'
      : 'Verified Daily Challenge';
  const opponentBadgeLabel = isComplete ? 'Set Complete' : isStarted ? 'Resume Available' : 'Bot Opponent';
  const resetCountdownLabel = formatCountdownHms(secondsUntilNextPacificMidnight(new Date()));

  return {
    dateLabel,
    tierLabel,
    formatLabel,
    streakLabel,
    winTarget,
    isComplete,
    isStarted,
    primaryCtaLabel,
    games,
    fritzTierShort,
    leaderboardRankLabel,
    leaderboardSupportLine,
    setStatusLabel,
    setStakesLabel,
    opponentBadgeLabel,
    resetCountdownLabel,
  };
}
