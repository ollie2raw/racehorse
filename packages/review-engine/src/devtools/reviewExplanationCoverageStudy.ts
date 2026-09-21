/**
 * Reports positional-explanation coverage from committed recorded corpora.
 * This is a manually invoked devtool: `npx tsx src/devtools/reviewExplanationCoverageStudy.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewCoachingFacts, capSeverityForContestedDecision, type ReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { lossBandLabelForEvaluation } from '../../../../client/src/analyzer/gameAccuracyModel';
import { buildReviewCoachingProse, referenceWinsFeature, VALUE_GAP_MIN_POINTS } from '../../../../client/src/analyzer/reviewCoachingProse';
import type { ReviewAction } from '@racehorse/game-core/review';
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

export type RenderedExplanationBucket = 'positional' | 'value-gap' | 'equal-value' | 'no-difference';
export type NoDifferenceSplitBucket = 'a' | 'b' | 'c' | 'd' | 'unavailable';

export function classifyNoDifferenceSplit(facts: ReviewCoachingFacts): NoDifferenceSplitBucket | null {
  if (classifyRenderedExplanationProse(facts) !== 'no-difference') return null;
  if (JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action)) return 'a';
  const referenceGap = facts.deltas.referenceExpectedPointDifferential;
  if (referenceGap === undefined) return 'unavailable';
  if (referenceGap === 0) return 'b';
  return referenceGap > 0 && referenceGap < VALUE_GAP_MIN_POINTS ? 'c' : 'd';
}

/** Classifies the enabled player-facing headline, not a duplicate truth predicate. */
export function classifyRenderedExplanationProse(facts: ReviewCoachingFacts): RenderedExplanationBucket | null {
  if (facts.missKind === 'forced') return null;
  const headline = buildReviewCoachingProse(facts, true).headline.replace(/^Contested:\s*/, '');
  if (headline.startsWith('No meaningful positional difference')) return 'no-difference';
  if (headline.startsWith('The review rates these two moves even overall')) return 'equal-value';
  if (headline.includes('is worth about') || headline.includes(' scores ') && headline.includes(' immediately')) return 'value-gap';
  return 'positional';
}

function actionText(action: ReviewAction): string {
  if (action.kind === 'play') return `${action.tile.low}-${action.tile.high} at ${action.position}`;
  return action.kind === 'draw' ? 'draw' : 'pass';
}

