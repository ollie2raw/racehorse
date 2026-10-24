import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyNodeById } from './journeyChapters';
import type { JourneyAttempt, JourneyAttemptDetail } from './journeyAttempts';
import { findJourneyAttempt, getJourneyAttemptStorageKey, loadJourneyAttempts } from './journeyAttempts';
import { settleAndApplyJourneyAttempt, type JourneyMatchOutcomeResult } from './journeyCompletionCore';
import type { JourneyLessonDefinition } from './journeyContentContract';
import { getJourneyContentDescriptor, getJourneyLessonDefinition } from './journeyContentResolver';
import {
  isJourneyStageOutcomeAccepted,
  parseJourneyLessonSessionSnapshot,
  type JourneyLessonSessionState,
  type JourneyStageOutcome,
} from './journeyLessonController';
import { getJourneyPuzzleSprint, hasJourneyPuzzleSprint } from './journeyPuzzleSprints';
import { JOURNEY_CHAPTER_1_ID, type JourneyNode } from './journeyTypes';

/**
 * WHEN IS A LESSON OR SPRINT COMPLETION VALID?
 *
 * Three different things, kept apart:
 *   - SESSION EVIDENCE: the in-memory decisions of one lesson run (controller state, evidence store). Never
 *     persisted here; it is what a completion is *derived from*.
 *   - A COMPLETED ATTEMPT: a terminal `won` attempt in the attempt log whose completion conditions were
 *     genuinely met. Written only by `recordJourneyLessonCompletion` / `recordJourneySprintResult`, and only
 *     after the predicates below pass against real controller / sprint state.
 *   - PROGRESS CREDIT: the node in `completedNodeIds`. Granted only for a completed attempt — by the same
 *     write path, or by recovery re-checking the SAME predicates against the stored attempt.
 *
 * A stored field proves nothing by itself. `isLegitimateStageCompletion` therefore never reads a boolean like
 * "passed": it re-derives validity from structured facts and the CURRENT definitions.
 *
 * LESSON — all must hold:
 *   L1  attempt.kind === 'lesson', outcome === 'won', stored for this node.
 *   L2  the node is a premium `lesson_sequence` node; its lesson definition exists, `definition.nodeId` is this
 *       node, and `attempt.detail.contentId` is that definition's ID (a reused or renamed ID cannot be credited).
 *   L3  the attempt carries a completion proof that, checked against the current definition, says: same
 *       content/definition/node/version; the controller's completion rule is the definition's; and EVERY
 *       required stage was completed — an interactive stage with an outcome the controller itself counts as
 *       accepted (`isJourneyStageOutcomeAccepted`: proof/review stages need `passed`; `failed` and `abandoned`
 *       never count), a non-interactive one acknowledged.
 *   L4  the proof was built from a session the controller reports `completed`, whose snapshot parses as a
 *       valid session for this definition (`parseJourneyLessonSessionSnapshot`) AND whose history is internally
 *       consistent (`sessionHistoryIsConsistent`): every `stageOutcomes` entry and every `outcomeHistory` entry
 *       carries the parent session's ID; each stage outcome is the LAST history entry of its stage; a required
 *       stage's executions are numbered 1..n, match the stage's recorded ordinal, and only the last one passed;
 *       execution IDs are unique and registered; timestamps sit inside the session; required stages finished in
 *       definition order. A session that ended, was abandoned, ran out of variants or is still in flight, or whose
 *       history contradicts its outcomes, yields no proof, so no `won` is ever written.
 *   L5  stamps: `detail.stage` is the node's title and, in Chapter One, `detail.chapterLayout` is current.
 *   L6  the proof is BOUND TO THE ATTEMPT it credits (`attemptBindingHolds`): the attempt records the session ID
 *       (`detail.sessionId`) and it equals the proof's; the session started no earlier than the attempt (both
 *       timestamps well-formed); and the attempt is the session ID's sole OWNER, so one session credits at most
 *       one attempt however the attempts are ordered. Ownership follows SETTLEMENT, not start order: before a win
 *       is written, no other lesson attempt may already carry the session ID; in recovery, among attempts that
 *       carry it, the one that settled first (earliest valid `endedAt`, then `attemptId`) is the only eligible
 *       owner. A carrier with a missing or malformed settlement time can never be the earlier winner. Applied by
 *       the same predicate before a win is written and by recovery, so persisting a proof in a pending record
 *       never makes it valid.
 *
 * TRUST BOUNDARY: this is a client-side integrity contract, not cryptographic proof. A user who can edit
 * localStorage or run arbitrary client code can fabricate a self-consistent session, attempt and proof. What the
 * contract does stop is accident and misuse inside the app: a stale or replayed session, a session from another
 * attempt, a half-finished or internally contradictory one, a record that never ran the lesson. Session-ID
 * uniqueness is checked against the stored attempt log, which is bounded (oldest finished attempts are dropped
 * past `JOURNEY_ATTEMPT_LOG_LIMIT`), so a very old session ID is no longer remembered.
 *   Retries are allowed — the controller's own `retry_required` policy lets a stage pass on a later position —
 *   but the proof records how many there were and nothing here calls the result "mastery".
 *
 * SPRINT — all must hold:
 *   S1  attempt.kind === 'sprint', outcome === 'won', stored for this node.
 *   S2  the node is a `puzzle_sprint` node with a registered puzzle set.
 *   S3  `correct` and `total` are integers, `total` equals the registered set's size, 0 <= correct <= total,
 *       and correct >= ceil(total / 2) (`journeySprintPasses` — the threshold the screen has always used; a
 *       timeout is not treated differently: unanswered puzzles are simply not correct).
 *   S4  stamps as L5.
 *
 * MATCH (unchanged): kind 'match', won, node is a match/boss stage, `detail.stage` is its title, layout current.
 *
 * Both write time and recovery then require the stage to be unlocked right now (a win never skips ahead).
 * Nothing here makes localStorage tamper-proof: a determined user can edit it. The goal is correctness
 * against crashes, stale state, duplicate events and malformed records.
 */

