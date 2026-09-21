/**
 * Reports positional-explanation coverage from committed recorded corpora.
 * This is a manually invoked devtool: `npx tsx src/devtools/reviewExplanationCoverageStudy.ts`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewCoachingFacts, type ReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { referenceWinsFeature } from '../../../../client/src/analyzer/reviewCoachingProse';
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
  writeFileSync(REPORT_PATH, formatReport(countPositions(factsList), countUnresolvedValueGaps(factsList)));
  return { selfPlayPositions: selfPlay.length, clientPolicy, ...(clientPolicyReason ? { clientPolicyReason } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runCoverageStudy()));
}
