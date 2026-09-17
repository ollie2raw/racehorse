/**
 * C2a-2 (docs/scoping/phase-c-accuracy-model-spec.md, section 5 gap check):
 * closes the largest remaining fixture-category gap -- "strong policy /
 * top-tier self-play" and "ordinary PVF-tier play" had zero representation
 * because no recorded-log ingestion path existed. This script plays out N
 * complete deterministic games of bot-vs-bot self-play, runs every real
 * decision point (both players, not just one seat -- the same "capture both
 * actors from day one" decision this doc already locked for live capture)
 * through the REAL evaluateReviewPosition dispatcher, and writes the
 * resulting ReviewEvaluationV1 records to disk as JSONL.
 *
 * Tier and architecture note: this uses FritzTier ('rookie'|'standard'|
 * 'elite'|'master', packages/game-core/src/fritzPolicy.ts) and its pure,
 * GameState-native chooseOfficialFritzDecision -- NOT client's BotDifficulty
 * ('casual'|'standard'|'hard'|'master', client/src/modules/fritz/
 * botHeuristics.ts). review-engine cannot depend on client code (the same
 * boundary C1 already hit with dedupeCandidatesByTile), and BotDifficulty's
 * own move-selection (chooseBotMove) operates on BotMatchState, a
 * client-only match representation with no GameState equivalent --
 * reachable only from client, not from this package. chooseOfficialFritzDecision
 * is the one bot decision-maker review-engine can reach without an
 * architecture violation: it is the same real, already-shipped bot policy
 * used elsewhere in the app (Daily Fritz), not a new or weaker stand-in.
 * 'master' stands in for "strong policy / top-tier"; 'standard' for
 * "ordinary" play -- see batchTagForTier below, which tags every output
 * record with which of C0's two categories it belongs to.
 *
 * This is a manually-invoked script -- not wired into CI, not part of any
 * test suite, not run automatically. Invoke directly, e.g.:
 *
 *   npx tsx packages/review-engine/src/devtools/recordSelfPlayCorpus.ts \
 *     --games 5 --tier master --seed demo-master-1
 *
 * or, from within packages/review-engine:
 *
 *   npm run record:self-play -- --games 5 --tier master --seed demo-master-1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  createInitialState,
  DEFAULT_CONFIG,
  generateFullSet,
  getOpenEnds,
  shuffleDeterministically,
  startNewHand,
  type FritzTier,
  type GameCommand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import {
  createReviewPositionSnapshotV2,
  type ReviewEvaluationV1,
  type ReviewKnownMissingPipEvidence,
} from '@racehorse/game-core/review';
import { evaluateReviewPosition, type ReviewDispatchBudget } from '../evaluateReviewPosition';

// __dirname is not available in a pure-ESM module; this file is invoked
// directly (tsx) and imported by tests, both of which give import.meta.url
// its real, expected value, so this needs no __dirname shim.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const FRITZ_TIERS: readonly FritzTier[] = ['rookie', 'standard', 'elite', 'master'];

/**
 * Same realistic budget used throughout this package's own tests
 * (evaluateReviewPosition.test.ts) -- keeps self-play evaluations
 * comparable to every other evaluation this package already produces.
 */
export const SELF_PLAY_REALISTIC_BUDGET: ReviewDispatchBudget = {
  maxNodes: 200_000,
  maxHiddenStateSamples: 100,
  maxPlyDepth: 2,
  seed: 'self-play-corpus',
};
export const SELF_PLAY_COVERAGE_THRESHOLD = 0.02;

/**
 * Bump manually whenever this harness's capture behavior changes (what gets
 * recorded, how evidence is filtered, how hands are dealt/redealt) -- not
 * when only cosmetic/refactor changes land. Recorded on every row so a
 * consumer reading a JSONL file in isolation (split, merged, or streamed
 * away from its manifest) still knows which capture semantics produced it.
 */
export const SELF_PLAY_HARNESS_VERSION = 'self-play-harness-v1';

/**
 * Identifies the decision-making policy used to generate a batch, so a
 * future second capture path (a different policy entirely, not just a
 * different FritzTier) is distinguishable at the row level rather than
 * inferred from `tier` -- `tier` alone can't disambiguate "chooseOfficialFritzDecision
 * at this tier" from some other policy that happens to reuse the same tier
 * name.
 */
export const SELF_PLAY_POLICY_ID = 'official-fritz';

export type SelfPlayBatchTag = 'strong-policy-top-tier' | 'ordinary-pvf-tier' | `other-tier-${FritzTier}`;

/**
 * Maps a FritzTier onto C0's own two named categories, so a downstream
 * consumer (C2b) can tell which category a batch belongs to purely from its
 * tag -- no need to know which CLI arguments produced a given file.
 */
