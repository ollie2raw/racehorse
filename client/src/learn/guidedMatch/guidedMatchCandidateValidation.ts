import type {
  GuidedMatchCandidate,
  GuidedMatchCandidateEvent,
  GuidedMatchCandidatePlayerTilePlayEvent,
} from './guidedMatchCandidateTypes';
import {
  GUIDED_MATCH_CANDIDATE_VERSION,
} from './guidedMatchCandidateTypes';
import { GUIDED_MATCH_STANDARD_TARGET_SCORE } from './guidedMatchRecorderEngine';

export interface GuidedMatchCandidateValidationIssue {
  path: string;
  message: string;
}

export type GuidedMatchCandidateValidationMode = 'draft' | 'final';

export interface GuidedMatchCandidateValidationResult {
  ok: boolean;
  mode: GuidedMatchCandidateValidationMode;
  issues: GuidedMatchCandidateValidationIssue[];
}

const SNAPSHOT_CONTINUITY_IGNORED_FIELDS = new Set([
  'opponentDrawCount',
  'opponentPassedOnEnds',
  'opponentKnownMissing',
  'opponentMissingEvidence',
]);

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

function pushIssue(
  issues: GuidedMatchCandidateValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
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

function normalizeSnapshotForContinuity(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSnapshotForContinuity);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (SNAPSHOT_CONTINUITY_IGNORED_FIELDS.has(key)) continue;
    normalized[key] = normalizeSnapshotForContinuity(nestedValue);
  }
  return normalized;
}

