/**
 * F3a — Coverage-gate validation (issue #226 / Phase F Track F3).
 *
 * Question: on positions where BOTH the search tier can evaluate and the exact
 * solver provides complete ground truth, does the proposed convergence
 * diagnostic admit additional positions whose exact-action error rate is no
 * worse than the existing coverage-fraction gate?
 *
 * Provenance: selective port of `ce2a658c` (devtools/f3a-convergence-validation)
 * onto main after #292. Adapted to:
 *   - use the committed recorded corpora (not freshly generated Fritz games)
 *   - lock the precommitted proposed thresholds from hold/f3b (`0.26` delta,
 *     `0.02` coverage floor) — no post-hoc threshold grid / tuning
 *   - report newly-admitted AND newly-rejected flips separately
 *   - project corpus tier mix from stored coverage/convergence (no dispatch change)
 *
 * Ground truth = complete `solveExactEndgame` only. Fritz is never ground truth.
 * Midgame re-runs on locked-yard snapshots are deterministic (no Fritz).
 *
 * Manually invoked:
 *   npx tsx packages/review-engine/src/devtools/validateMidgameConvergenceGate.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeCandidatesByTile, type ReviewAction, type ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { deserializeReviewCaptureRecordsFromJsonl, type ReviewCaptureRecord } from '../reviewCaptureSchema';
import { solveExactEndgame } from '../solveExactEndgame';
import {
  solveMidgameDeterminization,
  type MidgameConvergence,
  type MidgameDeterminizationResult,
} from '../solveMidgameDeterminization';
import type { ReviewSearchBudget } from '../evaluateReviewPosition';
import { replayRecordedSelfPlay, type RecordedPosition } from './replayRecordedSelfPlay';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '../..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
export const RECORDED_SELF_PLAY_DIR = join(PACKAGE_ROOT, 'fixtures', 'recorded-self-play');
export const RECORDED_CLIENT_POLICY_DIR = join(PACKAGE_ROOT, 'fixtures', 'recorded-client-policy');
export const REPORT_PATH = join(REPO_ROOT, 'docs', 'review-convergence-gate-validation.md');

/** Matches production / recorded-corpus per-decision coverage threshold. */
export const EXISTING_COVERAGE_THRESHOLD = 0.02;

/**
 * Precommitted proposed maxConvergenceValueDelta from hold/f3b-convergence-gate
 * (`90c0d914` midgameConvergenceGate.ts): 90th percentile of corpus valueDelta.
 * Not tuned against this validation set.
 */
export const PROPOSED_MAX_CONVERGENCE_VALUE_DELTA = 0.26;

/** Coarse floor retained alongside convergence terms (same as recorded coverageThreshold). */
export const PROPOSED_MIN_COVERAGE = EXISTING_COVERAGE_THRESHOLD;

const BUDGET: ReviewSearchBudget = { maxNodes: 200_000, maxHiddenStateSamples: 100 };
const MAX_PLY_DEPTH = 2;

export type MidgameTrustSignal = {
  readonly coverage: number;
  readonly convergence: MidgameConvergence;
};

/** Devtool-only copy of the proposed gate — does not alter production dispatch. */
export function passesProposedConvergenceGate(
  signal: MidgameTrustSignal,
  thresholds: { readonly minCoverage: number; readonly maxConvergenceValueDelta: number } = {
    minCoverage: PROPOSED_MIN_COVERAGE,
    maxConvergenceValueDelta: PROPOSED_MAX_CONVERGENCE_VALUE_DELTA,
  },
): boolean {
  return (
    signal.coverage >= thresholds.minCoverage &&
    signal.convergence.sameTopAction &&
    signal.convergence.valueDelta <= thresholds.maxConvergenceValueDelta
  );
}

export function passesExistingCoverageGate(
  coverage: number,
  threshold: number = EXISTING_COVERAGE_THRESHOLD,
): boolean {
  return coverage >= threshold;
}

export function canonicalActionKey(action: ReviewAction): string {
  if (action.kind === 'play') {
    const lo = Math.min(action.tile.low, action.tile.high);
    const hi = Math.max(action.tile.low, action.tile.high);
    return JSON.stringify({ tile: [lo, hi], position: action.position });
  }
  return JSON.stringify({ kind: action.kind });
}