/** Fraction of a sprint's puzzles that must be read correctly. Unchanged from the original screen logic. */
export function journeySprintPasses(correct: number, total: number): boolean {
  return Number.isInteger(correct) && Number.isInteger(total) && total > 0 && correct >= 0 && correct <= total
    && correct >= Math.ceil(total / 2);
}

export const JOURNEY_LESSON_COMPLETION_PROOF_VERSION = 2 as const;

export interface JourneyLessonCompletionProofStage {
  stageId: string;
  /** Interactive stages carry the controller's outcome; a required non-interactive stage is `acknowledged`. */
  outcome: JourneyStageOutcome | 'acknowledged';
  /** Executions of this stage (1 = first position passed). 0 for a non-interactive stage. */
  attempts: number;
  /** The controller execution that passed this stage (empty for a non-interactive stage). */
  executionId: string;
}

/** The smallest projection of a completed session that recovery can re-check. Not the session, not skill data. */
export interface JourneyLessonCompletionProof {
  v: typeof JOURNEY_LESSON_COMPLETION_PROOF_VERSION;
  sessionId: string;
  /** When the session began — must not precede the attempt it is recorded against. */
  startedAt: string;
  contentId: string;
  nodeId: string;
  contentVersion: number;
  rule: JourneyLessonDefinition['completion']['kind'];
  completedAt: string;
  /** One entry per REQUIRED stage, in the definition's order. */
  stages: JourneyLessonCompletionProofStage[];
  /** Total extra positions across required stages (sum of attempts - 1). Honest effort, not a score. */
  retries: number;
}

function requiredStageIds(definition: JourneyLessonDefinition): string[] {
  return definition.completion.kind === 'required_stages' ? definition.completion.stageIds : definition.completion.requiredStageIds;
}

function isInteractiveStage(stage: JourneyLessonDefinition['stages'][number]): boolean {
  return stage.kind !== 'frame' && stage.kind !== 'board_demo';
}

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * Cross-checks the session's two outcome records against each other and against the session, beyond the shape
 * checks of `parseJourneyLessonSessionSnapshot`. Assumes `status === 'completed'` and a valid snapshot.
 */
