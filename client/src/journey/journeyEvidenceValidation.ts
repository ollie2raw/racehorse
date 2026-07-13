import {
  JOURNEY_EVIDENCE_SCHEMA_VERSION,
  JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT,
  JOURNEY_RECENT_ATTEMPT_LIMIT,
  type JourneyAttemptEvidence,
  type JourneyEvidenceEvent,
  type JourneyEvidenceRecord,
  type JourneyEvidenceStore,
  type JourneyEvidenceValidationResult,
} from './journeyEvidenceTypes.ts';

const ATTEMPT_KINDS = new Set(['practice', 'proof', 'review']);
const ATTEMPT_RESULTS = new Set(['completed', 'passed', 'failed', 'abandoned']);
const APPLICATION_SOURCES = new Set(['fritz', 'game_review', 'multiplayer_post_match', 'journey_review']);
const VERSION_KINDS = new Set(['legacy_unversioned', 'versioned']);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function validCounter(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function sameVersion(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as { kind?: unknown; version?: unknown };
  const right = b as { kind?: unknown; version?: unknown };
  return left.kind === right.kind && (left.kind !== 'versioned' || left.version === right.version);
}

function sourceKey(source: unknown): string {
  if (!source || typeof source !== 'object') return String(source);
  const value = source as Record<string, unknown>;
  return `${String(value.kind)}:${String(value.id)}`;
}

function validateVersion(errors: string[], value: unknown, label: string, requireVersioned: boolean): void {
  if (!value || typeof value !== 'object') {
    errors.push(`${label}: missing content version`);
    return;
  }
  const version = value as { kind?: unknown; version?: unknown };
  if (!VERSION_KINDS.has(String(version.kind))) errors.push(`${label}: unknown content version kind`);
  if (requireVersioned && version.kind !== 'versioned') errors.push(`${label}: attempt evidence requires a versioned content identity`);
  if (version.kind === 'versioned' && (!Number.isInteger(version.version) || Number(version.version) < 1)) {
    errors.push(`${label}: content version must be a positive integer`);
  }
}

function validateScore(errors: string[], score: unknown, label: string): void {
  if (score == null) return;
  if (!score || typeof score !== 'object') {
    errors.push(`${label}: invalid score evidence`);
    return;
  }
  const value = score as Record<string, unknown>;
  if (!nonEmpty(value.metricId)) errors.push(`${label}: score metric ID is required`);
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) errors.push(`${label}: score value must be finite`);
  if (value.maximum !== undefined && (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum) || value.maximum <= 0)) errors.push(`${label}: score maximum must be finite and positive`);
  if (typeof value.maximum === 'number' && Number.isFinite(value.value as number) && Number.isFinite(value.maximum) && ((value.value as number) < 0 || (value.value as number) > value.maximum)) errors.push(`${label}: score value is outside maximum bounds`);
  if (value.comparison !== 'higher_is_better' && value.comparison !== 'lower_is_better') errors.push(`${label}: invalid score comparison`);
}

function validateDecisions(errors: string[], summary: unknown, label: string): void {
  if (!summary || typeof summary !== 'object') {
    errors.push(`${label}: decision summary is required`);
    return;
  }
  const value = summary as Record<string, unknown>;
  if (!validCounter(value.total) || !validCounter(value.correct) || !validCounter(value.incorrect)) errors.push(`${label}: decision counters must be non-negative integers`);
  if (validCounter(value.total) && validCounter(value.correct) && validCounter(value.incorrect)) {
    if (value.correct + value.incorrect > value.total) errors.push(`${label}: correct plus incorrect decisions exceed total decisions`);
  }
}

function validateSourceRef(errors: string[], sourceRef: unknown, label: string): void {
  if (!sourceRef || typeof sourceRef !== 'object') {
    errors.push(`${label}: source reference is required`);
    return;
  }
  const value = sourceRef as Record<string, unknown>;
  if (!APPLICATION_SOURCES.has(String(value.kind))) errors.push(`${label}: unknown source kind`);
  if (!nonEmpty(value.id)) errors.push(`${label}: source ID is required`);
}

