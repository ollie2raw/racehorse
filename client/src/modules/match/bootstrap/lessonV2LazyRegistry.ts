import type { BotMatchState } from '../runtime/botEngine.ts';
import type { ResolveInitialBotMatchStateInput } from './resolveInitialBotMatchState.ts';
import type { GuidedV2HandAdvancePlan } from './guidedV2HandCoordinator.ts';

type LessonV2Module = typeof import('../../../learn/lessonV2.ts');

let lessonV2Module: LessonV2Module | null = null;
let resolveLessonV2InitialStateFn:
  | ((input: ResolveInitialBotMatchStateInput, lessonV2: LessonV2Module) => BotMatchState)
  | null = null;
let planGuidedV2HandAdvanceFn:
  | ((
    frozenV2Lesson: import('../../../learn/lessonV2.ts').LessonV2,
    currentHandNumber: number,
  ) => GuidedV2HandAdvancePlan | null)
  | null = null;

export function isLessonV2Preloaded(): boolean {
  return lessonV2Module !== null;
}

export function getLessonV2Module(): LessonV2Module {
  if (!lessonV2Module) {
    throw new Error('[lessonV2LazyRegistry] lessonV2 is not loaded — preload before guided/authoring V2 use');
  }
  return lessonV2Module;
}

export function parseLessonV2BoardState(boardAfter: string) {
  return getLessonV2Module().parseLessonV2BoardState(boardAfter);
}

export function resolveLessonV2InitialState(input: ResolveInitialBotMatchStateInput): BotMatchState {
  if (!resolveLessonV2InitialStateFn || !lessonV2Module) {
    throw new Error('[lessonV2LazyRegistry] lessonV2 bootstrap is not loaded');
  }
  return resolveLessonV2InitialStateFn(input, lessonV2Module);
}

export function planGuidedV2HandAdvance(
  frozenV2Lesson: import('../../../learn/lessonV2.ts').LessonV2,
  currentHandNumber: number,
): GuidedV2HandAdvancePlan | null {
  if (!planGuidedV2HandAdvanceFn) {
    throw new Error('[lessonV2LazyRegistry] guided V2 hand coordinator is not loaded');
  }
  return planGuidedV2HandAdvanceFn(frozenV2Lesson, currentHandNumber);
}

export async function preloadLessonV2ForBotMatch(): Promise<void> {
  if (lessonV2Module) return;

  const [lessonV2, bootstrap, handCoordinator] = await Promise.all([
    import('../../../learn/lessonV2.ts'),
    import('./resolveLessonV2InitialState.ts'),
    import('./guidedV2HandCoordinator.ts'),
  ]);

  lessonV2Module = lessonV2;
  resolveLessonV2InitialStateFn = bootstrap.resolveLessonV2InitialState;
  planGuidedV2HandAdvanceFn = handCoordinator.planGuidedV2HandAdvance;
}