function sessionHistoryIsConsistent(session: JourneyLessonSessionState, definition: JourneyLessonDefinition): boolean {
  if (!session.completion || !isTime(session.startedAt) || !isTime(session.completion.completedAt)) return false;
  const startMs = Date.parse(session.startedAt);
  const endMs = Date.parse(session.completion.completedAt);
  if (endMs < startMs) return false;

  const executionIds = new Set<string>();
  for (const entry of session.outcomeHistory) {
    if (entry.sessionId !== session.sessionId || executionIds.has(entry.executionId)) return false;
    if (!session.usedExecutionIds.includes(entry.executionId) || !session.usedAttemptIds.includes(String(entry.attemptId))) return false;
    if (!isTime(entry.startedAt) || !isTime(entry.completedAt)) return false;
    if (Date.parse(entry.startedAt) < startMs || Date.parse(entry.completedAt) > endMs) return false;
    executionIds.add(entry.executionId);
  }
  for (const outcome of session.stageOutcomes) {
    if (outcome.sessionId !== session.sessionId) return false;
    const last = [...session.outcomeHistory].reverse().find((entry) => entry.stageId === outcome.stageId);
    if (!last || last.executionId !== outcome.executionId || String(last.attemptId) !== String(outcome.attemptId)
      || last.outcome !== outcome.outcome || last.accepted !== outcome.accepted || last.scenarioRef !== outcome.scenarioRef
      || last.attemptOrdinal !== outcome.attemptOrdinal || last.completedAt !== outcome.completedAt) return false;
  }

  let previousFinish = -Infinity;
  for (const stageId of requiredStageIds(definition)) {
    const stage = definition.stages.find((candidate) => candidate.id === stageId);
    if (!stage || !isInteractiveStage(stage)) continue;
    const entries = session.outcomeHistory.filter((entry) => entry.stageId === stageId);
    const count = entries.length;
    if (count < 1 || session.attemptOrdinalByStageId[stageId] !== count) return false;
    for (let index = 0; index < count; index += 1) {
      if (entries[index].attemptOrdinal !== index + 1) return false; // executions numbered 1..n, none missing or repeated
      if (entries[index].accepted !== (index === count - 1)) return false; // only the final execution may have passed
    }
    const finish = Date.parse(entries[count - 1].completedAt);
    if (finish < previousFinish) return false; // required stages finish in definition order
    previousFinish = finish;
  }
  return true;
}

/**
 * Derives a proof from the controller's own state, or returns null when the session is not a genuinely
 * completed run of this definition. Used at the moment a lesson reports completion.
 */
export function buildJourneyLessonCompletionProof(
  session: JourneyLessonSessionState,
  definition: JourneyLessonDefinition,
): JourneyLessonCompletionProof | null {
  if (session.status !== 'completed' || session.phase !== 'completed' || !session.completion) return null;
  if (session.completion.rule !== definition.completion.kind) return null;
  if (parseJourneyLessonSessionSnapshot(session, definition).kind !== 'valid') return null;
  if (!sessionHistoryIsConsistent(session, definition)) return null;

  const stages: JourneyLessonCompletionProofStage[] = [];
  let retries = 0;
  for (const stageId of requiredStageIds(definition)) {
    const stage = definition.stages.find((candidate) => candidate.id === stageId);
    if (!stage || !session.completedStageIds.includes(stageId)) return null;
    if (!isInteractiveStage(stage)) {
      stages.push({ stageId, outcome: 'acknowledged', attempts: 0, executionId: '' });
      continue;
    }
    const outcome = session.stageOutcomes.find((candidate) => candidate.stageId === stageId);
    const attempts = session.attemptOrdinalByStageId[stageId] ?? 0;
    if (!outcome || attempts < 1 || !isJourneyStageOutcomeAccepted(stage, outcome.outcome)) return null;
    stages.push({ stageId, outcome: outcome.outcome, attempts, executionId: outcome.executionId });
    retries += attempts - 1;
  }
  return {
    v: JOURNEY_LESSON_COMPLETION_PROOF_VERSION,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    contentId: String(definition.id),
    nodeId: String(definition.nodeId),
    contentVersion: definition.contentVersion,
    rule: definition.completion.kind,
    completedAt: session.completion.completedAt,
    stages,
    retries,
  };
}

