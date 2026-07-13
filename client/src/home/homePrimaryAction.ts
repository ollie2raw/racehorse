import type {
  HomeActivityTimeline,
  HomeActivityTimelineEvent,
  HomeCommandCenterModel,
  HomePrimaryAction,
} from './homeTypes';
import { buildHomeActivityTimeline } from './homeActivityTimeline';

export type HomePrimaryActionContext = {
  model: HomeCommandCenterModel;
  timeline?: HomeActivityTimeline;
  authStatus: 'loading' | 'ready';
};

type Candidate = HomePrimaryAction & {
  stableId: string;
  commitment: number;
};

const PRIORITY = {
  continueTournament: 90,
  continueDailyFritz: 70,
  continueDailyPuzzle: 60,
  continueLesson: 40,
  playDailyFritz: 30,
  playDailyPuzzle: 20,
  challengeOnlineRival: 10,
  recommended: 0,
} as const;

function isReady(status: string): boolean {
  return status === 'ready';
}

function deadlineMs(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const value = Date.parse(expiresAt);
  return Number.isFinite(value) ? value : null;
}

function isExpired(expiresAt: string | null, nowMs: number): boolean {
  const value = deadlineMs(expiresAt);
  return value !== null && value <= nowMs;
}

function roundLabel(round: 1 | 2 | 3): string {
  if (round === 1) return 'quarterfinal';
  if (round === 2) return 'semifinal';
  return 'final';
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;

  const aDeadline = deadlineMs(a.expiresAt);
  const bDeadline = deadlineMs(b.expiresAt);
  if (aDeadline !== bDeadline) {
    if (aDeadline === null) return 1;
    if (bDeadline === null) return -1;
    return aDeadline - bDeadline;
  }

  if (a.commitment !== b.commitment) return b.commitment - a.commitment;

  return a.stableId.localeCompare(b.stableId);
}

function recommendedAction(): Candidate {
  return {
    type: 'play_recommended_mode',
    title: 'Choose your next game',
    reason: 'Pick up where you want to play.',
    cta: 'Play',
    route: 'singlePlayerHub',
    priority: PRIORITY.recommended,
    expiresAt: null,
    stableId: 'recommended-mode',
    commitment: 0,
  };
}

function rivalCandidates(
  context: HomePrimaryActionContext,
  timeline: HomeActivityTimeline,
): Candidate[] {
  const { model } = context;
  if (
    model.identity.kind !== 'authenticated' ||
    !isReady(model.social.presence.status) ||
    !isReady(model.social.rivals.status)
  ) {
    return [];
  }

  return timeline.events
    .filter((event): event is Extract<HomeActivityTimelineEvent, { type: 'friend_online' }> => event.type === 'friend_online')
    .map((event): Candidate => ({
      type: 'challenge_online_rival',
      title: `Challenge ${event.payload.username}`,
      reason: `${event.payload.username} is online.`,
      cta: 'Open Friends',
      route: 'friends',
      priority: PRIORITY.challengeOnlineRival,
      expiresAt: null,
      rivalId: event.payload.userId,
      stableId: event.id,
      commitment: 0,
    }));
}

/**
 * Selects exactly one action from already-normalized Home state. It is intentionally
 * pure: callers supply time and data, and no fetch, navigation, storage, or mutation occurs here.
 */
