import type { ReviewKnownMissingPipEvidence } from '@racehorse/game-core/reviewContracts';

/**
 * Complete live observation of a player failing to play on open ends.
 * A1 will emit these for both actors; A0 only converts them to V2.
 */
export type LiveMissingPipObservation = {
  readonly actorId: string;
  readonly reason: 'passed_on_open_end' | 'drew_past_open_end';
  readonly observedHandNumber: number;
  readonly observedSequence: number;
  readonly openEnds: readonly number[];
};

/** Legacy Fritz draw-evidence rows from `BotMatchState.opponentMissingEvidence`. */
export type LegacyOpponentMissingEvidenceRow = {
  readonly pip: number;
  readonly handNumber: number;
  readonly turnIndex: number;
};

/**
 * One pass (or pass-equivalent) event with full public context.
 * Prefer this over the flat `opponentPassedOnEnds: number[]` bag, which loses
 * hand/sequence/openEnds grouping and cannot round-trip into V2.
 */
export type LivePassOnEndBatch = {
  readonly actorId: string;
  readonly openEnds: readonly number[];
  readonly observedHandNumber: number;
  readonly observedSequence: number;
};

function dedupeKey(row: ReviewKnownMissingPipEvidence): string {
  return `${row.opponentId}|${row.pip}|${row.reason}|${row.observedHandNumber}|${row.observedSequence}`;
}

function uniquePips(openEnds: readonly number[]): number[] {
  return [...new Set(openEnds)];
}

/**
 * Expand live observations into `ReviewKnownMissingPipEvidence[]`
 * matching the fixture-corpus `recordMissingPipEvidence` shape
 * (one row per open-end pip, shared `openEnds` snapshot).
 */
export function toReviewKnownMissingPipEvidence(
  observations: readonly LiveMissingPipObservation[],
): ReviewKnownMissingPipEvidence[] {
  const out: ReviewKnownMissingPipEvidence[] = [];
  const seen = new Set<string>();

  for (const observation of observations) {
    const openEnds = uniquePips(observation.openEnds);
    if (openEnds.length === 0) continue;

    for (const pip of openEnds) {
      const row: ReviewKnownMissingPipEvidence = {
        opponentId: observation.actorId,
        pip,
        reason: observation.reason,
        observedHandNumber: observation.observedHandNumber,
        observedSequence: observation.observedSequence,
        openEnds,
      };
      const key = dedupeKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }

  return out;
}

/**
 * Recover V2 draw-past evidence from Fritz's per-pip legacy rows by grouping
 * rows that share the same handNumber + turnIndex (recorded together at draw-start).
 */
export function adaptLegacyOpponentMissingEvidence(args: {
  readonly opponentId: string;
  readonly evidence: readonly LegacyOpponentMissingEvidenceRow[];
}): ReviewKnownMissingPipEvidence[] {
  if (args.evidence.length === 0) return [];

  const groups = new Map<string, LegacyOpponentMissingEvidenceRow[]>();
  for (const row of args.evidence) {
    const key = `${row.handNumber}:${row.turnIndex}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const observations: LiveMissingPipObservation[] = [];
  for (const group of groups.values()) {
    observations.push({
      actorId: args.opponentId,
      reason: 'drew_past_open_end',
      observedHandNumber: group[0]!.handNumber,
      observedSequence: group[0]!.turnIndex,
      openEnds: group.map((row) => row.pip),
    });
  }

  return toReviewKnownMissingPipEvidence(observations);
}

/** Map structured pass-on-end batches into V2 `passed_on_open_end` evidence. */
export function adaptPassOnEndBatches(
  batches: readonly LivePassOnEndBatch[],
): ReviewKnownMissingPipEvidence[] {
  return toReviewKnownMissingPipEvidence(
    batches.map((batch) => ({
      actorId: batch.actorId,
      reason: 'passed_on_open_end' as const,
      observedHandNumber: batch.observedHandNumber,
      observedSequence: batch.observedSequence,
      openEnds: batch.openEnds,
    })),
  );
}