/** Why a proof does not satisfy the CURRENT definition. Empty = it does. Pure; trusts nothing in `value`. */
export function verifyJourneyLessonCompletionProof(value: unknown, definition: JourneyLessonDefinition): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['proof is not an object'];
  const proof = value as Partial<JourneyLessonCompletionProof>;
  if (proof.v !== JOURNEY_LESSON_COMPLETION_PROOF_VERSION) errors.push('unsupported proof version');
  if (typeof proof.sessionId !== 'string' || proof.sessionId.length === 0) errors.push('missing session ID');
  if (!isTime(proof.startedAt)) errors.push('invalid session start time');
  if (proof.contentId !== String(definition.id)) errors.push('content ID mismatch');
  if (proof.nodeId !== String(definition.nodeId)) errors.push('node ID mismatch');
  if (proof.contentVersion !== definition.contentVersion) errors.push('content version mismatch');
  if (proof.rule !== definition.completion.kind) errors.push('completion rule mismatch');
  if (!isTime(proof.completedAt)) errors.push('invalid completion time');
  else if (isTime(proof.startedAt) && Date.parse(proof.completedAt) < Date.parse(proof.startedAt)) errors.push('completion precedes session start');
  if (!Array.isArray(proof.stages)) return [...errors, 'stages must be an array'];

  const required = requiredStageIds(definition);
  if (proof.stages.length !== required.length) errors.push('proof does not cover exactly the required stages');
  let retries = 0;
  const executionIds = new Set<string>();
  required.forEach((stageId, index) => {
    const entry = proof.stages?.[index] as Partial<JourneyLessonCompletionProofStage> | undefined;
    const stage = definition.stages.find((candidate) => candidate.id === stageId);
    if (!entry || !stage || entry.stageId !== stageId) {
      errors.push(`required stage ${stageId} is missing from the proof`);
      return;
    }
    if (!isInteractiveStage(stage)) {
      if (entry.outcome !== 'acknowledged' || entry.attempts !== 0) errors.push(`required stage ${stageId} was not acknowledged`);
      return;
    }
    const outcome = entry.outcome;
    if (outcome !== 'completed' && outcome !== 'passed' && outcome !== 'failed' && outcome !== 'abandoned') {
      errors.push(`required stage ${stageId} has no controller outcome`);
      return;
    }
    if (!isJourneyStageOutcomeAccepted(stage, outcome)) errors.push(`required stage ${stageId} did not pass (${outcome})`);
    if (typeof entry.executionId !== 'string' || entry.executionId.length === 0 || executionIds.has(entry.executionId)) errors.push(`required stage ${stageId} has no distinct execution`);
    else executionIds.add(entry.executionId);
    if (!Number.isInteger(entry.attempts) || (entry.attempts as number) < 1) errors.push(`required stage ${stageId} has no recorded attempt`);
    else retries += (entry.attempts as number) - 1;
  });
  if (proof.retries !== retries) errors.push('retry count does not match the stage attempts');
  return errors;
}

function chapterLayoutIsCurrent(node: JourneyNode, detail: JourneyAttemptDetail): boolean {
  return node.chapterId !== JOURNEY_CHAPTER_1_ID || detail.chapterLayout === JOURNEY_CHAPTER_ONE_LAYOUT_VERSION;
}

