/**
 * C2a-3 (docs/scoping/phase-c-accuracy-model-spec.md, section 5 gap check):
 * C2a-2 built a self-play harness against chooseOfficialFritzDecision --
 * confirmed (PR #250 report, 2026-09-17) to be a different, simpler policy
 * than what players actually face: a one-ply deterministic formula with no
 * opponent modeling, versus chooseBotMove's multi-ply Monte Carlo search
 * with tier-specific weights and built-in randomized suboptimality. This
 * script closes that gap: the same capture shape, driven by the REAL
 * chooseBotMove policy from client/src/modules/fritz/botHeuristics.ts, so
 * C2b calibrates against an opponent players have actually played.
 *
 * Game-driving pattern reused from client/src/devtools/tierFixtureCompare.ts
 * and tierPhilosophyAudit.ts (both already drive chooseBotMove end-to-end
 * over BotMatchState). createStatePrng (botHeuristics.ts) seeds every
 * stochastic branch inside chooseBotMove -- tier-select randomized
 * suboptimality, Monte Carlo opponent-hand sampling, minimax/master-endgame
 * randomization -- purely from the current game state, never from
 * Math.random() or an external RNG stream. That means replaying an
 * identical sequence of states always reproduces identical stochastic
 * choices: this harness only needs to pin the deal at each hand (via a
 * seeded deck, the same determinism mechanism C2a-2 already used), and
 * everything chooseBotMove itself decides downstream is already pinned by
 * the resulting state. No per-decision seed threading was needed.
 *
 * BotMatchState -> ReviewPositionSnapshotV2 conversion REUSES the existing,
 * already-shipped live-capture path -- captureReviewSnapshotAtDecision
 * (client/src/modules/review/captureReviewSnapshotAtDecision.ts), which
 * itself projects through toCoreGameState (gameCoreAdapter.ts) -- rather
 * than writing a new converter. This is the same function GameReviewer's
 * real PVF capture uses. No new conversion code was written for this item.
 *
 * Tier-to-category mapping, checked against botHeuristics.ts's own
 * semantics rather than assumed: TIER_LABEL in tierPhilosophyAudit.ts maps
 * casual->Rookie, standard->Standard, hard->Elite, master->Master --
 * confirming master is genuinely the strongest tier and standard the
 * middle one, so C0's mapping (master -> strong-policy-top-tier, standard
 * -> ordinary-pvf-tier) still holds for this BotDifficulty enum too.
 *
 * This is a manually-invoked script -- not wired into CI, not part of any
 * test suite, not run automatically, no UI. Invoke directly, e.g.:
 *
 *   npx tsx client/src/devtools/recordClientPolicyCorpus.ts \
 *     --games 5 --tier master --seed demo-client-policy-master-1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canDraw, createDeterministicDoubleSixDeal, type GameCommand } from '@racehorse/game-core';
import {
  evaluateReviewPosition,
  serializeReviewCaptureRecordsToJsonl,
  deserializeReviewCaptureRecordsFromJsonl,
  type ReviewCaptureBatchTag,
  type ReviewCaptureManifest,
  type ReviewCaptureRecord,
} from '@racehorse/review-engine';
import {
  chooseBotMove,
  toBotVisibleState,
  type BotDifficulty,
} from '../modules/fritz/botHeuristics.ts';
import {
  applyPlayMove,
  createFixedBotMatch,
  drawOne,
  getLegalMoves,
  passTurn,
  startNextFixedBotHand,
  type BotHandDeal,
  type BotMatchState,
  type BotPlayerId,
} from '../modules/match/runtime/botEngine.ts';
import { toCoreGameState } from '../modules/match/runtime/gameCoreAdapter.ts';
import { captureReviewSnapshotAtDecision } from '../modules/review/captureReviewSnapshotAtDecision.ts';
import {
  DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  DEFAULT_REVIEW_DISPATCH_BUDGET,
} from '../modules/review/reviewEngineConfig.ts';
import { observeActorDrawPastOpenEnds, observeActorPassOnOpenEnds } from '../modules/review/missingPipEvidenceAccumulate.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['casual', 'standard', 'hard', 'master'];

/**
 * Names WHICH of the four structurally different tier formulas produced a
 * row -- chooseBotMove is not one formula with four weight sets, it is four
 * different code paths (see botHeuristics.ts):
 *  - casual: flat immediate*10 + unload, then a seeded tier-select that can
 *    pick a uniformly random legal move instead (TIER_SELECT.casual.pRandom > 0).
 *  - standard: immediate*60 + selfOpportunity*10 - threat*8 + mobility*5 +
 *    unload*0.5, deterministic top pick (TIER_SELECT.standard.pRandom === 0).
 *  - hard: evaluateStrategicMove blended with mcEvaluateMove (MC_SAMPLES = 8
 *    hidden-hand samples, mcBlend 0.35).
 *  - master: the same strategic+MC blend but with 20 samples and mcBlend
 *    0.45 in general, EXCEPT when totalTiles <= 12 (masterEndgameThreshold),
 *    where it switches to a sampled-opponent-hand minimax search instead.
 * These identifiers are this harness's own descriptive naming -- chooseBotMove
 * does not self-report a policy id -- chosen so a downstream reader can tell
 * "which of the four" at a glance without re-reading botHeuristics.ts.
 */
