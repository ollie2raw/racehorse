/**
 * Reports positional-explanation coverage from committed recorded corpora.
 * This is a manually invoked devtool: `npx tsx src/devtools/reviewExplanationCoverageStudy.ts`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewCoachingFacts, capSeverityForContestedDecision, type ReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { lossBandLabelForEvaluation } from '../../../../client/src/analyzer/gameAccuracyModel';
import { buildReviewCoachingProse, referenceWinsFeature, VALUE_GAP_MIN_POINTS } from '../../../../client/src/analyzer/reviewCoachingProse';
import { replayRecordedSelfPlay, type RecordedPosition } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SELF_PLAY_DIR = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const CLIENT_POLICY_DIR = resolve(ROOT, 'packages/review-engine/fixtures/recorded-client-policy');
const REPORT_PATH = resolve(ROOT, 'docs/review-explanation-coverage-study.md');

export type ExplanationTier = 'exact' | 'search' | 'heuristic';
export type ExplanationCoverageBucket = {
  readonly tier: ExplanationTier;
  readonly contested: boolean;
  /** Whether a measured feature actually favors the reference move. */
  readonly resolved: boolean;
};

export type RenderedExplanationBucket = 'positional' | 'value-gap' | 'no-difference';
export type NoDifferenceSplitBucket = 'a' | 'b' | 'c' | 'd';

export function classifyNoDifferenceSplit(facts: ReviewCoachingFacts): NoDifferenceSplitBucket | null {
  if (classifyRenderedExplanationProse(facts) !== 'no-difference') return null;
  if (JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action)) return 'a';
  if (facts.deltas.expectedPointDifferential === 0) return 'b';
  return facts.deltas.expectedPointDifferential > 0 && facts.deltas.expectedPointDifferential < VALUE_GAP_MIN_POINTS ? 'c' : 'd';
}

/** Classifies the enabled player-facing headline, not a duplicate truth predicate. */
export function classifyRenderedExplanationProse(facts: ReviewCoachingFacts): RenderedExplanationBucket | null {
  if (facts.missKind === 'forced') return null;
  const headline = buildReviewCoachingProse(facts, true).headline.replace(/^Contested:\s*/, '');
  if (headline.startsWith('No meaningful positional difference')) return 'no-difference';
  if (headline.includes('is worth about') || headline.includes(' scores ') && headline.includes(' immediately')) return 'value-gap';
  return 'positional';
}

export function classifyExplanationCoverage(facts: ReviewCoachingFacts): ExplanationCoverageBucket | null {
  if (facts.missKind === 'forced') return null;
  return {
    tier: facts.evidence.source,
    contested: facts.agreement?.contested === true,
    resolved: (facts.featureDeltas ?? []).some(referenceWinsFeature),
  };
}

/**
 * The truth-rule docs define no value-gap threshold, so an unresolved
 * decision has a value gap exactly when either backed delta is nonzero.
 */
export function unresolvedValueGapMagnitude(facts: ReviewCoachingFacts): number | null {
  const coverage = classifyExplanationCoverage(facts);
  if (!coverage || coverage.resolved) return null;
  return Math.max(
    Math.abs(facts.deltas.expectedPointDifferential),
    Math.abs(facts.deltas.immediatePoints),
  );
}

type CoverageCounts = Record<ExplanationTier, Record<'yes' | 'no', Record<'yes' | 'no', number>>>;

function emptyCounts(): CoverageCounts {
  return {
    exact: { yes: { yes: 0, no: 0 }, no: { yes: 0, no: 0 } },
    search: { yes: { yes: 0, no: 0 }, no: { yes: 0, no: 0 } },
    heuristic: { yes: { yes: 0, no: 0 }, no: { yes: 0, no: 0 } },
  };
}

function buildFacts(positions: readonly RecordedPosition[]): readonly ReviewCoachingFacts[] {
  return positions.map(({ evaluation, snapshot }) => buildReviewCoachingFacts(evaluation, snapshot, true));
}

function countPositions(factsList: readonly ReviewCoachingFacts[]): CoverageCounts {
  const counts = emptyCounts();
  for (const facts of factsList) {
    const bucket = classifyExplanationCoverage(facts);
    if (bucket) counts[bucket.tier][bucket.contested ? 'yes' : 'no'][bucket.resolved ? 'yes' : 'no'] += 1;
  }
  return counts;
}