export function selectHomePrimaryAction(
  context: HomePrimaryActionContext,
  nowMs = Date.now(),
): HomePrimaryAction {
  const { model } = context;
  if (context.authStatus === 'loading') return recommendedAction();
  const timeline = context.timeline ?? model.activityTimeline;
  const resolvedTimeline = timeline ?? buildHomeActivityTimeline(model, nowMs);

  const candidates: Candidate[] = [];
  const tournamentEvent = resolvedTimeline.events.find(
    (event): event is Extract<HomeActivityTimelineEvent, { type: 'tournament_match_ready' | 'tournament_match_in_progress' }> =>
      event.type === 'tournament_match_ready' || event.type === 'tournament_match_in_progress',
  );
  if (
    model.identity.kind === 'authenticated' &&
    tournamentEvent &&
    !isExpired(tournamentEvent.expiresAt, nowMs)
  ) {
    candidates.push({
      type: 'continue_tournament',
      title: 'Return to your tournament match',
      reason: `Your ${roundLabel(tournamentEvent.payload.round)} is ${tournamentEvent.payload.matchStatus === 'ready' ? 'ready' : 'in progress'}.`,
      cta: tournamentEvent.payload.matchStatus === 'ready' ? 'Join Match' : 'Return',
      route: 'tournament',
      priority: PRIORITY.continueTournament,
      expiresAt: tournamentEvent.expiresAt,
      tournamentId: tournamentEvent.payload.tournamentId,
      matchId: tournamentEvent.payload.matchId,
      stableId: tournamentEvent.id,
      commitment: tournamentEvent.payload.matchStatus === 'in_progress' ? 2 : 1,
    });
  }

  const fritzStarted = resolvedTimeline.events.find((event) => event.type === 'daily_fritz_started');
  if (
    model.identity.kind === 'authenticated' &&
    fritzStarted?.type === 'daily_fritz_started'
  ) {
    candidates.push({
      type: 'continue_daily_fritz',
      title: 'Continue Daily Fritz',
      reason: fritzStarted.payload.currentGame ? `Game ${fritzStarted.payload.currentGame} is waiting.` : 'Your daily series is in progress.',
      cta: 'Continue',
      route: 'dailyFritz',
      priority: PRIORITY.continueDailyFritz,
      expiresAt: null,
      stableId: fritzStarted.id,
      commitment: 1,
    });
  }

  const puzzleStarted = resolvedTimeline.events.find((event) => event.type === 'daily_puzzle_started');
  if (puzzleStarted?.type === 'daily_puzzle_started') {
    candidates.push({
      type: 'continue_daily_puzzle',
      title: 'Continue Daily Puzzle',
      reason: puzzleStarted.payload.nextAvailableSlotIndex
        ? `Puzzle ${puzzleStarted.payload.nextAvailableSlotIndex} is ready.`
        : 'Your daily puzzle is in progress.',
      cta: 'Continue',
      route: 'daily',
      priority: PRIORITY.continueDailyPuzzle,
      expiresAt: null,
      stableId: puzzleStarted.id,
      commitment: 1,
    });
  }

  const journeyEvent = resolvedTimeline.events.find(
    (event): event is Extract<HomeActivityTimelineEvent, { type: 'journey_progressed' }> => event.type === 'journey_progressed' && event.status === 'active',
  );
  if (journeyEvent) {
    candidates.push({
      type: 'continue_lesson',
      title: 'Continue Journey',
      reason: journeyEvent.payload.chapterTitle
        ? `${journeyEvent.payload.chapterTitle} is ready.`
        : 'Your next lesson is ready.',
      cta: 'Continue',
      route: 'journey',
      priority: PRIORITY.continueLesson,
      expiresAt: null,
      chapterId: journeyEvent.payload.chapterId ?? 'current',
      stableId: journeyEvent.id,
      commitment: 1,
    });
  }

  const fritz = model.daily.fritz.data;
  if (model.identity.kind === 'authenticated' && isReady(model.daily.fritz.status) && fritz?.state === 'unstarted') {
    candidates.push({
      type: 'play_daily_fritz',
      title: 'Play Daily Fritz',
      reason: 'Today’s best-of-three is ready.',
      cta: 'Play',
      route: 'dailyFritz',
      priority: PRIORITY.playDailyFritz,
      expiresAt: null,
      stableId: `daily-fritz:${fritz.runDate ?? 'today'}`,
      commitment: 0,
    });
  }

  const puzzle = model.daily.puzzle.data;
  if (isReady(model.daily.puzzle.status) && puzzle?.state === 'unstarted') {
    candidates.push({
      type: 'play_daily_puzzle',
      title: 'Play Daily Puzzle',
      reason: 'Today’s three puzzles are ready.',
      cta: 'Play',
      route: 'daily',
      priority: PRIORITY.playDailyPuzzle,
      expiresAt: null,
      stableId: `daily-puzzle:${puzzle.runDate ?? 'today'}`,
      commitment: 0,
    });
  }

  candidates.push(...rivalCandidates(context, resolvedTimeline));
  candidates.push(recommendedAction());
  const selected = candidates.sort(compareCandidates)[0]!;
  const { stableId: _stableId, commitment: _commitment, ...action } = selected;
  return action;
}

export const HOME_PRIMARY_ACTION_PRIORITY = PRIORITY;
