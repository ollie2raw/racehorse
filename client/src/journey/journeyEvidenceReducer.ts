import { validateJourneyEvidenceEvent } from './journeyEvidenceValidation.ts';
import {
  JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT,
  JOURNEY_EVIDENCE_SCHEMA_VERSION,
  JOURNEY_RECENT_ATTEMPT_LIMIT,
  type JourneyAttemptEvidence,
  type JourneyAttemptKind,
  type JourneyAttemptResult,
  type JourneyContentVersionRef,
  type JourneyEvidenceEvent,
  type JourneyEvidenceRecord,
  type JourneyEvidenceSourceRef,
  type JourneyEvidenceStore,
  type JourneyLearningLevel,
  type JourneyReviewTrigger,
  type JourneyScoreEvidence,
} from './journeyEvidenceTypes.ts';
import type { JourneyContentId, JourneyNodeId, JourneySkillId } from './journeyContentContract.ts';

function emptyAttempts() {
  return {
    total: 0,
    byKind: { practice: 0, proof: 0, review: 0 } as Record<JourneyAttemptKind, number>,
    byResult: { completed: 0, passed: 0, failed: 0, abandoned: 0 } as Record<JourneyAttemptResult, number>,
    decisions: { total: 0, correct: 0, incorrect: 0 },
    hintsUsed: 0,
    mistakeCounts: {} as Record<string, number>,
    bestResults: {} as Record<string, JourneyScoreEvidence>,
    recent: [] as JourneyAttemptEvidence[],
    seenAttemptIds: [] as string[],
  };
}

export function createEmptyJourneyEvidenceRecord(
  contentId: JourneyContentId,
  nodeId: JourneyNodeId,
  contentVersion: JourneyContentVersionRef,
  skillId: JourneySkillId | null = null,
): JourneyEvidenceRecord {
  return {
    contentId,
    nodeId,
    skillId,
    contentVersion,
    learningLevel: 'not_started',
    application: { observed: false, observationCount: 0, firstObservedAt: null, lastObservedAt: null, sourceRefs: [], contentVersion },
    review: { kind: 'not_due', lastResolvedAt: null },
    attempts: emptyAttempts(),
    startedAt: null,
    lastEvidenceAt: null,
    provenance: { legacyCompletionCredit: false, versionConflict: false },
  };
}

function levelRank(level: JourneyLearningLevel): number {
  return { not_started: 0, started: 1, practiced: 2, proven: 3 }[level];
}

function maxLevel(a: JourneyLearningLevel, b: JourneyLearningLevel): JourneyLearningLevel {
  return levelRank(a) >= levelRank(b) ? a : b;
}

function latest(a: string | null, b: string): string {
  return !a || Date.parse(b) > Date.parse(a) ? b : a;
}

function earliest(a: string | null, b: string): string {
  return !a || Date.parse(b) < Date.parse(a) ? b : a;
}

function sameVersion(a: JourneyContentVersionRef, b: JourneyContentVersionRef): boolean {
  return a.kind === b.kind && (a.kind === 'legacy_unversioned' || a.version === (b as { version: number }).version);
}

function transitionVersion(record: JourneyEvidenceRecord, incoming: JourneyContentVersionRef): JourneyEvidenceRecord {
  if (sameVersion(record.contentVersion, incoming)) return record;
  const legacySynthetic = record.contentVersion.kind === 'legacy_unversioned'
    && record.provenance.legacyCompletionCredit
    && record.attempts.total === 0
    && levelRank(record.learningLevel) <= levelRank('practiced');
  if (legacySynthetic && incoming.kind === 'versioned') {
    return {
      ...record,
      contentVersion: incoming,
      application: { ...record.application, contentVersion: incoming },
      provenance: { ...record.provenance, versionConflict: true },
    };
  }
  throw new Error(`Journey evidence content-version conflict for ${record.contentId}.`);
}

function assertTarget(record: JourneyEvidenceRecord, target: { contentId: JourneyContentId; nodeId: JourneyNodeId; contentVersion: JourneyContentVersionRef; skillId?: JourneySkillId }): JourneyEvidenceRecord {
  if (record.contentId !== target.contentId) throw new Error(`Journey evidence content-ID mismatch for ${target.contentId}.`);
  if (record.nodeId !== target.nodeId) throw new Error(`Journey evidence node-ID mismatch for ${target.contentId}.`);
  if (record.skillId && target.skillId && record.skillId !== target.skillId) throw new Error(`Journey evidence skill-ID mismatch for ${target.contentId}.`);
  return transitionVersion(record, target.contentVersion);
}

function sourceKey(source: JourneyEvidenceSourceRef): string {
  return `${source.kind}:${source.id}`;
}