function parseProof(detail: JourneyAttemptDetail): unknown {
  const raw = detail.completionProof;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type AttemptFacts = Pick<JourneyAttempt, 'attemptId' | 'startedAt' | 'endedAt' | 'kind' | 'outcome' | 'nodeId' | 'detail'>;

/**
 * The settlement time as STORED, or null when the stored value is missing or malformed. The attempt reader
 * (`sanitizeAttempt`) deliberately repairs a finished attempt's absent/invalid `endedAt` to its `startedAt`; that
 * repair is right for display, but for ownership it would let a stripped record look like it settled at its start
 * time and "win" over a genuine owner. So ownership reads the raw value and treats anything unusable as "no
 * settlement time".
 */
function storedSettlementMs(attemptId: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getJourneyAttemptStorageKey(attemptId));
    const value = raw ? (JSON.parse(raw) as { endedAt?: unknown } | null) : null;
    return value && isTime(value.endedAt) ? Date.parse(value.endedAt) : null;
  } catch {
    return null;
  }
}

/**
 * L6 — the proof belongs to THIS attempt. Pure apart from reading the attempt log. See the contract comment for
 * what this does and does not establish.
 */
function attemptBindingHolds(attempt: AttemptFacts, proof: JourneyLessonCompletionProof): boolean {
  if (typeof attempt.detail.sessionId !== 'string' || attempt.detail.sessionId.length === 0 || attempt.detail.sessionId !== proof.sessionId) return false;
  if (!isTime(attempt.startedAt) || !isTime(proof.startedAt)) return false;
  if (Date.parse(proof.startedAt) < Date.parse(attempt.startedAt)) return false; // the session predates the attempt
  const carriers = loadJourneyAttempts().filter((other) =>
    other.attemptId !== attempt.attemptId && other.kind === 'lesson' && other.detail.sessionId === proof.sessionId);
  // Being settled right now (no settlement time yet): every other carrier necessarily settled first, whichever
  // attempt started earlier. Nobody may already own this session.
  if (attempt.endedAt === null) return carriers.length === 0;
  // Already settled (recovery): this attempt needs a valid settlement time, and must have settled first among the
  // carriers that settled as wins. A carrier without a valid settlement time cannot be an earlier owner.
  const mine = storedSettlementMs(attempt.attemptId);
  if (mine === null) return false;
  return !carriers.some((other) => {
    if (other.outcome !== 'won') return false;
    const theirs = storedSettlementMs(other.attemptId);
    if (theirs === null) return false;
    return theirs < mine || (theirs === mine && other.attemptId < attempt.attemptId);
  });
}

/**
 * The single predicate for "this stored attempt is a legitimate completion of this node", for every kind.
 * Called before a win is written and again by recovery. Does not check unlocked-ness (callers do).
 */
export function isLegitimateStageCompletion(attempt: AttemptFacts, node: JourneyNode): boolean {
  if (attempt.outcome !== 'won' || attempt.nodeId !== node.id) return false;
  if (attempt.detail.stage !== node.title || !chapterLayoutIsCurrent(node, attempt.detail)) return false;

  switch (attempt.kind) {
    case 'match':
      return node.nodeType === 'match' || node.nodeType === 'boss';
    case 'lesson': {
      const descriptor = getJourneyContentDescriptor(node.id);
      if (!descriptor || descriptor.runtime.kind !== 'lesson_sequence' || descriptor.migrationClass !== 'premium') return false;
      const definition = getJourneyLessonDefinition(String(descriptor.contentId));
      if (!definition || String(definition.nodeId) !== node.id) return false;
      if (attempt.detail.contentId !== String(definition.id)) return false;
      const proof = parseProof(attempt.detail);
      if (verifyJourneyLessonCompletionProof(proof, definition).length > 0) return false;
      return attemptBindingHolds(attempt, proof as JourneyLessonCompletionProof);
    }
    case 'sprint': {
      const descriptor = getJourneyContentDescriptor(node.id);
      if (!descriptor || descriptor.runtime.kind !== 'puzzle_sprint' || !hasJourneyPuzzleSprint(node.id)) return false;
      const { correct, total } = attempt.detail;
      if (typeof correct !== 'number' || typeof total !== 'number') return false;
      return total === (getJourneyPuzzleSprint(node.id)?.length ?? -1) && journeySprintPasses(correct, total);
    }
    default:
      return false;
  }
}