export function batchTagForTier(tier: FritzTier): SelfPlayBatchTag {
  if (tier === 'master') return 'strong-policy-top-tier';
  if (tier === 'standard') return 'ordinary-pvf-tier';
  return `other-tier-${tier}`;
}

/**
 * Per-record provenance. Deliberately excludes anything that would vary
 * between two runs of the same seed (a wall-clock timestamp, a git SHA) --
 * that would break the byte-identical determinism this harness's own test
 * suite asserts. Run-level, non-deterministic provenance (generatedAt) lives
 * only in the sidecar manifest (see SelfPlayCaptureManifest below), not here.
 */
export type RecordedSelfPlayEvaluation = {
  readonly batchTag: SelfPlayBatchTag;
  readonly harnessVersion: string;
  readonly policyId: string;
  readonly tier: FritzTier;
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
 */
export type SelfPlayCaptureManifest = {
  readonly batchTag: SelfPlayBatchTag;
  readonly harnessVersion: string;
  readonly policyId: string;
  readonly tier: FritzTier;
  readonly seed: string;
  readonly gameCount: number;
  readonly budget: ReviewDispatchBudget;
  readonly coverageThreshold: number;
  readonly recordedDecisions: number;
  readonly nonHeuristicDecisions: number;
  readonly elapsedMs: number;
  readonly generatedAt: string;
};

export type SelfPlayCorpusOptions = {
  readonly gameCount: number;
  readonly tier: FritzTier;
  readonly seed: string;
  /** Safety cap against a non-terminating game; not expected to bind in practice. */
  readonly maxActionsPerGame?: number;
};

function dealDeckForHand(handSeed: string): Tile[] {
  return shuffleDeterministically(generateFullSet(DEFAULT_CONFIG.maxPips), createDeterministicRandom(handSeed));
}

/**
 * Same pattern reviewFixtureCorpus.ts's chooseFixtureCommand /
 * recordMissingPipEvidence already use: a pass/draw on the open ends
 * reveals which pips that actor cannot hold, recorded so the OTHER player's
 * later snapshots can honestly include it. Duplicated here (not imported)
 * because reviewFixtureCorpus.ts's own version is a private, unexported
 * helper local to that file's fixture-building concern.
 */
function recordMissingPipEvidence(
  state: GameState,
  command: GameCommand,
  evidence: ReviewKnownMissingPipEvidence[],
): void {
  if (command.kind !== 'draw' && command.kind !== 'pass') return;
  const openEnds = getOpenEnds(state.board).map((end) => end.matchValue);
  for (const pip of new Set(openEnds)) {
    evidence.push({
      opponentId: command.actorId,
      pip,
      reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end',
      observedHandNumber: state.handNumber,
      observedSequence: state.sequence,
      openEnds,
    });
  }
}

/**
 * Plays `options.gameCount` complete deterministic games of the given
 * FritzTier against itself, capturing a real ReviewEvaluationV1 (via the
 * actual evaluateReviewPosition dispatcher -- no mocks, no stub solver) at
 * every real decision point, for both players.
 */
export function runSelfPlayCorpus(options: SelfPlayCorpusOptions): RecordedSelfPlayEvaluation[] {
  const records: RecordedSelfPlayEvaluation[] = [];
  const batchTag = batchTagForTier(options.tier);
  const maxActionsPerGame = options.maxActionsPerGame ?? 4_000;

  for (let gameIndex = 0; gameIndex < options.gameCount; gameIndex += 1) {
    let state: GameState = createInitialState(['player', 'opponent'], DEFAULT_CONFIG);
    state = startNewHand(state, dealDeckForHand(`${options.seed}:game${gameIndex}:hand1`));
    let evidence: ReviewKnownMissingPipEvidence[] = [];
    let moveNumber = 0;

    for (let actionIndex = 0; actionIndex < maxActionsPerGame && !state.gameOver; actionIndex += 1) {
      if (state.handOver) {
        state = startNewHand(state, dealDeckForHand(`${options.seed}:game${gameIndex}:hand${state.handNumber + 1}`));
        evidence = [];
        continue;
      }

      const actorId = state.playerIds[state.currentPlayerIndex];
      const opponentId = state.playerIds.find((id) => id !== actorId)!;
      const decision = chooseOfficialFritzDecision({ state, participantId: actorId, tier: options.tier });
      const command: GameCommand = decision.kind === 'play'
        ? {
            version: 1,
            commandId: `self-play:${options.seed}:${gameIndex}:${actionIndex}`,
            sequence: state.sequence,
            actorId,
            kind: 'play',
            tile: decision.tile,
            position: decision.position,
          }
        : {
            version: 1,
            commandId: `self-play:${options.seed}:${gameIndex}:${actionIndex}`,
            sequence: state.sequence,
            actorId,
            kind: decision.kind,
          };

      moveNumber += 1;
      const snapshot = createReviewPositionSnapshotV2({
        authorityPreState: state,
        command,
        identifiers: {
          sessionId: `self-play:${options.seed}:${gameIndex}`,
          gameId: `self-play:${options.seed}:${gameIndex}`,
          handId: `self-play:${options.seed}:${gameIndex}:hand-${state.handNumber}`,
          decisionId: `self-play:${options.seed}:${gameIndex}:move-${moveNumber}`,
          mode: 'fixture',
          gameNumber: 1,
          actionNumber: moveNumber,
        },
        knownMissingPipEvidence: evidence.filter((item) => item.opponentId === opponentId),
      });

      const evaluation = evaluateReviewPosition(snapshot, SELF_PLAY_REALISTIC_BUDGET, SELF_PLAY_COVERAGE_THRESHOLD);
      records.push({
        batchTag,
        harnessVersion: SELF_PLAY_HARNESS_VERSION,
        policyId: SELF_PLAY_POLICY_ID,
        tier: options.tier,
        seed: options.seed,
        gameIndex,
        handNumber: state.handNumber,
        moveNumber,
        actorId,
        budget: SELF_PLAY_REALISTIC_BUDGET,
        coverageThreshold: SELF_PLAY_COVERAGE_THRESHOLD,
        evaluation,
      });

      recordMissingPipEvidence(state, command, evidence);
      state = applyGameCommand(state, command).state;
    }

    if (!state.gameOver) {
      throw new Error(
        `self-play game ${gameIndex} (tier=${options.tier}, seed=${options.seed}) did not reach gameOver within ${maxActionsPerGame} actions.`,
      );
    }
  }

  return records;
}

/** One ReviewEvaluationV1 record per line -- trailing newline only when non-empty. */
export function serializeSelfPlayRecordsToJsonl(records: readonly RecordedSelfPlayEvaluation[]): string {
  if (records.length === 0) return '';
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

export function deserializeSelfPlayRecordsFromJsonl(jsonl: string): RecordedSelfPlayEvaluation[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedSelfPlayEvaluation);
}

type CliOptions = SelfPlayCorpusOptions & { readonly outDir: string };

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const raw = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    raw.set(arg.slice(2), argv[index + 1]);
    index += 1;
  }

  const gameCountRaw = raw.get('games') ?? '10';
  const gameCount = Number(gameCountRaw);
  if (!Number.isInteger(gameCount) || gameCount <= 0) {
    throw new Error(`--games must be a positive integer, got "${gameCountRaw}".`);
  }

  const tier = (raw.get('tier') ?? 'standard') as FritzTier;
  if (!FRITZ_TIERS.includes(tier)) {
    throw new Error(`--tier must be one of ${FRITZ_TIERS.join('|')}, got "${tier}".`);
  }

  const seed = raw.get('seed') ?? 'self-play-default-seed';
  const outDir = raw.get('out') ?? join(SCRIPT_DIR, '..', '..', 'fixtures', 'recorded-self-play');

  return { gameCount, tier, seed, outDir };
}