const CLIENT_POLICY_ID_BY_TIER: Record<BotDifficulty, string> = {
  casual: 'client-bot-v1-casual-flat-immediate-unload-randomized',
  standard: 'client-bot-v1-standard-weighted-heuristic-deterministic',
  hard: 'client-bot-v1-hard-strategic-plus-mc8-blend035',
  master: 'client-bot-v1-master-strategic-plus-mc20-blend045-endgame-minimax-le12tiles',
};

/**
 * Bump manually whenever this harness's capture behavior changes -- not on
 * cosmetic/refactor changes. Recorded on every row so a consumer reading a
 * JSONL file in isolation still knows which capture semantics produced it.
 */
export const CLIENT_POLICY_HARNESS_VERSION = 'client-policy-harness-v1';

/**
 * This harness produces the pvf-bot-match corpus kind -- chooseBotMove is
 * the real policy a player actually faces in a live Play vs Fritz match, so
 * this is real production data representing a real mode, on equal footing
 * with recordSelfPlayCorpus.ts's daily-fritz-master corpus (see
 * reviewCaptureSchema.ts's ReviewCaptureCorpusKind doc).
 */
const CLIENT_POLICY_CORPUS_KIND = 'pvf-bot-match' as const;

/**
 * C2a-3 finding (2026-09-17): 'hard' and 'master' both pass through
 * botHeuristics.ts's shared "Hard/Master" scoring block, which searches
 * `searchExactTurnChain` under a REAL wall-clock deadline
 * (`EXACT_CHAIN_BUDGET_MS`, not a node/iteration budget) once
 * `totalTiles <= 16`. 'master' additionally has its own endgame-only
 * wall-clock budget (`MASTER_ENDGAME_BUDGET_MS`) once `totalTiles <= 12`,
 * gating a sampled-opponent-hand minimax search. Both mean the actual
 * search depth reached -- and therefore the move chosen -- can depend on
 * real execution speed at the moment the search runs, not just on game
 * state, unlike every other decision-maker this project's capture
 * harnesses use ('casual'/'standard' here, and chooseOfficialFritzDecision
 * in recordSelfPlayCorpus.ts), which are seeded purely from
 * createStatePrng(state, label) and are therefore fully reproducible.
 *
 * Confirmed empirically, not just inferred from reading the code: two
 * identically-seeded runClientPolicyCorpus runs at 'master' (seed
 * "master-determinism-seed", 1 game) diverged mid-game (hand 7, ~move 148
 * vs ~move 155 -- a real trajectory difference, not a metadata artifact).
 * The same two-run comparison at 'hard' (two different seeds, one and three
 * games) came back byte-identical both times in practice -- but 'hard'
 * shares the exact same wall-clock-gated code path as 'master' (only the
 * budget constant and threshold differ), so the absence of observed
 * divergence in a small sample is not proof of determinism, and 'hard' is
 * treated as timing-sensitive too.
 *
 * This is a real property of the shipped, player-facing bot -- not
 * something this harness can or should paper over by, say, monkey-patching
 * performance.now(). No production code changed here (out of scope for
 * C2a-3); a future budget -> node-count conversion in botHeuristics.ts
 * would make 'master'/'hard' reproducible for players too, not just for
 * this harness, but that is a separate, later conversation.
 */
export function isTimingSensitiveBotDifficulty(tier: BotDifficulty): boolean {
  return tier === 'hard' || tier === 'master';
}

/**
 * Maps a BotDifficulty onto C0's own two named categories, checked (not
 * assumed) against botHeuristics.ts's own tier semantics -- see the module
 * doc comment above.
 */
export function batchTagForBotDifficulty(tier: BotDifficulty): ReviewCaptureBatchTag {
  if (tier === 'master') return 'strong-policy-top-tier';
  if (tier === 'standard') return 'ordinary-pvf-tier';
  return `other-tier-${tier}`;
}

export type ClientPolicyCorpusOptions = {
  readonly gameCount: number;
  readonly tier: BotDifficulty;
  readonly seed: string;
  /** Safety cap against a non-terminating game; not expected to bind in practice. */
  readonly maxActionsPerGame?: number;
};

