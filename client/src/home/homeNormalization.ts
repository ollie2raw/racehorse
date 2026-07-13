import type { DailyFritzTodayResponse } from '../dailyFritz/api';
import type { DailyPuzzleTodayResponse } from '../dailyPuzzle/types';
import type { HomeDailySummaryResponse } from '../features/daily/homeDailySummaryApi';
import type { FriendWithPresence, FeedItem, RivalEntry } from '../social/socialApi';
import type { RankingProfile } from '../stats/statsTypes';
import type { JourneyProgress } from '../journey/journeyTypes';
import type {
  HomeActivityItem,
  DailySummaryBaseModel,
  HomeFriendPresence,
  HomeJourneyModel,
  HomeRankingModel,
  HomeRival,
  HomeSocialModel,
  HomeTournamentModel,
  DailyFritzModel,
  DailyPuzzleModel,
} from './homeTypes';

type TournamentSnapshot = {
  upcoming: Array<{ id: string }>;
  registrations: Array<{ tournament_id: string; status: string }>;
  activeTournamentId: string | null;
  tournamentPhase: string | null;
  recoveryMatch: {
    matchId: string;
    tournamentId: string;
    round: 1 | 2 | 3;
    opponentId: string | null;
    opponentUsername: string | null;
    matchStatus: 'ready' | 'in_progress';
    readyDeadlineAt: string | null;
  } | null;
};

export function normalizeDailyFritz(raw: DailyFritzTodayResponse): DailyFritzModel {
  const state = raw.attempt_status === 'completed'
    ? 'completed'
    : raw.attempt_status === 'started'
      ? 'started'
      : 'unstarted';
  const won = raw.set_result?.setWinner === 'player' || raw.set_result?.won === true;
  const lost = raw.set_result?.setWinner === 'fritz' || raw.set_result?.won === false;
  const completedAt = raw.set_result?.games
    ?.map((game) => game.completedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    state,
    outcome: state === 'completed' ? (won ? 'win' : lost ? 'loss' : null) : null,
    rank: raw.rank ?? null,
    currentGame: raw.current_game_number ?? null,
    streak: raw.streak ?? null,
    runDate: raw.run_date ?? null,
    completedAt,
  };
}

export function normalizeDailyPuzzle(raw: DailyPuzzleTodayResponse): DailyPuzzleModel {
  return {
    state: raw.attemptStatus === 'completed'
      ? 'completed'
      : raw.attemptStatus === 'started'
        ? 'started'
        : 'unstarted',
    score: raw.attempt?.totalScore ?? null,
    runDate: raw.runDate ?? null,
    nextAvailableSlotIndex: raw.nextAvailableSlotIndex ?? null,
    completedAt: raw.attempt?.completedAt ?? null,
  };
}

export function normalizeDailySummary(raw: HomeDailySummaryResponse): DailySummaryBaseModel {
  return {
    dateKey: raw.today ?? null,
    week: Array.isArray(raw.week)
      ? raw.week.map((day) => ({
          dateKey: day.dateKey,
          label: day.label,
          fritzCompleted: day.fritzCompleted,
          puzzleCompleted: day.puzzleCompleted,
          complete: day.complete,
          isToday: day.isToday,
          isFuture: day.isFuture,
        }))
      : [],
    weeklyCompletedCount: Number.isFinite(raw.weeklyCompletedCount) ? raw.weeklyCompletedCount : null,
    currentStreakCount: Number.isFinite(raw.currentStreakCount) ? raw.currentStreakCount : null,
    todayComplete: typeof raw.todayComplete === 'boolean' ? raw.todayComplete : null,
  };
}

export function normalizeSocial(
  friends: FriendWithPresence[],
  activity: FeedItem[],
  rivals: RivalEntry[],
): HomeSocialModel {
  const normalizedFriends: HomeFriendPresence[] = friends.map((friend) => ({
    id: friend.id,
    userId: friend.userId,
    username: friend.username,
    status: friend.presence_status,
    currentMode: friend.current_mode,
  }));
  const normalizedActivity: HomeActivityItem[] = activity.map((item) => ({
    id: item.id,
    userId: item.user_id,
    username: item.username,
    type: item.type,
    metadata: item.metadata,
    createdAt: item.created_at,
  }));
  const normalizedRivals: HomeRival[] = rivals.map((rival) => ({
    userId: rival.userId,
    username: rival.username,
    gamesPlayed: rival.gamesPlayed,
    winsAgainst: rival.winsAgainst,
    lossesAgainst: rival.lossesAgainst,
    rating: rival.rating,
  }));

  return { friends: normalizedFriends, activity: normalizedActivity, rivals: normalizedRivals };
}

export function normalizeTournament(snapshot: TournamentSnapshot): HomeTournamentModel {
  return {
    upcomingCount: snapshot.upcoming.length,
    registeredTournamentIds: snapshot.registrations
      .filter((registration) => ['registered', 'active', 'winner'].includes(registration.status))
      .map((registration) => registration.tournament_id),
    activeTournamentId: snapshot.activeTournamentId,
    phase: snapshot.tournamentPhase,
    recoveryMatch: snapshot.recoveryMatch,
  };
}

export function normalizeJourney(
  progress: JourneyProgress,
  summary: { activeChapter: { chapterId: string; title: string }; activeChapterCompleted: number; activeChapterTotal: number; totalCompleted: number; hasAnyProgress: boolean },
): HomeJourneyModel {
  return {
    activeChapterId: summary.activeChapter.chapterId,
    activeChapterTitle: summary.activeChapter.title,
    completedNodes: summary.activeChapterCompleted,
    totalNodes: summary.activeChapterTotal,
    totalCompleted: summary.totalCompleted,
    hasAnyProgress: summary.hasAnyProgress,
    lastVisitedNodeId: progress.chapters[summary.activeChapter.chapterId]?.lastVisitedNodeId ?? null,
    updatedAt: progress.updatedAt ?? null,
  };
}

export function normalizeRanking(raw: RankingProfile): HomeRankingModel {
  return {
    rating: Number.isFinite(raw.glicko_rating) ? raw.glicko_rating : null,
    peakRating: Number.isFinite(raw.peak_rating) ? raw.peak_rating : null,
    globalRank: raw.rank ?? null,
    rankedGamesPlayed: Number.isFinite(raw.ranked_games_played) ? raw.ranked_games_played : null,
    currentWinStreak: Number.isFinite(raw.currentWinStreak) ? raw.currentWinStreak : null,
    provisional: raw.provisional ?? null,
  };
}
