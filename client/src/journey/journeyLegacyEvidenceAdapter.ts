import type { JourneyContentDescriptor, JourneyNodeId } from './journeyContentContract.ts';
import type { JourneyProgress } from './journeyTypes.ts';
import {
  createEmptyJourneyEvidenceRecord,
  createEmptyJourneyEvidenceStore,
} from './journeyEvidenceReducer.ts';
import type {
  JourneyEvidenceRecord,
  JourneyEvidenceStore,
} from './journeyEvidenceTypes.ts';

export type LegacyJourneyEvidenceProjection = {
  store: JourneyEvidenceStore;
  ignoredNodeIds: string[];
};

export function projectLegacyJourneyProgressToEvidence({
  legacyProgress,
  activeDescriptors,
}: {
  legacyProgress: JourneyProgress;
  activeDescriptors: ReadonlyArray<JourneyContentDescriptor>;
}): LegacyJourneyEvidenceProjection {
  const descriptorsByNodeId = new Map(activeDescriptors.map((descriptor) => [String(descriptor.nodeId), descriptor]));
  const store = createEmptyJourneyEvidenceStore();
  const ignoredNodeIds = new Set<string>();
  const records: Record<string, JourneyEvidenceRecord> = {};

  for (const chapter of Object.values(legacyProgress.chapters)) {
    for (const nodeId of new Set(chapter.completedNodeIds)) {
      const descriptor = descriptorsByNodeId.get(nodeId);
      if (!descriptor) {
        ignoredNodeIds.add(nodeId);
        continue;
      }
      const record = createEmptyJourneyEvidenceRecord(
        descriptor.contentId,
        descriptor.nodeId as JourneyNodeId,
        { kind: 'legacy_unversioned' },
      );
      records[String(descriptor.contentId)] = {
        ...record,
        learningLevel: 'practiced',
        provenance: { legacyCompletionCredit: true, versionConflict: false },
      };
    }
  }

  return { store: { ...store, recordsByContentId: records }, ignoredNodeIds: [...ignoredNodeIds].sort() };
}

function levelRank(level: JourneyEvidenceRecord['learningLevel']): number {
  return { not_started: 0, started: 1, practiced: 2, proven: 3 }[level];
}

function mergeRecord(legacy: JourneyEvidenceRecord, structured: JourneyEvidenceRecord): JourneyEvidenceRecord {
  const versionConflict = legacy.contentVersion.kind !== structured.contentVersion.kind
    || (legacy.contentVersion.kind === 'versioned' && structured.contentVersion.kind === 'versioned' && legacy.contentVersion.version !== structured.contentVersion.version);
  if (versionConflict) {
    const legacyCreditOnly = legacy.contentVersion.kind === 'legacy_unversioned'
      && legacy.provenance.legacyCompletionCredit
      && legacy.attempts.total === 0;
    if (!legacyCreditOnly) throw new Error(`Journey evidence content-version conflict for ${structured.contentId}.`);
    return {
      ...structured,
      learningLevel: structured.learningLevel === 'not_started' || structured.learningLevel === 'started'
        ? (legacy.learningLevel === 'practiced' ? 'practiced' : structured.learningLevel)
        : structured.learningLevel,
      provenance: { ...structured.provenance, legacyCompletionCredit: legacy.provenance.legacyCompletionCredit, versionConflict: true },
    };
  }
  return {
    ...structured,
    learningLevel: levelRank(legacy.learningLevel) > levelRank(structured.learningLevel) ? legacy.learningLevel : structured.learningLevel,
    startedAt: legacy.startedAt && structured.startedAt ? (legacy.startedAt < structured.startedAt ? legacy.startedAt : structured.startedAt) : legacy.startedAt ?? structured.startedAt,
    provenance: { legacyCompletionCredit: legacy.provenance.legacyCompletionCredit || structured.provenance.legacyCompletionCredit, versionConflict: legacy.provenance.versionConflict || structured.provenance.versionConflict },
  };
}

function mergeRecordOrderIndependent(first: JourneyEvidenceRecord, second: JourneyEvidenceRecord): JourneyEvidenceRecord {
  const firstLooksLegacy = first.provenance.legacyCompletionCredit && first.attempts.total === 0;
  const secondLooksLegacy = second.provenance.legacyCompletionCredit && second.attempts.total === 0;
  if (firstLooksLegacy && !secondLooksLegacy) return mergeRecord(first, second);
  if (secondLooksLegacy && !firstLooksLegacy) return mergeRecord(second, first);
  return mergeRecord(first, second);
}

export function mergeJourneyEvidence(
  legacyStore: JourneyEvidenceStore,
  structuredStore: JourneyEvidenceStore,
): JourneyEvidenceStore {
  const records: Record<string, JourneyEvidenceRecord> = { ...structuredStore.recordsByContentId };
  for (const [contentId, legacy] of Object.entries(legacyStore.recordsByContentId)) {
    const structured = records[contentId];
    records[contentId] = structured ? mergeRecordOrderIndependent(legacy, structured) : legacy;
  }
  return { schemaVersion: structuredStore.schemaVersion, recordsByContentId: records };
}