type UnresolvedValueGapCounts = {
  readonly zero: number;
  readonly nonzero: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
};

function countUnresolvedValueGaps(factsList: readonly ReviewCoachingFacts[]): UnresolvedValueGapCounts {
  const magnitudes = factsList
    .map(unresolvedValueGapMagnitude)
    .filter((magnitude): magnitude is number => magnitude !== null);
  const nonzero = magnitudes.filter(magnitude => magnitude !== 0).sort((a, b) => a - b);
  const middle = Math.floor(nonzero.length / 2);
  return {
    zero: magnitudes.length - nonzero.length,
    nonzero: nonzero.length,
    min: nonzero[0] ?? null,
    median: nonzero.length === 0 ? null : nonzero.length % 2 === 0 ? (nonzero[middle - 1] + nonzero[middle]) / 2 : nonzero[middle],
    max: nonzero.at(-1) ?? null,
  };
}

function formatMagnitude(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 1e12) / 1e12);
}

function formatReport(counts: CoverageCounts, valueGaps: UnresolvedValueGapCounts): string {
  const total = Object.values(counts).flatMap(byContested => Object.values(byContested))
    .flatMap(byResolved => Object.values(byResolved)).reduce((sum, count) => sum + count, 0);
  const rows = (['exact', 'search', 'heuristic'] as const).flatMap(tier =>
    (['yes', 'no'] as const).flatMap(contested =>
      (['yes', 'no'] as const).map(resolved => {
        const count = counts[tier][contested][resolved];
        return `| ${tier} | ${contested} | ${resolved} | ${count} | ${((count / total) * 100).toFixed(1)}% |`;
      }),
    ),
  );
  return [
    '# Review explanation coverage study',
    '',
    '| tier | contested | resolved | count | percent |',
    '| --- | --- | --- | ---: | ---: |',
    ...rows,
    `| overall | all | all | ${total} | 100.0% |`,
    '',
    '## Resolved: false value gaps',
    '',
    '| value gap magnitude | count | percent | min | median | max |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    `| 0 | ${valueGaps.zero} | ${((valueGaps.zero / (valueGaps.zero + valueGaps.nonzero)) * 100).toFixed(1)}% | — | — | — |`,
    `| nonzero | ${valueGaps.nonzero} | ${((valueGaps.nonzero / (valueGaps.zero + valueGaps.nonzero)) * 100).toFixed(1)}% | ${formatMagnitude(valueGaps.min)} | ${formatMagnitude(valueGaps.median)} | ${formatMagnitude(valueGaps.max)} |`,
    '',
  ].join('\n');
}

function formatRenderedReport(factsList: readonly ReviewCoachingFacts[]): string {
  const eligible = factsList.filter(facts => classifyRenderedExplanationProse(facts) !== null);
  const buckets = { positional: 0, 'value-gap': 0, 'no-difference': 0 };
  // `ReviewCoachingFacts` has no identity flag, so compare the structured actions.
  const noDifference = { exact: [0, 0, 0, 0], search: [0, 0, 0, 0], heuristic: [0, 0, 0, 0] } as Record<ExplanationTier, number[]>;
  const missKinds = new Map<string, number>();
  let distinctChoices = 0;
  let distinctSupported = 0;
  for (const facts of eligible) {
    const bucket = classifyRenderedExplanationProse(facts)!;
    buckets[bucket] += 1;
    missKinds.set(facts.missKind, (missKinds.get(facts.missKind) ?? 0) + 1);
    const identical = JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action);
    if (!identical) {
      distinctChoices += 1;
      if (bucket !== 'no-difference') distinctSupported += 1;
    }
    if (bucket === 'no-difference') {
      const size = 'abcd'.indexOf(classifyNoDifferenceSplit(facts)!);
      noDifference[facts.evidence.source][size] += 1;
    }
  }
  const percent = (count: number) => `${((count / eligible.length) * 100).toFixed(1)}%`;
  const rows = (['exact', 'search', 'heuristic'] as const).map(tier => `| ${tier} | ${noDifference[tier].join(' | ')} |`);
  const totalNoDifference = [0, 1, 2, 3].map(index => (['exact', 'search', 'heuristic'] as const).reduce((sum, tier) => sum + noDifference[tier][index], 0));
  return [
    '## Rendered prose coverage', '', '| bucket | count | percent |', '| --- | ---: | ---: |',
    ...(['positional', 'value-gap', 'no-difference'] as const).map(bucket => `| ${bucket} | ${buckets[bucket]} | ${percent(buckets[bucket])} |`),
    `| supported-sentence coverage | ${buckets.positional + buckets['value-gap']} | ${percent(buckets.positional + buckets['value-gap'])} |`, '',
    `| supported-sentence coverage (played != reference) | ${distinctSupported} | ${((distinctSupported / distinctChoices) * 100).toFixed(1)}% |`, '',
    '## Rendered no-difference denominator breakdown', '', '| tier | played == reference | played != reference, exactly zero | played != reference, below 0.25 | played != reference, non-reference-favoring |', '| --- | ---: | ---: | ---: | ---: |', ...rows, `| overall | ${totalNoDifference.join(' | ')} |`, '',
    '## Eligible missKind distribution', '', '| missKind | count |', '| --- | ---: |', ...[...missKinds.entries()].sort().map(([kind, count]) => `| ${kind} | ${count} |`), '',
  ].join('\n');
}

