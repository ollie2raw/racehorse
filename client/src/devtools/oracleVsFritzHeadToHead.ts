/**
 * D1 (docs/scoping/game-review-oracle-upgrade-2026-09-13.md follow-on audit,
 * oracle-strength-validation, 2026-09-19): head-to-head harness pitting the
 * REAL live Fritz Master (`chooseBotMove(state, 'master')`,
 * client/src/modules/fritz/botHeuristics.ts -- confirmed by import-chain
 * trace to be the actual move-selector reached from PlayVsFritz at the
 * Master tier, not a stand-in) against the review-engine oracle's own top
 * move (`evaluateReviewPosition(...).best.action`,
 * packages/review-engine/src/evaluateReviewPosition.ts), on identical
 * seeded deals, with seat rotation so first-move advantage cancels out
 * across the game set.
 *
 * Architecture note: this lives under client/src/devtools/, NOT
 * packages/review-engine/src/devtools/, because it must call the real
 * chooseBotMove -- a client-only, BotMatchState-native function review-engine
 * is not allowed to depend on (the same INV-20 boundary
 * recordSelfPlayCorpus.ts's doc comment already documents, and
 * recordClientPolicyCorpus.ts already lives under client/src/devtools/ for
 * the identical reason). The dependency direction here is client ->
 * review-engine, which is fine; review-engine never imports this file.
 *
 * A second variant ("oracle-fallback-to-fritz-master-heuristic") replaces
 * the oracle's own opening/heuristic-tier fallback (solveHeuristicOpening)
 * with chooseBotMove('master') for exactly the decisions where the real
 * dispatcher would otherwise have used the heuristic tier
 * (evaluation.evidence.source === 'heuristic') -- everything else (exact,
 * search) is untouched. This measures whether borrowing Fritz Master's
 * opening judgment raises the oracle's OPENING-phase strength specifically,
 * without touching midgame/endgame search at all.
 *
 * IMPORTANT, read before trusting a "reproducible" claim: chooseBotMove's
 * 'master' tier is NOT fully reproducible run-to-run. It shares
 * botHeuristics.ts's wall-clock-gated "Hard/Master" scoring block
 * (EXACT_CHAIN_BUDGET_MS / MASTER_ENDGAME_BUDGET_MS, real Date.now()-based
 * deadlines, not a node/iteration budget) -- confirmed empirically in
 * client/src/devtools/recordClientPolicyCorpus.test.ts (two identically
 * seeded 'master' runs diverged mid-game). This harness inherits that
 * property: two runs at the same seed can legitimately produce different
 * games. Every game's full seed and seat assignment is recorded in its
 * result so a divergent run is at least traceable, but "fixed seeds for
 * reproducibility" here means "the SAME DEALS are used every run", not "the
 * same game is replayed" -- report this honestly, do not claim
 * byte-for-byte reproducibility this codebase does not actually have at the
 * Master tier.
 *
 * Phase classification: a decision is tagged 'endgame' when the boneyard is
 * fully drawn (drawableCount === 0, matching solveExactEndgame's own scope
 * boundary), 'opening' when 9 or more tiles remain drawable, and 'midgame'
 * otherwise (1-8 drawable). This threshold is an explicit, disclosed
 * methodology choice (roughly: more than half the non-dealt tile pool still
 * hidden vs. not) picked once, before running any games, and never adjusted
 * after seeing results.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { canDraw, createDeterministicDoubleSixDeal, type GameCommand } from '@racehorse/game-core';
import type { ReviewAction } from '@racehorse/game-core/review';
import { getReviewAuthorityStateDigest } from '@racehorse/game-core/review';
import { evaluateReviewPosition, type ReviewDispatchBudget } from '@racehorse/review-engine';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from '../modules/fritz/botHeuristics.ts';
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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const HEAD_TO_HEAD_HARNESS_VERSION = 'oracle-vs-fritz-h2h-v2';

export type EnginePolicy = 'fritz-master' | 'oracle-top-move';
export type OracleVariant = 'default' | 'oracle-fallback-to-fritz-master-heuristic';
export type PhaseTag = 'opening' | 'midgame' | 'endgame';

export type HeadToHeadOptions = {
  readonly gameCount: number;
  readonly seed: string;
  readonly variant?: OracleVariant;
  readonly fritzTier?: BotDifficulty;
  readonly budget?: ReviewDispatchBudget;
  readonly coverageThreshold?: number;
  readonly maxActionsPerGame?: number;
};

type ResolvedOptions = Required<HeadToHeadOptions>;

function resolveOptions(options: HeadToHeadOptions): ResolvedOptions {
  return {
    gameCount: options.gameCount,
    seed: options.seed,
    variant: options.variant ?? 'default',
    fritzTier: options.fritzTier ?? 'master',
    budget: options.budget ?? DEFAULT_REVIEW_DISPATCH_BUDGET,
    coverageThreshold: options.coverageThreshold ?? DEFAULT_REVIEW_COVERAGE_THRESHOLD,
    maxActionsPerGame: options.maxActionsPerGame ?? 4_000,
  };
}

export type DecisionRecord = {
  readonly gameIndex: number;
  readonly handNumber: number;
  readonly actor: BotPlayerId;
  readonly policy: EnginePolicy;
  readonly phase: PhaseTag;
  readonly immediatePoints: number;
  readonly evidenceSource?: 'exact' | 'search' | 'heuristic';
};

export type GameResult = {
  readonly gameIndex: number;
  readonly seed: string;
  readonly fritzSeat: BotPlayerId;
  readonly seatAssignment: Record<BotPlayerId, EnginePolicy>;
  readonly winnerPolicy: EnginePolicy | 'draw';
  readonly finalScore: Record<EnginePolicy, number>;
  readonly handCount: number;
  readonly decisionCount: number;
  readonly decisions: readonly DecisionRecord[];
  readonly replayTrace: readonly DecisionTrace[];
  readonly finalStateDigest: string;
};

export type DecisionTrace = {
  readonly decisionIndex: number;
  readonly stateDigest: string;
  readonly actor: BotPlayerId;
  readonly action: ReviewAction;
  readonly masterConsulted: boolean;
  readonly evidenceSource?: 'exact' | 'search' | 'heuristic';
};

/**
 * Same mechanism botEngine.ts's own (private) dealFromRankedSeed uses --
 * createDeterministicDoubleSixDeal, game-core's seeded shuffle --
 * reconstructed here rather than imported, same as
 * recordClientPolicyCorpus.ts's identical private helper, since it's
 * private to botEngine.ts.
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
 * chooseBotMove always evaluates from "bot"'s own seat (see
 * client/src/devtools/recordClientPolicyCorpus.ts's identical helper,
 * chooseMoveForActor, and its doc comment for the established pattern this
 * reuses rather than duplicates a novel approach for).
 */
