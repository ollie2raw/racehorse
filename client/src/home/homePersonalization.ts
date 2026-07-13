import type {
  HomeActivityTimeline,
  HomeActivityTimelineEvent,
  HomeCommandCenterModel,
  HomePersonalization,
  HomePersonalizationPrimaryMode,
} from './homeTypes';
import { buildHomeActivityTimeline } from './homeActivityTimeline';

export const HOME_PERSONALIZATION_WEIGHTS = {
  dailyFritzCompleted: 4,
  dailyFritzStarted: 2,
  dailyPuzzleCompleted: 3,
  dailyPuzzleStarted: 1,
  weeklyDailyCompletion: 1,
  journeyProgress: 5,
  tournamentActivity: 6,
  rankedGames: 3,
  rivalGames: 2,
  socialActivity: 4,
  friendOnline: 2,
} as const;

type ModeScores = Record<HomePersonalizationPrimaryMode, number>;

const MODE_ORDER: HomePersonalizationPrimaryMode[] = [
  'tournament',
  'journey',
  'daily_fritz',
  'daily_puzzle',
  'multiplayer',
  'friends',
];

const SOURCE_FOR_EVENT: Record<HomeActivityTimelineEvent['source'], keyof HomeActivityTimeline['sourceCoverage']> = {
  daily_fritz: 'dailyFritz',
  daily_puzzle: 'dailyPuzzle',
  journey: 'journey',
  tournament: 'tournament',
  social_presence: 'socialPresence',
  social_activity: 'socialActivity',
  daily_summary: 'dailySummary',
};

function usableEvent(event: HomeActivityTimelineEvent, timeline: HomeActivityTimeline): boolean {
  return timeline.sourceCoverage[SOURCE_FOR_EVENT[event.source]] === 'ready';
}

function completedDays(model: HomeCommandCenterModel): number {
  if (model.daily.summary.status !== 'ready' || !model.daily.summary.data) return 0;
  return model.daily.summary.data.week.filter((day) => day.complete && !day.isFuture).length;
}

function hasEvidence(scores: ModeScores, historicalEvidence: number): boolean {
  return Object.values(scores).some((score) => score > 0) || historicalEvidence > 0;
}

function modeFor(scores: ModeScores): HomePersonalizationPrimaryMode {
  if (Object.values(scores).every((score) => score === 0)) return 'daily_puzzle';
  return MODE_ORDER.reduce((best, mode) => {
    if (scores[mode] > scores[best]) return mode;
    return best;
  }, MODE_ORDER[0]);
}

function confidenceFor(scores: ModeScores, profile: HomePersonalization['profile'], historicalEvidence: number): number {
  if (profile === 'new_player') return 100;
  const values = Object.values(scores).filter((score) => score > 0).sort((a, b) => b - a);
  if (values.length === 0) return historicalEvidence > 0 ? 60 : 100;
  const total = values.reduce((sum, value) => sum + value, 0);
  const dominance = (values[0] - (values[1] ?? 0)) / total;
  return Math.max(50, Math.min(100, Math.round(55 + dominance * 45)));
}

function profileFor(
  scores: ModeScores,
  historicalEvidence: number,
  todayEvidence: boolean,
): HomePersonalization['profile'] {
  if (!hasEvidence(scores, historicalEvidence)) return 'new_player';

  const ranked = [
    { mode: 'journey', score: scores.journey },
    { mode: 'daily', score: scores.daily_fritz + scores.daily_puzzle },
    { mode: 'competitive', score: scores.tournament + scores.multiplayer },
    { mode: 'social', score: scores.friends },
  ]
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.mode.localeCompare(b.mode));
  if (ranked.length >= 2 && ranked[1].score >= 3 && ranked[0].score - ranked[1].score <= 2) {
    return 'mixed_player';
  }
  if (!todayEvidence && historicalEvidence > 0) return 'returning_player';

  switch (ranked[0]?.mode) {
    case 'journey': return 'learning_player';
    case 'daily': return 'daily_player';
    case 'competitive': return 'competitive_player';
    case 'social': return 'social_player';
    default: return 'returning_player';
  }
}

function reasoningFor(
  model: HomeCommandCenterModel,
  timeline: HomeActivityTimeline,
  scores: ModeScores,
): string[] {
  const reasons: string[] = [];
  const events = timeline.events.filter((event) => usableEvent(event, timeline));
  if (events.some((event) => event.type === 'journey_progressed')) reasons.push('Journey progression detected');
  if (events.some((event) => event.type === 'daily_fritz_completed')) reasons.push('Completed Daily Fritz regularly');
  if (events.some((event) => event.type === 'daily_puzzle_completed')) reasons.push('Completed Daily Puzzle');
  if (events.some((event) => event.type === 'tournament_match_ready' || event.type === 'tournament_match_in_progress')) reasons.push('Active tournament recovery');
  if (events.some((event) => event.type === 'player_social_activity' || event.type === 'friend_online')) reasons.push('Frequent friend interaction');
  if (model.stats.status === 'ready' && (model.stats.data?.rankedGamesPlayed ?? 0) > 0) reasons.push('Ranked play history detected');
  if (scores.daily_fritz + scores.daily_puzzle >= 5 && completedDays(model) >= 2) reasons.push('Daily ritual pattern detected');
  return reasons;
}