export function snapshotsMatchForContinuity(
  previousAfterSnapshot: string,
  nextBeforeSnapshot: string,
): boolean {
  const previous = parseSnapshot(previousAfterSnapshot);
  const next = parseSnapshot(nextBeforeSnapshot);
  if (!previous || !next) return previousAfterSnapshot === nextBeforeSnapshot;
  return JSON.stringify(normalizeSnapshotForContinuity(previous)) === JSON.stringify(normalizeSnapshotForContinuity(next));
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

function isPlayerTileEvent(event: GuidedMatchCandidateEvent): event is GuidedMatchCandidatePlayerTilePlayEvent {
  return event.kind === 'tile-play' && event.actor === 'player';
}

function validateEventBase(
  event: GuidedMatchCandidateEvent,
  index: number,
  issues: GuidedMatchCandidateValidationIssue[],
): void {
  const path = `events[${index}]`;
  if (!isNonEmptyString(event.id)) {
    pushIssue(issues, `${path}.id`, 'Event id is required.');
  }
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

function validateFinalCoaching(
  event: GuidedMatchCandidatePlayerTilePlayEvent,
  index: number,
  issues: GuidedMatchCandidateValidationIssue[],
): void {
  const path = `events[${index}].coaching`;
  const title = event.coaching?.title?.trim() ?? '';
  const body = event.coaching?.body?.trim() ?? '';
  if (!title) {
    pushIssue(issues, `${path}.title`, 'Final candidates require coaching title on every player tile event.');
  }
  if (!body) {
    pushIssue(issues, `${path}.body`, 'Final candidates require coaching body on every player tile event.');
  }
  if (title && title.length < 5) {
    pushIssue(issues, `${path}.title`, 'Final coaching titles must be at least 5 characters.');
  }
  if (body && body.length < 20) {
    pushIssue(issues, `${path}.body`, 'Final coaching body text must be at least 20 characters.');
  }
  if (title && isPlaceholderCoaching(title)) {
    pushIssue(issues, `${path}.title`, 'Final coaching title looks like placeholder text.');
  }
  if (body && isPlaceholderCoaching(body)) {
    pushIssue(issues, `${path}.body`, 'Final coaching body looks like placeholder text.');
  }
}

export function validateGuidedMatchCandidate(
  candidate: GuidedMatchCandidate,
  mode: GuidedMatchCandidateValidationMode,
): GuidedMatchCandidateValidationResult {
  const issues: GuidedMatchCandidateValidationIssue[] = [];

  if (candidate.version !== GUIDED_MATCH_CANDIDATE_VERSION) {
    pushIssue(issues, 'version', `Expected candidate version ${GUIDED_MATCH_CANDIDATE_VERSION}.`);
  }
  if (!isNonEmptyString(candidate.candidateId)) {
    pushIssue(issues, 'candidateId', 'candidateId is required.');
  }
  if (candidate.targetScore !== GUIDED_MATCH_STANDARD_TARGET_SCORE) {
    pushIssue(issues, 'targetScore', `targetScore must be ${GUIDED_MATCH_STANDARD_TARGET_SCORE}.`);
  }
  if (candidate.opponent !== 'standard-fritz') {
    pushIssue(issues, 'opponent', 'opponent must be "standard-fritz".');
  }
  if (candidate.fritzTier !== 'standard') {
    pushIssue(issues, 'fritzTier', 'fritzTier must be "standard".');
  }
  if (candidate.dealSize !== 7) {
    pushIssue(issues, 'dealSize', 'dealSize must be 7 for Guided Match candidates.');
  }
  const initialSnapshot = isNonEmptyString(candidate.initialMatchSnapshot)
    ? parseSnapshot(candidate.initialMatchSnapshot)
    : null;
  if (!isNonEmptyString(candidate.initialMatchSnapshot)) {
    pushIssue(issues, 'initialMatchSnapshot', 'initialMatchSnapshot is required.');
  } else if (!initialSnapshot) {
    pushIssue(issues, 'initialMatchSnapshot', 'initialMatchSnapshot must be parseable JSON.');
  }
  const finalSnapshot = isNonEmptyString(candidate.finalMatchSnapshot)
    ? parseSnapshot(candidate.finalMatchSnapshot)
    : null;
  if (isNonEmptyString(candidate.finalMatchSnapshot) && !finalSnapshot) {
    pushIssue(issues, 'finalMatchSnapshot', 'finalMatchSnapshot must be parseable JSON when present.');
  }
  if (!Array.isArray(candidate.events)) {
    pushIssue(issues, 'events', 'events must be an array.');
  }

  const ids = new Set<string>();
  let previousEvent: GuidedMatchCandidateEvent | null = null;

  candidate.events.forEach((event, index) => {
    const path = `events[${index}]`;
    validateEventBase(event, index, issues);

    if (ids.has(event.id)) {
      pushIssue(issues, `${path}.id`, 'Event ids must be unique.');
    }
    ids.add(event.id);

    if (
      index === 0 &&
      candidate.initialMatchSnapshot &&
      !snapshotsMatchForContinuity(candidate.initialMatchSnapshot, event.beforeSnapshot)
    ) {
      pushIssue(issues, `${path}.beforeSnapshot`, 'First event beforeSnapshot must equal initialMatchSnapshot.');
    }
    if (previousEvent && !snapshotsMatchForContinuity(previousEvent.afterSnapshot, event.beforeSnapshot)) {
      pushIssue(issues, `${path}.beforeSnapshot`, 'beforeSnapshot must equal previous event afterSnapshot.');
    }
    if (mode === 'final' && event.captureContinuityRepair) {
      pushIssue(
        issues,
        `${path}.captureContinuityRepair`,
        'Final candidates cannot include capture continuity repairs.',
      );
    }

    if (isPlayerTileEvent(event) && mode === 'final') {
      validateFinalCoaching(event, index, issues);
    }

    previousEvent = event;
  });

  if (mode === 'final') {
    if (!finalSnapshot) {
      pushIssue(issues, 'finalMatchSnapshot', 'Final candidates require finalMatchSnapshot.');
    }
    if (candidate.result === 'incomplete') {
      pushIssue(issues, 'result', 'Final candidates must be won or lost, not incomplete.');
    }
    if (!Number.isFinite(candidate.finalScore?.player) || !Number.isFinite(candidate.finalScore?.fritz)) {
      pushIssue(issues, 'finalScore', 'Final candidates require player and fritz final scores.');
    }
    if (candidate.eventCount !== candidate.events.length) {
      pushIssue(issues, 'eventCount', 'eventCount must match events.length.');
    }
    const playerTileEventCount = candidate.events.filter(isPlayerTileEvent).length;
    if (candidate.playerTileEventCount !== playerTileEventCount) {
      pushIssue(issues, 'playerTileEventCount', 'playerTileEventCount must match actual player tile events.');
    }
    const handCount = new Set(candidate.events.map((event) => event.handNumber)).size;
    if (candidate.handCount !== handCount) {
      pushIssue(issues, 'handCount', 'handCount must match distinct event hand numbers.');
    }
    if (candidate.events.length > 0 && candidate.finalMatchSnapshot !== candidate.events.at(-1)?.afterSnapshot) {
      pushIssue(issues, 'finalMatchSnapshot', 'finalMatchSnapshot must equal last event afterSnapshot.');
    }
    if (!finalSnapshot || finalSnapshot.gameOver !== true) {
      pushIssue(issues, 'finalMatchSnapshot', 'Final candidates must end with gameOver true.');
    }
  }

  return { ok: issues.length === 0, mode, issues };
}