function chooseFritzMasterAction(state: BotMatchState, actor: BotPlayerId, tier: BotDifficulty): ReviewAction {
  const playMoves = getLegalMoves(state, actor).filter((move) => move.type === 'play');
  if (playMoves.length > 0) {
    const perspective: BotMatchState = actor === 'bot'
      ? state
      : { ...state, players: { bot: state.players.you, you: state.players.bot }, currentPlayer: 'bot' };
    const choice = chooseBotMove(toBotVisibleState(perspective), tier);
    if (!choice?.move || choice.move.type !== 'play' || !choice.move.tile || !choice.move.position) {
      throw new Error(`chooseBotMove returned no play despite ${playMoves.length} legal play(s).`);
    }
    return { kind: 'play', tile: choice.move.tile, position: choice.move.position };
  }
  const core = toCoreGameState(state);
  return canDraw(core, actor) ? { kind: 'draw' } : { kind: 'pass' };
}

function placeholderCommand(state: BotMatchState, actor: BotPlayerId): GameCommand {
  const playMoves = getLegalMoves(state, actor).filter((move) => move.type === 'play');
  const base = { version: 1 as const, commandId: 'h2h-placeholder', sequence: state.turnIndex ?? 0, actorId: actor };
  if (playMoves.length > 0) {
    const move = playMoves[0];
    if (move.type === 'play') return { ...base, kind: 'play', tile: move.tile, position: move.position };
  }
  const core = toCoreGameState(state);
  return canDraw(core, actor) ? { ...base, kind: 'draw' } : { ...base, kind: 'pass' };
}