/** Identity stamps every lesson/sprint attempt carries so a later reader can tell which stage it was. */
export function journeyStageAttemptDetail(nodeId: string, extra: JourneyAttemptDetail = {}): JourneyAttemptDetail {
  const node = getJourneyNodeById(nodeId);
  return {
    ...extra,
    stage: node?.title ?? null,
    chapterLayout: node?.chapterId === JOURNEY_CHAPTER_1_ID ? JOURNEY_CHAPTER_ONE_LAYOUT_VERSION : null,
  };
}

function refuse(): JourneyMatchOutcomeResult {
  return { recorded: false, completedNode: false, refused: 'invalid_completion' };
}

/**
 * A lesson reported completion. Records a `won` attempt and (through the shared durable sequence) progress
 * credit — but only if the controller's completed session yields a valid proof and the resulting attempt would
 * pass `isLegitimateStageCompletion`. Otherwise NOTHING is written: the attempt stays open and is abandoned by
 * the normal exit paths. A duplicate call finds a terminal attempt and is a harmless no-op.
 */
export function recordJourneyLessonCompletion(input: {
  attemptId: string | null | undefined;
  nodeId: string;
  session: JourneyLessonSessionState;
}): JourneyMatchOutcomeResult {
  if (!input.attemptId) return { recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' };
  const node = getJourneyNodeById(input.nodeId);
  const descriptor = node ? getJourneyContentDescriptor(node.id) : null;
  const definition = descriptor?.migrationClass === 'premium' ? getJourneyLessonDefinition(String(descriptor.contentId)) : null;
  const existing = findJourneyAttempt(input.attemptId);
  // The attempt must be this node's lesson attempt; anything else is a caller bug, never a completion.
  if (!node || !definition || !existing || existing.nodeId !== input.nodeId || existing.kind !== 'lesson') {
    return { recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' };
  }

  const proof = buildJourneyLessonCompletionProof(input.session, definition);
  if (!proof) return refuse();
  const settleDetail: JourneyAttemptDetail = { completionProof: JSON.stringify(proof), retries: proof.retries, sessionId: proof.sessionId };
  const facts: AttemptFacts = { attemptId: existing.attemptId, startedAt: existing.startedAt, endedAt: null, kind: 'lesson', outcome: 'won', nodeId: existing.nodeId, detail: { ...existing.detail, ...settleDetail } };
  if (!isLegitimateStageCompletion(facts, node)) {
    return refuse();
  }
  return settleAndApplyJourneyAttempt({ attemptId: input.attemptId, nodeId: input.nodeId, expectedKind: 'lesson', won: true, settleDetail });
}

/**
 * A sprint finished. A pass records a `won` attempt (and credit) through the shared sequence, provided the
 * result satisfies the sprint predicate; a fail records `lost` and can never become a recoverable win.
 */
export function recordJourneySprintResult(input: {
  attemptId: string | null | undefined;
  nodeId: string;
  correct: number;
  total: number;
}): JourneyMatchOutcomeResult {
  if (!input.attemptId) return { recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' };
  const node = getJourneyNodeById(input.nodeId);
  const existing = findJourneyAttempt(input.attemptId);
  if (!node || !existing || existing.nodeId !== input.nodeId || existing.kind !== 'sprint') {
    return { recorded: false, completedNode: false, refused: 'unknown_attempt_or_stage' };
  }

  const wellFormed = Number.isInteger(input.correct) && Number.isInteger(input.total);
  const settleDetail: JourneyAttemptDetail = wellFormed ? { correct: input.correct, total: input.total } : {};
  if (journeySprintPasses(input.correct, input.total)) {
    if (!isLegitimateStageCompletion({ attemptId: existing.attemptId, startedAt: existing.startedAt, endedAt: null, kind: 'sprint', outcome: 'won', nodeId: existing.nodeId, detail: { ...existing.detail, ...settleDetail } }, node)) {
      return refuse();
    }
    return settleAndApplyJourneyAttempt({ attemptId: input.attemptId, nodeId: input.nodeId, expectedKind: 'sprint', won: true, settleDetail });
  }
  return settleAndApplyJourneyAttempt({ attemptId: input.attemptId, nodeId: input.nodeId, expectedKind: 'sprint', won: false, settleDetail });
}
