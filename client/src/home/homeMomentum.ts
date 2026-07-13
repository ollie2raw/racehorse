import type {
  HomeActivityTimeline,
  HomeCommandCenterModel,
  HomeMomentum,
  HomeMomentumCompletedItem,
  HomeMomentumLevel,
  HomeMomentumOpportunity,
  HomeMomentumReason,
  HomeMomentumReasonId,
} from './homeTypes';
import { buildHomeActivityTimeline } from './homeActivityTimeline';

export const HOME_MOMENTUM_WEIGHTS: Record<HomeMomentumReasonId, number> = {
  daily_fritz_started: 12,
  daily_fritz_completed: 40,
  daily_puzzle_started: 8,
  daily_puzzle_completed: 25,
  daily_ritual_completed: 25,
  journey_progressed: 15,
  tournament_active: 20,
  social_activity: 10,
};

const DAILY_MOMENTUM_TARGET =
  HOME_MOMENTUM_WEIGHTS.daily_fritz_completed + HOME_MOMENTUM_WEIGHTS.daily_puzzle_completed;

function isReady(status: string): boolean {
  return status === 'ready';
}

function isSameCalendarDay(value: string | null, nowMs: number): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date(nowMs);
  if (!Number.isFinite(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function reason(id: HomeMomentumReasonId, label: string): HomeMomentumReason {
  return { id, label, points: HOME_MOMENTUM_WEIGHTS[id] };
}

function levelFor(input: {
  score: number;
  dailyComplete: boolean;
  tournamentInProgress: boolean;
  socialActivity: boolean;
  tournamentActive: boolean;
  canDeclareCompleted: boolean;
}): HomeMomentumLevel {
  if (input.dailyComplete && input.canDeclareCompleted) return 'completed';
  if (input.dailyComplete || input.tournamentInProgress || input.socialActivity || input.score >= 40) return 'locked_in';
  if (input.tournamentActive || input.score >= 20) return 'active';
  if (input.score > 0) return 'warming_up';
  return 'cold';
}

function freshRivalOpportunity(model: HomeCommandCenterModel, timeline: HomeActivityTimeline): HomeMomentumOpportunity | null {
  if (
    model.identity.kind !== 'authenticated' ||
    !isReady(model.social.presence.status) ||
    !isReady(model.social.rivals.status)
  ) {
    return null;
  }

  const friend = timeline.events.find((event) => event.type === 'friend_online');
  return friend?.type === 'friend_online'
    ? { id: 'challenge_rival', label: `Challenge ${friend.payload.username}` }
    : null;
}

/**
 * Calculates grounded daily engagement from the normalized Home model. It has no
 * presentation, fetch, navigation, storage, or mutation dependency.
 */
export function calculateHomeMomentum(
  model: HomeCommandCenterModel,
  nowMs = Date.now(),
): HomeMomentum {
  const reasons: HomeMomentumReason[] = [];
  const completedToday: HomeMomentumCompletedItem[] = [];
  const missingOpportunities: HomeMomentumOpportunity[] = [];
  let score = 0;
  const timeline = model.activityTimeline ?? buildHomeActivityTimeline(model, nowMs);

  const fritz = model.daily.fritz.data;
  const fritzReady = isReady(model.daily.fritz.status);
  const fritzCompletedEvent = timeline.events.find((event) => event.type === 'daily_fritz_completed');
  const fritzStartedEvent = timeline.events.find((event) => event.type === 'daily_fritz_started');
  const fritzComplete = fritzCompletedEvent?.type === 'daily_fritz_completed';
  if (fritzComplete) {
    reasons.push(reason('daily_fritz_completed', 'Completed Daily Fritz'));
    completedToday.push({ id: 'daily_fritz', label: 'Daily Fritz' });
    score += HOME_MOMENTUM_WEIGHTS.daily_fritz_completed;
  } else if (fritzStartedEvent?.type === 'daily_fritz_started') {
    reasons.push(reason('daily_fritz_started', 'Started Daily Fritz'));
    score += HOME_MOMENTUM_WEIGHTS.daily_fritz_started;
    missingOpportunities.push({ id: 'daily_fritz', label: 'Continue Daily Fritz' });
  } else if (model.identity.kind === 'authenticated' && fritzReady && fritz?.state === 'unstarted') {
    missingOpportunities.push({ id: 'daily_fritz', label: 'Today’s Daily Fritz' });
  }

  const puzzle = model.daily.puzzle.data;
  const puzzleReady = isReady(model.daily.puzzle.status);
  const puzzleCompletedEvent = timeline.events.find((event) => event.type === 'daily_puzzle_completed');
  const puzzleStartedEvent = timeline.events.find((event) => event.type === 'daily_puzzle_started');
  const puzzleComplete = puzzleCompletedEvent?.type === 'daily_puzzle_completed';
  if (puzzleComplete) {
    reasons.push(reason('daily_puzzle_completed', 'Finished Daily Puzzle'));
    completedToday.push({ id: 'daily_puzzle', label: 'Daily Puzzle' });
    score += HOME_MOMENTUM_WEIGHTS.daily_puzzle_completed;
  } else if (puzzleStartedEvent?.type === 'daily_puzzle_started') {
    reasons.push(reason('daily_puzzle_started', 'Started Daily Puzzle'));
    score += HOME_MOMENTUM_WEIGHTS.daily_puzzle_started;
    missingOpportunities.push({ id: 'daily_puzzle', label: 'Continue Daily Puzzle' });
  } else if (puzzleReady && puzzle?.state === 'unstarted') {
    missingOpportunities.push({ id: 'daily_puzzle', label: 'Today’s Daily Puzzle' });
  }

  if (
    !fritzComplete &&
    !puzzleComplete &&
    isReady(model.daily.summary.status) &&
    model.daily.summary.data?.todayComplete
  ) {
    reasons.push(reason('daily_ritual_completed', 'Completed today’s daily ritual'));
    completedToday.push({ id: 'daily_ritual', label: 'Daily ritual' });
    score += HOME_MOMENTUM_WEIGHTS.daily_ritual_completed;
  }

  const journeyReady = isReady(model.journey.status);
  const journeyEvent = timeline.events.find((event) => event.type === 'journey_progressed');
  const journeyIncomplete = journeyEvent?.type === 'journey_progressed' && journeyEvent.status === 'active';
  if (journeyEvent?.type === 'journey_progressed' && isSameCalendarDay(journeyEvent.occurredAt, nowMs)) {
    reasons.push(reason('journey_progressed', 'Continued Journey'));
    completedToday.push({ id: 'journey', label: 'Journey progress' });
    score += HOME_MOMENTUM_WEIGHTS.journey_progressed;
  }
  if (journeyIncomplete) {
    missingOpportunities.push({ id: 'journey', label: 'Continue Journey' });
  }

  const tournamentReady = isReady(model.tournament.status);
  const tournamentEvent = timeline.events.find((event) => event.type === 'tournament_match_ready' || event.type === 'tournament_match_in_progress');
  const tournamentActive = tournamentEvent !== undefined;
  const tournamentInProgress = tournamentEvent?.type === 'tournament_match_in_progress';
  if (tournamentActive) {
    reasons.push(reason('tournament_active', 'Tournament match is active'));
    completedToday.push({ id: 'tournament', label: 'Tournament activity' });
    score += HOME_MOMENTUM_WEIGHTS.tournament_active;
  }
  if (tournamentEvent) {
    missingOpportunities.push({ id: 'tournament_match', label: 'Tournament Match' });
  }

  const socialActivity = Boolean(
    timeline.events.some((event) => event.type === 'player_social_activity' && isSameCalendarDay(event.occurredAt, nowMs)),
  );
  if (socialActivity) {
    reasons.push(reason('social_activity', 'Recorded table activity'));
    completedToday.push({ id: 'social_activity', label: 'Table activity' });
    score += HOME_MOMENTUM_WEIGHTS.social_activity;
  }

  const rivalOpportunity = freshRivalOpportunity(model, timeline);
  if (rivalOpportunity) missingOpportunities.push(rivalOpportunity);

  const dailyComplete = fritzComplete && puzzleComplete;
  const canDeclareCompleted =
    tournamentReady &&
    !tournamentActive &&
    journeyReady &&
    !journeyIncomplete;
  const level = levelFor({
    score,
    dailyComplete,
    tournamentInProgress,
    socialActivity,
    tournamentActive,
    canDeclareCompleted,
  });

  return {
    level,
    score,
    reasons,
    missingOpportunities,
    completedToday,
    progressPercent: Math.min(100, Math.round((score / DAILY_MOMENTUM_TARGET) * 100)),
  };
}
