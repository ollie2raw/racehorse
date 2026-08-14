import { serializeGhostBoardState } from '../../ghost/logic';
import type { BotMatchState, BotPlayerId } from '../../bot/botEngine';
import type { LessonV2, LessonV2Event, LessonV2HandEnd, LessonV2HandStart } from '../lessonV2';
import type {
  GuidedMatchEvent,
  GuidedMatchHandEndEvent,
  GuidedMatchLesson,
  GuidedMatchPlayerTilePlayEvent,
  GuidedMatchTilePlayEvent,
} from './guidedMatchTypes';
// Import as a URL so Vite serves it as a separate hashed asset rather than
// inlining 1.2 MB of JSON into the JS bundle. The fetch happens once at module
// init (this file is always dynamically imported via lessonV2 → LearnHome lazy).
import canonicalLessonUrl from './lessons/FINAL-guided-match-standard-v1-canonical-75-48.json?url';
const bundledCanonicalLesson: GuidedMatchLesson = await fetch(canonicalLessonUrl).then(
  (r) => r.json() as Promise<GuidedMatchLesson>,
);
import {
  getGuidedMatchFinalDebrief,
  STANDARD_GUIDED_MATCH_FINAL_DEBRIEF,
  type GuidedMatchFinalDebrief,
} from './guidedMatchFinalDebrief';

export const PUBLIC_GUIDED_MATCH_EXPECTED_TARGET_SCORE = 60;
export const PUBLIC_GUIDED_MATCH_EXPECTED_EVENT_COUNT = 232;
export const PUBLIC_GUIDED_MATCH_EXPECTED_PLAYER_COACHING_COUNT = 77;
export const PUBLIC_GUIDED_MATCH_EXPECTED_HAND_COUNT = 9;

function parseMatchSnapshot(snapshot: string): BotMatchState {
  return JSON.parse(snapshot) as BotMatchState;
}

function actorToBotPlayerId(actor: 'player' | 'fritz'): BotPlayerId {
  return actor === 'player' ? 'you' : 'bot';
}

function formatCoachingText(event: GuidedMatchPlayerTilePlayEvent): string {
  const title = event.coaching.title.trim();
  const body = event.coaching.body.trim();
  if (title && body) return `${title}\n${body}`;
  return title || body;
}

function toLessonV2HandEnd(event: GuidedMatchHandEndEvent | null): LessonV2HandEnd | undefined {
  if (!event) return undefined;
  return {
    winner:
      event.winner === 'player' ? 'player' : event.winner === 'fritz' ? 'fritz' : null,
    reason: event.reason,
    pointsAwarded: event.pointsAwarded,
    loserPips: event.leftoverPips,
    calcText: `${event.pointsAwarded} points awarded by ${event.reason}.`,
  };
}

function toLessonV2Position(event: GuidedMatchTilePlayEvent): string | undefined {
  return event.placement.laneRef ?? event.placement.side;
}

function isPlayerTileEvent(event: GuidedMatchEvent): event is GuidedMatchPlayerTilePlayEvent {
  return event.kind === 'tile-play' && event.actor === 'player';
}

function countPlayerCoaching(lesson: GuidedMatchLesson): number {
  return lesson.events.filter((event) => {
    return (
      isPlayerTileEvent(event) &&
      event.coaching.title.trim().length > 0 &&
      event.coaching.body.trim().length > 0
    );
  }).length;
}

function validatePublicLessonSanity(lesson: GuidedMatchLesson): string[] {
  const issues: string[] = [];
  if (lesson.targetScore !== PUBLIC_GUIDED_MATCH_EXPECTED_TARGET_SCORE) {
    issues.push(`targetScore expected ${PUBLIC_GUIDED_MATCH_EXPECTED_TARGET_SCORE}, received ${lesson.targetScore}`);
  }
  if (lesson.events.length !== PUBLIC_GUIDED_MATCH_EXPECTED_EVENT_COUNT) {
    issues.push(`events.length expected ${PUBLIC_GUIDED_MATCH_EXPECTED_EVENT_COUNT}, received ${lesson.events.length}`);
  }
  const coachingCount = countPlayerCoaching(lesson);
  if (coachingCount !== PUBLIC_GUIDED_MATCH_EXPECTED_PLAYER_COACHING_COUNT) {
    issues.push(
      `player coaching count expected ${PUBLIC_GUIDED_MATCH_EXPECTED_PLAYER_COACHING_COUNT}, received ${coachingCount}`,
    );
  }
  const handStartCount = lesson.events.filter((event) => event.kind === 'hand-start').length;
  if (handStartCount !== PUBLIC_GUIDED_MATCH_EXPECTED_HAND_COUNT) {
    issues.push(`hand-start count expected ${PUBLIC_GUIDED_MATCH_EXPECTED_HAND_COUNT}, received ${handStartCount}`);
  }
  return issues;
}