function validateAttempt(errors: string[], attempt: JourneyAttemptEvidence): void {
  const label = `attempt ${String(attempt?.attemptId ?? 'unknown')}`;
  if (!nonEmpty(attempt?.attemptId)) errors.push(`${label}: attempt ID is required`);
  if (!nonEmpty(attempt?.contentId)) errors.push(`${label}: content ID is required`);
  if (!nonEmpty(attempt?.nodeId)) errors.push(`${label}: node ID is required`);
  if (!ATTEMPT_KINDS.has(String(attempt?.attemptKind))) errors.push(`${label}: invalid attempt kind`);
  if (!ATTEMPT_RESULTS.has(String(attempt?.result))) errors.push(`${label}: invalid attempt result`);
  validateVersion(errors, attempt?.contentVersion, label, true);
  if (!validTimestamp(attempt?.startedAt)) errors.push(`${label}: invalid startedAt timestamp`);
  if (attempt?.completedAt === null && attempt?.result !== 'abandoned') errors.push(`${label}: completed attempts require completedAt`);
  if (attempt?.completedAt !== null && !validTimestamp(attempt?.completedAt)) errors.push(`${label}: invalid completedAt timestamp`);
  if (validTimestamp(attempt?.startedAt) && validTimestamp(attempt?.completedAt) && Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) errors.push(`${label}: completedAt precedes startedAt`);
  validateDecisions(errors, attempt?.decisionSummary, label);
  if (!validCounter(attempt?.hintsUsed)) errors.push(`${label}: hintsUsed must be a non-negative integer`);
  if (!Array.isArray(attempt?.mistakeCategoryIds) || attempt.mistakeCategoryIds.some((id) => !nonEmpty(id))) errors.push(`${label}: mistake category IDs must be non-empty`);
  if (!Array.isArray(attempt?.stageIds) || attempt.stageIds.some((id) => !nonEmpty(id))) errors.push(`${label}: stage IDs must be non-empty`);
  if (attempt?.attemptKind !== 'review' && (!Array.isArray(attempt?.reviewReasonIds) || attempt.reviewReasonIds.length > 0)) errors.push(`${label}: only review attempts may carry review reason IDs`);
  if (attempt?.attemptKind === 'review' && (!Array.isArray(attempt.reviewReasonIds) || attempt.reviewReasonIds.some((id) => !nonEmpty(id)))) errors.push(`${label}: review attempts require valid review reason IDs`);
  if (attempt?.skillId !== undefined && !nonEmpty(attempt.skillId)) errors.push(`${label}: skill ID must be non-empty when supplied`);
  validateScore(errors, attempt?.score, label);
}

export function validateJourneyEvidenceEvent(event: JourneyEvidenceEvent): string[] {
  const errors: string[] = [];
  const value = event as unknown as Record<string, unknown>;
  if (!value || typeof value !== 'object') return ['evidence event must be an object'];
  switch (value.kind) {
    case 'lesson_started':
      if (!nonEmpty(value.contentId)) errors.push('lesson_started: content ID is required');
      if (!nonEmpty(value.nodeId)) errors.push('lesson_started: node ID is required');
      if (!validTimestamp(value.timestamp)) errors.push('lesson_started: invalid timestamp');
      validateVersion(errors, value.contentVersion, 'lesson_started', true);
      break;
    case 'attempt_recorded':
      validateAttempt(errors, value.attempt as JourneyAttemptEvidence);
      break;
    case 'application_observed':
      validateTarget(errors, value.target, 'application_observed');
      if (!validTimestamp(value.observedAt)) errors.push('application_observed: invalid timestamp');
      validateSourceRef(errors, value.sourceRef, 'application_observed');
      break;
    case 'review_requested':
      validateTarget(errors, value.target, 'review_requested');
      if (!nonEmpty(value.reasonId)) errors.push('review_requested: review reason ID is required');
      if (!validTimestamp(value.requestedAt)) errors.push('review_requested: invalid timestamp');
      validateSourceRef(errors, value.sourceRef, 'review_requested');
      break;
    case 'review_resolved':
      validateTarget(errors, value.target, 'review_resolved');
      if (!Array.isArray(value.reasonIds) || value.reasonIds.length === 0 || value.reasonIds.some((id) => !nonEmpty(id))) errors.push('review_resolved: non-empty reason IDs are required');
      if (!validTimestamp(value.resolvedAt)) errors.push('review_resolved: invalid timestamp');
      validateSourceRef(errors, value.sourceRef, 'review_resolved');
      break;
    default:
      errors.push(`unknown evidence event kind ${String(value.kind)}`);
  }
  return errors;
}

