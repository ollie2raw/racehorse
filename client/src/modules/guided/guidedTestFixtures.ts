/**
 * Shared test fixtures for `modules/guided/` unit tests (F6, CODE_QUALITY_PLAN.md
 * §CQ9.5). Builders return minimal-but-valid literals with an `overrides` hook.
 *
 * `BotMatchState` fixtures come from botEngine's `createBotMatch*` exports — this
 * module deliberately does NOT add a parallel `BotMatchState` builder (§CQ9.5.5).
 */
import type {
  AuthoredStep,
  FrozenLesson,
  GuidedTranscript,
  GuidedTurn,
} from '../../learn/guidedAuthoring.ts';
import type { LessonV2, LessonV2Event, LessonV2HandStart } from '../../learn/lessonV2.ts';

export function makeLessonV2Event(overrides: Partial<LessonV2Event> = {}): LessonV2Event {
  return {
    eventIndex: 0,
    handNumber: 1,
    actor: 'player',
    action: 'play',
    tile: '3|4',
    position: 'left',
    boardAfter: 'board:test-stub',
    playerHandAfter: ['0|0', '1|2'],
    fritzHandAfter: ['3|3', '4|5'],
    boneyardCountAfter: 5,
    pointsScored: 0,
    playerScoreAfter: 0,
    fritzScoreAfter: 0,
    turnContinues: false,
    handOver: false,
    gameOver: false,
    coachingText: '',
    ...overrides,
  };
}

export function makeLessonV2HandStart(overrides: Partial<LessonV2HandStart> = {}): LessonV2HandStart {
  return {
    handNumber: 1,
    matchStateJson: '{}',
    firstEventIndex: 0,
    ...overrides,
  };
}

export function makeLessonV2(overrides: Partial<LessonV2> = {}): LessonV2 {
  return {
    version: 2,
    lessonId: 'test-lesson',
    gameId: 'test-game',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    handStarts: [makeLessonV2HandStart()],
    events: [makeLessonV2Event()],
    ...overrides,
  };
}

export function makeAuthoredStep(overrides: Partial<AuthoredStep> = {}): AuthoredStep {
  return {
    stepIndex: 0,
    handNumber: 1,
    boardState: 'board:empty',
    playerHand: ['0|0', '1|2'],
    chosenMove: '0|0:left',
    coachingText: '',
    fritzReplyEvents: [],
    matchStateJson: null,
    ...overrides,
  };
}

export function makeFrozenLesson(overrides: Partial<FrozenLesson> = {}): FrozenLesson {
  return {
    lessonId: 'test-lesson',
    fixedGameId: 'test-game',
    steps: [makeAuthoredStep()],
    currentStepIndex: 1,
    matchSnapshot: null,
    ...overrides,
  };
}

export function makeGuidedTurn(overrides: Partial<GuidedTurn> = {}): GuidedTurn {
  return {
    stepIndex: 0,
    handNumber: 1,
    coachingText: '',
    stateBefore: '{}',
    expectedPlayerMove: { type: 'play', tile: '3|4', position: 'left' },
    playerStateAfter: '{}',
    fritzReplies: [],
    ...overrides,
  };
}

export function makeGuidedTranscript(overrides: Partial<GuidedTranscript> = {}): GuidedTranscript {
  return {
    lessonId: 'test-lesson',
    version: 'v1-explicit',
    initialState: '{}',
    turns: [makeGuidedTurn()],
    ...overrides,
  };
}
