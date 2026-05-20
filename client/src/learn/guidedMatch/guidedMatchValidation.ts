import {
  GUIDED_MATCH_CANONICAL_VERSION,
  type GuidedMatchEvent,
  type GuidedMatchLesson,
  type GuidedMatchPlayerTilePlayEvent,
  type GuidedMatchTilePlayEvent,
} from './guidedMatchTypes';
import { GUIDED_MATCH_STANDARD_TARGET_SCORE } from './guidedMatchRecorderEngine';

export interface GuidedMatchValidationIssue {
  path: string;
  message: string;
}

export type GuidedMatchValidationMode = 'draft' | 'final';

export interface GuidedMatchValidationOptions {
  mode: GuidedMatchValidationMode;
  pendingPlayerEvent?: GuidedMatchPlayerTilePlayEvent | null;
}

export interface GuidedMatchValidationResult {
  ok: boolean;
  mode: GuidedMatchValidationMode;
  issues: GuidedMatchValidationIssue[];
}

const PLACEHOLDER_COACHING_VALUES = new Set([
  'a',
  'aa',
  'aaa',
  'as',
  's',
  'ss',
  'd',
  'n',
  'na',
  'test',
  'todo',
  'tbd',
  'placeholder',
  'fixme',
  'temp',
]);

function pushIssue(issues: GuidedMatchValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isIsoString(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSnapshot(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractEventSequence(id: string): number | null {
  const match = id.match(/^event-(\d{4})-/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPlaceholderCoaching(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (PLACEHOLDER_COACHING_VALUES.has(normalized)) return true;
  return /^test\d*$/.test(normalized) || /^todo[-\d]*$/.test(normalized);
}

function validateBaseEvent(event: GuidedMatchEvent, index: number, issues: GuidedMatchValidationIssue[]): void {
  const path = `events[${index}]`;
  if (!isNonEmptyString(event.id)) pushIssue(issues, `${path}.id`, 'Event id is required.');
  const sequence = extractEventSequence(event.id);
  if (sequence === null) {
    pushIssue(issues, `${path}.id`, 'Event id must start with event-0000 style sequence.');
  } else if (sequence !== index + 1) {
    pushIssue(issues, `${path}.id`, `Event id sequence must be ${index + 1}.`);
  }
  if (!Number.isInteger(event.handNumber) || event.handNumber < 1) {
    pushIssue(issues, `${path}.handNumber`, 'handNumber must be a positive integer.');
  }
  if (!Number.isInteger(event.turnNumber) || event.turnNumber < 1) {
    pushIssue(issues, `${path}.turnNumber`, 'turnNumber must be a positive integer.');
  }
  if (!Number.isInteger(event.chainIndex) || event.chainIndex < 0) {
    pushIssue(issues, `${path}.chainIndex`, 'chainIndex must be a non-negative integer.');
  }
  if (!isNonEmptyString(event.beforeSnapshot)) {
    pushIssue(issues, `${path}.beforeSnapshot`, 'beforeSnapshot is required.');
  } else if (!parseSnapshot(event.beforeSnapshot)) {
    pushIssue(issues, `${path}.beforeSnapshot`, 'beforeSnapshot must be parseable JSON.');
  }
  if (!isNonEmptyString(event.afterSnapshot)) {
    pushIssue(issues, `${path}.afterSnapshot`, 'afterSnapshot is required.');
  } else if (!parseSnapshot(event.afterSnapshot)) {
    pushIssue(issues, `${path}.afterSnapshot`, 'afterSnapshot must be parseable JSON.');
  }
  if (!Number.isFinite(event.openCountBefore)) {
    pushIssue(issues, `${path}.openCountBefore`, 'openCountBefore is required.');
  }
  if (!Number.isFinite(event.openCountAfter)) {
    pushIssue(issues, `${path}.openCountAfter`, 'openCountAfter is required.');
  }
}

function validateTilePlayEvent(
  event: GuidedMatchTilePlayEvent,
  index: number,
  issues: GuidedMatchValidationIssue[],
): void {
  const path = `events[${index}]`;
  if (!isNonEmptyString(event.tileId)) pushIssue(issues, `${path}.tileId`, 'tileId is required.');
  if (!Number.isInteger(event.tile.low) || event.tile.low < 0 || event.tile.low > 6) {
    pushIssue(issues, `${path}.tile.low`, 'tile.low must be an integer between 0 and 6.');
  }
  if (!Number.isInteger(event.tile.high) || event.tile.high < 0 || event.tile.high > 6) {
    pushIssue(issues, `${path}.tile.high`, 'tile.high must be an integer between 0 and 6.');
  }
  if (event.tile.low > event.tile.high) {
    pushIssue(issues, `${path}.tile`, 'tile.low must be <= tile.high.');
  }
  if (!Number.isInteger(event.legalMoveMetadata.legalMovesBeforeCount) || event.legalMoveMetadata.legalMovesBeforeCount < 0) {
    pushIssue(issues, `${path}.legalMoveMetadata.legalMovesBeforeCount`, 'legalMovesBeforeCount must be a non-negative integer.');
  }
  if (!Array.isArray(event.legalMoveMetadata.playableTileIdsBefore)) {
    pushIssue(issues, `${path}.legalMoveMetadata.playableTileIdsBefore`, 'playableTileIdsBefore must be an array.');
  }
  if (!Array.isArray(event.legalMoveMetadata.openTargetsBefore)) {
    pushIssue(issues, `${path}.legalMoveMetadata.openTargetsBefore`, 'openTargetsBefore must be an array.');
  }
  if (!Number.isFinite(event.pointsScored) || event.pointsScored < 0) {
    pushIssue(issues, `${path}.pointsScored`, 'pointsScored must be a non-negative number.');
  }
}

function validatePlayerTileCoaching(
  event: GuidedMatchPlayerTilePlayEvent,
  index: number,
  issues: GuidedMatchValidationIssue[],
  mode: GuidedMatchValidationMode,
): void {
  const path = `events[${index}].coaching`;
  const title = event.coaching.title?.trim() ?? '';
  const body = event.coaching.body?.trim() ?? '';
  if (!title) pushIssue(issues, `${path}.title`, 'Player tile events require a coaching title.');
  if (!body) pushIssue(issues, `${path}.body`, 'Player tile events require coaching body text.');
  if (event.coaching.tags && !Array.isArray(event.coaching.tags)) {
    pushIssue(issues, `${path}.tags`, 'coaching.tags must be an array when provided.');
  }
  if (mode !== 'final') return;
  if (title.length < 5) {
    pushIssue(issues, `${path}.title`, 'Final canonical coaching titles must be at least 5 characters.');
  }
  if (body.length < 20) {
    pushIssue(issues, `${path}.body`, 'Final canonical coaching body text must be at least 20 characters.');
  }
  if (isPlaceholderCoaching(title)) {
    pushIssue(issues, `${path}.title`, 'Final canonical coaching title looks like placeholder text.');
  }
  if (isPlaceholderCoaching(body)) {
    pushIssue(issues, `${path}.body`, 'Final canonical coaching body looks like placeholder text.');
  }
}

export function validateGuidedMatchLesson(
  lesson: GuidedMatchLesson,
  options: GuidedMatchValidationOptions,
): GuidedMatchValidationResult {
  const issues: GuidedMatchValidationIssue[] = [];
  const { mode, pendingPlayerEvent = null } = options;

  if (lesson.version !== GUIDED_MATCH_CANONICAL_VERSION) {
    pushIssue(issues, 'version', `Expected canonical version ${GUIDED_MATCH_CANONICAL_VERSION}.`);
  }
  if (!isNonEmptyString(lesson.lessonId)) pushIssue(issues, 'lessonId', 'lessonId is required.');
  if (!isNonEmptyString(lesson.title)) pushIssue(issues, 'title', 'title is required.');
  if (lesson.opponent !== 'standard-fritz') {
    pushIssue(issues, 'opponent', 'opponent must be "standard-fritz".');
  }
  if (!Number.isInteger(lesson.dealSize) || lesson.dealSize <= 0) {
    pushIssue(issues, 'dealSize', 'dealSize must be a positive integer.');
  }
  if (lesson.targetScore !== GUIDED_MATCH_STANDARD_TARGET_SCORE) {
    pushIssue(
      issues,
      'targetScore',
      `targetScore must be ${GUIDED_MATCH_STANDARD_TARGET_SCORE} (First to 60).`,
    );
  }
  if (!isNonEmptyString(lesson.rootSeed)) pushIssue(issues, 'rootSeed', 'rootSeed is required.');
  if (!isNonEmptyString(lesson.createdAt) || !isIsoString(lesson.createdAt)) {
    pushIssue(issues, 'createdAt', 'createdAt must be a valid ISO date string.');
  }
  if (!isNonEmptyString(lesson.updatedAt) || !isIsoString(lesson.updatedAt)) {
    pushIssue(issues, 'updatedAt', 'updatedAt must be a valid ISO date string.');
  }

  const initialSnapshot = isNonEmptyString(lesson.initialMatchSnapshot) ? parseSnapshot(lesson.initialMatchSnapshot) : null;
  if (!isNonEmptyString(lesson.initialMatchSnapshot)) {
    pushIssue(issues, 'initialMatchSnapshot', 'initialMatchSnapshot is required.');
  } else if (!initialSnapshot) {
    pushIssue(issues, 'initialMatchSnapshot', 'initialMatchSnapshot must be parseable JSON.');
  }

  const finalSnapshot = isNonEmptyString(lesson.finalMatchSnapshot) ? parseSnapshot(lesson.finalMatchSnapshot) : null;
  if (!isNonEmptyString(lesson.finalMatchSnapshot)) {
    pushIssue(issues, 'finalMatchSnapshot', 'finalMatchSnapshot is required.');
  } else if (!finalSnapshot) {
    pushIssue(issues, 'finalMatchSnapshot', 'finalMatchSnapshot must be parseable JSON.');
  }

  if (!Array.isArray(lesson.events) || lesson.events.length === 0) {
    pushIssue(issues, 'events', 'At least one event is required.');
  }

  let previousEvent: GuidedMatchEvent | null = null;
  let previousChainContext: { handNumber: number; turnNumber: number; actor: 'player' | 'fritz' } | null = null;
  const ids = new Set<string>();

  lesson.events.forEach((event, index) => {
    const path = `events[${index}]`;
    validateBaseEvent(event, index, issues);

    if (ids.has(event.id)) {
      pushIssue(issues, `${path}.id`, 'Event ids must be unique.');
    }
    ids.add(event.id);

    if (index === 0 && event.beforeSnapshot !== lesson.initialMatchSnapshot) {
      pushIssue(issues, `${path}.beforeSnapshot`, 'The first event beforeSnapshot must equal initialMatchSnapshot.');
    }

    if (previousEvent) {
      if (event.beforeSnapshot !== previousEvent.afterSnapshot) {
        pushIssue(issues, `${path}.beforeSnapshot`, 'beforeSnapshot must equal the previous event afterSnapshot.');
      }
      if (event.handNumber < previousEvent.handNumber) {
        pushIssue(issues, `${path}.handNumber`, 'handNumber cannot move backwards.');
      }
      if (event.handNumber === previousEvent.handNumber && event.turnNumber < previousEvent.turnNumber) {
        pushIssue(issues, `${path}.turnNumber`, 'turnNumber cannot move backwards within a hand.');
      }
      if (previousEvent.kind === 'hand-end' && event.kind !== 'next-hand') {
        pushIssue(issues, `${path}.kind`, 'A hand-end event must be followed by a next-hand event.');
      }
    }

    if (event.kind === 'tile-play') {
      validateTilePlayEvent(event, index, issues);
      if (event.actor === 'player') {
        validatePlayerTileCoaching(event, index, issues, mode);
      }

      const context = { handNumber: event.handNumber, turnNumber: event.turnNumber, actor: event.actor };
      if (
        previousChainContext &&
        previousChainContext.handNumber === context.handNumber &&
        previousChainContext.turnNumber === context.turnNumber &&
        previousChainContext.actor === context.actor
      ) {
        if (previousEvent && event.chainIndex !== previousEvent.chainIndex + 1) {
          pushIssue(issues, `${path}.chainIndex`, 'chainIndex must increment by 1 within the same actor tile-play turn.');
        }
      } else if (event.chainIndex !== 0) {
        pushIssue(issues, `${path}.chainIndex`, 'A new actor turn must start at chainIndex 0.');
      }
      previousChainContext = context;
    } else if (event.kind === 'draw' || event.kind === 'pass') {
      if (event.chainIndex !== 0) {
        pushIssue(issues, `${path}.chainIndex`, `${event.kind} events must use chainIndex 0.`);
      }
      previousChainContext = { handNumber: event.handNumber, turnNumber: event.turnNumber, actor: event.actor };
    } else {
      if (event.actor !== 'system') {
        pushIssue(issues, `${path}.actor`, 'System events must use actor "system".');
      }
      previousChainContext = null;
    }

    if (event.kind === 'hand-end') {
      if (!Number.isFinite(event.pointsAwarded) || event.pointsAwarded < 0) {
        pushIssue(issues, `${path}.pointsAwarded`, 'hand-end pointsAwarded must be a non-negative number.');
      }
      if (!Number.isFinite(event.leftoverPips) || event.leftoverPips < 0) {
        pushIssue(issues, `${path}.leftoverPips`, 'hand-end leftoverPips must be a non-negative number.');
      }
    }

    previousEvent = event;
  });

  if (lesson.events.length > 0 && lesson.finalMatchSnapshot !== lesson.events.at(-1)?.afterSnapshot) {
    pushIssue(issues, 'finalMatchSnapshot', 'finalMatchSnapshot must equal the last event afterSnapshot.');
  }

  if (pendingPlayerEvent) {
    pushIssue(issues, 'pendingPlayerEvent', 'Pending player coaching event has not been committed.');
  }

  if (mode === 'final') {
    if (!finalSnapshot || finalSnapshot.gameOver !== true) {
      pushIssue(issues, 'finalMatchSnapshot', 'Final canonical lessons must end with gameOver true.');
    }
  }

  return { ok: issues.length === 0, mode, issues };
}