/** Same tile identity, different end/branch → distinct actions (exact-action error). */
export function sameTileDifferentEnd(a: ReviewAction, b: ReviewAction): boolean {
  if (a.kind !== 'play' || b.kind !== 'play') return false;
  const aLo = Math.min(a.tile.low, a.tile.high);
  const aHi = Math.max(a.tile.low, a.tile.high);
  const bLo = Math.min(b.tile.low, b.tile.high);
  const bHi = Math.max(b.tile.low, b.tile.high);
  return aLo === bLo && aHi === bHi && a.position !== b.position;
}

export type EvaluatedOverlap = {
  readonly exactBestKeys: readonly string[];
  readonly exactBestActions: readonly ReviewAction[];
  readonly midgame: MidgameDeterminizationResult;
  readonly decisionId: string;
};

export type OverlapEvaluationReport = {
  readonly results: readonly EvaluatedOverlap[];
  readonly eligibleLockedNonForced: number;
  readonly excludedIncompleteExact: number;
  readonly excludedInfeasibleExact: number;
  readonly excludedInfeasibleSearch: number;
};

export function evaluateOverlaps(
  positions: readonly { readonly snapshot: ReviewPositionSnapshotV2; readonly decisionId?: string }[],
): OverlapEvaluationReport {
  const results: EvaluatedOverlap[] = [];
  let eligibleLockedNonForced = 0;
  let excludedIncompleteExact = 0;
  let excludedInfeasibleExact = 0;
  let excludedInfeasibleSearch = 0;

  for (const { snapshot, decisionId } of positions) {
    if (snapshot.preAction.boneyard.drawableCount !== 0) continue;
    if (snapshot.legalActions.length <= 1) continue;
    eligibleLockedNonForced += 1;

    const exact = solveExactEndgame(snapshot, { maxNodes: BUDGET.maxNodes });
    if (exact === null) {
      excludedInfeasibleExact += 1;
      continue;
    }
    if (!exact.complete) {
      excludedIncompleteExact += 1;
      continue;
    }
    const midgame = solveMidgameDeterminization(snapshot, BUDGET, 'validate-convergence-gate', MAX_PLY_DEPTH);
    if (midgame === null) {
      excludedInfeasibleSearch += 1;
      continue;
    }
    const exactBestActions = exact.candidates.filter(
      (candidate) =>
        Math.abs(candidate.value.expectedPointDifferential - exact.best.value.expectedPointDifferential) <= 1e-9,
    );
    results.push({
      exactBestKeys: exactBestActions.map((c) => canonicalActionKey(c.action)),
      exactBestActions: exactBestActions.map((c) => c.action),
      midgame,
      decisionId: decisionId ?? snapshot.identifiers.decisionId,
    });
  }

  return {
    results,
    eligibleLockedNonForced,
    excludedIncompleteExact,
    excludedInfeasibleExact,
    excludedInfeasibleSearch,
  };
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): { readonly low: number; readonly high: number } | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return { low: (center - margin) / denom, high: (center + margin) / denom };
}

export type GateComparisonReport = {
  readonly totalOverlapCases: number;
  readonly flips: number;
  readonly flipRate: number | null;
  readonly newlyAdmitted: {
    readonly count: number;
    readonly errors: number;
    readonly errorRate: number | null;
    readonly ci95: { readonly low: number; readonly high: number } | null;
    readonly sameTileWrongEnd: number;
    readonly differentAction: number;
  };
  readonly newlyRejected: {
    readonly count: number;
  };
  readonly existingGate: {
    readonly admitted: number;
    readonly errors: number;
    readonly errorRate: number | null;
    readonly ci95: { readonly low: number; readonly high: number } | null;
    readonly sameTileWrongEnd: number;
    readonly differentAction: number;
  };
  readonly convergenceGate: {
    readonly admitted: number;
    readonly errors: number;
    readonly errorRate: number | null;
    readonly ci95: { readonly low: number; readonly high: number } | null;
  };
  readonly decision:
    | 'PASS'
    | 'FAIL'
    | 'INSUFFICIENT_EVIDENCE';
  readonly decisionLine: string;
};

function classifyMismatch(
  midgameBest: ReviewAction,
  exactBestActions: readonly ReviewAction[],
): 'match' | 'same_tile_wrong_end' | 'different_action' {
  const key = canonicalActionKey(midgameBest);
  if (exactBestActions.some((a) => canonicalActionKey(a) === key)) return 'match';
  if (exactBestActions.some((a) => sameTileDifferentEnd(midgameBest, a))) return 'same_tile_wrong_end';
  return 'different_action';
}

