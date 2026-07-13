import { describe, expect, it } from 'vitest';
import { getAllJourneyContentDescriptors } from './journeyContentResolver';
import { JOURNEY_CHAPTER_DEFINITIONS } from './journeyChapters';
import { projectLegacyJourneyProgressToEvidence, mergeJourneyEvidence } from './journeyLegacyEvidenceAdapter';
import {
  applyJourneyEvidence,
  createEmptyJourneyEvidenceRecord,
} from './journeyEvidenceReducer';
import { parseJourneyEvidenceEvent, parseJourneyEvidenceStore, validateJourneyEvidenceEvent } from './journeyEvidenceValidation';
import type { JourneyContentId, JourneyNodeId, JourneySkillId } from './journeyContentContract';
import type { JourneyAttemptEvidence, JourneyEvidenceStore } from './journeyEvidenceTypes';
import type { JourneyProgress } from './journeyTypes';

const contentId = (value: string) => value as JourneyContentId;
const nodeId = (value: string) => value as JourneyNodeId;
const skillId = (value: string) => value as JourneySkillId;

function attempt(overrides: Partial<JourneyAttemptEvidence> = {}): JourneyAttemptEvidence {
  return {
    attemptId: 'attempt-1' as JourneyAttemptEvidence['attemptId'],
    contentId: contentId('premium:tempo'),
    nodeId: nodeId('ch1-n02'),
    contentVersion: { kind: 'versioned', version: 1 },
    attemptKind: 'practice',
    result: 'completed',
    startedAt: '2026-07-11T10:00:00.000Z',
    completedAt: '2026-07-11T10:01:00.000Z',
    decisionSummary: { total: 4, correct: 3, incorrect: 1 },
    hintsUsed: 1,
    mistakeCategoryIds: ['open-end' as never],
    score: { metricId: 'accuracy' as never, value: 75, maximum: 100, comparison: 'higher_is_better' },
    stageIds: ['practice'],
    reviewReasonIds: [],
    ...overrides,
  };
}

function eventStore(record: ReturnType<typeof createEmptyJourneyEvidenceRecord>): JourneyEvidenceStore {
  return { schemaVersion: 1, recordsByContentId: { [record.contentId]: record } };
}