function addSource(sources: JourneyEvidenceSourceRef[], source: JourneyEvidenceSourceRef): JourneyEvidenceSourceRef[] {
  if (sources.some((entry) => sourceKey(entry) === sourceKey(source))) return sources;
  return [...sources, { ...source }].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
}

function sortTriggers(triggers: JourneyReviewTrigger[]): JourneyReviewTrigger[] {
  return [...triggers].sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt) || a.reasonId.localeCompare(b.reasonId) || sourceKey(a.sourceRef).localeCompare(sourceKey(b.sourceRef)));
}

function updateBestResults(existing: Record<string, JourneyScoreEvidence>, score: JourneyScoreEvidence | null): Record<string, JourneyScoreEvidence> {
  if (!score) return existing;
  const prior = existing[score.metricId];
  if (prior && (prior.comparison !== score.comparison || (prior.maximum ?? null) !== (score.maximum ?? null))) {
    throw new Error(`Journey score metric-definition conflict for ${score.metricId}.`);
  }
  if (!prior || (score.comparison === 'higher_is_better' ? score.value > prior.value : score.value < prior.value)) {
    return { ...existing, [score.metricId]: { ...score } };
  }
  return existing;
}

function cloneRecord(record: JourneyEvidenceRecord): JourneyEvidenceRecord {
  return {
    ...record,
    application: { ...record.application, sourceRefs: [...record.application.sourceRefs] },
    review: record.review.kind === 'due' ? { ...record.review, triggers: record.review.triggers.map((trigger) => ({ ...trigger, sourceRef: { ...trigger.sourceRef } })) } : { ...record.review },
    attempts: {
      ...record.attempts,
      byKind: { ...record.attempts.byKind }, byResult: { ...record.attempts.byResult }, decisions: { ...record.attempts.decisions },
      mistakeCounts: { ...record.attempts.mistakeCounts }, bestResults: { ...record.attempts.bestResults }, recent: [...record.attempts.recent],
      seenAttemptIds: [...record.attempts.seenAttemptIds],
    },
    provenance: { ...record.provenance },
  };
}

function removeReviewReasons(record: JourneyEvidenceRecord, reasonIds: string[], resolvedAt: string): JourneyEvidenceRecord {
  if (record.review.kind !== 'due') return record;
  const remaining = record.review.triggers.filter((trigger) => !reasonIds.includes(trigger.reasonId));
  return remaining.length === 0
    ? { ...record, review: { kind: 'not_due', lastResolvedAt: resolvedAt } }
    : { ...record, review: { kind: 'due', dueSince: record.review.dueSince, triggers: sortTriggers(remaining) } };
}

function recordAttempt(record: JourneyEvidenceRecord, attempt: JourneyAttemptEvidence): JourneyEvidenceRecord {
  if (record.attempts.seenAttemptIds.includes(attempt.attemptId)) return record;
  const nextLevel = attempt.attemptKind === 'proof' && attempt.result === 'passed'
    ? maxLevel(record.learningLevel, 'proven')
    : attempt.attemptKind === 'practice' && (attempt.result === 'completed' || attempt.result === 'passed')
      ? maxLevel(record.learningLevel, 'practiced')
      : attempt.attemptKind === 'review' ? record.learningLevel : maxLevel(record.learningLevel, 'started');
  const nextRecent = [...record.attempts.recent, { ...attempt, mistakeCategoryIds: [...attempt.mistakeCategoryIds], stageIds: [...attempt.stageIds] }]
    .sort((a, b) => Date.parse(a.completedAt ?? a.startedAt) - Date.parse(b.completedAt ?? b.startedAt) || a.attemptId.localeCompare(b.attemptId))
    .slice(-JOURNEY_RECENT_ATTEMPT_LIMIT);
  const seenAttemptIds = [...record.attempts.seenAttemptIds, attempt.attemptId].slice(-JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT);
  const mistakeCounts = { ...record.attempts.mistakeCounts };
  for (const category of attempt.mistakeCategoryIds) mistakeCounts[category] = (mistakeCounts[category] ?? 0) + 1;
  let next: JourneyEvidenceRecord = {
    ...record,
    skillId: attempt.skillId ?? record.skillId,
    learningLevel: nextLevel,
    startedAt: earliest(record.startedAt, attempt.startedAt),
    lastEvidenceAt: latest(record.lastEvidenceAt, attempt.completedAt ?? attempt.startedAt),
    attempts: {
      ...record.attempts,
      total: record.attempts.total + 1,
      byKind: { ...record.attempts.byKind, [attempt.attemptKind]: record.attempts.byKind[attempt.attemptKind] + 1 },
      byResult: { ...record.attempts.byResult, [attempt.result]: record.attempts.byResult[attempt.result] + 1 },
      decisions: { total: record.attempts.decisions.total + attempt.decisionSummary.total, correct: record.attempts.decisions.correct + attempt.decisionSummary.correct, incorrect: record.attempts.decisions.incorrect + attempt.decisionSummary.incorrect },
      hintsUsed: record.attempts.hintsUsed + attempt.hintsUsed,
      mistakeCounts,
      bestResults: updateBestResults(record.attempts.bestResults, attempt.score),
      recent: nextRecent,
      seenAttemptIds,
    },
  };
  if (attempt.attemptKind === 'review' && attempt.result === 'passed') next = removeReviewReasons(next, attempt.reviewReasonIds, attempt.completedAt!);
  return next;
}