/**
 * Precommitted decision rule (Phase F docs): newly admitted exact-action error
 * rate must be ≤ existing-search (coverage-gate) exact-action error rate.
 * Zero newly-admitted or zero existing-admitted → insufficient evidence (not PASS).
 */
export function applyF3DecisionRule(input: {
  readonly newlyAdmittedCount: number;
  readonly newlyAdmittedErrors: number;
  readonly existingAdmittedCount: number;
  readonly existingErrors: number;
}): {
  readonly decision: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
  readonly decisionLine: string;
  readonly newlyAdmittedErrorRate: number | null;
  readonly existingErrorRate: number | null;
} {
  const newlyAdmittedErrorRate = rate(input.newlyAdmittedErrors, input.newlyAdmittedCount);
  const existingErrorRate = rate(input.existingErrors, input.existingAdmittedCount);
  if (
    input.newlyAdmittedCount === 0 ||
    input.existingAdmittedCount === 0 ||
    newlyAdmittedErrorRate === null ||
    existingErrorRate === null
  ) {
    return {
      decision: 'INSUFFICIENT_EVIDENCE',
      decisionLine: 'F3 DECISION: FAIL — retain existing coverage gate',
      newlyAdmittedErrorRate,
      existingErrorRate,
    };
  }
  if (newlyAdmittedErrorRate <= existingErrorRate) {
    return {
      decision: 'PASS',
      decisionLine: 'F3 DECISION: PASS — convergence gate eligible for F3b',
      newlyAdmittedErrorRate,
      existingErrorRate,
    };
  }
  return {
    decision: 'FAIL',
    decisionLine: 'F3 DECISION: FAIL — retain existing coverage gate',
    newlyAdmittedErrorRate,
    existingErrorRate,
  };
}

export function compareGates(overlaps: readonly EvaluatedOverlap[]): GateComparisonReport {
  let flips = 0;
  let existingAdmitted = 0;
  let existingErrors = 0;
  let existingSameTileWrongEnd = 0;
  let existingDifferentAction = 0;
  let convergenceAdmitted = 0;
  let convergenceErrors = 0;
  let newlyAdmitted = 0;
  let newlyAdmittedErrors = 0;
  let newlyAdmittedSameTileWrongEnd = 0;
  let newlyAdmittedDifferentAction = 0;
  let newlyRejected = 0;

  for (const { exactBestKeys, exactBestActions, midgame } of overlaps) {
    const midgameBestKey = canonicalActionKey(midgame.best.action);
    const mismatch = classifyMismatch(midgame.best.action, exactBestActions);
    const disagrees = !exactBestKeys.includes(midgameBestKey);

    const oldPass = passesExistingCoverageGate(midgame.coverage);
    const newPass = passesProposedConvergenceGate({
      coverage: midgame.coverage,
      convergence: midgame.convergence,
    });

    if (oldPass !== newPass) flips += 1;
    if (newPass && !oldPass) {
      newlyAdmitted += 1;
      if (disagrees) {
        newlyAdmittedErrors += 1;
        if (mismatch === 'same_tile_wrong_end') newlyAdmittedSameTileWrongEnd += 1;
        else newlyAdmittedDifferentAction += 1;
      }
    }
    if (oldPass && !newPass) newlyRejected += 1;

    if (oldPass) {
      existingAdmitted += 1;
      if (disagrees) {
        existingErrors += 1;
        if (mismatch === 'same_tile_wrong_end') existingSameTileWrongEnd += 1;
        else existingDifferentAction += 1;
      }
    }
    if (newPass) {
      convergenceAdmitted += 1;
      if (disagrees) convergenceErrors += 1;
    }
  }

  const ruled = applyF3DecisionRule({
    newlyAdmittedCount: newlyAdmitted,
    newlyAdmittedErrors,
    existingAdmittedCount: existingAdmitted,
    existingErrors,
  });

  return {
    totalOverlapCases: overlaps.length,
    flips,
    flipRate: rate(flips, overlaps.length),
    newlyAdmitted: {
      count: newlyAdmitted,
      errors: newlyAdmittedErrors,
      errorRate: ruled.newlyAdmittedErrorRate,
      ci95: wilsonInterval(newlyAdmittedErrors, newlyAdmitted),
      sameTileWrongEnd: newlyAdmittedSameTileWrongEnd,
      differentAction: newlyAdmittedDifferentAction,
    },
    newlyRejected: { count: newlyRejected },
    existingGate: {
      admitted: existingAdmitted,
      errors: existingErrors,
      errorRate: ruled.existingErrorRate,
      ci95: wilsonInterval(existingErrors, existingAdmitted),
      sameTileWrongEnd: existingSameTileWrongEnd,
      differentAction: existingDifferentAction,
    },
    convergenceGate: {
      admitted: convergenceAdmitted,
      errors: convergenceErrors,
      errorRate: rate(convergenceErrors, convergenceAdmitted),
      ci95: wilsonInterval(convergenceErrors, convergenceAdmitted),
    },
    decision: ruled.decision,
    decisionLine: ruled.decisionLine,
  };
}