describe('Journey evidence learning levels', () => {
  it('progresses from started to practiced to proven without demotion', () => {
    let record = applyJourneyEvidence(null, { kind: 'lesson_started', contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 }, timestamp: '2026-07-11T10:00:00.000Z', skillId: skillId('skill:tempo') });
    expect(record.learningLevel).toBe('started');
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt() });
    expect(record.learningLevel).toBe('practiced');
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'proof-1' as never, attemptKind: 'proof', result: 'failed' }) });
    expect(record.learningLevel).toBe('practiced');
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'proof-2' as never, attemptKind: 'proof', result: 'passed' }) });
    expect(record.learningLevel).toBe('proven');
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'proof-3' as never, attemptKind: 'proof', result: 'failed' }) });
    expect(record.learningLevel).toBe('proven');
  });

  it('does not grant practice or proof for abandoned or generic proof completion', () => {
    const abandoned = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ result: 'abandoned' }) });
    expect(abandoned.learningLevel).toBe('started');
    const completedProof = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ attemptKind: 'proof', result: 'completed' }) });
    expect(completedProof.learningLevel).toBe('started');
  });

  it('deduplicates attempt IDs and retains bounded history', () => {
    let record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt() });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt() });
    expect(record.attempts.total).toBe(1);
    for (let index = 2; index <= 25; index += 1) {
      record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: `attempt-${index}` as never, startedAt: `2026-07-11T10:${String(index).padStart(2, '0')}:00.000Z`, completedAt: `2026-07-11T10:${String(index).padStart(2, '0')}:30.000Z` }) });
    }
    expect(record.attempts.total).toBe(25);
    expect(record.attempts.recent).toHaveLength(20);
    expect(record.attempts.recent[0].attemptId).toBe('attempt-6');
    expect(record.attempts.seenAttemptIds).toContain('attempt-1');
    expect(record.attempts.decisions.total).toBe(25 * 4);
  });

  it('rejects target identity and structured content-version drift', () => {
    const record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt() });
    expect(() => applyJourneyEvidence(record, { kind: 'lesson_started', contentId: contentId('other'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 }, timestamp: '2026-07-11T10:02:00.000Z' })).toThrow('content-ID mismatch');
    expect(() => applyJourneyEvidence(record, { kind: 'lesson_started', contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n03'), contentVersion: { kind: 'versioned', version: 1 }, timestamp: '2026-07-11T10:02:00.000Z' })).toThrow('node-ID mismatch');
    expect(() => applyJourneyEvidence(record, { kind: 'lesson_started', contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 2 }, timestamp: '2026-07-11T10:02:00.000Z' })).toThrow('content-version conflict');
    const withSkill = applyJourneyEvidence(null, { kind: 'lesson_started', contentId: contentId('premium:skill'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 }, skillId: skillId('skill:a'), timestamp: '2026-07-11T10:00:00.000Z' });
    expect(() => applyJourneyEvidence(withSkill, { kind: 'lesson_started', contentId: contentId('premium:skill'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 }, skillId: skillId('skill:b'), timestamp: '2026-07-11T10:01:00.000Z' })).toThrow('skill-ID mismatch');
    const application = applyJourneyEvidence(null, { kind: 'application_observed', target: { contentId: contentId('premium:application-version'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, sourceRef: { kind: 'fritz', id: 'match:1' as never }, observedAt: '2026-07-11T10:00:00.000Z' });
    expect(() => applyJourneyEvidence(application, { kind: 'application_observed', target: { contentId: contentId('premium:application-version'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 2 } }, sourceRef: { kind: 'fritz', id: 'match:2' as never }, observedAt: '2026-07-11T10:01:00.000Z' })).toThrow('content-version conflict');
    expect(() => applyJourneyEvidence(application, { kind: 'review_requested', target: { contentId: contentId('premium:application-version'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 2 } }, reasonId: 'reason:1' as never, sourceRef: { kind: 'game_review', id: 'review:1' as never }, requestedAt: '2026-07-11T10:01:00.000Z' })).toThrow('content-version conflict');
  });

  it('keeps attempt timestamps chronological when events arrive out of order', () => {
    let record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'late' as never, startedAt: '2026-07-11T14:00:00.000Z', completedAt: '2026-07-11T14:01:00.000Z' }) });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'early' as never, startedAt: '2026-07-11T10:00:00.000Z', completedAt: '2026-07-11T10:01:00.000Z' }) });
    expect(record.startedAt).toBe('2026-07-11T10:00:00.000Z');
    expect(record.lastEvidenceAt).toBe('2026-07-11T14:01:00.000Z');
  });

  it('bounds idempotency independently from recent history', () => {
    let record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt() });
    for (let index = 2; index <= 270; index += 1) record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: `horizon-${index}` as never, startedAt: `2026-07-12T00:${String(index % 60).padStart(2, '0')}:00.000Z`, completedAt: `2026-07-12T00:${String(index % 60).padStart(2, '0')}:30.000Z` }) });
    expect(record.attempts.recent).toHaveLength(20);
    expect(record.attempts.seenAttemptIds).toHaveLength(256);
    expect(record.attempts.seenAttemptIds).toContain('horizon-270');
    const before = record.attempts.total;
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'horizon-270' as never }) });
    expect(record.attempts.total).toBe(before);
  });
});