function formatJitterReport(positions: readonly RecordedPosition[]): string {
  // The canonical per-record facts were not persisted, so A/B are fresh independent Fritz runs.
  const pass = () => new Map(positions.map(record => [record.snapshot.identifiers.decisionId, { record, facts: buildReviewCoachingFacts(record.evaluation, record.snapshot, true) }]));
  const a = pass();
  const b = pass();
  if (a.size !== b.size || [...a.keys()].some(id => !b.has(id))) throw new Error('Jitter passes have different eligible decision IDs.');
  let contested = 0; let bucket = 0; let split = 0; let severity = 0;
  const eligible = [...a].filter(([, value]) => classifyRenderedExplanationProse(value.facts) !== null);
  for (const [id, left] of eligible) {
    const right = b.get(id)!;
    if (left.facts.agreement?.contested !== right.facts.agreement?.contested) contested += 1;
    if (classifyRenderedExplanationProse(left.facts) !== classifyRenderedExplanationProse(right.facts)) bucket += 1;
    if (classifyNoDifferenceSplit(left.facts) !== classifyNoDifferenceSplit(right.facts)) split += 1;
    const base = lossBandLabelForEvaluation(left.record.evaluation);
    if (base && capSeverityForContestedDecision(base, left.facts.agreement!, left.facts.evidence.source, true) !== capSeverityForContestedDecision(base, right.facts.agreement!, right.facts.evidence.source, true)) severity += 1;
  }
  return ['## Jitter measurement', '', 'Two fresh independent facts passes were compared because canonical per-record facts were not persisted.', '', `| eligible decisions compared | ${eligible.length} |`, `| contested flips | ${contested} |`, `| rendered top-level bucket flips | ${bucket} |`, `| denominator sub-split flips | ${split} |`, `| capped-severity flips | ${severity} |`, ''].join('\n');
}

export function runCoverageStudy(): { readonly selfPlayPositions: number; readonly clientPolicy: 'included' | 'skipped'; readonly clientPolicyReason?: string } {
  const selfPlay = replayRecordedSelfPlay(SELF_PLAY_DIR);
  let positions = selfPlay;
  let clientPolicy: 'included' | 'skipped' = 'included';
  let clientPolicyReason: string | undefined;
  try {
    positions = [...selfPlay, ...replayRecordedSelfPlay(CLIENT_POLICY_DIR)];
  } catch (error) {
    clientPolicy = 'skipped';
    clientPolicyReason = error instanceof Error ? error.message : String(error);
  }
  const factsList = buildFacts(positions);
  writeFileSync(REPORT_PATH, `${formatReport(countPositions(factsList), countUnresolvedValueGaps(factsList))}\n${formatRenderedReport(factsList)}\n${formatJitterReport(positions)}`);
  return { selfPlayPositions: selfPlay.length, clientPolicy, ...(clientPolicyReason ? { clientPolicyReason } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runCoverageStudy()));
}