/**
 * Deterministic per-hand deal, same mechanism botEngine.ts's own (private)
 * dealFromRankedSeed uses -- createDeterministicDoubleSixDeal, game-core's
 * seeded shuffle -- reconstructed here rather than imported since that
 * helper is private to botEngine.ts and this is a small, self-contained
 * wrapper, not core game logic.
 */
function dealForHand(seed: string, handNumber: number): BotHandDeal {
  const dealt = createDeterministicDoubleSixDeal({ seed: `${seed}:h${handNumber}`, tilesPerPlayer: 7, deadTileCount: 2 });
  return {
    player_tiles: dealt.playerTiles.map((tile) => ({ ...tile })),
    fritz_tiles: dealt.opponentTiles.map((tile) => ({ ...tile })),
    boneyard: dealt.boneyard.map((tile) => ({ ...tile })),
    locked: dealt.deadTiles.map((tile) => ({ ...tile })),
  };
}

/**
 * chooseBotMove always evaluates from "bot"'s own seat (BotVisibleState
 * assumes currentPlayer === 'bot' internally). When the real actor is
 * "you", the established pattern (tierPhilosophyAudit.ts's runPairedH2H /
 * collectStatesFromMatch) is to swap the two seats before building the
 * visible state, then apply the resulting move back onto the real state
 * under the real actor id.
 */
function chooseMoveForActor(state: BotMatchState, actor: BotPlayerId, tier: BotDifficulty) {
  const perspective: BotMatchState = actor === 'bot'
    ? state
    : {
        ...state,
        players: { bot: state.players.you, you: state.players.bot },
        currentPlayer: 'bot',
      };
  return chooseBotMove(toBotVisibleState(perspective), tier);
}

/**
 * Plays `options.gameCount` complete deterministic games of the given
 * BotDifficulty tier against itself, capturing a real ReviewEvaluationV1
 * (via the actual evaluateReviewPosition dispatcher -- no mocks, no stub
 * solver) at every real decision point, for both seats.
 */
export function runClientPolicyCorpus(options: ClientPolicyCorpusOptions): ReviewCaptureRecord[] {
  const records: ReviewCaptureRecord[] = [];
  const batchTag = batchTagForBotDifficulty(options.tier);
  const policyId = CLIENT_POLICY_ID_BY_TIER[options.tier];
  const maxActionsPerGame = options.maxActionsPerGame ?? 4_000;

  for (let gameIndex = 0; gameIndex < options.gameCount; gameIndex += 1) {
    let state: BotMatchState = createFixedBotMatch(dealForHand(`${options.seed}:game${gameIndex}`, 1));
    let moveNumber = 0;

    for (let actionIndex = 0; actionIndex < maxActionsPerGame && !state.gameOver; actionIndex += 1) {
      if (state.handOver) {
        state = startNextFixedBotHand(state, dealForHand(`${options.seed}:game${gameIndex}`, state.handNumber + 1));
        continue;
      }

      const actor = state.currentPlayer;
      const playMoves = getLegalMoves(state, actor).filter((move) => move.type === 'play');

      let decisionPreState: BotMatchState = state;
      let command: GameCommand;

      if (playMoves.length > 0) {
        const choice = chooseMoveForActor(state, actor, options.tier);
        if (!choice?.move?.tile || !choice.move.position) {
          throw new Error(
            `chooseBotMove returned no move despite ${playMoves.length} legal play(s) -- ` +
            `game ${gameIndex}, hand ${state.handNumber}, tier ${options.tier}.`,
          );
        }
        command = {
          version: 1,
          commandId: `client-policy:${options.seed}:${gameIndex}:${actionIndex}`,
          sequence: state.turnIndex ?? 0,
          actorId: actor,
          kind: 'play',
          tile: choice.move.tile,
          position: choice.move.position,
        };
      } else {
        const core = toCoreGameState(state);
        if (canDraw(core, actor)) {
          decisionPreState = observeActorDrawPastOpenEnds(state, actor);
          command = {
            version: 1,
            commandId: `client-policy:${options.seed}:${gameIndex}:${actionIndex}`,
            sequence: state.turnIndex ?? 0,
            actorId: actor,
            kind: 'draw',
          };
        } else {
          decisionPreState = observeActorPassOnOpenEnds(state, actor);
          command = {
            version: 1,
            commandId: `client-policy:${options.seed}:${gameIndex}:${actionIndex}`,
            sequence: state.turnIndex ?? 0,
            actorId: actor,
            kind: 'pass',
          };
        }
      }

      moveNumber += 1;
      const snapshot = captureReviewSnapshotAtDecision({
        preState: decisionPreState,
        command,
        identifiers: {
          sessionId: `client-policy:${options.seed}:${gameIndex}`,
          gameId: `client-policy:${options.seed}:${gameIndex}`,
          handId: `client-policy:${options.seed}:${gameIndex}:hand-${state.handNumber}`,
          decisionId: `client-policy:${options.seed}:${gameIndex}:move-${moveNumber}`,
          mode: 'fixture',
          gameNumber: 1,
          actionNumber: moveNumber,
        },
      });

      const evaluation = evaluateReviewPosition(
        snapshot,
        DEFAULT_REVIEW_DISPATCH_BUDGET,
        DEFAULT_REVIEW_COVERAGE_THRESHOLD,
      );
      records.push({
        batchTag,
        corpusKind: CLIENT_POLICY_CORPUS_KIND,
        harnessVersion: CLIENT_POLICY_HARNESS_VERSION,
        policyId,
        tier: options.tier,
        seed: options.seed,
        gameIndex,
        handNumber: state.handNumber,
        moveNumber,
        actorId: actor,
        budget: DEFAULT_REVIEW_DISPATCH_BUDGET,
        coverageThreshold: DEFAULT_REVIEW_COVERAGE_THRESHOLD,
        evaluation,
      });

      if (command.kind === 'play') {
        state = applyPlayMove(decisionPreState, actor, { type: 'play', tile: command.tile, position: command.position }).state;
      } else if (command.kind === 'draw') {
        state = drawOne(decisionPreState, actor).state;
      } else {
        state = passTurn(decisionPreState, actor).state;
      }
    }

    if (!state.gameOver) {
      throw new Error(
        `client-policy game ${gameIndex} (tier=${options.tier}, seed=${options.seed}) did not reach gameOver within ${maxActionsPerGame} actions.`,
      );
    }
  }

  return records;
}