function actionMatches(left: ReviewAction, right: ReviewAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type TrueEqualCoverage = {
  readonly denominator: number;
  readonly positional: number;
  readonly materialValueGap: number;
  readonly equalValue: number;
  readonly immediateOnly: number;
  readonly genericNoDifference: number;
  readonly unavailable: number;
  readonly belowFloor: number;
  readonly other: number;
  readonly samples: number;
};

type MutableTrueEqualCoverage = { -readonly [Key in keyof TrueEqualCoverage]: TrueEqualCoverage[Key] };

/**
 * Writes the post-template measurement and its human-review samples from one
 * shared facts pass. The historical PR #285 and semantic-correction sections
 * are deliberately retained verbatim.
 */
export function writeTrueReferenceEqualProseStudy(): TrueEqualCoverage {
  const records = replayRecordedSelfPlay(SELF_PLAY_DIR);
  const measured = records.map(record => ({ ...record, facts: buildReviewCoachingFacts(record.evaluation, record.snapshot, true) }))
    .filter(({ facts }) => facts.missKind !== 'forced');
  const coverage: Omit<MutableTrueEqualCoverage, 'samples'> = {
    denominator: 0, positional: 0, materialValueGap: 0, equalValue: 0, immediateOnly: 0,
    genericNoDifference: 0, unavailable: 0, belowFloor: 0, other: 0,
  };
  const equalSamples: typeof measured = [];
  for (const item of measured) {
    const { facts } = item;
    if (actionMatches(facts.played.action, facts.best.action)) continue;
    coverage.denominator += 1;
    const headline = buildReviewCoachingProse(facts, true).headline.replace(/^Contested:\s*/, '');
    const bucket = classifyRenderedExplanationProse(facts)!;
    if (bucket === 'positional') coverage.positional += 1;
    else if (bucket === 'equal-value') {
      coverage.equalValue += 1;
      equalSamples.push(item);
    } else if (bucket === 'value-gap') {
      if (headline.includes('is worth about')) coverage.materialValueGap += 1;
      else coverage.immediateOnly += 1;
    } else {
      coverage.genericNoDifference += 1;
      const gap = facts.deltas.referenceExpectedPointDifferential;
      if (gap === undefined) coverage.unavailable += 1;
      else if (gap > 0 && gap < VALUE_GAP_MIN_POINTS) coverage.belowFloor += 1;
      else coverage.other += 1;
    }
  }
  const supported = coverage.positional + coverage.materialValueGap + coverage.equalValue + coverage.immediateOnly;
  const section = [
    '## True displayed-reference equality fallback', '',
    '| metric | count |', '| --- | ---: |',
    `| played != displayed reference denominator | ${coverage.denominator} |`,
    `| positional | ${coverage.positional} |`,
    `| material value-gap | ${coverage.materialValueGap} |`,
    `| equal-value rendered | ${coverage.equalValue} |`,
    `| immediate-only supported | ${coverage.immediateOnly} |`,
    `| generic no-difference / unsupported | ${coverage.genericNoDifference} |`,
    `| supported | ${supported}/${coverage.denominator} | ${((supported / coverage.denominator) * 100).toFixed(1)}% |`, '',
    '| remaining unsupported category | count |', '| --- | ---: |',
    `| displayed-reference value unavailable | ${coverage.unavailable} |`,
    `| positive gap below 0.25 | ${coverage.belowFloor} |`,
    `| other | ${coverage.other} |`, '',
  ].join('\n');
  const current = readFileSync(REPORT_PATH, 'utf8');
  const historical = current.split('\n## True displayed-reference equality fallback\n')[0].trimEnd();
  writeFileSync(REPORT_PATH, `${historical}\n\n${section}`);
  const samplePath = resolve(ROOT, 'docs/review-true-equal-prose-samples.md');
  const sampleSections = equalSamples.map(({ facts, snapshot, file }, index) => [
    `## ${index + 1}. ${facts.evidence.source}`,
    '',
    `- Decision ID: ${snapshot.identifiers.decisionId}`,
    `- Position: ${file}`,
    `- Played: ${actionText(facts.played.action)}`,
    `- Displayed reference: ${actionText(facts.best.action)}`,
    `- referenceExpectedPointDifferential: ${facts.deltas.referenceExpectedPointDifferential}`,
    `- Immediate delta: ${facts.deltas.immediatePoints}`,
    `- Contested: ${facts.agreement?.contested === true}`,
    `- Previous prose: ${buildReviewCoachingProse(facts, true, false).headline}`,
    `- New prose: ${buildReviewCoachingProse(facts, true).headline}`,
    '',
  ].join('\n'));
  writeFileSync(samplePath, ['# True displayed-reference equality prose samples', '', `| rendered equality cases | ${equalSamples.length} |`, '', ...sampleSections].join('\n'));
  return { ...coverage, samples: equalSamples.length };
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
    Math.abs(facts.deltas.referenceExpectedPointDifferential ?? 0),
    Math.abs(facts.deltas.immediatePoints),
  );
}

type ReferenceRelativeCategory = 'same-reference' | 'equal' | 'below-floor' | 'material-positive' | 'unavailable' | 'other';

function referenceRelativeCategory(facts: ReviewCoachingFacts): ReferenceRelativeCategory {
  if (JSON.stringify(facts.played.action) === JSON.stringify(facts.best.action)) return 'same-reference';
  const gap = facts.deltas.referenceExpectedPointDifferential;
  if (gap === undefined) return 'unavailable';
  if (gap === 0) return 'equal';
  if (gap > 0 && gap < VALUE_GAP_MIN_POINTS) return 'below-floor';
  if (gap >= VALUE_GAP_MIN_POINTS) return 'material-positive';
  return 'other';
}

