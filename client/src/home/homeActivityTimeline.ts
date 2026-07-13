import type {
  HomeActivityTimeline,
  HomeActivityTimelineEvent,
  HomeCommandCenterModel,
  HomeSourceKey,
} from './homeTypes';

export const HOME_ACTIVITY_EVENT_PRIORITIES = {
  tournament_match_ready: 100,
  tournament_match_in_progress: 100,
  daily_fritz_completed: 90,
  daily_puzzle_completed: 85,
  daily_fritz_started: 70,
  daily_puzzle_started: 60,
  journey_progressed: 50,
  friend_online: 40,
  player_social_activity: 30,
  weekly_daily_goal_completed: 20,
} as const;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isExpired(value: string | null, nowMs: number): boolean {
  const time = parseTime(value);
  return time !== null && time <= nowMs;
}

function sourceCoverage(model: HomeCommandCenterModel): HomeActivityTimeline['sourceCoverage'] {
  return {
    dailySummary: model.daily.summary.status,
    dailyFritz: model.daily.fritz.status,
    dailyPuzzle: model.daily.puzzle.status,
    socialPresence: model.social.presence.status,
    socialActivity: model.social.activity.status,
    socialRivals: model.social.rivals.status,
    tournament: model.tournament.status,
    journey: model.journey.status,
    ranking: model.stats.status,
    runtime: model.runtime.status,
  };
}

function sortEvents(a: HomeActivityTimelineEvent, b: HomeActivityTimelineEvent): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aOccurred = parseTime(a.occurredAt);
  const bOccurred = parseTime(b.occurredAt);
  if (aOccurred !== bOccurred) {
    if (aOccurred === null) return 1;
    if (bOccurred === null) return -1;
    return bOccurred - aOccurred;
  }
  const aExpiry = 'expiresAt' in a ? parseTime(a.expiresAt) : null;
  const bExpiry = 'expiresAt' in b ? parseTime(b.expiresAt) : null;
  if (aExpiry !== bExpiry) {
    if (aExpiry === null) return 1;
    if (bExpiry === null) return -1;
    return aExpiry - bExpiry;
  }
  return a.id.localeCompare(b.id);
}

function latestOccurredAt(events: HomeActivityTimelineEvent[]): string | null {
  return events.reduce<string | null>((latest, event) => {
    const eventTime = parseTime(event.occurredAt);
    if (eventTime === null) return latest;
    const latestTime = parseTime(latest);
    return latestTime === null || eventTime > latestTime ? event.occurredAt : latest;
  }, null);
}