export type Tier = 'exact' | 'search' | 'heuristic';

function isForced(evaluation: { readonly candidates: readonly unknown[] }): boolean {
  return dedupeCandidatesByTile(evaluation.candidates as never).length === 1;
}

function oldTier(evaluation: ReviewCaptureRecord['evaluation']): Tier {
  return evaluation.evidence.source;
}

function newTierFromRecord(record: ReviewCaptureRecord): Tier {
  const { evaluation } = record;
  if (evaluation.evidence.source === 'exact') return 'exact';
  if (evaluation.convergence === undefined) return 'heuristic';
  const passes = passesProposedConvergenceGate({
    coverage: evaluation.search.coverage,
    convergence: evaluation.convergence,
  });
  return passes ? 'search' : 'heuristic';
}

export type CorpusTierMixReport = {
  readonly totalDecisions: number;
  readonly nonForced: number;
  readonly midgameAttempted: number;
  readonly before: Record<Tier, number>;
  readonly after: Record<Tier, number>;
  readonly newlyAdmitted: number;
  readonly newlyRejected: number;
  readonly flips: number;
  readonly flipRate: number | null;
};

export function readAllCorpusRecords(): ReviewCaptureRecord[] {
  const records: ReviewCaptureRecord[] = [];
  for (const dir of [RECORDED_SELF_PLAY_DIR, RECORDED_CLIENT_POLICY_DIR]) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()) {
      const text = readFileSync(join(dir, file), 'utf8');
      records.push(...deserializeReviewCaptureRecordsFromJsonl(text));
    }
  }
  return records;
}

/** Projected tier mix / flips from stored diagnostics — does not mutate production config. */
export function projectCorpusTierMix(records: readonly ReviewCaptureRecord[]): CorpusTierMixReport {
  let totalDecisions = 0;
  let nonForced = 0;
  let midgameAttempted = 0;
  const before: Record<Tier, number> = { exact: 0, search: 0, heuristic: 0 };
  const after: Record<Tier, number> = { exact: 0, search: 0, heuristic: 0 };
  let newlyAdmitted = 0;
  let newlyRejected = 0;
  let flips = 0;

  for (const record of records) {
    totalDecisions += 1;
    if (isForced(record.evaluation)) continue;
    nonForced += 1;
    if (record.evaluation.convergence !== undefined) midgameAttempted += 1;

    const b = oldTier(record.evaluation);
    const a = newTierFromRecord(record);
    before[b] += 1;
    after[a] += 1;
    if (b !== a) flips += 1;
    if (b === 'heuristic' && a === 'search') newlyAdmitted += 1;
    if (b === 'search' && a === 'heuristic') newlyRejected += 1;
  }

  return {
    totalDecisions,
    nonForced,
    midgameAttempted,
    before,
    after,
    newlyAdmitted,
    newlyRejected,
    flips,
    flipRate: rate(flips, nonForced),
  };
}

export function loadReplayableLockedNonForcedPositions(): {
  readonly positions: RecordedPosition[];
  readonly selfPlayTotal: number;
  readonly clientPolicySkipped: boolean;
  readonly clientPolicySkipReason: string | null;
} {
  const selfPlay = replayRecordedSelfPlay(RECORDED_SELF_PLAY_DIR);
  let clientPolicySkipped = false;
  let clientPolicySkipReason: string | null = null;
  try {
    replayRecordedSelfPlay(RECORDED_CLIENT_POLICY_DIR);
  } catch (error) {
    clientPolicySkipped = true;
    clientPolicySkipReason =
      error instanceof Error
        ? error.message
        : 'recorded-client-policy replay failed (known cursor mismatch)';
  }

  const positions = selfPlay.filter(
    (p) => p.snapshot.preAction.boneyard.drawableCount === 0 && p.snapshot.legalActions.length > 1,
  );
  return {
    positions,
    selfPlayTotal: selfPlay.length,
    clientPolicySkipped,
    clientPolicySkipReason,
  };
}

