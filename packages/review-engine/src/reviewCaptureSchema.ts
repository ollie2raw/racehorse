import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from './evaluateReviewPosition';

/**
 * C2a-3 extraction: the framework-neutral capture shape shared by every
 * ReviewEvaluationV1-recording harness (C2a-2's chooseOfficialFritzDecision
 * self-play, C2a-3's client chooseBotMove capture, and whatever comes
 * after). Deliberately contains zero node: imports -- this must be
 * importable from both a Node-side devtools script (packages/review-engine)
 * and a browser-side devtools script (client/src/devtools), and INV-20
 * (client/scripts/checkArchitectureInvariants.ts) fails any
 * packages/review-engine/src file outside src/devtools/ that imports one.
 * If path/fs-style logic is ever needed here, that is a sign it belongs in
 * each producer script instead, not in this file.
 */

export type ReviewCaptureBatchTag =
  | 'strong-policy-top-tier'
  | 'ordinary-pvf-tier'
  | `other-tier-${string}`;

/**
 * corpusKind is the coarse "is this trustworthy for calibration" signal;
 * policyId is the finer "which exact policy produced it" signal. Keep both
 * -- do not collapse them into one field.
 *
 * 'synthetic-baseline': a fully deterministic policy with no opponent
 * modeling (chooseOfficialFritzDecision, C2a-2). Real per the definition of
 * "real" the whole review pipeline uses (a real evaluateReviewPosition call
 * against a real position), but not representative of what a player
 * actually faces -- confirmed structurally different from chooseBotMove
 * (one-ply deterministic formula vs. multi-ply Monte Carlo search with
 * tier-specific weights and built-in randomized suboptimality; see the
 * PR #250 fidelity finding). Useful for validating the calibration MATH
 * against controllable, hand-verifiable ground truth -- not for validating
 * a calibration RESULT against real play. C2b must not treat this as its
 * production input.
 *
 * 'client-policy': the real chooseBotMove policy a player actually faces in
 * a live match (C2a-3). This is the corpus C2b calibrates against.
 */
export type ReviewCaptureCorpusKind = 'synthetic-baseline' | 'client-policy';

/**
 * Per-record provenance. Deliberately excludes anything that would vary
 * between two runs of the same seed (a wall-clock timestamp, a git SHA) --
 * that would break the byte-identical determinism every producer's own
 * test suite asserts. Run-level, non-deterministic provenance (generatedAt)
 * lives only in the sidecar manifest (ReviewCaptureManifest below), never
 * on individual records.
 */
export type ReviewCaptureRecord = {
  readonly batchTag: ReviewCaptureBatchTag;
  readonly corpusKind: ReviewCaptureCorpusKind;
  readonly harnessVersion: string;
  readonly policyId: string;
  readonly tier: string;
  readonly seed: string;
  readonly gameIndex: number;
  readonly handNumber: number;
  readonly moveNumber: number;
  readonly actorId: string;
  readonly budget: ReviewDispatchBudget;
  readonly coverageThreshold: number;
  readonly evaluation: ReviewEvaluationV1;
};

/**
 * Run-level provenance written once per JSONL file, alongside it (same base
 * filename, .manifest.json). generatedAt and any future non-deterministic
 * field belong here, never on individual records.
 *
 * `reproducible`: whether re-running this exact seed/tier/gameCount is
 * guaranteed to reproduce this file byte-for-byte. This is a run-level fact
 * about the TIER/POLICY, not a per-decision fact, which is why it lives here
 * and not on ReviewCaptureRecord (same category as generatedAt). C2a-3
 * (2026-09-17) found this is not always true: chooseBotMove's 'hard' and
 * 'master' BotDifficulty tiers pass through code gated by real wall-clock
 * deadlines (performance.now()), not node/iteration budgets, so the actual
 * search depth -- and therefore the move chosen -- can depend on real
 * execution speed, not just game state. Each producer computes this via its
 * own tier-specific logic (e.g. client/src/devtools/
 * recordClientPolicyCorpus.ts's isTimingSensitiveBotDifficulty) rather than
 * a literal true/false at each manifest call site, so the reasoning for
 * "reproducible or not" lives in one place per producer.
 */
export type ReviewCaptureManifest = {
  readonly batchTag: ReviewCaptureBatchTag;
  readonly corpusKind: ReviewCaptureCorpusKind;
  readonly harnessVersion: string;
  readonly policyId: string;
  readonly tier: string;
  readonly seed: string;
  readonly gameCount: number;
  readonly budget: ReviewDispatchBudget;
  readonly coverageThreshold: number;
  readonly recordedDecisions: number;
  readonly nonHeuristicDecisions: number;
  readonly elapsedMs: number;
  readonly generatedAt: string;
  readonly reproducible: boolean;
};

/** One ReviewCaptureRecord per line -- trailing newline only when non-empty. */
export function serializeReviewCaptureRecordsToJsonl(
  records: readonly ReviewCaptureRecord[],
): string {
  if (records.length === 0) return '';
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

export function deserializeReviewCaptureRecordsFromJsonl(
  jsonl: string,
): ReviewCaptureRecord[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ReviewCaptureRecord);
}