export function applyJourneyEvidence(current: JourneyEvidenceRecord | null, event: JourneyEvidenceEvent): JourneyEvidenceRecord {
  const errors = validateJourneyEvidenceEvent(event);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  const eventTarget = event.kind === 'attempt_recorded' ? event.attempt : event.kind === 'lesson_started' ? event : event.target;
  const base = current ? assertTarget(cloneRecord(current), eventTarget) : null;
  switch (event.kind) {
    case 'lesson_started': {
      const record = base ?? createEmptyJourneyEvidenceRecord(event.contentId, event.nodeId, event.contentVersion, event.skillId ?? null);
      return { ...record, skillId: event.skillId ?? record.skillId, startedAt: earliest(record.startedAt, event.timestamp), lastEvidenceAt: latest(record.lastEvidenceAt, event.timestamp), learningLevel: maxLevel(record.learningLevel, 'started') };
    }
    case 'attempt_recorded': {
      const record = base ?? createEmptyJourneyEvidenceRecord(event.attempt.contentId, event.attempt.nodeId, event.attempt.contentVersion, event.attempt.skillId ?? null);
      return recordAttempt(record, event.attempt);
    }
    case 'application_observed': {
      const record = base ?? createEmptyJourneyEvidenceRecord(event.target.contentId, event.target.nodeId, event.target.contentVersion, event.target.skillId ?? null);
      const sources = addSource(record.application.sourceRefs, event.sourceRef);
      if (sources.length === record.application.sourceRefs.length) return record;
      return { ...record, skillId: event.target.skillId ?? record.skillId, lastEvidenceAt: latest(record.lastEvidenceAt, event.observedAt), application: { ...record.application, contentVersion: event.target.contentVersion, observed: true, observationCount: sources.length, firstObservedAt: earliest(record.application.firstObservedAt, event.observedAt), lastObservedAt: record.application.lastObservedAt ? latest(record.application.lastObservedAt, event.observedAt) : event.observedAt, sourceRefs: sources } };
    }
    case 'review_requested': {
      const record = base ?? createEmptyJourneyEvidenceRecord(event.target.contentId, event.target.nodeId, event.target.contentVersion, event.target.skillId ?? null);
      if (record.learningLevel !== 'proven' && !record.application.observed) return record;
      const currentTriggers = record.review.kind === 'due' ? record.review.triggers : [];
      if (currentTriggers.some((trigger) => trigger.reasonId === event.reasonId && sourceKey(trigger.sourceRef) === sourceKey(event.sourceRef))) return record;
      const triggers = sortTriggers([...currentTriggers, { reasonId: event.reasonId, sourceRef: { ...event.sourceRef }, requestedAt: event.requestedAt }]);
      return { ...record, lastEvidenceAt: latest(record.lastEvidenceAt, event.requestedAt), review: { kind: 'due', dueSince: triggers[0].requestedAt, triggers } };
    }
    case 'review_resolved': {
      const record = base ?? createEmptyJourneyEvidenceRecord(event.target.contentId, event.target.nodeId, event.target.contentVersion, event.target.skillId ?? null);
      const resolved = removeReviewReasons(record, event.reasonIds, event.resolvedAt);
      return { ...resolved, lastEvidenceAt: latest(resolved.lastEvidenceAt, event.resolvedAt) };
    }
    default:
      return assertNever(event);
  }
}

export function applyJourneyEvidenceToStore(store: JourneyEvidenceStore, event: JourneyEvidenceEvent): JourneyEvidenceStore {
  const contentId = event.kind === 'attempt_recorded' ? event.attempt.contentId : event.kind === 'lesson_started' ? event.contentId : event.target.contentId;
  const current = store.recordsByContentId[contentId];
  const next = applyJourneyEvidence(current ?? null, event);
  return { schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION, recordsByContentId: { ...store.recordsByContentId, [next.contentId]: next } };
}

export function createEmptyJourneyEvidenceStore(): JourneyEvidenceStore {
  return { schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION, recordsByContentId: {} };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled Journey evidence event: ${String(value)}`);
}