function baseFileName(options: CliOptions): string {
  const batchTag = batchTagForTier(options.tier);
  return `${batchTag}--tier-${options.tier}--seed-${options.seed}--games-${options.gameCount}`;
}

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const records = runSelfPlayCorpus(options);
  mkdirSync(options.outDir, { recursive: true });

  const base = baseFileName(options);
  const outPath = join(options.outDir, `${base}.jsonl`);
  const manifestPath = join(options.outDir, `${base}.manifest.json`);
  writeFileSync(outPath, serializeSelfPlayRecordsToJsonl(records), 'utf8');

  const scorableCount = records.filter(
    (record) => record.evaluation.evidence.source !== 'heuristic',
  ).length;
  const elapsedMs = Date.now() - startedAt;

  const manifest: SelfPlayCaptureManifest = {
    batchTag: batchTagForTier(options.tier),
    harnessVersion: SELF_PLAY_HARNESS_VERSION,
    policyId: SELF_PLAY_POLICY_ID,
    tier: options.tier,
    seed: options.seed,
    gameCount: options.gameCount,
    budget: SELF_PLAY_REALISTIC_BUDGET,
    coverageThreshold: SELF_PLAY_COVERAGE_THRESHOLD,
    recordedDecisions: records.length,
    nonHeuristicDecisions: scorableCount,
    elapsedMs,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ...manifest, outPath, manifestPath }, null, 2));
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
