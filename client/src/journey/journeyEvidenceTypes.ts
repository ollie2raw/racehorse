import type {
  JourneyContentId,
  JourneyNodeId,
  JourneySkillId,
} from './journeyContentContract.ts';

export const JOURNEY_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const JOURNEY_RECENT_ATTEMPT_LIMIT = 20 as const;
export const JOURNEY_ATTEMPT_IDEMPOTENCY_LIMIT = 256 as const;

export type JourneyAttemptId = string & { readonly __journeyAttemptId: unique symbol };
export type JourneyMistakeCategoryId = string & { readonly __journeyMistakeCategoryId: unique symbol };
export type JourneyScoreMetricId = string & { readonly __journeyScoreMetricId: unique symbol };
export type JourneyReviewReasonId = string & { readonly __journeyReviewReasonId: unique symbol };
export type JourneySourceId = string & { readonly __journeySourceId: unique symbol };

export type JourneyContentVersionRef =
  | { kind: 'legacy_unversioned' }
  | { kind: 'versioned'; version: number };

export type JourneyEvidenceTarget = {
  contentId: JourneyContentId;
  nodeId: JourneyNodeId;
  contentVersion: JourneyContentVersionRef;
  skillId?: JourneySkillId;
};

export type JourneyEvidenceSourceRef = {
  kind: 'fritz' | 'game_review' | 'multiplayer_post_match' | 'journey_review';
  id: JourneySourceId;
};

export type JourneyLearningLevel = 'not_started' | 'started' | 'practiced' | 'proven';

export type JourneyApplicationProjection = {
  observed: boolean;
  observationCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  sourceRefs: JourneyEvidenceSourceRef[];
  contentVersion: JourneyContentVersionRef;
};

export type JourneyReviewTrigger = {
  reasonId: JourneyReviewReasonId;
  sourceRef: JourneyEvidenceSourceRef;
  requestedAt: string;
};

export type JourneyReviewProjection =
  | { kind: 'not_due'; lastResolvedAt: string | null }
  | {
      kind: 'due';
      dueSince: string;
      triggers: JourneyReviewTrigger[];
    };

export type JourneyScoreEvidence = {
  metricId: JourneyScoreMetricId;
  value: number;
  maximum?: number;
  comparison: 'higher_is_better' | 'lower_is_better';
};

export type JourneyAttemptKind = 'practice' | 'proof' | 'review';
export type JourneyAttemptResult = 'completed' | 'passed' | 'failed' | 'abandoned';

export type JourneyDecisionSummary = {
  total: number;
  correct: number;
  incorrect: number;
};

export type JourneyAttemptEvidence = {
  attemptId: JourneyAttemptId;
  contentId: JourneyContentId;
  nodeId: JourneyNodeId;
  contentVersion: { kind: 'versioned'; version: number };
  skillId?: JourneySkillId;
  attemptKind: JourneyAttemptKind;
  result: JourneyAttemptResult;
  startedAt: string;
  completedAt: string | null;
  decisionSummary: JourneyDecisionSummary;
  hintsUsed: number;
  mistakeCategoryIds: JourneyMistakeCategoryId[];
  score: JourneyScoreEvidence | null;
  stageIds: string[];
  reviewReasonIds: JourneyReviewReasonId[];
};

export type JourneyAttemptSummary = JourneyAttemptEvidence;

export type JourneyAttemptAggregates = {
  total: number;
  byKind: Record<JourneyAttemptKind, number>;
  byResult: Record<JourneyAttemptResult, number>;
  decisions: JourneyDecisionSummary;
  hintsUsed: number;
  mistakeCounts: Record<string, number>;
  bestResults: Record<string, JourneyScoreEvidence>;
  recent: JourneyAttemptSummary[];
  seenAttemptIds: string[];
};

export type JourneyEvidenceProvenance = {
  legacyCompletionCredit: boolean;
  versionConflict: boolean;
};

export type JourneyEvidenceRecord = {
  contentId: JourneyContentId;
  nodeId: JourneyNodeId;
  skillId: JourneySkillId | null;
  contentVersion: JourneyContentVersionRef;
  learningLevel: JourneyLearningLevel;
  application: JourneyApplicationProjection;
  review: JourneyReviewProjection;
  attempts: JourneyAttemptAggregates;
  startedAt: string | null;
  lastEvidenceAt: string | null;
  provenance: JourneyEvidenceProvenance;
};

export type JourneyEvidenceStore = {
  schemaVersion: typeof JOURNEY_EVIDENCE_SCHEMA_VERSION;
  recordsByContentId: Record<string, JourneyEvidenceRecord>;
};

export type JourneyEvidenceEvent =
  | {
      kind: 'lesson_started';
      contentId: JourneyContentId;
      nodeId: JourneyNodeId;
      contentVersion: { kind: 'versioned'; version: number };
      timestamp: string;
      skillId?: JourneySkillId;
    }
  | {
      kind: 'attempt_recorded';
      attempt: JourneyAttemptEvidence;
    }
  | {
      kind: 'application_observed';
      target: JourneyEvidenceTarget & { contentVersion: { kind: 'versioned'; version: number } };
      sourceRef: JourneyEvidenceSourceRef;
      observedAt: string;
    }
  | {
      kind: 'review_requested';
      target: JourneyEvidenceTarget & { contentVersion: { kind: 'versioned'; version: number } };
      reasonId: JourneyReviewReasonId;
      sourceRef: JourneyEvidenceSourceRef;
      requestedAt: string;
    }
  | {
      kind: 'review_resolved';
      target: JourneyEvidenceTarget & { contentVersion: { kind: 'versioned'; version: number } };
      reasonIds: JourneyReviewReasonId[];
      resolvedAt: string;
      sourceRef: JourneyEvidenceSourceRef;
      attemptId?: JourneyAttemptId;
    };

export type JourneyEvidenceValidationResult =
  | { kind: 'valid'; event: JourneyEvidenceEvent }
  | { kind: 'invalid'; errors: string[] };