function pct(rateValue: number | null): string {
  if (rateValue === null) return 'n/a';
  return `${(rateValue * 100).toFixed(2)}%`;
}

function fmtCi(ci: { low: number; high: number } | null): string {
  if (!ci) return 'n/a';
  return `[${(ci.low * 100).toFixed(2)}%, ${(ci.high * 100).toFixed(2)}%]`;
}

export function formatValidationReport(input: {
  readonly overlapMeta: OverlapEvaluationReport;
  readonly comparison: GateComparisonReport;
  readonly tierMix: CorpusTierMixReport;
  readonly replayMeta: ReturnType<typeof loadReplayableLockedNonForcedPositions>;
}): string {
  const { overlapMeta, comparison, tierMix, replayMeta } = input;
  const lines: string[] = [];
  lines.push('# F3a — Convergence coverage-gate validation');
  lines.push('');
  lines.push('Provenance: selective port of `ce2a658c` onto main after #292.');
  lines.push('Proposed thresholds (precommitted, not tuned on this run):');
  lines.push(`- existing coverage gate: \`coverage >= ${EXISTING_COVERAGE_THRESHOLD}\``);
  lines.push(
    `- proposed convergence gate: coverage >= ${PROPOSED_MIN_COVERAGE} AND sameTopAction AND valueDelta <= ${PROPOSED_MAX_CONVERGENCE_VALUE_DELTA}`,
  );
  lines.push('');
  lines.push('## Exact-overlap population (locked yard, both solvers)');
  lines.push('');
  lines.push(`- Recorded self-play decisions replayed: ${replayMeta.selfPlayTotal}`);
  lines.push(
    `- Client-policy snapshot replay: ${
      replayMeta.clientPolicySkipped
        ? `SKIPPED (${replayMeta.clientPolicySkipReason})`
        : 'ok'
    }`,
  );
  lines.push(`- Eligible locked-yard non-forced positions: ${overlapMeta.eligibleLockedNonForced}`);
  lines.push(`- Exact-incomplete excluded: ${overlapMeta.excludedIncompleteExact}`);
  lines.push(`- Exact-infeasible excluded: ${overlapMeta.excludedInfeasibleExact}`);
  lines.push(`- Search-infeasible excluded: ${overlapMeta.excludedInfeasibleSearch}`);
  lines.push(`- Exact-complete validation denominator: ${overlapMeta.results.length}`);
  lines.push('');
  lines.push('Solvers: `solveExactEndgame` (ground truth) + `solveMidgameDeterminization` (deterministic). Fritz not invoked.');
  lines.push('');
  lines.push('| metric | existing gate | convergence / newly admitted |');
  lines.push('| --- | ---: | ---: |');
  lines.push(
    `| exact-complete validation positions | ${comparison.totalOverlapCases} | ${comparison.totalOverlapCases} |`,
  );
  lines.push(
    `| admitted | ${comparison.existingGate.admitted} | newly admitted ${comparison.newlyAdmitted.count} (convergence total ${comparison.convergenceGate.admitted}) |`,
  );
  lines.push(
    `| exact-action errors | ${comparison.existingGate.errors} | ${comparison.newlyAdmitted.errors} |`,
  );
  lines.push(
    `| error rate | ${pct(comparison.existingGate.errorRate)} | ${pct(comparison.newlyAdmitted.errorRate)} |`,
  );
  lines.push(
    `| 95% CI (Wilson) | ${fmtCi(comparison.existingGate.ci95)} | ${fmtCi(comparison.newlyAdmitted.ci95)} |`,
  );
  lines.push('');
  lines.push('Mismatch breakdown (exact-action errors):');
  lines.push(
    `- existing admitted: same-tile/wrong-end ${comparison.existingGate.sameTileWrongEnd}, different action ${comparison.existingGate.differentAction}`,
  );
  lines.push(
    `- newly admitted: same-tile/wrong-end ${comparison.newlyAdmitted.sameTileWrongEnd}, different action ${comparison.newlyAdmitted.differentAction}`,
  );
  lines.push('');
  lines.push('| gate flip | count | percent of exact-complete |');
  lines.push('| --- | ---: | ---: |');
  lines.push(
    `| newly admitted | ${comparison.newlyAdmitted.count} | ${pct(rate(comparison.newlyAdmitted.count, comparison.totalOverlapCases))} |`,
  );
  lines.push(
    `| newly rejected | ${comparison.newlyRejected.count} | ${pct(rate(comparison.newlyRejected.count, comparison.totalOverlapCases))} |`,
  );
  lines.push(
    `| any flip | ${comparison.flips} | ${pct(comparison.flipRate)} |`,
  );
  lines.push('');
  lines.push('## Projected corpus tier mix (100-game recorded evaluations)');
  lines.push('');
  lines.push('Measurement only — production dispatch unchanged.');
  lines.push('');
  lines.push(`- Total recorded decisions: ${tierMix.totalDecisions}`);
  lines.push(`- Non-forced: ${tierMix.nonForced}`);
  lines.push(`- Midgame-attempted (has convergence diagnostic): ${tierMix.midgameAttempted}`);
  lines.push(`- Corpus flips (non-forced): ${tierMix.flips} (${pct(tierMix.flipRate)})`);
  lines.push(`- Corpus newly admitted (heuristic→search): ${tierMix.newlyAdmitted}`);
  lines.push(`- Corpus newly rejected (search→heuristic): ${tierMix.newlyRejected}`);
  lines.push('');
  lines.push('| tier | before (existing gate) | after (projected convergence) |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| exact | ${tierMix.before.exact} | ${tierMix.after.exact} |`);
  lines.push(`| search | ${tierMix.before.search} | ${tierMix.after.search} |`);
  lines.push(`| heuristic | ${tierMix.before.heuristic} | ${tierMix.after.heuristic} |`);
  lines.push('');
  lines.push('## Decision rule');
  lines.push('');
  lines.push(
    'PASS iff newly_admitted_error_rate ≤ existing_search_error_rate on exact-complete overlap; otherwise FAIL. Inconclusive samples are FAIL.',
  );
  lines.push('');
  lines.push(comparison.decisionLine);
  lines.push('');
  lines.push(`Internal classification: \`${comparison.decision}\`.`);
  lines.push('');
  lines.push('No production gate, `accuracyModelVersion`, `MINIMUM_COVERAGE_FLOOR`, or calibration changed.');
  lines.push('');
  return lines.join('\n');
}

export function runCanonicalStudy(): {
  readonly overlapMeta: OverlapEvaluationReport;
  readonly comparison: GateComparisonReport;
  readonly tierMix: CorpusTierMixReport;
  readonly replayMeta: ReturnType<typeof loadReplayableLockedNonForcedPositions>;
  readonly markdown: string;
} {
  const replayMeta = loadReplayableLockedNonForcedPositions();
  const overlapMeta = evaluateOverlaps(
    replayMeta.positions.map((p) => ({
      snapshot: p.snapshot,
      decisionId: p.evaluation.snapshotId,
    })),
  );
  const comparison = compareGates(overlapMeta.results);
  const tierMix = projectCorpusTierMix(readAllCorpusRecords());
  const markdown = formatValidationReport({ overlapMeta, comparison, tierMix, replayMeta });
  return { overlapMeta, comparison, tierMix, replayMeta, markdown };
}

function main(): void {
  const study = runCanonicalStudy();
  writeFileSync(REPORT_PATH, study.markdown, 'utf8');
  console.error(study.markdown);
  console.log(
    JSON.stringify(
      {
        exactCompleteDenominator: study.overlapMeta.results.length,
        exclusions: {
          eligibleLockedNonForced: study.overlapMeta.eligibleLockedNonForced,
          excludedIncompleteExact: study.overlapMeta.excludedIncompleteExact,
          excludedInfeasibleExact: study.overlapMeta.excludedInfeasibleExact,
          excludedInfeasibleSearch: study.overlapMeta.excludedInfeasibleSearch,
        },
        comparison: study.comparison,
        tierMix: study.tierMix,
        clientPolicySkipped: study.replayMeta.clientPolicySkipped,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith('validateMidgameConvergenceGate.ts')) {
  main();
}