function validateTarget(errors: string[], target: unknown, label: string): void {
  if (!target || typeof target !== 'object') {
    errors.push(`${label}: evidence target is required`);
    return;
  }
  const value = target as Record<string, unknown>;
  if (!nonEmpty(value.contentId)) errors.push(`${label}: content ID is required`);
  if (!nonEmpty(value.nodeId)) errors.push(`${label}: node ID is required`);
  validateVersion(errors, value.contentVersion, label, true);
  if (value.skillId !== undefined && !nonEmpty(value.skillId)) errors.push(`${label}: skill ID must be non-empty when supplied`);
}

export function parseJourneyEvidenceEvent(value: unknown): JourneyEvidenceValidationResult {
  const errors = validateJourneyEvidenceEvent(value as JourneyEvidenceEvent);
  return errors.length > 0
    ? { kind: 'invalid', errors }
    : { kind: 'valid', event: value as JourneyEvidenceEvent };
}

function validateRecord(errors: string[], record: unknown, key: string): void {
  if (!record || typeof record !== 'object') {
    errors.push(`${key}: record must be an object`);
    return;
  }
  const value = record as Partial<JourneyEvidenceRecord>;
  if (value.contentId !== key) errors.push(`${key}: record content ID does not match store key`);
  if (!nonEmpty(value.nodeId)) errors.push(`${key}: record node ID is required`);
  if (value.skillId !== null && !nonEmpty(value.skillId)) errors.push(`${key}: skill ID must be null or non-empty`);
  validateVersion(errors, value.contentVersion, key, false);
  if (!['not_started', 'started', 'practiced', 'proven'].includes(String(value.learningLevel))) errors.push(`${key}: invalid learning level`);
  if (value.startedAt !== null && !validTimestamp(value.startedAt)) errors.push(`${key}: invalid startedAt`);
  if (value.lastEvidenceAt !== null && !validTimestamp(value.lastEvidenceAt)) errors.push(`${key}: invalid lastEvidenceAt`);
  if (validTimestamp(value.startedAt) && validTimestamp(value.lastEvidenceAt) && Date.parse(value.lastEvidenceAt) < Date.parse(value.startedAt)) errors.push(`${key}: lastEvidenceAt precedes startedAt`);
  if (!value.provenance || typeof value.provenance !== 'object' || typeof value.provenance.legacyCompletionCredit !== 'boolean' || typeof value.provenance.versionConflict !== 'boolean') errors.push(`${key}: provenance booleans are required`);
  if (!value.attempts || typeof value.attempts !== 'object') errors.push(`${key}: attempts aggregate is required`);
  else {
    const attempts = value.attempts as Record<string, unknown>;
    if (!validCounter(attempts.total)) errors.push(`${key}: attempt total must be non-negative`);
    if (!validCounter(attempts.hintsUsed)) errors.push(`${key}: aggregate hintsUsed must be non-negative`);
    const byKind = attempts.byKind as Record<string, unknown> | undefined;
    const byResult = attempts.byResult as Record<string, unknown> | undefined;
    const requiredKinds = ['practice', 'proof', 'review'];
    const requiredResults = ['completed', 'passed', 'failed', 'abandoned'];
    if (!byKind || requiredKinds.some((kind) => !validCounter(byKind[kind]))) errors.push(`${key}: byKind counters are incomplete or invalid`);
    if (!byResult || requiredResults.some((result) => !validCounter(byResult[result]))) errors.push(`${key}: byResult counters are incomplete or invalid`);
    if (byKind && validCounter(attempts.total) && requiredKinds.every((kind) => validCounter(byKind[kind])) && requiredKinds.reduce((sum, kind) => sum + Number(byKind[kind]), 0) !== attempts.total) errors.push(`${key}: byKind total does not equal total attempts`);
    if (byResult && validCounter(attempts.total) && requiredResults.every((result) => validCounter(byResult[result])) && requiredResults.reduce((sum, result) => sum + Number(byResult[result]), 0) !== attempts.total) errors.push(`${key}: byResult total does not equal total attempts`);
    validateDecisions(errors, attempts.decisions, key);
    if (!Array.isArray(attempts.recent) || attempts.recent.length > JOURNEY_RECENT_ATTEMPT_LIMIT) errors.push(`${key}: recent attempt history exceeds the bounded limit`);
    else {
      const recentIds = new Set<string>();
      for (const attempt of attempts.recent) {
        validateAttempt(errors, attempt as JourneyAttemptEvidence);
        const item = attempt as JourneyAttemptEvidence;
        if (recentIds.has(item.attemptId)) errors.push(`${key}: duplicate recent attempt ID ${item.attemptId}`);
        recentIds.add(item.attemptId);
        if (item.contentId !== value.contentId || item.nodeId !== value.nodeId || !sameVersion(item.contentVersion, value.contentVersion)) errors.push(`${key}: recent attempt target does not match record`);
      }
      const seen = attempts.seenAttemptIds;
      if (!Array.isArray(seen) || seen.length > JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT || new Set(seen).size !== seen.length || seen.some((id) => !nonEmpty(id))) errors.push(`${key}: invalid bounded attempt idempotency history`);
      else for (const id of recentIds) if (!seen.includes(id)) errors.push(`${key}: recent attempt ${id} is missing from idempotency history`);
    }
    const mistakeCounts = attempts.mistakeCounts;
    if (!mistakeCounts || typeof mistakeCounts !== 'object' || Array.isArray(mistakeCounts)) errors.push(`${key}: mistakeCounts must be an object`);
    else for (const [mistakeId, count] of Object.entries(mistakeCounts)) {
      if (!nonEmpty(mistakeId) || !validCounter(count)) errors.push(`${key}: mistake counts must use non-empty IDs and non-negative integers`);
    }
    if (!Array.isArray(attempts.seenAttemptIds) || attempts.seenAttemptIds.length > JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT || new Set(attempts.seenAttemptIds).size !== attempts.seenAttemptIds.length || attempts.seenAttemptIds.some((id) => !nonEmpty(id))) errors.push(`${key}: invalid bounded attempt idempotency history`);
    const bestResults = attempts.bestResults as Record<string, unknown> | undefined;
    if (!bestResults || typeof bestResults !== 'object' || Array.isArray(bestResults)) errors.push(`${key}: bestResults must be an object`);
    else for (const [metricId, score] of Object.entries(bestResults)) {
      validateScore(errors, score, `${key}: best result ${metricId}`);
      if (!score || typeof score !== 'object' || (score as Record<string, unknown>).metricId !== metricId) errors.push(`${key}: best result key does not match metric ID`);
    }
  }
  if (!value.application || typeof value.application !== 'object') errors.push(`${key}: application projection is required`);
  else {
    const application = value.application as Record<string, unknown>;
    if (typeof application.observed !== 'boolean') errors.push(`${key}: application observed must be boolean`);
    if (!validCounter(application.observationCount)) errors.push(`${key}: application observationCount must be non-negative`);
    if (validCounter(application.observationCount) && typeof application.observed === 'boolean' && application.observed !== (application.observationCount > 0)) errors.push(`${key}: application observed/count are inconsistent`);
    validateVersion(errors, application.contentVersion, `${key}: application`, false);
    if (!sameVersion(application.contentVersion, value.contentVersion)) errors.push(`${key}: application content version does not match record`);
    if (!Array.isArray(application.sourceRefs) || new Set((application.sourceRefs as unknown[]).map(sourceKey)).size !== (application.sourceRefs as unknown[]).length) errors.push(`${key}: application source references must be unique`);
    else for (const source of application.sourceRefs) validateSourceRef(errors, source, `${key}: application source`);
    if (validCounter(application.observationCount) && application.observationCount !== (Array.isArray(application.sourceRefs) ? application.sourceRefs.length : -1)) errors.push(`${key}: application count does not match unique source references`);
    if (application.firstObservedAt !== null && !validTimestamp(application.firstObservedAt)) errors.push(`${key}: invalid first application timestamp`);
    if (application.lastObservedAt !== null && !validTimestamp(application.lastObservedAt)) errors.push(`${key}: invalid last application timestamp`);
    if (application.observationCount === 0 && (application.firstObservedAt !== null || application.lastObservedAt !== null)) errors.push(`${key}: empty application must have null timestamps`);
    if (validCounter(application.observationCount) && application.observationCount > 0 && (application.firstObservedAt === null || application.lastObservedAt === null)) errors.push(`${key}: observed application requires timestamps`);
    if (validTimestamp(application.firstObservedAt) && validTimestamp(application.lastObservedAt) && Date.parse(application.firstObservedAt) > Date.parse(application.lastObservedAt)) errors.push(`${key}: first application timestamp is after last`);
  }
  if (!value.review || typeof value.review !== 'object') errors.push(`${key}: review projection is required`);
  else {
    const review = value.review as Record<string, unknown>;
    if (review.kind !== 'not_due' && review.kind !== 'due') errors.push(`${key}: invalid review projection kind`);
    if (review.kind === 'not_due' && review.lastResolvedAt !== null && !validTimestamp(review.lastResolvedAt)) errors.push(`${key}: invalid review lastResolvedAt`);
    if (review.kind === 'due') {
      if (!validTimestamp(review.dueSince)) errors.push(`${key}: invalid review dueSince timestamp`);
      const applicationObserved = Boolean(value.application && typeof value.application === 'object' && (value.application as Record<string, unknown>).observed);
      if (value.learningLevel !== 'proven' && !applicationObserved) errors.push(`${key}: review due requires proven or applied evidence`);
      if (!Array.isArray(review.triggers) || review.triggers.length === 0) errors.push(`${key}: due review requires triggers`);
      else {
        const pairs = new Set<string>();
        let earliestTrigger = Number.POSITIVE_INFINITY;
        for (const trigger of review.triggers) {
          if (!trigger || typeof trigger !== 'object') { errors.push(`${key}: invalid review trigger`); continue; }
          const item = trigger as Record<string, unknown>;
          if (!nonEmpty(item.reasonId) || !validTimestamp(item.requestedAt)) errors.push(`${key}: invalid review trigger identity or timestamp`);
          validateSourceRef(errors, item.sourceRef, `${key}: review trigger`);
          const pair = `${String(item.reasonId)}:${sourceKey(item.sourceRef)}`;
          if (pairs.has(pair)) errors.push(`${key}: duplicate review trigger`);
          pairs.add(pair);
          if (validTimestamp(item.requestedAt)) earliestTrigger = Math.min(earliestTrigger, Date.parse(item.requestedAt));
        }
        if (validTimestamp(review.dueSince) && earliestTrigger !== Number.POSITIVE_INFINITY && Date.parse(review.dueSince) !== earliestTrigger) errors.push(`${key}: dueSince must equal earliest trigger`);
      }
    }
  }
}

export function parseJourneyEvidenceStore(value: unknown): { kind: 'valid'; store: JourneyEvidenceStore } | { kind: 'invalid'; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { kind: 'invalid', errors: ['evidence store must be an object'] };
  const store = value as Partial<JourneyEvidenceStore>;
  if (store.schemaVersion !== JOURNEY_EVIDENCE_SCHEMA_VERSION) errors.push('evidence store has an unsupported schema version');
  if (!store.recordsByContentId || typeof store.recordsByContentId !== 'object' || Array.isArray(store.recordsByContentId)) errors.push('evidence store recordsByContentId must be an object');
  else for (const [key, record] of Object.entries(store.recordsByContentId)) validateRecord(errors, record, key);
  return errors.length > 0 ? { kind: 'invalid', errors } : { kind: 'valid', store: value as JourneyEvidenceStore };
}
