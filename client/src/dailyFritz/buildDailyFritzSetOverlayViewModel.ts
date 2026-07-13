import { formatOrdinalPlace } from './format';
import { DAILY_FRITZ_CLASSIC_PRACTICE_HINT, playerLostDailyFritzGame } from './practiceHint';
import { getGameSkunkChipLabel, getSetSkunkBadge, getSkunkOverlayCopy } from './skunk';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';
import type { DailyFritzSetGameNumber } from './api';
import {
  formatDateLabel,
  formatMargin,
  getSetTrackerStatus,
  setResultForOverlay,
  titleCaseTier,
} from './dailyFritzScreenHelpers';
import type {
  DailyFritzGameCompletionPayload,
  DailyFritzOverlayState,
  OverlayGameItem,
  OverlayTrackerItem,
} from './dailyFritzScreenTypes';

export type BuildDailyFritzSetOverlayActions = {
  continueSet: () => void;
  submitCompletedGame: (game: DailyFritzGameCompletionPayload) => void;
  closeEmbeddedRun: () => void;
  loadToday: () => void;
  openLeaderboardForRunDate: () => void;
  clearOverlay: () => void;
  retryFinalSubmission: () => void;
  startPractice: () => void;
};

export type BuildDailyFritzSetOverlayContext = {
  todayRunDate?: string;
  todayStreak?: number;
  todayFritzTier?: string;
  activeRunDate?: string;
  activeFritzTier?: string;
  profileGlickoRating?: number | null;
};