/** Appends a one-pass reference-relative correction without rewriting the historical PR #285 tables. */
export function appendReferenceRelativeCorrectionStudy(): string {
  // Match the historical study denominator: forced/no-choice records are not
  // explanation decisions and are excluded before every correction count.
  const factsList = buildFacts(replayRecordedSelfPlay(SELF_PLAY_DIR))
    .filter(facts => facts.missKind !== 'forced');
  const tiers: ExplanationTier[] = ['exact', 'search', 'heuristic'];
  const categories: ReferenceRelativeCategory[] = ['same-reference', 'equal', 'below-floor', 'material-positive', 'unavailable', 'other'];
  const count = (tier: ExplanationTier | 'overall', category: ReferenceRelativeCategory) => factsList.filter(facts =>
    (tier === 'overall' || facts.evidence.source === tier) && referenceRelativeCategory(facts) === category,
  ).length;
  const oldBucketB = factsList.filter(facts =>
    classifyRenderedExplanationProse(facts) === 'no-difference'
    && JSON.stringify(facts.played.action) !== JSON.stringify(facts.best.action)
    && facts.deltas.expectedPointDifferential === 0,
  );
  const trueTies = oldBucketB.filter(facts => facts.deltas.referenceExpectedPointDifferential === 0);
  const tieByTier = (tier: ExplanationTier) => trueTies.filter(facts => facts.evidence.source === tier).length;
  const distinct = factsList.filter(facts => JSON.stringify(facts.played.action) !== JSON.stringify(facts.best.action));
  const supported = distinct.filter(facts => classifyRenderedExplanationProse(facts) !== 'no-difference');
  const rows = [...tiers, 'overall' as const].map(tier =>
    `| ${tier} | ${categories.map(category => count(tier, category)).join(' | ')} |`,
  );
  const section = [
    '## Reference-relative semantic correction', '',
    '| tier | played == displayed reference | displayed-reference expected gap == 0 | positive gap below 0.25 | positive/material expected gap | expected value unavailable | sign-inconsistent/other |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows, '',
    `| previous zero-loss bucket-b cases | ${oldBucketB.length} |`,
    `| true displayed-reference ties | ${trueTies.length} |`,
    `| true displayed-reference ties (search) | ${tieByTier('search')} |`,
    `| true displayed-reference ties (heuristic) | ${tieByTier('heuristic')} |`,
    `| previous bucket-b cases moved to another category | ${oldBucketB.length - trueTies.length} |`,
    `| supported sentences (played != displayed reference) | ${supported.length}/${distinct.length} | ${((supported.length / distinct.length) * 100).toFixed(1)}% |`, '',
  ].join('\n');
  const current = readFileSync(REPORT_PATH, 'utf8');
  const historical = current.split('\n## Reference-relative semantic correction\n')[0].trimEnd();
  writeFileSync(REPORT_PATH, `${historical}\n\n${section}`);
  return section;
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
  const buckets = { positional: 0, 'value-gap': 0, 'equal-value': 0, 'no-difference': 0 };
  // `ReviewCoachingFacts` has no identity flag, so compare the structured actions.
  const noDifference = { exact: [0, 0, 0, 0, 0], search: [0, 0, 0, 0, 0], heuristic: [0, 0, 0, 0, 0] } as Record<ExplanationTier, number[]>;
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
      const split = classifyNoDifferenceSplit(facts)!;
      const size = ['a', 'b', 'c', 'd', 'unavailable'].indexOf(split);
      noDifference[facts.evidence.source][size] += 1;
    }
  }
  const percent = (count: number) => `${((count / eligible.length) * 100).toFixed(1)}%`;
  const rows = (['exact', 'search', 'heuristic'] as const).map(tier => `| ${tier} | ${noDifference[tier].join(' | ')} |`);
  const totalNoDifference = [0, 1, 2, 3, 4].map(index => (['exact', 'search', 'heuristic'] as const).reduce((sum, tier) => sum + noDifference[tier][index], 0));
  return [
    '## Rendered prose coverage', '', '| bucket | count | percent |', '| --- | ---: | ---: |',
    ...(['positional', 'value-gap', 'equal-value', 'no-difference'] as const).map(bucket => `| ${bucket} | ${buckets[bucket]} | ${percent(buckets[bucket])} |`),
    `| supported-sentence coverage | ${buckets.positional + buckets['value-gap'] + buckets['equal-value']} | ${percent(buckets.positional + buckets['value-gap'] + buckets['equal-value'])} |`, '',
    `| supported-sentence coverage (played != reference) | ${distinctSupported} | ${((distinctSupported / distinctChoices) * 100).toFixed(1)}% |`, '',
    '## Rendered no-difference denominator breakdown', '', '| tier | played == reference | played != reference, exactly zero | played != reference, below 0.25 | played != reference, non-reference-favoring | played != reference, expected value unavailable |', '| --- | ---: | ---: | ---: | ---: | ---: |', ...rows, `| overall | ${totalNoDifference.join(' | ')} |`, '',
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
