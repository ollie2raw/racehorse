import type { BotActionResult } from '../match/runtime/botEngine.ts';
import type { LessonV2Event } from '../../learn/lessonV2.ts';
import type { Move, PlacementPosition } from '../../types.ts';
import { toTileKey } from '../../game/tileKeys.ts';

export function recordAuthoringPlayStep(
  isAuthoringMode: boolean,
  move: Move,
  position: PlacementPosition,
  recordAuthoringStep: (chosenMove: string | null) => void,
): void {
  if (!isAuthoringMode || !move.tile) return;
  const posStr = typeof position === 'string' && position ? `:${position}` : '';
  recordAuthoringStep(`${toTileKey(move.tile)}${posStr}`);
}

type CreateV2Event = (args: Parameters<typeof import('../../learn/lessonV2.ts').createV2Event>[0]) => LessonV2Event;

export function buildAuthoringV2PlayEvent(
  createV2Event: CreateV2Event,
  input: {
  result: BotActionResult;
  handNumber: number;
  move: Move;
  position: PlacementPosition;
  eventIndex: number;
  coachingText: string;
},
): LessonV2Event {
  return createV2Event({
    result: input.result,
    handNumber: input.handNumber,
    actor: 'player',
    action: 'play',
    tile: input.move.tile ?? undefined,
    position: typeof input.position === 'string' ? input.position : undefined,
    eventIndex: input.eventIndex,
    coachingText: input.coachingText,
  });
}

export function buildAuthoringV2DrawEvent(
  createV2Event: CreateV2Event,
  input: {
  result: BotActionResult;
  handNumber: number;
  eventIndex: number;
},
): LessonV2Event {
  return createV2Event({
    result: input.result,
    handNumber: input.handNumber,
    actor: 'player',
    action: 'draw',
    eventIndex: input.eventIndex,
  });
}

export function buildAuthoringV2PassEvent(
  createV2Event: CreateV2Event,
  input: {
  result: BotActionResult;
  handNumber: number;
  eventIndex: number;
},
): LessonV2Event {
  return createV2Event({
    result: input.result,
    handNumber: input.handNumber,
    actor: 'player',
    action: 'pass',
    eventIndex: input.eventIndex,
  });
}

export function recordAuthoringPassStep(
  isAuthoringMode: boolean,
  recordAuthoringStep: (chosenMove: string | null) => void,
): void {
  if (!isAuthoringMode) return;
  recordAuthoringStep('pass');
}