export function buildDailyFritzSetOverlayViewModel(
  setOverlay: DailyFritzOverlayState,
  actions: BuildDailyFritzSetOverlayActions,
  context: BuildDailyFritzSetOverlayContext,
): DailyFritzSetOverlayViewModel {
  const base = {
    kind: 'between' as const,
    eyebrow: 'Daily Fritz',
    headline: '',
    subheadline: '',
    objective: null,
    nextLabel: null,
    primaryLabel: '',
    primaryTone: 'default' as const,
    primaryDisabled: false,
    secondaryLabel: null,
    tertiaryLabel: null,
    errorMessage: null,
    gameScoreLabel: '',
    gameScoreValue: '',
    setScoreValue: '',
    marginValue: '',
    marginTone: 'idle' as 'win' | 'loss' | 'idle',
    resultValue: null,
    rankValue: null,
    skunkBadge: null,
    tracker: [] as OverlayTrackerItem[],
    games: [] as OverlayGameItem[],
    onPrimary: () => {},
    onSecondary: () => {},
    onTertiary: () => {},
  };

  if (setOverlay.kind === 'saving') {
    return {
      ...base,
      kind: 'saving' as const,
      headline: 'Saving game',
      subheadline: setOverlay.message,
      primaryLabel: 'Please wait…',
      primaryDisabled: true,
      gameScoreLabel: 'This game',
      gameScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
      setScoreValue: '—',
      marginValue: '—',
    };
  }

  if (setOverlay.kind === 'record-error') {
    return {
      ...base,
      kind: 'record-error' as const,
      headline: 'Couldn’t save progress',
      subheadline: 'Please try again.',
      primaryLabel: 'Retry',
      primaryTone: 'default' as const,
      onPrimary: (): void => {
        void actions.submitCompletedGame(setOverlay.game);
      },
      secondaryLabel: 'Return to Hub',
      onSecondary: () => {
        actions.clearOverlay();
        actions.closeEmbeddedRun();
        void actions.loadToday();
      },
      gameScoreLabel: 'This game',
      gameScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
      setScoreValue: '—',
      marginValue: '—',
      errorMessage: setOverlay.message,
    };
  }

  if (setOverlay.kind === 'finalizing') {
    const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
    return {
      ...base,
      kind: 'finalizing' as const,
      headline: 'Posting set',
      subheadline: setOverlay.message,
      primaryLabel: 'Please wait…',
      primaryDisabled: true,
      gameScoreLabel: 'Set score',
      gameScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
      setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
      marginValue: formatMargin(sr.totalPointDiff),
      marginTone:
        sr.totalPointDiff > 0 ? ('win' as const) : sr.totalPointDiff < 0 ? ('loss' as const) : ('idle' as const),
    };
  }

  if (setOverlay.kind === 'final-error') {
    const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
    return {
      ...base,
      kind: 'final-error' as const,
      headline: 'Couldn’t finish Daily Fritz',
      subheadline: 'Please try again.',
      primaryLabel: 'Retry submission',
      onPrimary: actions.retryFinalSubmission,
      secondaryLabel: 'Back Home',
      onSecondary: () => {
        actions.clearOverlay();
        actions.closeEmbeddedRun();
        void actions.loadToday();
      },
      gameScoreLabel: 'Set score',
      gameScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
      setScoreValue: `${setOverlay.completedGame.playerScore}–${setOverlay.completedGame.fritzScore}`,
      marginValue: formatMargin(sr.totalPointDiff),
      marginTone: 'idle' as const,
      errorMessage: setOverlay.error,
    };
  }

  if (setOverlay.kind === 'between') {
    const g = setOverlay.completedGame;
    const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
    const margin = formatMargin(sr.totalPointDiff);
    const marginTone: 'win' | 'loss' | 'idle' =
      sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
    const skunkCopy = getSkunkOverlayCopy(sr, g);
    return {
      ...base,
      kind: 'between' as const,
      eyebrow: skunkCopy?.eyebrow ?? base.eyebrow,
      headline: skunkCopy?.headline ??
        (Number(g.playerScore) > Number(g.fritzScore)
          ? `You take Game ${g.gameNumber}`
          : `Fritz takes Game ${g.gameNumber}`),
      subheadline: skunkCopy?.subheadline ?? `The set is ${sr.playerGamesWon}-${sr.fritzGamesWon}`,
      skunkBadge: getSetSkunkBadge(sr),
      primaryTone: skunkCopy?.primaryTone ?? ('success' as const),
      gameScoreLabel: `Game ${g.gameNumber}`,
      gameScoreValue: `${Number.isFinite(g.playerScore) ? g.playerScore : 0}–${Number.isFinite(g.fritzScore) ? g.fritzScore : 0}`,
      setScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
      marginValue: margin,
      marginTone,
      primaryLabel: `Start Game ${setOverlay.nextGameNumber}`,
      onPrimary: (): void => {
        void actions.continueSet();
      },
      onSecondary: () => {
        actions.clearOverlay();
        actions.closeEmbeddedRun();
        void actions.loadToday();
      },
      secondaryLabel: 'Return to Hub',
      practiceHint: playerLostDailyFritzGame(g.playerScore, g.fritzScore)
        ? DAILY_FRITZ_CLASSIC_PRACTICE_HINT
        : null,
      tracker: [1, 2, 3].map((n) => ({
        gameNumber: n as DailyFritzSetGameNumber,
        ...getSetTrackerStatus(sr, n as DailyFritzSetGameNumber, setOverlay.nextGameNumber),
      })),
    };
  }

  if (setOverlay.kind === 'final') {
    const sr = setResultForOverlay(setOverlay.setResult) ?? setOverlay.setResult;
    const g = setOverlay.completedGame;
    const margin = formatMargin(sr.totalPointDiff);
    const marginTone: 'win' | 'loss' | 'idle' =
      sr.totalPointDiff > 0 ? 'win' : sr.totalPointDiff < 0 ? 'loss' : 'idle';
    const skunkCopy = getSkunkOverlayCopy(sr, g);
    const games: OverlayGameItem[] = sr.games.map((game) => {
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
    const returnToHub = (): void => {
      actions.clearOverlay();
      actions.closeEmbeddedRun();
      void actions.loadToday();
    };
    const openLeaderboard = (): void => {
      actions.clearOverlay();
      actions.closeEmbeddedRun();
      void actions.loadToday();
      const rd = context.activeRunDate ?? setOverlay.setResult.run_date ?? context.todayRunDate ?? '';
      if (rd) actions.openLeaderboardForRunDate();
    };
    const setWonPlayer = sr.setWinner === 'player';
    const profileRating = context.profileGlickoRating;
    return {
      ...base,
      kind: 'final' as const,
      headline: skunkCopy?.headline ?? 'Daily Fritz Complete',
      subheadline:
        skunkCopy?.subheadline ??
        (setWonPlayer
          ? `You won the set ${sr.playerGamesWon}–${sr.fritzGamesWon}.`
          : `Fritz won the set ${sr.fritzGamesWon}–${sr.playerGamesWon}.`),
      skunkBadge: getSetSkunkBadge(sr),
      primaryTone: skunkCopy?.primaryTone ?? (setWonPlayer ? ('success' as const) : ('default' as const)),
      gameScoreLabel: 'Final game',
      gameScoreValue: `${Number.isFinite(g.playerScore) ? g.playerScore : 0}–${Number.isFinite(g.fritzScore) ? g.fritzScore : 0}`,
      setScoreValue: `${sr.playerGamesWon}–${sr.fritzGamesWon}`,
      marginValue: margin,
      marginTone,
      resultValue: setWonPlayer ? 'Victory' : 'Defeat',
      rankValue: formatOrdinalPlace(setOverlay.rank),
      shareDate: formatDateLabel(context.activeRunDate ?? context.todayRunDate ?? setOverlay.setResult.run_date ?? ''),
      shareTier: titleCaseTier(context.activeFritzTier ?? context.todayFritzTier ?? ''),
      shareRating: typeof profileRating === 'number' && Number.isFinite(profileRating) ? Math.round(profileRating) : undefined,
      shareStreak: context.todayStreak ?? 0,
      games,
      primaryLabel: setOverlay.canViewLeaderboard ? 'View Leaderboard' : 'Back Home',
      onPrimary: setOverlay.canViewLeaderboard ? openLeaderboard : returnToHub,
      onSecondary: actions.startPractice,
      secondaryLabel: 'Practice vs Fritz',
      tertiaryLabel: setOverlay.canViewLeaderboard ? 'Return Home' : null,
      onTertiary: setOverlay.canViewLeaderboard ? returnToHub : (): void => {},
      practiceHint: !setWonPlayer ? DAILY_FRITZ_CLASSIC_PRACTICE_HINT : null,
    };
  }

  return base;
}