function chooseOracleAction(
  state: BotMatchState,
  actor: BotPlayerId,
  gameIndex: number,
  decisionIndex: number,
  options: ResolvedOptions,
): { action: ReviewAction; evidenceSource: 'exact' | 'search' | 'heuristic'; masterConsulted?: boolean } {
  const command = placeholderCommand(state, actor);
  const snapshot = captureReviewSnapshotAtDecision({
    preState: state,
    command,
    identifiers: {
      sessionId: `h2h:${options.seed}:${gameIndex}`,
      gameId: `h2h:${options.seed}:${gameIndex}`,
      handId: `h2h:${options.seed}:${gameIndex}:hand-${state.handNumber}`,
      decisionId: `h2h:${options.seed}:${gameIndex}:decision-${decisionIndex}`,
      mode: 'fixture',
      gameNumber: 1,
      actionNumber: decisionIndex,
    },
  });

  const evaluation = evaluateReviewPosition(snapshot, options.budget, options.coverageThreshold);

  if (evaluation.evidence.source === 'heuristic' && options.variant === 'oracle-fallback-to-fritz-master-heuristic') {
    const playMoves = getLegalMoves(state, actor).filter((move) => move.type === 'play');
    if (playMoves.length > 0) {
      const perspective: BotMatchState = actor === 'bot'
        ? state
        : { ...state, players: { bot: state.players.you, you: state.players.bot }, currentPlayer: 'bot' };
      const choice = chooseBotMove(toBotVisibleState(perspective), options.fritzTier);
      if (choice?.move?.type === 'play' && choice.move.tile && choice.move.position) {
        return {
          action: { kind: 'play', tile: choice.move.tile, position: choice.move.position },
          evidenceSource: 'heuristic',
          masterConsulted: true,
        };
      }
    }
    // No legal play (must draw/pass): the fallback has nothing to override,
    // fall through to the oracle's own (already-correct) draw/pass call.
  }

  return { action: evaluation.best.action, evidenceSource: evaluation.evidence.source };
}

function applyReviewAction(state: BotMatchState, actor: BotPlayerId, action: ReviewAction): BotMatchState {
  if (action.kind === 'play') {
    return applyPlayMove(state, actor, { type: 'play', tile: action.tile, position: action.position }).state;
  }
  if (action.kind === 'draw') return drawOne(state, actor).state;
  return passTurn(state, actor).state;
}

/**
 * drawableCount mirrors ReviewPositionSnapshotV2's own
 * preAction.boneyard.drawableCount definition (hiddenPoolEligibility.ts /
 * evaluateReviewPosition.ts's dispatch condition) so 'endgame' here means
 * exactly what solveExactEndgame's own scope boundary means.
 */
function classifyPhase(state: BotMatchState): PhaseTag {
  const core = toCoreGameState(state);
  const drawableCount = core.boneyard.length;
  if (drawableCount === 0) return 'endgame';
  if (drawableCount >= 9) return 'opening';
  return 'midgame';
}

/**
 * Plays one complete deterministic game between Fritz Master and the
 * oracle's top move, with `fritzSeat` fixed for the whole game (seat
 * rotation across a game SET is the caller's job -- see runHeadToHead).
 */
