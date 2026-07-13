import type {
  HomeActivityTimeline,
  HomeActivityTimelineEvent,
  HomeCommandCenterModel,
  HomeWelcomeBack,
  HomeWelcomeIcon,
  HomeWelcomeItem,
  HomeWelcomeItemType,
} from './homeTypes';
import { buildHomeActivityTimeline } from './homeActivityTimeline';

export type HomeWelcomeBackContext = {
  model: HomeCommandCenterModel;
  lastVisitAt: number | null;
};

const PRIORITY: Record<HomeWelcomeItemType, number> = {
  tournament_ready: 100,
  daily_fritz_result: 90,
  daily_puzzle_result: 85,
  friend_online: 60,
  journey_progress: 50,
  weekly_goal: 40,
};

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isCurrentAndAfterVisit(
  value: string | null | undefined,
  lastVisitAt: number | null,
  nowMs: number,
): boolean {
  const eventAt = validTime(value);
  return eventAt !== null && lastVisitAt !== null && eventAt > lastVisitAt && eventAt <= nowMs;
}

function itemBase(
  id: string,
  type: HomeWelcomeItemType,
  title: string,
  subtitle: string,
  icon: HomeWelcomeIcon,
  route: HomeWelcomeItem['route'],
  expiresAt: string | null = null,
): HomeWelcomeItem {
  return { id, type, priority: PRIORITY[type], title, subtitle, icon, route, expiresAt };
}

function isExpired(expiresAt: string | null, nowMs: number): boolean {
  const time = validTime(expiresAt);
  return time !== null && time <= nowMs;
}

function eventIsAfterVisit(
  event: { occurredAt: string | null },
  lastVisitAt: number,
  nowMs: number,
): boolean {
  return isCurrentAndAfterVisit(event.occurredAt, lastVisitAt, nowMs);
}

function sortItems(a: HomeWelcomeItem, b: HomeWelcomeItem): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aExpiry = validTime(a.expiresAt);
  const bExpiry = validTime(b.expiresAt);
  if (aExpiry !== bExpiry) {
    if (aExpiry === null) return 1;
    if (bExpiry === null) return -1;
    return aExpiry - bExpiry;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Curates current, authoritative Home changes into a small return summary.
 * A null lastVisitAt means first login/no baseline, so historical change claims
 * are intentionally suppressed.
 */
export function calculateWelcomeBack(
  context: HomeWelcomeBackContext,
  nowMs = Date.now(),
): HomeWelcomeBack {
  const { model, lastVisitAt } = context;
  const generatedAt = nowMs;
  if (lastVisitAt === null || lastVisitAt >= nowMs) {
    return { summaryItems: [], headline: null, priority: 0, hasMeaningfulChanges: false, generatedAt };
  }

  const timeline: HomeActivityTimeline = model.activityTimeline ?? buildHomeActivityTimeline(model, nowMs);
  const items: HomeWelcomeItem[] = [];
  const fritzEvent = timeline.events.find((event) => event.type === 'daily_fritz_completed');
  if (fritzEvent?.type === 'daily_fritz_completed' && eventIsAfterVisit(fritzEvent, lastVisitAt, nowMs)) {
    items.push(itemBase(
      'daily-fritz-result',
      'daily_fritz_result',
      'Daily Fritz result is ready',
      fritzEvent.payload.outcome === 'win' ? 'You won today’s series.' : 'Review today’s series result.',
      'bot',
      'dailyFritz',
    ));
  }

  const puzzleEvent = timeline.events.find((event) => event.type === 'daily_puzzle_completed');
  if (puzzleEvent?.type === 'daily_puzzle_completed' && eventIsAfterVisit(puzzleEvent, lastVisitAt, nowMs)) {
    items.push(itemBase(
      'daily-puzzle-result',
      'daily_puzzle_result',
      'Daily Puzzle complete',
      puzzleEvent.payload.score === null ? 'Your result is ready to review.' : `You scored ${puzzleEvent.payload.score} points.`,
      'puzzle',
      'daily',
    ));
  }

  const tournamentEvent = timeline.events.find(
    (event): event is Extract<HomeActivityTimelineEvent, { type: 'tournament_match_ready' | 'tournament_match_in_progress' }> =>
      event.type === 'tournament_match_ready' || event.type === 'tournament_match_in_progress',
  );
  if (tournamentEvent && !isExpired(tournamentEvent.expiresAt, nowMs)) {
    items.push(itemBase(
      tournamentEvent.id,
      'tournament_ready',
      'Tournament match is ready',
      tournamentEvent.payload.opponentUsername
        ? `Your match with ${tournamentEvent.payload.opponentUsername} is ready.`
        : 'Your assigned tournament match is ready.',
      'trophy',
      'tournament',
      tournamentEvent.expiresAt,
    ));
  }

  const journeyEvent = timeline.events.find((event) => event.type === 'journey_progressed' && event.status === 'active');
  if (journeyEvent?.type === 'journey_progressed' && eventIsAfterVisit(journeyEvent, lastVisitAt, nowMs)) {
    items.push(itemBase(
      journeyEvent.id,
      'journey_progress',
      'Journey progress recorded',
      journeyEvent.payload.chapterTitle
        ? `${journeyEvent.payload.chapterTitle} is ready to continue.`
        : 'Your next lesson is ready to continue.',
      'book',
      'journey',
    ));
  }

  const weeklyEvent = timeline.events.find((event) => event.type === 'weekly_daily_goal_completed');
  if (weeklyEvent?.type === 'weekly_daily_goal_completed') {
    items.push(itemBase(
      'weekly-goal-complete',
      'weekly_goal',
      'Weekly goal complete',
      'You completed all seven days this week.',
      'target',
      'stats',
    ));
  }

  const friendEvents = timeline.events.filter((event) => event.type === 'friend_online');
  for (const event of friendEvents) {
    if (event.type === 'friend_online') {
      items.push(itemBase(
        event.id,
        'friend_online',
        `${event.payload.username} is online`,
        'Open Friends to see what they are playing.',
        'user',
        'friends',
      ));
    }
  }

  const summaryItems = [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(sortItems)
    .slice(0, 3);
  return {
    summaryItems,
    headline: summaryItems.length > 0 ? 'While you were away' : null,
    priority: summaryItems[0]?.priority ?? 0,
    hasMeaningfulChanges: summaryItems.length > 0,
    generatedAt,
  };
}

export const HOME_WELCOME_BACK_PRIORITY = PRIORITY;