function buildPublicPlaybackLesson(lesson: GuidedMatchLesson): LessonV2 {
  const handStarts: LessonV2HandStart[] = [];
  const events: LessonV2Event[] = [];

  for (let index = 0; index < lesson.events.length; index += 1) {
    const event = lesson.events[index]!;

    if (event.kind === 'hand-start') {
      handStarts.push({
        handNumber: event.handNumber,
        matchStateJson: event.afterSnapshot || event.beforeSnapshot,
        firstEventIndex: events.length,
      });
      continue;
    }

    if (event.actor === 'system') {
      continue;
    }

    const nextState = parseMatchSnapshot(event.afterSnapshot);
    const nextHandEndEvent =
      lesson.events[index + 1]?.kind === 'hand-end' && lesson.events[index + 1]?.actor === 'system'
        ? (lesson.events[index + 1] as GuidedMatchHandEndEvent)
        : null;

    const actor = event.actor;
    const action =
      event.kind === 'tile-play' ? 'play' : event.kind === 'draw' ? 'draw' : 'pass';
    const botPlayerId = actorToBotPlayerId(actor);
    const coachingText = isPlayerTileEvent(event) ? formatCoachingText(event) : '';

    events.push({
      eventIndex: events.length,
      handNumber: event.handNumber,
      actor,
      action,
      tile: event.kind === 'tile-play' ? event.tileId : undefined,
      position: event.kind === 'tile-play' ? toLessonV2Position(event) : undefined,
      boardAfter: serializeGhostBoardState(nextState.board),
      playerHandAfter: nextState.players.you.hand.map((tile) => `${tile.low}|${tile.high}`),
      fritzHandAfter: nextState.players.bot.hand.map((tile) => `${tile.low}|${tile.high}`),
      boneyardCountAfter: nextState.boneyard.length,
      pointsScored: event.kind === 'tile-play' ? event.pointsScored : 0,
      playerScoreAfter: nextState.players.you.score,
      fritzScoreAfter: nextState.players.bot.score,
      turnContinues:
        !nextState.handOver &&
        !nextState.gameOver &&
        nextState.currentPlayer === botPlayerId,
      handOver: Boolean(nextState.handOver),
      gameOver: Boolean(nextState.gameOver),
      handEnded: toLessonV2HandEnd(nextHandEndEvent),
      coachingText,
    });
  }

  if (handStarts.length === 0) {
    handStarts.push({
      handNumber: 1,
      matchStateJson: lesson.initialMatchSnapshot,
      firstEventIndex: 0,
    });
  }

  return {
    version: 2,
    lessonId: lesson.lessonId,
    gameId: `${lesson.lessonId}:public-canonical`,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
    handStarts,
    events,
  };
}

const publicGuidedMatchLesson = bundledCanonicalLesson as GuidedMatchLesson;
const publicGuidedMatchLessonSanityIssues = validatePublicLessonSanity(publicGuidedMatchLesson);
const publicGuidedMatchPlaybackLesson = buildPublicPlaybackLesson(publicGuidedMatchLesson);

if (import.meta.env.DEV) {
  if (publicGuidedMatchLessonSanityIssues.length > 0) {
    console.warn('[guided-match-public-lesson] sanity issues', publicGuidedMatchLessonSanityIssues);
  } else {
    console.log('[guided-match-public-lesson] ready', {
      lessonId: publicGuidedMatchLesson.lessonId,
      targetScore: publicGuidedMatchLesson.targetScore,
      eventCount: publicGuidedMatchLesson.events.length,
      playerCoachingCount: countPlayerCoaching(publicGuidedMatchLesson),
    });
  }
}

export function getPublicGuidedMatchLesson(): GuidedMatchLesson {
  return publicGuidedMatchLesson;
}

export function getPublicGuidedMatchPlaybackLesson(): LessonV2 {
  return publicGuidedMatchPlaybackLesson;
}

export function getPublicGuidedMatchLessonSanityIssues(): string[] {
  return [...publicGuidedMatchLessonSanityIssues];
}

export function getPublicGuidedMatchFinalDebrief(): GuidedMatchFinalDebrief | null {
  return getGuidedMatchFinalDebrief(publicGuidedMatchLesson.lessonId);
}

export { STANDARD_GUIDED_MATCH_FINAL_DEBRIEF };