describe('Journey application and review projections', () => {
  it('keeps application additive and deduplicated without changing learning level', () => {
    const sourceRef = { kind: 'fritz' as const, id: 'match-1' as never };
    let record = applyJourneyEvidence(null, { kind: 'application_observed', target: { contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, observedAt: '2026-07-11T10:00:00.000Z', sourceRef });
    record = applyJourneyEvidence(record, { kind: 'application_observed', target: { contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, observedAt: '2026-07-11T11:00:00.000Z', sourceRef });
    expect(record.learningLevel).toBe('not_started');
    expect(record.application.observationCount).toBe(1);
    expect(record.application.observed).toBe(true);
  });

  it('does not create review due for an unstarted record', () => {
    const record = applyJourneyEvidence(null, { kind: 'review_requested', target: { contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, reasonId: 'mistake:open-end' as never, sourceRef: { kind: 'game_review', id: 'review-1' as never }, requestedAt: '2026-07-11T10:00:00.000Z' });
    expect(record.learningLevel).toBe('not_started');
    expect(record.review.kind).toBe('not_due');
  });

  it('keeps review due through failure and clears it only through relevant passed review', () => {
    let record = applyJourneyEvidence(null, { kind: 'lesson_started', contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 }, timestamp: '2026-07-11T10:00:00.000Z' });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt() });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'proof-pass' as never, attemptKind: 'proof', result: 'passed', reviewReasonIds: [] }) });
    record = applyJourneyEvidence(record, { kind: 'review_requested', target: { contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, reasonId: 'mistake:open-end' as never, sourceRef: { kind: 'game_review', id: 'review-1' as never }, requestedAt: '2026-07-11T11:00:00.000Z' });
    record = applyJourneyEvidence(record, { kind: 'review_requested', target: { contentId: contentId('premium:tempo'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }, reasonId: 'mistake:open-end' as never, sourceRef: { kind: 'game_review', id: 'review-1' as never }, requestedAt: '2026-07-11T11:01:00.000Z' });
    expect(record.review.kind).toBe('due');
    if (record.review.kind === 'due') expect(record.review.triggers).toHaveLength(1);
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'review-fail' as never, attemptKind: 'review', result: 'failed', reviewReasonIds: ['mistake:open-end' as never] }) });
    expect(record.review.kind).toBe('due');
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'review-pass' as never, attemptKind: 'review', result: 'passed', reviewReasonIds: ['mistake:open-end' as never] }) });
    expect(record.review.kind).toBe('not_due');
    expect(record.learningLevel).toBe('proven');
  });

  it('only attaches review to Proven or Applied evidence', () => {
    const target = { contentId: contentId('premium:review'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned' as const, version: 1 } };
    const request = (record: ReturnType<typeof createEmptyJourneyEvidenceRecord>) => applyJourneyEvidence(record, { kind: 'review_requested', target, reasonId: 'reason:one' as never, sourceRef: { kind: 'game_review', id: 'review:one' as never }, requestedAt: '2026-07-11T12:00:00.000Z' });
    expect(request(createEmptyJourneyEvidenceRecord(target.contentId, target.nodeId, target.contentVersion)).review.kind).toBe('not_due');
    const started = applyJourneyEvidence(null, { kind: 'lesson_started', ...target, timestamp: '2026-07-11T10:00:00.000Z' });
    expect(request(started).review.kind).toBe('not_due');
    const practiced = applyJourneyEvidence(started, { kind: 'attempt_recorded', attempt: attempt({ contentId: target.contentId, nodeId: target.nodeId }) });
    expect(request(practiced).review.kind).toBe('not_due');
    const applied = applyJourneyEvidence(null, { kind: 'application_observed', target, sourceRef: { kind: 'fritz', id: 'match:one' as never }, observedAt: '2026-07-11T11:00:00.000Z' });
    expect(request(applied).review.kind).toBe('due');
  });

  it('retains distinct review triggers and resolves only named reasons', () => {
    const target = { contentId: contentId('premium:review-reasons'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned' as const, version: 1 } };
    let record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ contentId: target.contentId, nodeId: target.nodeId, attemptKind: 'proof', result: 'passed' }) });
    record = applyJourneyEvidence(record, { kind: 'review_requested', target, reasonId: 'reason:a' as never, sourceRef: { kind: 'game_review', id: 'source:1' as never }, requestedAt: '2026-07-11T12:00:00.000Z' });
    record = applyJourneyEvidence(record, { kind: 'review_requested', target, reasonId: 'reason:a' as never, sourceRef: { kind: 'fritz', id: 'source:2' as never }, requestedAt: '2026-07-11T11:00:00.000Z' });
    record = applyJourneyEvidence(record, { kind: 'review_requested', target, reasonId: 'reason:b' as never, sourceRef: { kind: 'game_review', id: 'source:3' as never }, requestedAt: '2026-07-11T13:00:00.000Z' });
    expect(record.review.kind).toBe('due');
    if (record.review.kind === 'due') {
      expect(record.review.triggers).toHaveLength(3);
      expect(record.review.dueSince).toBe('2026-07-11T11:00:00.000Z');
    }
    record = applyJourneyEvidence(record, { kind: 'review_resolved', target, reasonIds: ['reason:a' as never], sourceRef: { kind: 'journey_review', id: 'resolution:1' as never }, resolvedAt: '2026-07-11T14:00:00.000Z' });
    expect(record.review.kind).toBe('due');
    if (record.review.kind === 'due') expect(record.review.triggers.map((trigger) => trigger.reasonId)).toEqual(['reason:b']);
    expect(record.learningLevel).toBe('proven');
  });

  it('keeps application timestamps correct when observations arrive out of order', () => {
    const target = { contentId: contentId('premium:application'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned' as const, version: 1 } };
    let record = applyJourneyEvidence(null, { kind: 'application_observed', target, sourceRef: { kind: 'fritz', id: 'match:late' as never }, observedAt: '2026-07-11T14:00:00.000Z' });
    record = applyJourneyEvidence(record, { kind: 'application_observed', target, sourceRef: { kind: 'fritz', id: 'match:early' as never }, observedAt: '2026-07-11T10:00:00.000Z' });
    expect(record.application.firstObservedAt).toBe('2026-07-11T10:00:00.000Z');
    expect(record.application.lastObservedAt).toBe('2026-07-11T14:00:00.000Z');
    expect(record.lastEvidenceAt).toBe('2026-07-11T14:00:00.000Z');
  });
});