export function runHeadToHeadGame(
  gameIndex: number,
  fritzSeat: BotPlayerId,
  options: HeadToHeadOptions,
  replay?: readonly DecisionTrace[],
): GameResult {
  const resolved = resolveOptions(options);
  const oracleSeat: BotPlayerId = fritzSeat === 'bot' ? 'you' : 'bot';
  const seatAssignment = {
    [fritzSeat]: 'fritz-master' as const,
    [oracleSeat]: 'oracle-top-move' as const,
  } as Record<BotPlayerId, EnginePolicy>;

  let state: BotMatchState = createFixedBotMatch(dealForHand(`${resolved.seed}:game${gameIndex}`, 1));
  const decisions: DecisionRecord[] = [];
  const replayTrace: DecisionTrace[] = [];
  let decisionIndex = 0;

  for (let step = 0; step < resolved.maxActionsPerGame && !state.gameOver; step += 1) {
    if (state.handOver) {
      state = startNextFixedBotHand(state, dealForHand(`${resolved.seed}:game${gameIndex}`, state.handNumber + 1));
      continue;
    }

    const actor = state.currentPlayer;
    const policy = seatAssignment[actor];
    const phase = classifyPhase(state);
    const scoreBefore = state.players[actor].score;
    decisionIndex += 1;

    let evidenceSource: 'exact' | 'search' | 'heuristic' | undefined;
    const stateDigest = getReviewAuthorityStateDigest(toCoreGameState(state));
    let action: ReviewAction;
    let masterConsulted = false;
    if (replay) {
      const recorded = replay[decisionIndex - 1];
      if (!recorded || recorded.stateDigest !== stateDigest || recorded.actor !== actor || recorded.decisionIndex !== decisionIndex) {
        throw new Error(`Replay diverged at game ${gameIndex}, decision ${decisionIndex}.`);
      }
      action = recorded.action;
      evidenceSource = recorded.evidenceSource;
      masterConsulted = recorded.masterConsulted;
    } else if (policy === 'fritz-master') {
      action = chooseFritzMasterAction(state, actor, resolved.fritzTier);
      masterConsulted = getLegalMoves(state, actor).some(move => move.type === 'play');
    } else {
      const chosen = chooseOracleAction(state, actor, gameIndex, decisionIndex, resolved);
      evidenceSource = chosen.evidenceSource;
      action = chosen.action;
      masterConsulted = chosen.masterConsulted ?? false;
    }
    replayTrace.push({ decisionIndex, stateDigest, actor, action, masterConsulted, evidenceSource });
    const nextState = applyReviewAction(state, actor, action);

    decisions.push({
      gameIndex,
      handNumber: state.handNumber,
      actor,
      policy,
      phase,
      immediatePoints: nextState.players[actor].score - scoreBefore,
      evidenceSource,
    });
    state = nextState;
  }

  if (!state.gameOver) {
    throw new Error(`h2h game ${gameIndex} (seed=${resolved.seed}) did not reach gameOver within ${resolved.maxActionsPerGame} actions.`);
  }
  if (replay && replay.length !== replayTrace.length) throw new Error('Replay contains trailing decisions.');

  const finalScore: Record<EnginePolicy, number> = {
    'fritz-master': state.players[fritzSeat].score,
    'oracle-top-move': state.players[oracleSeat].score,
  };
  const winnerPolicy: EnginePolicy | 'draw' = state.winnerId ? seatAssignment[state.winnerId] : 'draw';

  return {
    gameIndex,
    seed: resolved.seed,
    fritzSeat,
    seatAssignment,
    winnerPolicy,
    finalScore,
    handCount: state.handNumber,
    decisionCount: decisions.length,
    decisions,
    replayTrace,
    finalStateDigest: getReviewAuthorityStateDigest(toCoreGameState(state)),
  };
}

/** Replays recorded actions without consulting either timing-sensitive policy. */
export function replayHeadToHeadGame(record: GameResult): GameResult {
  const replayed = runHeadToHeadGame(record.gameIndex, record.fritzSeat, {
    seed: record.seed, gameCount: 1,
  }, record.replayTrace);
  if (replayed.finalStateDigest !== record.finalStateDigest) throw new Error('Replay terminal digest mismatch.');
  return replayed;
}

/**
 * Runs `options.gameCount` games, alternating which seat Fritz Master
 * occupies every game (even gameIndex -> Fritz on 'bot', odd -> Fritz on
 * 'you'), so first-move/seat advantage cancels out across the set. Pure and
 * synchronous -- no I/O, no parallelism -- so it is directly unit-testable;
 * the CLI below adds process-level parallelism on top of this.
 */
export function runHeadToHead(options: HeadToHeadOptions): GameResult[] {
  const results: GameResult[] = [];
  for (let gameIndex = 0; gameIndex < options.gameCount; gameIndex += 1) {
    const fritzSeat: BotPlayerId = gameIndex % 2 === 0 ? 'bot' : 'you';
    results.push(runHeadToHeadGame(gameIndex, fritzSeat, options));
  }
  return results;
}

export type PhaseBucket = { readonly oracleNetPoints: number; readonly fritzNetPoints: number; readonly decisionCount: number };

export type HeadToHeadSummary = {
  readonly gameCount: number;
  readonly oracleWins: number;
  readonly fritzWins: number;
  readonly draws: number;
  readonly oracleWinRate: number;
  /** 95% Wilson score interval on the oracle win rate. */
  readonly winRateCI95: readonly [number, number];
  /** Mean per-game point margin, oracle minus Fritz. */
  readonly meanMargin: number;
  readonly meanMarginStdErr: number;
  readonly byPhase: Record<PhaseTag, PhaseBucket>;
};

function wilsonScoreInterval(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0];
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const halfWidth = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (center - halfWidth) / denom), Math.min(1, (center + halfWidth) / denom)];
}