function emphasisFor(scores: ModeScores): HomePersonalization['emphasis'] {
  const daily = scores.daily_fritz + scores.daily_puzzle;
  const learning = scores.journey;
  const competitive = scores.tournament + scores.multiplayer;
  const social = scores.friends;
  const max = Math.max(1, daily, learning, competitive, social);
  return {
    daily: Math.round((daily / max) * 100),
    learning: Math.round((learning / max) * 100),
    competitive: Math.round((competitive / max) * 100),
    social: Math.round((social / max) * 100),
  };
}

function secondaryModes(scores: ModeScores, primaryMode: HomePersonalizationPrimaryMode): HomePersonalization['secondaryModes'] {
  const routeFor: Record<HomePersonalizationPrimaryMode, HomePersonalization['secondaryModes'][number]> = {
    journey: 'journey',
    daily_fritz: 'dailyFritz',
    daily_puzzle: 'daily',
    multiplayer: 'multiplayer',
    tournament: 'tournament',
    friends: 'friends',
  };
  return MODE_ORDER
    .filter((mode) => mode !== primaryMode && scores[mode] > 0)
    .sort((a, b) => scores[b] - scores[a] || MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b))
    .map((mode) => routeFor[mode]);
}

/** Classifies the player's current Home context using only authoritative state. */
export function calculateHomePersonalization(
  model: HomeCommandCenterModel,
  nowMs = Date.now(),
): HomePersonalization {
  const timeline = model.activityTimeline ?? buildHomeActivityTimeline(model, nowMs);
  const scores: ModeScores = {
    journey: 0,
    daily_fritz: 0,
    daily_puzzle: 0,
    multiplayer: 0,
    tournament: 0,
    friends: 0,
  };
  const events = timeline.events.filter((event) => usableEvent(event, timeline));

  for (const event of events) {
    switch (event.type) {
      case 'daily_fritz_completed': scores.daily_fritz += HOME_PERSONALIZATION_WEIGHTS.dailyFritzCompleted; break;
      case 'daily_fritz_started': scores.daily_fritz += HOME_PERSONALIZATION_WEIGHTS.dailyFritzStarted; break;
      case 'daily_puzzle_completed': scores.daily_puzzle += HOME_PERSONALIZATION_WEIGHTS.dailyPuzzleCompleted; break;
      case 'daily_puzzle_started': scores.daily_puzzle += HOME_PERSONALIZATION_WEIGHTS.dailyPuzzleStarted; break;
      case 'journey_progressed': scores.journey += HOME_PERSONALIZATION_WEIGHTS.journeyProgress; break;
      case 'tournament_match_ready':
      case 'tournament_match_in_progress': scores.tournament += HOME_PERSONALIZATION_WEIGHTS.tournamentActivity; break;
      case 'friend_online': scores.friends += HOME_PERSONALIZATION_WEIGHTS.friendOnline; break;
      case 'player_social_activity': scores.friends += HOME_PERSONALIZATION_WEIGHTS.socialActivity; break;
      case 'weekly_daily_goal_completed': scores.daily_fritz += HOME_PERSONALIZATION_WEIGHTS.weeklyDailyCompletion; break;
    }
  }

  const days = completedDays(model);
  if (model.daily.summary.status === 'ready') scores.daily_fritz += Math.min(days, 7) * HOME_PERSONALIZATION_WEIGHTS.weeklyDailyCompletion;
  const rankedGames = model.stats.status === 'ready' ? model.stats.data?.rankedGamesPlayed ?? 0 : 0;
  if (rankedGames > 0) scores.multiplayer += HOME_PERSONALIZATION_WEIGHTS.rankedGames;
  const rivalGames = model.social.rivals.status === 'ready'
    ? (model.social.rivals.data ?? []).reduce((sum, rival) => sum + rival.gamesPlayed, 0)
    : 0;
  if (rivalGames > 0) scores.multiplayer += HOME_PERSONALIZATION_WEIGHTS.rivalGames;

  const historicalEvidence = rankedGames + rivalGames + days;
  const todayEvidence = events.some((event) => event.type !== 'friend_online' || event.source === 'social_presence') ||
    (model.daily.summary.status === 'ready' && model.daily.summary.data?.todayComplete === true);
  const profile = profileFor(scores, historicalEvidence, todayEvidence);
  const primaryMode = modeFor(scores);
  return {
    profile,
    confidence: confidenceFor(scores, profile, historicalEvidence),
    primaryMode,
    secondaryModes: secondaryModes(scores, primaryMode),
    emphasis: emphasisFor(scores),
    reasoning: reasoningFor(model, timeline, scores),
  };
}