describe('Journey scores, legacy projection, and merge', () => {
  it('keeps best results separate by metric and comparison direction', () => {
    let record = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ score: { metricId: 'accuracy' as never, value: 70, comparison: 'higher_is_better' } }) });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'score-2' as never, score: { metricId: 'accuracy' as never, value: 80, comparison: 'higher_is_better' } }) });
    record = applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'time-1' as never, score: { metricId: 'time' as never, value: 20, comparison: 'lower_is_better' } }) });
    expect(record.attempts.bestResults.accuracy.value).toBe(80);
    expect(record.attempts.bestResults.time.value).toBe(20);
    expect(() => applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'conflict-direction' as never, score: { metricId: 'accuracy' as never, value: 90, comparison: 'lower_is_better' } }) })).toThrow('metric-definition conflict');
    expect(() => applyJourneyEvidence(record, { kind: 'attempt_recorded', attempt: attempt({ attemptId: 'conflict-maximum' as never, score: { metricId: 'accuracy' as never, value: 9, maximum: 10, comparison: 'higher_is_better' } }) })).toThrow('metric-definition conflict');
  });

  it('projects legacy completed nodes to Practiced only', () => {
    const progress: JourneyProgress = {
      version: 2,
      activeChapterId: 'ch1-fritz-trail',
      chapters: { 'ch1-fritz-trail': { completedNodeIds: ['ch1-n01', 'ch1-n01', 'unknown-node'], lastVisitedNodeId: 'ch1-n01', completedAt: null, completionCelebrated: false } },
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    const projection = projectLegacyJourneyProgressToEvidence({ legacyProgress: progress, activeDescriptors: getAllJourneyContentDescriptors() });
    const record = projection.store.recordsByContentId['ch1-n01'];
    expect(record.learningLevel).toBe('practiced');
    expect(record.provenance.legacyCompletionCredit).toBe(true);
    expect(record.attempts.total).toBe(0);
    expect(record.startedAt).toBeNull();
    expect(record.application.observed).toBe(false);
    expect(record.review.kind).toBe('not_due');
    expect(projection.ignoredNodeIds).toEqual(['unknown-node']);
  });

  it('projects every canonical descriptor without inventing evidence', () => {
    const progress: JourneyProgress = {
      version: 2,
      activeChapterId: 'ch1-fritz-trail',
      chapters: Object.fromEntries(JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => [chapter.chapterId, {
        completedNodeIds: chapter.nodes.map((node) => node.id),
        lastVisitedNodeId: null,
        completedAt: null,
        completionCelebrated: false,
      }])),
      updatedAt: '2026-07-11T10:00:00.000Z',
    },
    projection = projectLegacyJourneyProgressToEvidence({ legacyProgress: progress, activeDescriptors: getAllJourneyContentDescriptors() });
    expect(Object.keys(projection.store.recordsByContentId)).toHaveLength(108);
    expect(Object.values(projection.store.recordsByContentId).every((record) => record.learningLevel === 'practiced')).toBe(true);
  });

  it('merges legacy credit without inflating structured attempts or silently proving a version conflict', () => {
    const legacy = projectLegacyJourneyProgressToEvidence({
      legacyProgress: { version: 2, activeChapterId: 'ch1-fritz-trail', chapters: { 'ch1-fritz-trail': { completedNodeIds: ['ch1-n02'], lastVisitedNodeId: null, completedAt: null, completionCelebrated: false } }, updatedAt: '2026-07-11T10:00:00.000Z' },
      activeDescriptors: getAllJourneyContentDescriptors(),
    }).store;
    const structuredRecord = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ contentId: contentId('ch1-n02'), nodeId: nodeId('ch1-n02'), attemptId: 'structured-1' as never }) });
    const structured = eventStore(structuredRecord);
    const merged = mergeJourneyEvidence(legacy, structured);
    const reversed = mergeJourneyEvidence(structured, legacy);
    const record = merged.recordsByContentId['ch1-n02'];
    expect(record.learningLevel).toBe('practiced');
    expect(record.attempts.total).toBe(1);
    expect(record.provenance.versionConflict).toBe(true);
    expect(reversed).toEqual(merged);
  });

  it('rejects incompatible structured versions during merge', () => {
    const versionOne = eventStore(applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ contentId: contentId('premium:versions'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 1 } }) }));
    const versionTwo = eventStore(applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt({ contentId: contentId('premium:versions'), nodeId: nodeId('ch1-n02'), contentVersion: { kind: 'versioned', version: 2 } }) }));
    expect(() => mergeJourneyEvidence(versionOne, versionTwo)).toThrow('content-version conflict');
  });
});