/** Builds canonical Home events from normalized model state only. */
export function buildHomeActivityTimeline(
  model: HomeCommandCenterModel,
  nowMs = Date.now(),
): HomeActivityTimeline {
  const events: HomeActivityTimelineEvent[] = [];
  const authenticated = model.identity.kind === 'authenticated';
  const fritz = model.daily.fritz.data;
  if (authenticated && model.daily.fritz.status === 'ready' && fritz?.state === 'started') {
    events.push({
      id: `daily-fritz:${fritz.runDate ?? 'current'}:started`,
      type: 'daily_fritz_started',
      occurredAt: null,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.daily_fritz_started,
      source: 'daily_fritz',
      route: 'dailyFritz',
      status: 'active',
      payload: { currentGame: fritz.currentGame, runDate: fritz.runDate },
    });
  }
  if (authenticated && model.daily.fritz.status === 'ready' && fritz?.state === 'completed') {
    const occurredAt = parseTime(fritz.completedAt ?? null) !== null && parseTime(fritz.completedAt ?? null)! <= nowMs
      ? fritz.completedAt ?? null
      : null;
    events.push({
      id: `daily-fritz:${fritz.runDate ?? 'current'}:completed`,
      type: 'daily_fritz_completed',
      occurredAt,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.daily_fritz_completed,
      source: 'daily_fritz',
      route: 'dailyFritz',
      status: 'completed',
      payload: { outcome: fritz.outcome, rank: fritz.rank, runDate: fritz.runDate },
    });
  }

  const puzzle = model.daily.puzzle.data;
  if (model.daily.puzzle.status === 'ready' && puzzle?.state === 'started') {
    events.push({
      id: `daily-puzzle:${puzzle.runDate ?? 'current'}:started`,
      type: 'daily_puzzle_started',
      occurredAt: null,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.daily_puzzle_started,
      source: 'daily_puzzle',
      route: 'daily',
      status: 'active',
      payload: { score: puzzle.score, nextAvailableSlotIndex: puzzle.nextAvailableSlotIndex, runDate: puzzle.runDate },
    });
  }
  if (model.daily.puzzle.status === 'ready' && puzzle?.state === 'completed') {
    const occurredAt = parseTime(puzzle.completedAt ?? null) !== null && parseTime(puzzle.completedAt ?? null)! <= nowMs
      ? puzzle.completedAt ?? null
      : null;
    events.push({
      id: `daily-puzzle:${puzzle.runDate ?? 'current'}:completed`,
      type: 'daily_puzzle_completed',
      occurredAt,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.daily_puzzle_completed,
      source: 'daily_puzzle',
      route: 'daily',
      status: 'completed',
      payload: { score: puzzle.score, runDate: puzzle.runDate },
    });
  }

  const journey = model.journey.data;
  if (model.journey.status === 'ready' && journey?.hasAnyProgress) {
    events.push({
      id: `journey:${journey.activeChapterId ?? 'current'}:${journey.updatedAt ?? 'current'}`,
      type: 'journey_progressed',
      occurredAt: parseTime(journey.updatedAt) !== null && parseTime(journey.updatedAt)! <= nowMs ? journey.updatedAt : null,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.journey_progressed,
      source: 'journey',
      route: 'journey',
      status: journey.completedNodes >= journey.totalNodes ? 'completed' : 'active',
      payload: { chapterId: journey.activeChapterId, chapterTitle: journey.activeChapterTitle, completedNodes: journey.completedNodes, totalNodes: journey.totalNodes },
    });
  }

  const recoveryMatch = model.tournament.data?.recoveryMatch;
  if (authenticated && model.tournament.status === 'ready' && recoveryMatch && !isExpired(recoveryMatch.readyDeadlineAt, nowMs)) {
    const inProgress = recoveryMatch.matchStatus === 'in_progress';
    events.push({
      id: `tournament:${recoveryMatch.tournamentId}:${recoveryMatch.matchId}`,
      type: inProgress ? 'tournament_match_in_progress' : 'tournament_match_ready',
      occurredAt: null,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES[inProgress ? 'tournament_match_in_progress' : 'tournament_match_ready'],
      source: 'tournament',
      route: 'tournament',
      status: 'pending',
      expiresAt: recoveryMatch.readyDeadlineAt,
      payload: { tournamentId: recoveryMatch.tournamentId, matchId: recoveryMatch.matchId, round: recoveryMatch.round, opponentUsername: recoveryMatch.opponentUsername, matchStatus: recoveryMatch.matchStatus },
    });
  }

  if (authenticated && model.social.presence.status === 'ready') {
    const uniqueFriends = new Map(
      (model.social.presence.data ?? [])
        .filter((friend) => friend.status === 'online')
        .map((friend) => [friend.userId, friend]),
    );
    for (const friend of uniqueFriends.values()) {
      events.push({
        id: `friend-online:${friend.userId}`,
        type: 'friend_online',
        occurredAt: null,
        priority: HOME_ACTIVITY_EVENT_PRIORITIES.friend_online,
        source: 'social_presence',
        route: 'friends',
        status: 'available',
        payload: { userId: friend.userId, username: friend.username, currentMode: friend.currentMode },
      });
    }
  }

  if (authenticated && model.social.activity.status === 'ready') {
    const uniqueActivity = new Map(
      (model.social.activity.data ?? [])
        .filter((activity) => activity.userId === model.identity.userId && parseTime(activity.createdAt) !== null && parseTime(activity.createdAt)! <= nowMs)
        .map((activity) => [activity.id, activity]),
    );
    for (const activity of uniqueActivity.values()) {
      events.push({
        id: `social-activity:${activity.id}`,
        type: 'player_social_activity',
        occurredAt: activity.createdAt,
        priority: HOME_ACTIVITY_EVENT_PRIORITIES.player_social_activity,
        source: 'social_activity',
        route: 'friends',
        status: 'completed',
        payload: { activityType: activity.type },
      });
    }
  }

  if (model.daily.summary.status === 'ready' && model.daily.summary.data?.weeklyCompletedCount === 7) {
    events.push({
      id: `weekly-goal:${model.daily.summary.data.dateKey ?? 'current'}`,
      type: 'weekly_daily_goal_completed',
      occurredAt: null,
      priority: HOME_ACTIVITY_EVENT_PRIORITIES.weekly_daily_goal_completed,
      source: 'daily_summary',
      route: 'stats',
      status: 'completed',
      payload: { dateKey: model.daily.summary.data.dateKey, completedDays: 7 },
    });
  }

  const deduplicated = [...new Map(events.map((event) => [event.id, event])).values()]
    .sort(sortEvents);
  return {
    events: deduplicated,
    generatedAt: nowMs,
    latestOccurredAt: latestOccurredAt(deduplicated),
    sourceCoverage: sourceCoverage(model),
  };
}

export const HOME_ACTIVITY_TIMELINE_SOURCE_KEYS: HomeSourceKey[] = [
  'dailySummary', 'dailyFritz', 'dailyPuzzle', 'socialPresence', 'socialActivity', 'socialRivals', 'tournament', 'journey', 'ranking', 'runtime',
];