// Re-exported so this script's own CLI/tests share the identical shared
// serialization implementation review-engine's producers use, without
// duplicating it.
export {
  serializeReviewCaptureRecordsToJsonl as serializeClientPolicyRecordsToJsonl,
  deserializeReviewCaptureRecordsFromJsonl as deserializeClientPolicyRecordsFromJsonl,
};

type CliOptions = ClientPolicyCorpusOptions & { readonly outDir: string };

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

  const tier = (raw.get('tier') ?? 'standard') as BotDifficulty;
  if (!BOT_DIFFICULTIES.includes(tier)) {
    throw new Error(`--tier must be one of ${BOT_DIFFICULTIES.join('|')}, got "${tier}".`);
  }

  const seed = raw.get('seed') ?? 'client-policy-default-seed';
  // Single canonical fixtures root shared with C2a-2's own corpus, so both
  // corpora sit next to each other for whoever consumes them in C2b.
  const outDir = raw.get('out')
    ?? join(SCRIPT_DIR, '..', '..', '..', 'packages', 'review-engine', 'fixtures', 'recorded-client-policy');

  return { gameCount, tier, seed, outDir };
}

function baseFileName(options: CliOptions): string {
  const batchTag = batchTagForBotDifficulty(options.tier);
  return `${batchTag}--tier-${options.tier}--seed-${options.seed}--games-${options.gameCount}`;
}

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const records = runClientPolicyCorpus(options);
  mkdirSync(options.outDir, { recursive: true });

  const base = baseFileName(options);
  const outPath = join(options.outDir, `${base}.jsonl`);
  const manifestPath = join(options.outDir, `${base}.manifest.json`);
  writeFileSync(outPath, serializeReviewCaptureRecordsToJsonl(records), 'utf8');

  const scorableCount = records.filter((record) => record.evaluation.evidence.source !== 'heuristic').length;
  const elapsedMs = Date.now() - startedAt;

  const manifest: ReviewCaptureManifest = {
    batchTag: batchTagForBotDifficulty(options.tier),
    corpusKind: CLIENT_POLICY_CORPUS_KIND,
    harnessVersion: CLIENT_POLICY_HARNESS_VERSION,
    policyId: CLIENT_POLICY_ID_BY_TIER[options.tier],
    tier: options.tier,
    seed: options.seed,
    gameCount: options.gameCount,
    budget: DEFAULT_REVIEW_DISPATCH_BUDGET,
    coverageThreshold: DEFAULT_REVIEW_COVERAGE_THRESHOLD,
    recordedDecisions: records.length,
    nonHeuristicDecisions: scorableCount,
    elapsedMs,
    generatedAt: new Date().toISOString(),
    reproducible: !isTimingSensitiveBotDifficulty(options.tier),
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