export function summarizeHeadToHead(results: readonly GameResult[]): HeadToHeadSummary {
  const gameCount = results.length;
  let oracleWins = 0;
  let fritzWins = 0;
  let draws = 0;
  const margins: number[] = [];
  const byPhase: Record<PhaseTag, { oracleNetPoints: number; fritzNetPoints: number; decisionCount: number }> = {
    opening: { oracleNetPoints: 0, fritzNetPoints: 0, decisionCount: 0 },
    midgame: { oracleNetPoints: 0, fritzNetPoints: 0, decisionCount: 0 },
    endgame: { oracleNetPoints: 0, fritzNetPoints: 0, decisionCount: 0 },
  };

  for (const result of results) {
    if (result.winnerPolicy === 'oracle-top-move') oracleWins += 1;
    else if (result.winnerPolicy === 'fritz-master') fritzWins += 1;
    else draws += 1;
    margins.push(result.finalScore['oracle-top-move'] - result.finalScore['fritz-master']);
    for (const decision of result.decisions) {
      const bucket = byPhase[decision.phase];
      bucket.decisionCount += 1;
      if (decision.policy === 'oracle-top-move') bucket.oracleNetPoints += decision.immediatePoints;
      else bucket.fritzNetPoints += decision.immediatePoints;
    }
  }

  const oracleWinRate = gameCount > 0 ? oracleWins / gameCount : 0;
  const meanMargin = gameCount > 0 ? margins.reduce((sum, m) => sum + m, 0) / gameCount : 0;
  const variance = gameCount > 1
    ? margins.reduce((sum, m) => sum + (m - meanMargin) ** 2, 0) / (gameCount - 1)
    : 0;
  const meanMarginStdErr = gameCount > 0 ? Math.sqrt(variance / gameCount) : 0;

  return {
    gameCount,
    oracleWins,
    fritzWins,
    draws,
    oracleWinRate,
    winRateCI95: wilsonScoreInterval(oracleWins, gameCount),
    meanMargin,
    meanMarginStdErr,
    byPhase,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────
// Follows the same conventions as recordSelfPlayCorpus.ts /
// recordClientPolicyCorpus.ts (plain .ts, tsx-invoked, invokedDirectly
// guard) plus a --workers flag: with --workers N > 1, this process spawns N
// `tsx` child processes, each running a disjoint shard of the game set
// (game gameIndex assigned to shard gameIndex % N), and merges their JSON
// results. Each child is invoked with --shard-count/--shard-index and
// writes its shard's GameResult[] to its own file; the parent reads all N
// files back and merges. This avoids worker_threads + ESM/tsx loader
// interaction entirely, at the cost of process-spawn overhead, which is
// negligible next to per-game oracle-evaluation cost.

export type CliOptions = HeadToHeadOptions & {
  readonly outDir: string;
  readonly workers: number;
  readonly shardCount?: number;
  readonly shardIndex?: number;
  readonly startIndex: number;
};

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const raw = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    raw.set(arg.slice(2), argv[index + 1]);
    index += 1;
  }

  const gameCountRaw = raw.get('games') ?? '600';
  const gameCount = Number(gameCountRaw);
  if (!Number.isInteger(gameCount) || gameCount <= 0) {
    throw new Error(`--games must be a positive integer, got "${gameCountRaw}".`);
  }

  const seed = raw.get('seed') ?? 'oracle-vs-fritz-h2h-default-seed';
  const variant = (raw.get('variant') ?? 'default') as OracleVariant;
  if (variant !== 'default' && variant !== 'oracle-fallback-to-fritz-master-heuristic') {
    throw new Error(`--variant must be one of default|oracle-fallback-to-fritz-master-heuristic, got "${variant}".`);
  }

  const workersRaw = raw.get('workers') ?? '1';
  const workers = Number(workersRaw);
  if (!Number.isInteger(workers) || workers <= 0 || workers > 4) {
    throw new Error(`--workers must be a positive integer at most 4, got "${workersRaw}".`);
  }

  const outDir = raw.get('out') ?? join(SCRIPT_DIR, '..', '..', '..', 'docs', 'oracle-strength-validation-runs');

  const shardCountRaw = raw.get('shard-count');
  const shardIndexRaw = raw.get('shard-index');
  const startIndex = Number(raw.get('start-index') ?? 0);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) throw new Error('Invalid --start-index.');

  return {
    gameCount,
    seed,
    variant,
    outDir,
    workers,
    startIndex,
    shardCount: shardCountRaw !== undefined ? Number(shardCountRaw) : undefined,
    shardIndex: shardIndexRaw !== undefined ? Number(shardIndexRaw) : undefined,
  };
}

