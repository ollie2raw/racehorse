import type {
  GuidedMatchCandidate,
  GuidedMatchCandidateEvent,
  GuidedMatchCandidatePlayerTilePlayEvent,
} from './guidedMatchCandidateTypes';
import { validateGuidedMatchCandidate } from './guidedMatchCandidateValidation';
import {
  GUIDED_MATCH_CANONICAL_VERSION,
  type GuidedMatchEvent,
  type GuidedMatchLesson,
  type GuidedMatchPlayerTilePlayEvent,
} from './guidedMatchTypes';
import {
  GUIDED_MATCH_STANDARD_LESSON_ID,
  GUIDED_MATCH_STANDARD_TARGET_SCORE,
} from './guidedMatchRecorderEngine';

function isCandidatePlayerTileEvent(
  event: GuidedMatchCandidateEvent,
): event is GuidedMatchCandidatePlayerTilePlayEvent {
  return event.kind === 'tile-play' && event.actor === 'player';
}

function convertCandidateEvent(event: GuidedMatchCandidateEvent): GuidedMatchEvent {
  if (!isCandidatePlayerTileEvent(event)) {
    return event;
  }
  if (!event.coaching) {
    throw new Error(`Player tile event ${event.id} is missing coaching.`);
  }
  return {
    ...event,
    coaching: event.coaching,
  } satisfies GuidedMatchPlayerTilePlayEvent;
}

export function convertCandidateToGuidedMatchLesson(candidate: GuidedMatchCandidate): GuidedMatchLesson {
  const validation = validateGuidedMatchCandidate(candidate, 'final');
  if (!validation.ok) {
    throw new Error(
      `Guided Match candidate cannot be exported: ${validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  return {
    version: GUIDED_MATCH_CANONICAL_VERSION,
    lessonId: GUIDED_MATCH_STANDARD_LESSON_ID,
    title: candidate.title.trim() || 'Guided Match · First to 60',
    opponent: 'standard-fritz',
    dealSize: 7,
    targetScore: GUIDED_MATCH_STANDARD_TARGET_SCORE,
    rootSeed: candidate.rootSeed ?? `candidate:${candidate.candidateId}`,
    createdAt: candidate.createdAt,
    updatedAt: new Date().toISOString(),
    initialMatchSnapshot: candidate.initialMatchSnapshot,
    finalMatchSnapshot: candidate.finalMatchSnapshot,
    events: candidate.events.map(convertCandidateEvent),
  };
}