describe('Journey evidence validation', () => {
  it('rejects malformed events and stores', () => {
    expect(validateJourneyEvidenceEvent({ kind: 'future' } as never)).toContain('unknown evidence event kind future');
    expect(validateJourneyEvidenceEvent({ kind: 'attempt_recorded', attempt: attempt({ attemptId: '' as never, hintsUsed: -1, decisionSummary: { total: 1, correct: 1, incorrect: 1 }, score: { metricId: '' as never, value: Number.NaN, comparison: 'bad' as never }, contentVersion: { kind: 'legacy_unversioned' } as never }) } as never).length).toBeGreaterThan(3);
    expect(parseJourneyEvidenceEvent({ kind: 'application_observed', target: { contentId: '', nodeId: '', contentVersion: { kind: 'legacy_unversioned' } }, observedAt: 'bad', sourceRef: { kind: 'unknown', id: '' } })).toMatchObject({ kind: 'invalid' });
    expect(parseJourneyEvidenceStore({ schemaVersion: 2, recordsByContentId: [] })).toMatchObject({ kind: 'invalid' });
    expect(parseJourneyEvidenceStore({ schemaVersion: 1, recordsByContentId: { 'premium:x': { contentId: 'other', nodeId: 'ch1-n02' } } })).toMatchObject({ kind: 'invalid' });
    const valid = applyJourneyEvidence(null, { kind: 'attempt_recorded', attempt: attempt() });
    expect(parseJourneyEvidenceStore(eventStore(valid))).toMatchObject({ kind: 'valid' });
    const invalidApplicationVersion = structuredClone(valid);
    invalidApplicationVersion.application.contentVersion = { kind: 'versioned', version: 2 };
    expect(parseJourneyEvidenceStore(eventStore(invalidApplicationVersion))).toMatchObject({ kind: 'invalid' });
    const invalidReview = structuredClone(valid);
    invalidReview.review = { kind: 'due', dueSince: '2026-07-11T10:00:00.000Z', triggers: [] };
    expect(parseJourneyEvidenceStore(eventStore(invalidReview))).toMatchObject({ kind: 'invalid' });
  });
});