function runShard(options: CliOptions): GameResult[] {
  const { shardCount, shardIndex } = options;
  if (shardCount === undefined || shardIndex === undefined) {
    throw new Error('runShard requires --shard-count and --shard-index.');
  }
  const results: GameResult[] = [];
  for (let gameIndex = options.startIndex + shardIndex; gameIndex < options.startIndex + options.gameCount; gameIndex += shardCount) {
    const fritzSeat: BotPlayerId = gameIndex % 2 === 0 ? 'bot' : 'you';
    results.push(runHeadToHeadGame(gameIndex, fritzSeat, options));
  }
  return results;
}

async function runParallel(options: CliOptions): Promise<GameResult[]> {
  mkdirSync(options.outDir, { recursive: true });
  const scriptPath = fileURLToPath(import.meta.url);
  const shardFiles: string[] = [];

  const children = Array.from({ length: options.workers }, (_, shardIndex) => {
    const shardFile = join(options.outDir, `.shard-${options.seed}-${options.variant}-${shardIndex}-of-${options.workers}.json`);
    shardFiles.push(shardFile);
    const args = [
      scriptPath,
      '--games', String(options.gameCount),
      '--start-index', String(options.startIndex),
      '--seed', options.seed,
      '--variant', options.variant ?? 'default',
      '--out', options.outDir,
      '--shard-count', String(options.workers),
      '--shard-index', String(shardIndex),
      '--shard-file', shardFile,
    ];
    return new Promise<void>((resolve, reject) => {
      execFile('npx', ['tsx', ...args], { maxBuffer: 1024 * 1024 * 256 }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`shard ${shardIndex} failed: ${error.message}\n${stderr}`));
          return;
        }
        resolve();
      });
    });
  });

  await Promise.all(children);

  const merged: GameResult[] = [];
  for (const shardFile of shardFiles) {
    const shardResults = JSON.parse(readFileSync(shardFile, 'utf8')) as GameResult[];
    merged.push(...shardResults);
  }
  merged.sort((a, b) => a.gameIndex - b.gameIndex);
  return merged;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  // Shard-worker mode: run this shard's games and write them to --shard-file, then exit.
  if (options.shardCount !== undefined && options.shardIndex !== undefined) {
    const raw = new Map<string, string>();
    const argv = process.argv.slice(2);
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === '--shard-file') raw.set('shard-file', argv[index + 1]);
    }
    const shardFile = raw.get('shard-file');
    if (!shardFile) throw new Error('shard mode requires --shard-file.');
    const results = runShard(options);
    writeFileSync(shardFile, JSON.stringify(results), 'utf8');
    return;
  }

  mkdirSync(options.outDir, { recursive: true });
  const startedAt = Date.now();
  const baseName = `h2h--variant-${options.variant}--seed-${options.seed}--start-${options.startIndex}--games-${options.gameCount}`;
  const resultsPath = join(options.outDir, `${baseName}.results.json`);
  const summaryPath = join(options.outDir, `${baseName}.summary.json`);
  const loadSamples: { at: string; loadavg: number[] }[] = [];
  const sampleLoad = () => loadSamples.push({ at: new Date().toISOString(), loadavg: loadavg() });
  const loadExceeded = () => loadSamples.some(sample => sample.loadavg[0] > 6);
  const writeProgress = (status: string, games: GameResult[] = [], error?: string) => {
    writeFileSync(resultsPath, JSON.stringify({ status, loadSamples, loadExceeded: loadExceeded(), games, error }), 'utf8');
  };
  sampleLoad();
  writeProgress('running');
  const loadTimer = setInterval(() => { sampleLoad(); writeProgress('running'); }, 5 * 60 * 1000);
  let results: GameResult[];
  try {
    // Even 1-worker runs execute in a child: the coordinator remains free
    // to sample load every five minutes while synchronous search runs.
    results = await runParallel(options);
  } catch (error) {
    sampleLoad();
    writeProgress('failed', [], String(error));
    throw error;
  } finally {
    clearInterval(loadTimer);
  }
  sampleLoad();
  writeProgress('complete', results);
  const summary = summarizeHeadToHead(results);
  const elapsedMs = Date.now() - startedAt;
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        harnessVersion: HEAD_TO_HEAD_HARNESS_VERSION,
        variant: options.variant,
        seed: options.seed,
        gameCount: options.gameCount,
        workers: options.workers,
        loadSamples,
        loadExceeded: loadExceeded(),
        elapsedMs,
        generatedAt: new Date().toISOString(),
        ...summary,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(JSON.stringify({ ...summary, elapsedMs, resultsPath, summaryPath }, null, 2));
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
