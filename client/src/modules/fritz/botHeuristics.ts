/**
 * botHeuristics.ts — Racehorse Domino AI (Hard Bot) v3.7
 *
 * v3.1: minimax pass-turn bug (currentPlayer flip + passDepth guard)
 * v3.2: Codex review — null guard, depth cap 12, threshold ≤ 8, DEV-only logs
 * v3.3: draw-until-playable modeled inside minimax; pip burden 0.8 → 1.5
 * v3.4: perf guard (150ms budget); greedy fallback; consistent timing coverage
 * v3.5: deadlineMs propagated into minimax itself (single branch can't overrun);
 *       done() uses typed overloads — no brittle as-casts anywhere
 * v3.6: master difficulty uses sampled-hand endgame search (fair IS-MCTS style)
 * v3.7: master gets elevated MC samples (20 vs 8), wider chain search, two-ply
 *       worst-case wrapper enabled, endgame IS-MCTS threshold raised 8 → 12 tiles
 * v3.8: master-only endgame/defense/sacrifice weights — sharper near opponent win,
 *       stronger pip/threat denial, without changing elite or fairness paths
 */

import type { Move, Tile } from '../../types.ts';
export type { Move, Tile };
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { computeOpenEndsSum, getLegalMoves, previewPlayMove } from '../match/runtime/botEngine.ts';
import { drawableBoneyardCount, estimateDrawCostFromPublicInfo } from './publicDrawCost.ts';

export type BotDifficulty = 'casual' | 'standard' | 'hard' | 'master';

export interface BotChoice {
  move: Move;
  score: number;
  explanation?: string;
  breakdown: {
    immediate: number;
    doubleBias: number;
    mobility: number;
    denial: number;
    unload: number;
    replyRisk: number;
  };
}

export interface BotVisibleState extends BotMatchState {
  readonly opponentTileCount: number;
  readonly __fairMode: true;
}
type BotEvalState = BotVisibleState | BotMatchState;

// ─── Constants ────────────────────────────────────────────────────────────────

const MC_SAMPLES = 8;
const CHAIN_TREE_DEPTH = 5;
const CHAIN_TREE_WIDTH = 3;
const WIN_TARGET = 60;
const MASTER_ENDGAME_BUDGET_MS = 90;
const EXACT_CHAIN_BUDGET_MS = 45;

const ENABLE_TWO_PLY_WORST_CASE = false;
const FAIR_BOT_MODE = true;
let fairOpponentAccessWarned = false;

// ─── Tier selection config ────────────────────────────────────────────────────

interface TierSelectCfg {
  /** Sorted candidates to consider (pool). */
  poolSize: number;
  /** Probability of picking the top-ranked candidate (after the random-legal check). */
  pBest: number;
  /**
   * Probability of skipping the scored pool entirely and picking a truly random legal
   * move. Non-zero only for Rookie — keeps the random branch rare (3–5%) so mistakes
   * feel like lapses, not bugs.
   */
  pRandom: number;
  /**
   * Exponential rank-decay for weighted sampling among non-best pool candidates.
   * weight[i] = rankDecay^i — rank-based so probabilities are stable regardless of
   * raw score magnitudes.
   */
  rankDecay: number;
}

//  Effective non-best selection rate = pRandom + (1 − pRandom) × (1 − pBest)
//  casual:   0.04 + 0.96 × 0.31 ≈ 34%   (30–35% target ✓, ~4% truly random ✓)
//  standard: 0.00 + 1.00 × 0.14 ≈ 14%   (12–15% target ✓)
//  hard:     0.00 + 1.00 × 0.03 ≈  3%   (3% target ✓)
//  master:   0%                           (deterministic ✓)
const TIER_SELECT: Record<BotDifficulty, TierSelectCfg> = {
  casual:   { poolSize: 5, pBest: 0.69, pRandom: 0.04, rankDecay: 0.60 },
  standard: { poolSize: 4, pBest: 0.86, pRandom: 0.00, rankDecay: 0.55 },
  hard:     { poolSize: 3, pBest: 0.97, pRandom: 0.00, rankDecay: 0.50 },
  master:   { poolSize: 1, pBest: 1.00, pRandom: 0.00, rankDecay: 1.00 },
};

function makeDevOpponentHandTrap(): Tile[] {
  return new Proxy([] as Tile[], {
    get(_target, prop) {
      const key = String(prop);
      throw new Error(`[FairBotMode] Illegal access to hidden opponent hand via players.you.hand.${key}`);
    },
  });
}

export function toBotVisibleState(state: BotMatchState): BotVisibleState {
  const isDevRuntime = Boolean(import.meta.env?.DEV);
  const opponentTileCount = state.players.you.hand.length;
  return {
    ...state,
    players: {
      bot: state.players.bot,
      you: {
        score: state.players.you.score,
        hand: isDevRuntime ? makeDevOpponentHandTrap() : [],
      },
    },
    opponentTileCount,
    __fairMode: true,
  };
}

function asVisibleState(state: BotEvalState): BotVisibleState {
  if ((state as BotVisibleState).__fairMode) return state as BotVisibleState;
  return toBotVisibleState(state as BotMatchState);
}

function getOpponentTileCount(state: BotEvalState): number {
  const visibleCount = (state as Partial<BotVisibleState>).opponentTileCount;
  if (typeof visibleCount === 'number') return Math.max(0, visibleCount);
  return Math.max(0, state.players.you.hand.length);
}

function warnFairHiddenAccess(path: string) {
  if (fairOpponentAccessWarned) return;
  fairOpponentAccessWarned = true;
  console.warn(`[FairBotMode] blocked hidden-opponent path: ${path}`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function tileKey(t: { low: number; high: number }): string {
  return `${t.low}|${t.high}`;
}

function boardStateKey(state: BotEvalState): string {
  const board = state.board;
  if (!board) return 'no-board';
  const main = board.mainLine
    .map((placement) => `${tileKey(placement.tile)}@${placement.orientation}`)
    .join(',');
  const hubs = (board.hubDoubles ?? [])
    .map((hub, hubIdx) =>
      `${hub.hubId ?? hubIdx}:${(hub.branches ?? [])
        .map((branch, branchIdx) =>
          !branch
            ? `${branchIdx}:x`
            : `${branchIdx}:${branch.tiles.map((placement) => `${tileKey(placement.tile)}@${placement.orientation}`).join('.')}`,
        )
        .join('|')}`,
    )
    .join(';');
  return `${main}#${hubs}#${board.leftEnd}:${board.rightEnd}`;
}

function compareTilesNumeric(a: Tile | null | undefined, b: Tile | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.high !== b.high) return a.high - b.high;
  if (a.low !== b.low) return a.low - b.low;
  return 0;
}

function compareMoveStable(a: Move, b: Move): number {
  const tileCompare = compareTilesNumeric(a.tile ?? null, b.tile ?? null);
  if (tileCompare !== 0) return tileCompare;
  return String(a.position ?? '').localeCompare(String(b.position ?? ''));
}

function stateSeedKey(state: BotEvalState, label: string): string {
  return [
    label,
    state.currentPlayer,
    state.players.bot.hand.map(tileKey).sort().join(','),
    getOpponentTileCount(state),
    `yard:${state.boneyard.length}`,
    boardStateKey(state),
  ].join('|');
}

function hashStringToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createStatePrng(state: BotEvalState, label: string): () => number {
  let current = hashStringToUint32(stateSeedKey(state, label)) || 0x9e3779b9;
  return () => {
    current = (Math.imul(current, 1664525) + 1013904223) >>> 0;
    return current / 0x100000000;
  };
}

function pipSum(hand: Tile[]): number {
  return hand.reduce((s, t) => s + t.low + t.high, 0);
}

function isDoubleTile(t: Tile): boolean {
  return t.low === t.high;
}

function racehorsePoints(sum: number): number {
  return sum > 0 && sum % 5 === 0 ? sum / 5 : 0;
}

function cloneState<T extends BotMatchState>(
  state: T,
  overrides: Partial<T>,
): T {
  return { ...state, ...overrides };
}

// ─── Tile pool & inference ────────────────────────────────────────────────────

function buildUnseenPool(state: BotEvalState): Tile[] {
  const known = new Set<string>();
  for (const t of state.players.bot.hand) known.add(tileKey(t));
  if (state.board) {
    for (const pt of state.board.mainLine) known.add(tileKey(pt.tile));
    for (const hub of state.board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
        if (!branch) continue;
        for (const pt of branch.tiles ?? []) known.add(tileKey(pt.tile));
      }
    }
  }
  const pool: Tile[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      const t = { low: i, high: j };
      if (!known.has(tileKey(t))) pool.push(t);
    }
  }
  return pool;
}

function inferMissingPips(state: BotEvalState): Set<number> {
  const missing = new Set<number>(state.opponentKnownMissing ?? []);
  for (const end of state.opponentPassedOnEnds ?? []) missing.add(end);
  return missing;
}

function opponentHoldWeights(pool: Tile[], missingPips: Set<number>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of pool) {
    const w = missingPips.has(t.low) || missingPips.has(t.high) ? 0.05 : 1.0;
    weights.set(tileKey(t), w);
  }
  return weights;
}

// ─── Monte Carlo: sample plausible opponent hands ─────────────────────────────

function sampleOpponentHands(
  pool: Tile[],
  weights: Map<string, number>,
  handSize: number,
  n: number,
  rand: () => number,
): Tile[][] {
  const hands: Tile[][] = [];

  for (let s = 0; s < n; s++) {
    const available = [...pool];
    const w = available.map((t) => weights.get(tileKey(t)) ?? 1.0);
    const hand: Tile[] = [];

    for (let i = 0; i < Math.min(handSize, available.length); i++) {
      const totalW = w.reduce((sum, wi, idx) => (available[idx] ? sum + wi : sum), 0);
      if (totalW <= 0) break;

      let roll = rand() * totalW;
      let chosen = -1;
      for (let j = 0; j < available.length; j++) {
        if (!available[j]) continue;
        roll -= w[j];
        if (roll <= 0) { chosen = j; break; }
      }
      if (chosen === -1) chosen = available.findIndex((t) => t != null);
      if (chosen === -1) break;

      hand.push(available[chosen]);
      (available as (Tile | null)[])[chosen] = null;
      w[chosen] = 0;
    }

    hands.push(hand);
  }

  return hands;
}

// ─── Threat & opportunity ─────────────────────────────────────────────────────

function opponentThreat(
  openEnds: number[],
  openSum: number,
  holdWeights: Map<string, number>,
): number {
  let threat = 0;
  const checked = new Set<string>();
  for (const end of openEnds) {
    for (let pip = 0; pip <= 6; pip++) {
      const newSum = openSum - end + pip;
      if (newSum <= 0 || newSum % 5 !== 0) continue;
      const lo = Math.min(end, pip);
      const hi = Math.max(end, pip);
      const key = `${lo}|${hi}`;
      const dk = `${key}-${newSum}`;
      if (checked.has(dk)) continue;
      checked.add(dk);
      const w = holdWeights.get(key) ?? 0;
      if (w > 0) threat += racehorsePoints(newSum) * w;
    }
  }
  return threat;
}

function exactOpponentThreat(
  openEnds: number[],
  openSum: number,
  opponentHand: Tile[],
): number {
  let threat = 0;
  const checked = new Set<string>();
  for (const t of opponentHand) {
    for (const end of openEnds) {
      if (t.low !== end && t.high !== end) continue;
      const connectingPip = t.low === end ? t.high : t.low;
      const newSum = openSum - end + connectingPip;
      if (newSum <= 0 || newSum % 5 !== 0) continue;
      const dk = `${tileKey(t)}-${end}-${newSum}`;
      if (checked.has(dk)) continue;
      checked.add(dk);
      threat += racehorsePoints(newSum);
    }
  }
  return threat;
}

function selfOpportunity(openEnds: number[], openSum: number, hand: Tile[]): number {
  let opp = 0;
  for (const t of hand) {
    for (const end of openEnds) {
      if (t.low !== end && t.high !== end) continue;
      const pip = t.low === end ? t.high : t.low;
      const newSum = openSum - end + pip;
      if (newSum > 0 && newSum % 5 === 0) opp += racehorsePoints(newSum);
    }
  }
  return opp;
}

function handMobility(hand: Tile[], openEnds: number[]): number {
  const endSet = new Set(openEnds);
  return hand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

type HandPhase = 'early' | 'mid' | 'late';
type TierStrength = 'base' | 'master';

function tierStrengthFromDifficulty(difficulty: BotDifficulty): TierStrength {
  return difficulty === 'master' ? 'master' : 'base';
}

function phaseFor(handSizeAfter: number, totalTilesAfter: number): HandPhase {
  if (handSizeAfter <= 3 || totalTilesAfter <= 8) return 'late';
  if (handSizeAfter <= 7 || totalTilesAfter <= 16) return 'mid';
  return 'early';
}

function pipTileFrequency(hand: Tile[]): number[] {
  const freq = new Array<number>(7).fill(0);
  for (const t of hand) {
    freq[t.low] += 1;
    if (t.high !== t.low) freq[t.high] += 1;
  }
  return freq;
}

function inferOpenEndsFromState(state: BotMatchState): number[] {
  if (!state.board || !state.handOpen) return [];
  const ends: number[] = [state.board.leftEnd, state.board.rightEnd];
  for (const hub of state.board.hubDoubles ?? []) {
    for (const b of hub.branches ?? []) {
      if (!b) continue;
      ends.push(b.openEnd);
    }
  }
  return ends;
}

function countPlayableTiles(hand: Tile[], openEnds: number[]): number {
  const endSet = new Set(openEnds);
  return hand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

function countOrphanTiles(hand: Tile[], openEnds: number[]): number {
  const endSet = new Set(openEnds);
  return hand.filter((t) => !endSet.has(t.low) && !endSet.has(t.high)).length;
}

function boardTileCount(board: BotMatchState['board']): number {
  if (!board) return 0;
  let count = board.mainLine.length;
  for (const hub of board.hubDoubles ?? []) {
    for (const branch of hub.branches ?? []) {
      if (!branch) continue;
      count += branch.tiles?.length ?? 0;
    }
  }
  return count;
}

function estimateOpponentMobilityApprox(
  openEnds: number[],
  holdWeights: Map<string, number>,
): number {
  if (openEnds.length === 0) return 0;
  let total = 0;
  for (const end of openEnds) {
    for (let pip = 0; pip <= 6; pip++) {
      const lo = Math.min(end, pip);
      const hi = Math.max(end, pip);
      total += holdWeights.get(`${lo}|${hi}`) ?? 0;
    }
  }
  return total / openEnds.length;
}

function hasExitInTwoMoves(state: BotMatchState): boolean {
  if (state.players.bot.hand.length === 0) return true;
  const firstMoves = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
  for (const m1 of firstMoves) {
    const p1 = previewPlayMove(state, 'bot', m1);
    if (!p1) continue;
    if (p1.nextHand.length === 0) return true;
    if (!p1.turnContinues) continue;
    const after1 = cloneState(state, {
      board: p1.nextBoard,
      players: { ...state.players, bot: { ...state.players.bot, hand: p1.nextHand } },
      currentPlayer: 'bot',
    });
    const secondMoves = getLegalMoves(after1, 'bot').filter((m) => m.type === 'play');
    for (const m2 of secondMoves) {
      const p2 = previewPlayMove(after1, 'bot', m2);
      if (p2 && p2.nextHand.length === 0) return true;
    }
  }
  return false;
}

// ─── Draw anticipation (public info only — no boneyard stack order) ───────────

function estimateDrawCostForState(
  nextHand: Tile[],
  openEnds: number[],
  state: BotEvalState,
): number {
  return estimateDrawCostFromPublicInfo(
    nextHand,
    openEnds,
    buildUnseenPool(state),
    drawableBoneyardCount(state.boneyard.length),
  );
}

// ─── Chain tree search ────────────────────────────────────────────────────────

interface ChainNode {
  totalPoints: number;
  chainLength: number;
  finalHand: Tile[];
  finalOpenEnds: number[];
  finalOpenSum: number;
  finalBoard: BotMatchState['board'];
  drawCostAccum: number;
}

function dynamicChainParams(
  botHandSize: number,
  totalTiles: number,
  strength: 'base' | 'master' = 'base',
): { depth: number; width: number } {
  if (strength === 'master') {
    if (botHandSize <= 6 || totalTiles <= 12) return { depth: 8, width: 6 };
    if (botHandSize <= 8 || totalTiles <= 16) return { depth: 7, width: 5 };
    return { depth: 6, width: 4 };
  }
  if (botHandSize <= 6 || totalTiles <= 12) return { depth: 7, width: 5 };
  if (botHandSize <= 8 || totalTiles <= 16) return { depth: 6, width: 4 };
  return { depth: CHAIN_TREE_DEPTH, width: CHAIN_TREE_WIDTH };
}

function isBetterChain(a: ChainNode, b: ChainNode): boolean {
  if (a.totalPoints !== b.totalPoints) return a.totalPoints > b.totalPoints;
  if (a.chainLength !== b.chainLength) return a.chainLength < b.chainLength;
  return a.drawCostAccum < b.drawCostAccum;
}

/**
 * Exact turn-chain solver for the bot's current turn.
 * Enumerates all continuation orderings (subject to deadline) and picks the
 * highest total turn points, which fixes suboptimal scoring order issues.
 */
function searchExactTurnChain(
  state: BotMatchState,
  firstMove: Move,
  deadlineMs: number,
): ChainNode | null {
  const firstPreview = previewPlayMove(state, 'bot', firstMove);
  if (!firstPreview) return null;

  const root: ChainNode = {
    totalPoints: firstPreview.immediateScore,
    chainLength: 1,
    finalHand: firstPreview.nextHand,
    finalOpenEnds: firstPreview.openEnds,
    finalOpenSum: firstPreview.openSum,
    finalBoard: firstPreview.nextBoard,
    drawCostAccum: estimateDrawCostForState(firstPreview.nextHand, firstPreview.openEnds, state),
  };

  if (!firstPreview.turnContinues) return root;
  let best: ChainNode = root;

  const dfs = (node: ChainNode): void => {
    if (performance.now() > deadlineMs) return;

    const tempState = cloneState(state, {
      board: node.finalBoard,
      players: {
        ...state.players,
        bot: { ...state.players.bot, hand: node.finalHand },
      },
      currentPlayer: 'bot',
    });
    const continuations = getLegalMoves(tempState, 'bot').filter((m) => m.type === 'play');
    if (continuations.length === 0) {
      if (isBetterChain(node, best)) best = node;
      return;
    }

    for (const m of continuations) {
      if (performance.now() > deadlineMs) return;
      const p = previewPlayMove(tempState, 'bot', m);
      if (!p) continue;

      const child: ChainNode = {
        totalPoints: node.totalPoints + p.immediateScore,
        chainLength: node.chainLength + 1,
        finalHand: p.nextHand,
        finalOpenEnds: p.openEnds,
        finalOpenSum: p.openSum,
        finalBoard: p.nextBoard,
        drawCostAccum: node.drawCostAccum + estimateDrawCostForState(p.nextHand, p.openEnds, state),
      };

      if (p.turnContinues) dfs(child);
      else if (isBetterChain(child, best)) best = child;
    }
  };

  dfs(root);
  return best;
}

function searchChainTree(
  state: BotMatchState,
  firstMove: Move,
  maxDepth: number = CHAIN_TREE_DEPTH,
  width: number = CHAIN_TREE_WIDTH,
): ChainNode | null {
  const firstPreview = previewPlayMove(state, 'bot', firstMove);
  if (!firstPreview) return null;

  const drawCost = estimateDrawCostForState(firstPreview.nextHand, firstPreview.openEnds, state);

  const root: ChainNode = {
    totalPoints: firstPreview.immediateScore,
    chainLength: 1,
    finalHand: firstPreview.nextHand,
    finalOpenEnds: firstPreview.openEnds,
    finalOpenSum: firstPreview.openSum,
    finalBoard: firstPreview.nextBoard,
    drawCostAccum: drawCost,
  };

  if (!firstPreview.turnContinues) return root;

  let frontier: ChainNode[] = [root];
  let bestLeaf: ChainNode = root;

  for (let depth = 0; depth < maxDepth - 1; depth++) {
    const nextFrontier: ChainNode[] = [];

    for (const node of frontier) {
      const tempState = cloneState(state, {
        board: node.finalBoard,
        players: {
          ...state.players,
          bot: { ...state.players.bot, hand: node.finalHand },
        },
        currentPlayer: 'bot',
      });

      const continuations = getLegalMoves(tempState, 'bot').filter((m) => m.type === 'play');
      if (continuations.length === 0) {
        if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
        continue;
      }

      const scored = continuations
        .map((m) => {
          const p = previewPlayMove(tempState, 'bot', m);
          if (!p) return null;
          const val =
            p.immediateScore * 100 +
            selfOpportunity(p.openEnds, p.openSum, p.nextHand) * 10 +
            (m.tile ? m.tile.low + m.tile.high : 0) * 0.3;
          return { m, p, val };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const scoreDiff = b!.val - a!.val;
          if (scoreDiff !== 0) return scoreDiff;
          return compareMoveStable(a!.m, b!.m);
        })
        .slice(0, width) as Array<{ m: Move; p: NonNullable<ReturnType<typeof previewPlayMove>>; val: number }>;

      for (const { p } of scored) {
        const dc = estimateDrawCostForState(p.nextHand, p.openEnds, state);
        const child: ChainNode = {
          totalPoints: node.totalPoints + p.immediateScore,
          chainLength: node.chainLength + 1,
          finalHand: p.nextHand,
          finalOpenEnds: p.openEnds,
          finalOpenSum: p.openSum,
          finalBoard: p.nextBoard,
          drawCostAccum: node.drawCostAccum + dc,
        };

        if (p.turnContinues) {
          nextFrontier.push(child);
        } else {
          if (child.totalPoints > bestLeaf.totalPoints) bestLeaf = child;
        }
      }
    }

    if (nextFrontier.length === 0) break;

    nextFrontier.sort((a, b) => b.totalPoints - a.totalPoints);
    frontier = nextFrontier.slice(0, width * 2);

    for (const node of frontier) {
      if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
    }
  }

  for (const node of frontier) {
    if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
  }

  return bestLeaf;
}

// ─── Branch discipline ────────────────────────────────────────────────────────

function branchPenalty(
  move: Move,
  state: BotMatchState,
  holdWeights: Map<string, number>,
): number {
  if (!move.tile || !isDoubleTile(move.tile)) return 0;
  const pip = move.tile.low;

  const ourFollowups = state.players.bot.hand.filter(
    (t) => (t.low === pip || t.high === pip) && !(t.low === pip && t.high === pip),
  ).length;

  const oppFollowupWeight = Array.from(holdWeights.entries())
    .filter(([k]) => {
      const parts = k.split('|');
      const lo = parseInt(parts[0], 10);
      const hi = parseInt(parts[1], 10);
      return (lo === pip || hi === pip) && !(lo === pip && hi === pip);
    })
    .reduce((sum, [, w]) => sum + w, 0);

  if (ourFollowups === 0 && oppFollowupWeight > 1.5) return 40 + oppFollowupWeight * 8;
  if (oppFollowupWeight > ourFollowups * 2) return 15 + (oppFollowupWeight - ourFollowups) * 5;
  return 0;
}

/**
 * Aggressively discourage early non-scoring doubles unless strongly supported.
 * This prevents opening the board for the opponent in the first phase of a hand.
 */
function earlyDoubleExposurePenalty(
  move: Move,
  state: BotMatchState,
  holdWeights: Map<string, number>,
  immediateScore: number,
): number {
  if (!move.tile || !isDoubleTile(move.tile)) return 0;

  const tilesOnBoard = boardTileCount(state.board);
  const earlyPhase = tilesOnBoard <= 8;
  if (!earlyPhase) return 0;
  if (immediateScore > 0) return 0; // scoring doubles are still fine

  const pip = move.tile.low;
  const followups = state.players.bot.hand.filter(
    (t) => !isDoubleTile(t) && (t.low === pip || t.high === pip),
  ).length;
  const oppWeightOnPip = Array.from(holdWeights.entries())
    .filter(([k]) => {
      const [lo, hi] = k.split('|').map((n) => parseInt(n, 10));
      return lo === pip || hi === pip;
    })
    .reduce((sum, [, w]) => sum + w, 0);

  // Heavy baseline penalty in opening, softened if we have strong control.
  let penalty = 55 + oppWeightOnPip * 6;
  if (followups >= 3) penalty -= 25;
  else if (followups >= 2) penalty -= 12;

  return Math.max(0, penalty);
}

interface StrategicEval {
  score: number;
  immediateScore: number;
  playableNext: number;
  endControlScore: number;
  endDangerPenalty: number;
  pressureScore: number;
  trapPenalty: number;
  doubleScore: number;
  refillRiskScore: number;
  expectedDrawsIfForced: number;
  goldenBonus: number;
  safeFinishBonus: number;
  exitBonus: number;
  dominantEnd: number | null;
  dominantEndSupport: number;
  orphanTiles: number;
}

interface HardScoredCandidate {
  move: Move;
  strategic: StrategicEval;
  strategicScore: number;
  mcScore: number;
  score: number;
  breakdown: BotChoice['breakdown'];
}

function explainStrategicMove(
  move: Move,
  strategic: StrategicEval | null,
): string {
  if (!move.tile || !strategic) return 'Selected best available move.';
  const tile = `${move.tile.low}-${move.tile.high}`;
  const bits: string[] = [];
  if (strategic.dominantEnd !== null) {
    bits.push(`kept end on ${strategic.dominantEnd} (${strategic.dominantEndSupport} support)`);
  }
  if (strategic.orphanTiles === 0) {
    bits.push('avoided orphan tiles');
  } else {
    bits.push(`left ${strategic.orphanTiles} orphan tile${strategic.orphanTiles === 1 ? '' : 's'}`);
  }
  if (isDoubleTile(move.tile)) {
    bits.push(
      strategic.doubleScore >= 0 ? 'double is supported' : 'double only accepted due to higher overall value',
    );
  }
  if (strategic.pressureScore > 8) bits.push('kept pressure on inferred missing pips');
  if (strategic.endDangerPenalty > 6) {
    if (strategic.dominantEndSupport >= 3) {
      bits.push('kept an easy end because we are long that pip');
    } else {
      bits.push('avoided leaving an easy end (many matching tiles remain unseen)');
    }
  }
  if (strategic.expectedDrawsIfForced > 0) {
    if (strategic.refillRiskScore >= 0) bits.push('forced a late draw sequence');
    else bits.push('avoided risky early refill line');
  }
  if (strategic.goldenBonus > 0) bits.push('recognized golden finish pressure');
  if (strategic.safeFinishBonus > 0) bits.push('kept a deterministic outlet finish');
  if (strategic.exitBonus > 0) bits.push('detected near-exit line');
  return `Played ${tile} to ${bits.join(' and ')}.`;
}

function computeMissingWeightByPip(state: BotMatchState): Map<number, number> {
  const out = new Map<number, number>();
  const nowTurn = state.turnIndex ?? 0;
  const nowHand = state.handNumber ?? 0;

  for (const p of state.opponentKnownMissing ?? []) {
    out.set(p, Math.max(out.get(p) ?? 0, 5));
  }
  for (const p of state.opponentPassedOnEnds ?? []) {
    out.set(p, Math.max(out.get(p) ?? 0, 4));
  }
  for (const ev of state.opponentMissingEvidence ?? []) {
    const handDelta = Math.max(0, nowHand - ev.handNumber);
    const turnDelta = Math.max(0, nowTurn - ev.turnIndex);
    const age = handDelta * 12 + turnDelta;
    const weight = Math.max(2, 18 - age * 1.5);
    out.set(ev.pip, Math.max(out.get(ev.pip) ?? 0, weight));
  }
  return out;
}

function countTilesMatchingAny(tiles: Tile[], ends: number[]): number {
  const endSet = new Set(ends);
  return tiles.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

function countTilesMatchingPip(tiles: Tile[], pip: number): number {
  return tiles.filter((t) => t.low === pip || t.high === pip).length;
}

function expectedDrawsApprox(endsAfter: number[], unseenPool: Tile[]): number {
  if (endsAfter.length === 0 || unseenPool.length === 0) return 1;
  const unseenMatchCount = countTilesMatchingAny(unseenPool, endsAfter);
  const unseenTotal = unseenPool.length;
  const ratio = (unseenTotal / Math.max(1, unseenMatchCount)) * 0.5;
  return Math.max(1, Math.min(6, ratio));
}

function estimateOpponentCanPlayProbability(
  openEnds: number[],
  unseenPool: Tile[],
  opponentTileCount: number,
): number {
  if (openEnds.length === 0 || unseenPool.length === 0 || opponentTileCount <= 0) return 0;
  const endSet = new Set(openEnds);
  const matchCount = unseenPool.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
  if (matchCount <= 0) return 0;
  const pSingle = Math.min(1, matchCount / unseenPool.length);
  const pNone = Math.pow(1 - pSingle, Math.max(0, opponentTileCount));
  return Math.max(0, Math.min(1, 1 - pNone));
}

function countValueOccurrences(values: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function hasHubWithTwoOpenBranchesOnPip(
  board: BotMatchState['board'],
  pip: number,
): boolean {
  if (!board) return false;
  for (const hub of board.hubDoubles ?? []) {
    let count = 0;
    for (const branch of hub.branches ?? []) {
      if (!branch) continue;
      if (branch.openEnd === pip) count += 1;
    }
    if (count >= 2) return true;
  }
  return false;
}

function hasNearSafeFinishSetup(
  state: BotEvalState,
  handAfter: Tile[],
): boolean {
  if (handAfter.length !== 2) return false;
  const pseudo = cloneState(state, {
    players: { ...state.players, bot: { ...state.players.bot, hand: handAfter } },
    board: state.board,
    currentPlayer: 'bot',
    handOpen: true,
  });
  const moves = getLegalMoves(pseudo, 'bot').filter((m) => m.type === 'play');
  for (const m of moves) {
    const p = previewPlayMove(pseudo, 'bot', m);
    if (!p || p.nextHand.length !== 1) continue;
    const lastTile = p.nextHand[0];
    if (p.openEnds.some((e) => lastTile.low === e || lastTile.high === e)) return true;
  }
  return false;
}

function evaluateStrategicMove(
  state: BotEvalState,
  move: Move,
  holdWeights: Map<string, number>,
  strength: TierStrength = 'base',
): StrategicEval {
  const p = previewPlayMove(state, 'bot', move);
  if (!p || !move.tile) {
    return {
      score: -Infinity,
      immediateScore: 0,
      playableNext: 0,
      endControlScore: 0,
      endDangerPenalty: 0,
      pressureScore: 0,
      trapPenalty: 0,
      doubleScore: 0,
      refillRiskScore: 0,
      expectedDrawsIfForced: 0,
      goldenBonus: 0,
      safeFinishBonus: 0,
      exitBonus: 0,
      dominantEnd: null,
      dominantEndSupport: 0,
      orphanTiles: 0,
    };
  }

  const handAfter = p.nextHand;
  const endsAfter = p.openEnds;
  const totalTilesAfter = handAfter.length + getOpponentTileCount(state);
  const phase = phaseFor(handAfter.length, totalTilesAfter);
  const freq = pipTileFrequency(handAfter);
  const endsBefore = inferOpenEndsFromState(state);
  const missingWeights = computeMissingWeightByPip(state);
  const unseenPool = buildUnseenPool(state);

  const endSupportWeight = phase === 'early' ? 7 : phase === 'mid' ? 5 : 3;
  const endWeakPenalty = phase === 'early' ? 8 : phase === 'mid' ? 6 : 3;

  const endControlScore =
    endsAfter.reduce((sum, e) => sum + endSupportWeight * (freq[e] ?? 0), 0) -
    endsAfter.reduce((sum, e) => sum + endWeakPenalty * Math.max(0, 2 - (freq[e] ?? 0)), 0);
  let dominantEnd: number | null = null;
  let dominantEndSupport = -1;
  for (const e of endsAfter) {
    const s = freq[e] ?? 0;
    if (s > dominantEndSupport) {
      dominantEndSupport = s;
      dominantEnd = e;
    }
  }

  const dangerWeight = 2.0;
  let endDangerPenalty = endsAfter.reduce((sum, e) => {
    const availableMatches = countTilesMatchingPip(unseenPool, e);
    const support = freq[e] ?? 0;
    return sum + (dangerWeight * availableMatches) / (1 + 0.6 * support);
  }, 0);

  const pressureBonus = endsAfter.reduce((sum, e) => sum + (missingWeights.get(e) ?? 0), 0);
  const pressurePenalty = endsBefore
    .filter((e) => !endsAfter.includes(e))
    .reduce((sum, e) => sum + (missingWeights.get(e) ?? 0), 0);
  const pressureScore = pressureBonus - pressurePenalty;

  const playableNext = countPlayableTiles(handAfter, endsAfter);
  const orphanTiles = countOrphanTiles(handAfter, endsAfter);
  const bottleneck = playableNext <= 1 ? 1 : 0;
  const targetPlayable = phase === 'early' ? 3 : phase === 'mid' ? 2 : 1;

  const orphanPenalty = phase === 'early' ? 18 : phase === 'mid' ? 15 : 9;
  const bottleneckPenalty = phase === 'early' ? 36 : phase === 'mid' ? 26 : 12;
  const lowMobilityPenalty = phase === 'early' ? 10 : phase === 'mid' ? 8 : 4;

  const trapPenalty =
    orphanPenalty * orphanTiles +
    bottleneckPenalty * bottleneck +
    lowMobilityPenalty * Math.max(0, targetPlayable - playableNext);

  const followUps = isDoubleTile(move.tile)
    ? handAfter.filter((t) => t.low === move.tile!.low || t.high === move.tile!.low).length
    : 0;
  const oppMobilityAfter = estimateOpponentMobilityApprox(endsAfter, holdWeights);
  const oppMobilityBefore = estimateOpponentMobilityApprox(inferOpenEndsFromState(state), holdWeights);
  const oppDelta = Math.max(0, oppMobilityAfter - oppMobilityBefore);

  let doubleScore = 0;
  if (isDoubleTile(move.tile)) {
    // Strong discipline rule: early unsupported non-scoring doubles are
    // almost always bad unless forced.
    if (phase === 'early' && followUps === 0 && p.immediateScore === 0) {
      doubleScore -= 220;
    }
    if (phase === 'early' && followUps === 0) doubleScore -= 65;
    doubleScore += Math.min(2, followUps) * 14;
    if (followUps === 0) doubleScore -= 26;
    if (oppDelta > Math.max(0, playableNext)) {
      doubleScore -= 20 + (oppDelta - Math.max(0, playableNext)) * 8;
    }
  }

  // Keep prior double guardrails; they still help in branch-rich boards.
  const branchPen = branchPenalty(move, state, holdWeights);
  const earlyDoublePen = earlyDoubleExposurePenalty(move, state, holdWeights, p.immediateScore);
  doubleScore -= branchPen + earlyDoublePen;

  let exitBonus = 0;
  if (handAfter.length <= 3) {
    const after = cloneState(state, {
      board: p.nextBoard,
      players: { ...state.players, bot: { ...state.players.bot, hand: p.nextHand } },
      currentPlayer: p.turnContinues ? 'bot' : 'you',
    });
    if (hasExitInTwoMoves(after)) exitBonus += 140;
  }

  let refillRiskScore = 0;
  let expectedDrawsIfForced = 0;
  let forcedDraw = false;
  const afterUs = simulateAfterPlay(state, 'bot', move);
  if (afterUs && !afterUs.handOver && afterUs.currentPlayer === 'you') {
    const oppPlayProbability = estimateOpponentCanPlayProbability(
      inferOpenEndsFromState(afterUs),
      buildUnseenPool(afterUs),
      getOpponentTileCount(afterUs),
    );
    if (oppPlayProbability < 0.55 && afterUs.boneyard.length > 2) {
      forcedDraw = true;
      expectedDrawsIfForced = expectedDrawsApprox(endsAfter, unseenPool);
      const certainty = Math.max(0.25, 1 - oppPlayProbability);
      if (phase === 'early') {
        // Early forced draws often refill the opponent into chains; penalize very heavily.
        refillRiskScore -= (220 + expectedDrawsIfForced * 25) * certainty;
      } else if (phase === 'mid') {
        refillRiskScore -= expectedDrawsIfForced * 4 * certainty;
      } else {
        refillRiskScore += expectedDrawsIfForced * 8 * certainty;
      }
    }
  }

  const outletTiles = handAfter.filter((t) => endsAfter.some((e) => t.low === e || t.high === e));
  const outletCount = outletTiles.length;
  let goldenBonus = 0;
  let safeFinishBonus = 0;

  if (state.boneyard.length > 2 && handAfter.length <= 2 && exitBonus === 0 && outletTiles.some(isDoubleTile)) {
    goldenBonus = 90;
    const endFreq = countValueOccurrences(endsAfter);
    const outletPips = new Set<number>();
    for (const t of outletTiles) {
      if (endsAfter.includes(t.low)) outletPips.add(t.low);
      if (endsAfter.includes(t.high)) outletPips.add(t.high);
    }
    const hasRepeatedOutletEnd = Array.from(outletPips).some((pip) => (endFreq.get(pip) ?? 0) > 1);
    if (hasRepeatedOutletEnd) goldenBonus += 30;
    const hasHubOutlet = Array.from(outletPips).some((pip) => hasHubWithTwoOpenBranchesOnPip(p.nextBoard, pip));
    if (hasHubOutlet) goldenBonus += 30;
    const drawable = Math.max(0, (afterUs?.boneyard.length ?? state.boneyard.length) - 2);
    if (drawable <= 6) goldenBonus += 20;
  }

  if (handAfter.length === 1 && outletCount >= 1) {
    safeFinishBonus += 140;
  } else if (forcedDraw && handAfter.length === 2 && hasNearSafeFinishSetup(
    cloneState(state, { board: p.nextBoard }),
    handAfter,
  )) {
    safeFinishBonus += 90;
  }

  if (goldenBonus > 0) {
    refillRiskScore *= 0.25;
  }
  if (goldenBonus > 0 || safeFinishBonus > 0) {
    endDangerPenalty *= 0.25;
  }

  const winTarget = state.winningScore ?? WIN_TARGET;
  const youScore = state.players.you.score;
  const botScore = state.players.bot.score;
  const youProximity = youScore / winTarget;
  const botProximity = botScore / winTarget;
  const oppNearWin = youProximity >= 0.85;
  const oppTileCount = getOpponentTileCount(state);
  const isMaster = strength === 'master';

  let adjustedEndDanger = endDangerPenalty;
  if (isMaster) {
    if (oppNearWin) adjustedEndDanger *= 1.85;
    else if (youProximity >= 0.7) adjustedEndDanger *= 1.35;
    if (phase === 'late') adjustedEndDanger *= 1.2;
    if (oppNearWin && oppTileCount <= 2) {
      adjustedEndDanger += oppMobilityAfter * 14;
    }
  }

  let adjustedSafeFinish = safeFinishBonus;
  let outBlockBonus = 0;
  if (isMaster && (oppNearWin || phase === 'late') && oppTileCount <= 3) {
    adjustedSafeFinish *= oppNearWin ? 1.35 : 1.15;
    if (afterUs && !afterUs.handOver && afterUs.currentPlayer === 'you') {
      const blockEnds = inferOpenEndsFromState(afterUs);
      const blockPool = buildUnseenPool(afterUs);
      const blockProb = estimateOpponentCanPlayProbability(blockEnds, blockPool, oppTileCount);
      if (blockProb < 0.45) {
        outBlockBonus += 70 + (3 - oppTileCount) * 28;
        if (blockProb < 0.25) outBlockBonus += 35;
      }
    }
  }

  let adjustedPressure = pressureScore;
  if (isMaster && missingWeights.size > 0) {
    adjustedPressure *= oppNearWin ? 1.4 : phase === 'late' ? 1.2 : 1.0;
  }

  let leadProtectBonus = 0;
  if (isMaster && botProximity >= 0.85 && youProximity < 0.75 && phase === 'late') {
    leadProtectBonus += 45;
  }
  if (isMaster && oppNearWin && p.immediateScore <= 2 && outBlockBonus > 0) {
    leadProtectBonus += 30;
  }

  const immediateWeight =
    isMaster && oppNearWin ? 22 :
    isMaster && phase === 'late' ? 26 :
    isMaster && phase === 'mid' && youProximity >= 0.5 ? 30 :
    34;

  const unloadTieBreaker = (move.tile.low + move.tile.high) * 0.5;
  const score =
    p.immediateScore * immediateWeight +
    endControlScore -
    adjustedEndDanger -
    trapPenalty +
    adjustedPressure +
    doubleScore +
    refillRiskScore +
    goldenBonus +
    adjustedSafeFinish +
    outBlockBonus +
    leadProtectBonus +
    playableNext * (isMaster && phase === 'late' ? 4 : 3) +
    unloadTieBreaker +
    exitBonus;

  return {
    score,
    immediateScore: p.immediateScore,
    playableNext,
    endControlScore,
    endDangerPenalty,
    pressureScore,
    trapPenalty,
    doubleScore,
    refillRiskScore,
    expectedDrawsIfForced,
    goldenBonus,
    safeFinishBonus,
    exitBonus,
    dominantEnd,
    dominantEndSupport: Math.max(0, dominantEndSupport),
    orphanTiles,
  };
}

function nextPlayer(player: 'bot' | 'you'): 'bot' | 'you' {
  return player === 'bot' ? 'you' : 'bot';
}

function simulateAfterPlay(
  state: BotEvalState,
  player: 'bot' | 'you',
  move: Move,
): BotMatchState | null {
  if (FAIR_BOT_MODE && player === 'you') {
    warnFairHiddenAccess("simulateAfterPlay(..., 'you', ...)");
    return null;
  }
  const p = previewPlayMove(state, player, move);
  if (!p) return null;
  const handAfter = p.nextHand;
  const players = {
    ...state.players,
    [player]: {
      ...state.players[player],
      hand: handAfter,
      score: state.players[player].score + p.immediateScore,
    },
  };
  return cloneState(state, {
    board: p.nextBoard,
    players,
    handOpen: true,
    currentPlayer: handAfter.length === 0 ? nextPlayer(player) : (p.turnContinues ? player : nextPlayer(player)),
    handOver: handAfter.length === 0 ? true : state.handOver,
  });
}

function twoPlyWorstCaseValue(
  state: BotEvalState,
  ourMove: Move,
  holdWeights: Map<string, number>,
  strength: TierStrength = 'base',
): number {
  const afterUs = simulateAfterPlay(state, 'bot', ourMove);
  if (!afterUs) return -Infinity;
  if (afterUs.handOver || afterUs.players.bot.hand.length === 0) return 1_000_000;

  // If our turn continues, score our best immediate continuation.
  if (afterUs.currentPlayer === 'bot') {
    const replies = getLegalMoves(afterUs, 'bot').filter((m) => m.type === 'play');
    if (replies.length === 0) return 120;
    return Math.max(...replies.map((m) => evaluateStrategicMove(afterUs, m, holdWeights, strength).score));
  }

  const ends = inferOpenEndsFromState(afterUs);
  const unseen = buildUnseenPool(afterUs);
  const oppPlayProb = estimateOpponentCanPlayProbability(
    ends,
    unseen,
    getOpponentTileCount(afterUs),
  );
  const openSum = afterUs.board ? computeOpenEndsSum(afterUs.board) : 0;
  const threat = opponentThreat(ends, openSum, holdWeights);
  const draws = expectedDrawsApprox(ends, unseen);
  const totalTiles = afterUs.players.bot.hand.length + getOpponentTileCount(afterUs);
  const phase = phaseFor(afterUs.players.bot.hand.length, totalTiles);
  const youProx = afterUs.players.you.score / WIN_TARGET;
  const isMaster = strength === 'master';
  const defenseScale =
    isMaster && youProx >= 0.85 ? 1.65 :
    isMaster && youProx >= 0.7 ? 1.3 :
    1.0;
  const threatWeight = isMaster ? 28 : 18;
  const oppTiles = getOpponentTileCount(afterUs);
  const lowTileBlock =
    isMaster && oppTiles <= 2 && (phase === 'late' || youProx >= 0.7)
      ? (1 - oppPlayProb) * 55
      : 0;

  if (afterUs.boneyard.length > 2 && oppPlayProb < 0.35) {
    if (phase === 'early') return -260 - draws * 26;
    if (phase === 'mid') return (110 - draws * 5) * defenseScale;
    return (230 + draws * 10 + lowTileBlock) * defenseScale;
  }

  return (1 - oppPlayProb) * 90 * defenseScale - oppPlayProb * 70 * defenseScale - threat * threatWeight + lowTileBlock;
}

// ─── Endgame minimax ──────────────────────────────────────────────────────────

const BONEYARD_LOCKED = 2; // mirrors botEngine constant

/** Endgame search draw model: sample from unseen pool; never read boneyard stack order. */
function simulateDrawUntilPlayable(
  state: BotEvalState,
  player: 'bot' | 'you',
  rng: () => number,
): BotEvalState {
  let current = state;
  while (current.boneyard.length > BONEYARD_LOCKED) {
    const unseen = buildUnseenPool(current);
    if (unseen.length === 0) break;
    const drawn = unseen[Math.floor(rng() * unseen.length)]!;
    const newHand = [...current.players[player].hand, drawn];
    current = cloneState(current, {
      boneyard: current.boneyard.slice(0, -1),
      players: {
        ...current.players,
        [player]: { ...current.players[player], hand: newHand },
      },
    });
    const hasMoves = getLegalMoves(cloneState(current, { currentPlayer: player }), player).some(
      (m) => m.type === 'play',
    );
    if (hasMoves) break;
  }
  return current;
}

function minimaxFull(
  state: BotEvalState,
  depth: number,
  isBot: boolean,
  alpha: number,
  beta: number,
  pointsAccum: number,
  rng: () => number,
  passDepth: number = 0,
  deadlineMs: number = Infinity,
): number {
  if (performance.now() > deadlineMs) {
    const botPips = pipSum(state.players.bot.hand);
    const youPips = pipSum(state.players.you.hand);
    return pointsAccum * 100 + (youPips - botPips);
  }

  if (state.handOver || state.gameOver || depth === 0) {
    const botPips = pipSum(state.players.bot.hand);
    const youPips = pipSum(state.players.you.hand);
    return pointsAccum * 100 + (youPips - botPips);
  }

  const player = isBot ? 'bot' : 'you';
  const moves = getLegalMoves(state, player).filter((m) => m.type === 'play');

  if (moves.length === 0) {
    if (passDepth >= 2) {
      const botPips = pipSum(state.players.bot.hand);
      const youPips = pipSum(state.players.you.hand);
      return pointsAccum * 100 + (youPips - botPips);
    }

    if (state.boneyard.length > BONEYARD_LOCKED) {
      const drawnState = simulateDrawUntilPlayable(state, player, rng);
      const afterDrawState = cloneState(drawnState, { currentPlayer: player });
      return minimaxFull(afterDrawState, depth - 1, isBot, alpha, beta, pointsAccum, rng, passDepth, deadlineMs);
    }

    const passedState = cloneState(state, { currentPlayer: isBot ? 'you' : 'bot' });
    return minimaxFull(passedState, depth - 1, !isBot, alpha, beta, pointsAccum, rng, passDepth + 1, deadlineMs);
  }

  const orderedMoves = [...moves].sort((a, b) => {
    const pa = previewPlayMove(state, player, a);
    const pb = previewPlayMove(state, player, b);
    const scoreDiff = (pb?.immediateScore ?? 0) - (pa?.immediateScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return compareMoveStable(a, b);
  });

  if (isBot) {
    let best = -Infinity;
    for (const move of orderedMoves) {
      const p = previewPlayMove(state, 'bot', move);
      if (!p) continue;
      const next = cloneState(state, {
        board: p.nextBoard,
        currentPlayer: p.turnContinues ? 'bot' : 'you',
        players: { ...state.players, bot: { ...state.players.bot, hand: p.nextHand } },
      });
      const val = minimaxFull(
        next,
        depth - 1,
        p.turnContinues,
        alpha,
        beta,
        pointsAccum + p.immediateScore,
        rng,
        0,
        deadlineMs,
      );
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of orderedMoves) {
      const p = previewPlayMove(state, 'you', move);
      if (!p) continue;
      const next = cloneState(state, {
        board: p.nextBoard,
        currentPlayer: p.turnContinues ? 'you' : 'bot',
        players: { ...state.players, you: { ...state.players.you, hand: p.nextHand } },
      });
      const val = minimaxFull(
        next,
        depth - 1,
        p.turnContinues ? false : true,
        alpha,
        beta,
        pointsAccum - p.immediateScore,
        rng,
        0,
        deadlineMs,
      );
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ─── Monte Carlo move evaluation ──────────────────────────────────────────────

function mcEvaluateMove(
  move: Move,
  state: BotMatchState,
  pool: Tile[],
  holdWeights: Map<string, number>,
  mcSamples: number = MC_SAMPLES,
  difficulty: BotDifficulty = 'hard',
): number {
  const botScore = state.players.bot.score;
  const youScore = state.players.you.score;
  const boneyardSize = state.boneyard.length;
  const isMaster = difficulty === 'master';

  const preview = previewPlayMove(state, 'bot', move);
  if (!preview) return -Infinity;
  if (botScore + preview.immediateScore >= WIN_TARGET) return 1_000_000;

  const totalTiles = state.players.bot.hand.length + getOpponentTileCount(state);
  const { depth, width } = dynamicChainParams(
    state.players.bot.hand.length,
    totalTiles,
    isMaster ? 'master' : 'base',
  );
  const chain = searchChainTree(state, move, depth, width);
  if (!chain) return -Infinity;

  const { totalPoints, chainLength, finalHand, finalOpenEnds, finalOpenSum, drawCostAccum } = chain;

  const selfSetup = selfOpportunity(finalOpenEnds, finalOpenSum, finalHand);
  const mobilityAfter = handMobility(finalHand, finalOpenEnds);
  const finalEndSet = new Set(finalOpenEnds);
  const strandedDoubles = finalHand.filter((t) => isDoubleTile(t) && !finalEndSet.has(t.low)).length;
  const finalPips = pipSum(finalHand);
  const isLateGame = boneyardSize <= 6 || finalHand.length <= 3;
  const pipBurdenPenalty = isLateGame ? finalPips * (isMaster ? 2.25 : 1.5) : finalPips * 0.1;

  const branchPen = branchPenalty(move, state, holdWeights);

  const botProximity = botScore / WIN_TARGET;
  const youProximity = youScore / WIN_TARGET;
  const aggressionBoost = isMaster
    ? (botProximity >= 0.85 ? 1.25 : botProximity >= 0.7 ? 1.08 : 1.0)
    : (botProximity >= 0.85 ? 1.4 : botProximity >= 0.7 ? 1.2 : 1.0);
  const defenseMultiplier = isMaster
    ? (youProximity >= 0.85 ? 4.8 :
       youProximity >= 0.7 ? 2.75 :
       youProximity >= 0.5 ? 1.55 : 1.05)
    : (youProximity >= 0.85 ? 3.0 :
       youProximity >= 0.7 ? 1.8 :
       youProximity >= 0.5 ? 1.2 : 1.0);

  const youHandSize = getOpponentTileCount(state);
  const opponentLowTiles = youHandSize <= 2 && isLateGame;
  const defenseBoost = opponentLowTiles && isMaster ? 1.22 : 1.0;
  const sampledHands = sampleOpponentHands(
    pool,
    holdWeights,
    youHandSize,
    mcSamples,
    createStatePrng(state, `mc:${tileKey(move.tile ?? { low: 0, high: 0 })}:${move.position}`),
  );

  let totalThreat = 0;
  let totalThreatBefore = 0;

  for (const sampledHand of sampledHands) {
    const threatAfter = exactOpponentThreat(finalOpenEnds, finalOpenSum, sampledHand);
    const threatBefore = exactOpponentThreat(preview.openEnds, preview.openSum, sampledHand);
    totalThreat += threatAfter;
    totalThreatBefore += threatBefore;
  }

  const avgThreatAfter = sampledHands.length > 0 ? totalThreat / sampledHands.length : 0;
  const avgThreatBefore = sampledHands.length > 0 ? totalThreatBefore / sampledHands.length : 0;
  const threatDelta = avgThreatBefore - avgThreatAfter;

  const threatDeltaWeight = isMaster ? 52 : 35;
  const lingeringThreatWeight = isMaster ? 34 : 22;
  const chainPointsWeight = isMaster ? 108 : 120;
  const drawCostWeight = isMaster ? 18 : 12;

  return (
    totalPoints * chainPointsWeight * aggressionBoost +
    selfSetup * 25 +
    threatDelta * threatDeltaWeight * defenseMultiplier * defenseBoost +
    -avgThreatAfter * lingeringThreatWeight * defenseMultiplier * defenseBoost +
    mobilityAfter * (isMaster && isLateGame ? 10 : 8) +
    -strandedDoubles * (isMaster ? 42 : 35) +
    -branchPen +
    -pipBurdenPenalty +
    -drawCostAccum * drawCostWeight +
    (chainLength > 1 ? chainLength * (isMaster ? 6 : 5) : 0)
  );
}

// ─── Tier-based move selection ────────────────────────────────────────────────

/**
 * Rank-based exponential weighted sampling over a sorted candidate pool.
 * weight[i] = rankDecay^i, so the top candidate always has weight 1.0 and each
 * subsequent rank decays by the factor. Using rank rather than raw score gives
 * predictable selection probabilities regardless of score magnitude.
 */
function weightedSelectFromPool<T>(pool: T[], rand: () => number, rankDecay: number): T {
  if (pool.length <= 1) return pool[0];
  const weights = pool.map((_, i) => Math.pow(rankDecay, i));
  const totalW = weights.reduce((s, w) => s + w, 0);
  let roll = rand() * totalW;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Applies tier-specific selection to a sorted (best-first) candidate list.
 * Returns the selected item, or null if the caller should substitute a truly
 * random legal move (only possible when cfg.pRandom > 0, i.e. Rookie).
 *
 * Selection flow:
 *   1. pRandom roll  → null  (caller picks any legal move uniformly)
 *   2. pBest roll    → pool[0] (best move)
 *   3. otherwise     → rank-decayed sample from pool[1..poolSize-1]
 */
function applyTierSelect<T extends { score: number }>(
  sorted: T[],
  rand: () => number,
  cfg: TierSelectCfg,
): T | null {
  if (cfg.pRandom > 0 && rand() < cfg.pRandom) return null;
  const pool = sorted.slice(0, Math.min(cfg.poolSize, sorted.length));
  if (pool.length <= 1) return pool[0];
  if (rand() < cfg.pBest) return pool[0];
  return weightedSelectFromPool(pool.slice(1), rand, cfg.rankDecay);
}

// ─── Endgame depth scaling ────────────────────────────────────────────────────

function endgameDepth(totalTiles: number): number {
  if (totalTiles <= 2) return 12;
  if (totalTiles <= 4) return 10;
  if (totalTiles <= 6) return 8;
  return 6; // 7-8 tiles
}

export function evaluateMove(
  inputState: BotVisibleState | BotMatchState,
  move: Move,
  difficulty: BotDifficulty = 'hard'
): BotChoice | null {
  const state = asVisibleState(inputState);
  const p = previewPlayMove(state, state.currentPlayer, move);
  if (!p || !move.tile) return null;

  const pool = buildUnseenPool(state);
  const missing = inferMissingPips(state);
  const weights = opponentHoldWeights(pool, missing);
  const strength = tierStrengthFromDifficulty(difficulty);

  const strategic = evaluateStrategicMove(state, move, weights, strength);
  const mc = mcEvaluateMove(
    move,
    state,
    pool,
    weights,
    difficulty === 'master' ? 20 : MC_SAMPLES,
    difficulty,
  );
  const mcBlend = difficulty === 'master' ? 0.45 : 0.35;

  return {
    move,
    score: strategic.score + mc * mcBlend,
    explanation: explainStrategicMove(move, strategic),
    breakdown: {
      immediate: p.immediateScore,
      doubleBias: isDoubleTile(move.tile) ? 1 : 0,
      mobility: strategic.playableNext,
      denial: -opponentThreat(p.openEnds, p.openSum, weights),
      unload: move.tile.low + move.tile.high,
      replyRisk: opponentThreat(p.openEnds, p.openSum, weights),
    },
  };
}

// ─── Public API ───────────────────────────────────────────────

export function chooseBotMove(
  inputState: BotVisibleState | BotMatchState,
  difficulty: BotDifficulty = 'hard',
): BotChoice | null {
  const state = asVisibleState(inputState);
  const profile = (inputState as typeof inputState & {
    policyProfile?: 'scoring' | 'blocking' | 'closing' | 'default';
    config?: { policyProfile?: 'scoring' | 'blocking' | 'closing' | 'default' };
  }).config?.policyProfile;
  const t0 = performance.now();
  const isDevRuntime = Boolean(import.meta.env?.DEV);

  const totalTilesForLog = state.players.bot.hand.length + getOpponentTileCount(state);

  function done(result: null, label?: string): null;
  function done(result: BotChoice, label?: string): BotChoice;
  function done(result: BotChoice | null, label?: string): BotChoice | null {
    if (isDevRuntime) {
      const ms = (performance.now() - t0).toFixed(1);
      console.debug(`[Fritz] chooseBotMove (${difficulty}, ${totalTilesForLog} tiles${label ? ', ' + label : ''}): ${ms}ms`);
    }
    return result;
  }

  const candidates = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
  if (candidates.length === 0) return done(null, 'no-moves');

  function greedyFallback(label: string): BotChoice {
    const best = candidates
      .map((m) => {
        const p = previewPlayMove(state, 'bot', m);
        return {
          move: m,
          score: (p?.immediateScore ?? 0) * 60 + (m.tile ? m.tile.low + m.tile.high : 0) * 0.5,
          breakdown: {
            immediate: p?.immediateScore ?? 0,
            doubleBias: m.tile && isDoubleTile(m.tile) ? 1 : 0,
            mobility: 0, denial: 0,
            unload: (m.tile?.low ?? 0) + (m.tile?.high ?? 0),
            replyRisk: 0,
          },
        };
      })
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;
        return compareMoveStable(a.move, b.move);
      })[0];
    return done(best, label)
  }

  if (difficulty === 'casual') {
    // Rookie scores on immediate points + pip unload only (overvalues simple playability,
    // undervalues control and chaining — intentional style bias).
    const tierRand = createStatePrng(state, 'tier-select');
    const cfg = TIER_SELECT.casual;

    const scored = candidates
      .map((m) => {
        const p = previewPlayMove(state, 'bot', m);
        if (!p) return null;
        return {
          m,
          p,
          score: p.immediateScore * 10 + (m.tile?.low ?? 0) + (m.tile?.high ?? 0),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;
        return compareMoveStable(a.m, b.m);
      });

    if (scored.length === 0) return null;

    // applyTierSelect returns null when the pRandom branch fires; in that case
    // pick uniformly from all legal play moves (any legal move is plausible).
    const tierResult = applyTierSelect(scored, tierRand, cfg);
    const chosen = tierResult ?? scored[Math.floor(tierRand() * scored.length)];

    return done({
      move: chosen.m,
      score: chosen.p.immediateScore,
      explanation: `Played ${chosen.m.tile?.low}-${chosen.m.tile?.high} for immediate value.`,
      breakdown: {
        immediate: chosen.p.immediateScore,
        doubleBias: chosen.m.tile && isDoubleTile(chosen.m.tile) ? 1 : 0,
        mobility: 0, denial: 0,
        unload: (chosen.m.tile?.low ?? 0) + (chosen.m.tile?.high ?? 0),
        replyRisk: 0,
      },
    }, 'casual')
  }

  if (difficulty === 'standard') {
    // Standard slightly overvalues immediate score relative to board control — the
    // immediateScore weight (60) dominates, but threat/mobility/self-opportunity are
    // considered. Intentional style bias vs Elite's full multi-factor eval.
    const tierRand = createStatePrng(state, 'tier-select');
    const cfg = TIER_SELECT.standard;
    const pool = buildUnseenPool(state);
    const missing = inferMissingPips(state);
    const weights = opponentHoldWeights(pool, new Set(missing));

    const scored = candidates
      .map((m) => {
        const p = previewPlayMove(state, 'bot', m);
        if (!p) return null;
        const threat = opponentThreat(p.openEnds, p.openSum, weights);
        let moveScore =
            p.immediateScore * 60 +
            selfOpportunity(p.openEnds, p.openSum, p.nextHand) * 10 +
            -threat * 8 +
            handMobility(p.nextHand, p.openEnds) * 5 +
            (m.tile ? m.tile.low + m.tile.high : 0) * 0.5;

        if (profile === 'scoring') {
          moveScore += p.immediateScore * 25;
        } else if (profile === 'blocking') {
          moveScore += -threat * 20;
        } else if (profile === 'closing') {
          moveScore += (m.tile ? m.tile.low + m.tile.high : 0) * 5;
        }

        return {
          move: m,
          score: moveScore,
          breakdown: {
            immediate: p.immediateScore,
            doubleBias: m.tile && isDoubleTile(m.tile) ? 1 : 0,
            mobility: handMobility(p.nextHand, p.openEnds),
            denial: -threat,
            unload: (m.tile?.low ?? 0) + (m.tile?.high ?? 0),
            replyRisk: threat,
          },
        };
      })
      .filter(Boolean) as Array<{ move: Move; score: number; breakdown: BotChoice['breakdown'] }>;

    scored.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return compareMoveStable(a.move, b.move);
    });
    if (!scored[0]) return null;

    // applyTierSelect never returns null for standard (pRandom = 0), so the ?? fallback
    // is purely for type safety.
    const chosen = applyTierSelect(scored, tierRand, cfg) ?? scored[0];
    return done({ move: chosen.move, score: chosen.score, breakdown: chosen.breakdown }, 'standard')
  }

  // ── Hard / Master ─────────────────────────────────────────────────────────
  const pool = buildUnseenPool(state);
  const missing = inferMissingPips(state);
  const weights = opponentHoldWeights(pool, missing);
  const totalTiles = totalTilesForLog;
  const strength = tierStrengthFromDifficulty(difficulty);
  const mcSampleCount = difficulty === 'master' ? 20 : MC_SAMPLES;
  const mcBlend = difficulty === 'master' ? 0.45 : 0.35;
  // Seeded per-state PRNG for tier selection — deterministic for a given position
  // so Fritz doesn't oscillate unpredictably when the same board recurs.
  const tierRand = createStatePrng(state, 'tier-select');

  const masterEndgameThreshold = 12;
  const youNearWin = state.players.you.score / (state.winningScore ?? WIN_TARGET) >= 0.85;
  if (difficulty === 'master' && totalTiles <= masterEndgameThreshold) {
    const SAMPLE_COUNT = 16;
    const depth = endgameDepth(totalTiles);
    const deadlineMs = performance.now() + MASTER_ENDGAME_BUDGET_MS;
    const drawRng = createStatePrng(state, 'minimax-draw');
    const moveVotes = new Map<Move, number>();
    const moveScoreTotals = new Map<Move, number>();

    const sampledHands = sampleOpponentHands(
      pool,
      weights,
      getOpponentTileCount(state),
      SAMPLE_COUNT,
      createStatePrng(state, 'master-endgame'),
    );

    for (const sampledHand of sampledHands) {
      if (performance.now() > deadlineMs) break;

      const knownState = {
        ...state,
        players: {
          bot: state.players.bot,
          you: { ...state.players.you, hand: sampledHand },
        },
      } as BotMatchState;

      let bestMove = candidates[0];
      let bestVal = -Infinity;

      for (const move of candidates) {
        if (performance.now() > deadlineMs) break;
        const p = previewPlayMove(knownState, 'bot', move);
        if (!p) continue;
        const next = cloneState(knownState, {
          board: p.nextBoard,
          currentPlayer: p.turnContinues ? 'bot' : 'you',
          players: { ...knownState.players, bot: { ...knownState.players.bot, hand: p.nextHand } },
        });
        const threatPenalty = opponentThreat(p.openEnds, p.openSum, weights);
        const endgameDefenseWeight = youNearWin ? 48 : 22;
        const val =
          p.immediateScore * 100 +
          minimaxFull(
            next,
            depth,
            p.turnContinues,
            -Infinity,
            Infinity,
            p.immediateScore,
            drawRng,
            0,
            deadlineMs,
          ) -
          threatPenalty * endgameDefenseWeight;
        if (val > bestVal) {
          bestVal = val;
          bestMove = move;
        }
      }

      moveVotes.set(bestMove, (moveVotes.get(bestMove) ?? 0) + 1);
      moveScoreTotals.set(bestMove, (moveScoreTotals.get(bestMove) ?? 0) + bestVal);
    }

    const bestMove =
      [...moveVotes.entries()]
        .sort((a, b) => {
          const voteDiff = b[1] - a[1];
          if (voteDiff !== 0) return voteDiff;
          const scoreDiff = (moveScoreTotals.get(b[0]) ?? -Infinity) - (moveScoreTotals.get(a[0]) ?? -Infinity);
          if (scoreDiff !== 0) return scoreDiff;
          return compareMoveStable(a[0], b[0]);
        })[0]?.[0] ?? candidates[0];
    const bestPreview = previewPlayMove(state, 'bot', bestMove);
    if (!bestPreview) return greedyFallback('master-endgame-fallback');

    return done(
      {
        move: bestMove,
        score:
          bestPreview.immediateScore * 100 +
          (moveVotes.get(bestMove) ?? 0) +
          (moveScoreTotals.get(bestMove) ?? 0) * 0.001,
        explanation: `Played ${bestMove.tile?.low}-${bestMove.tile?.high} from sampled master endgame search.`,
        breakdown: {
          immediate: bestPreview.immediateScore,
          doubleBias: bestMove.tile && isDoubleTile(bestMove.tile) ? 1 : 0,
          mobility: 0,
          denial: 0,
          unload: (bestMove.tile?.low ?? 0) + (bestMove.tile?.high ?? 0),
          replyRisk: 0,
        },
      },
      'master-endgame',
    );
  }

  const prelim: HardScoredCandidate[] = candidates
    .map((move) => {
      const p = previewPlayMove(state, 'bot', move);
      const strategic = evaluateStrategicMove(state, move, weights, strength);
      const mc = mcEvaluateMove(
        move,
        state,
        pool,
        weights,
        mcSampleCount,
        difficulty,
      );
      let moveScore = strategic.score + mc * mcBlend;
      if (profile === 'scoring') {
        moveScore += (p?.immediateScore ?? 0) * 25;
      } else if (profile === 'blocking') {
        const denial = p ? -opponentThreat(p.openEnds, p.openSum, weights) : 0;
        moveScore += denial * 20;
      } else if (profile === 'closing') {
        const unload = (move.tile?.low ?? 0) + (move.tile?.high ?? 0);
        moveScore += unload * 5;
      }

      return {
        move,
        strategic,
        strategicScore: strategic.score,
        mcScore: mc,
        score: moveScore,
        breakdown: {
          immediate: p?.immediateScore ?? 0,
          doubleBias: move.tile && isDoubleTile(move.tile) ? 1 : 0,
          mobility: strategic.playableNext,
          denial: p ? -opponentThreat(p.openEnds, p.openSum, weights) : 0,
          unload: (move.tile?.low ?? 0) + (move.tile?.high ?? 0),
          replyRisk: p ? opponentThreat(p.openEnds, p.openSum, weights) : 0,
        },
      } satisfies HardScoredCandidate;
    })
    .sort((a, b) => {
      const scoreDiff = b.strategicScore - a.strategicScore;
      if (scoreDiff !== 0) return scoreDiff;
      return compareMoveStable(a.move, b.move);
    });

  if (totalTiles <= 16 && prelim.length > 1) {
    const exactDeadlineMs = performance.now() + EXACT_CHAIN_BUDGET_MS;
    const topN = Math.min(4, prelim.length);
    for (let i = 0; i < topN; i++) {
      if (performance.now() > exactDeadlineMs) break;
      const exact = searchExactTurnChain(state, prelim[i].move, exactDeadlineMs);
      if (!exact) continue;
      prelim[i].strategicScore +=
        exact.totalPoints * (strength === 'master' ? 26 : 22) +
        (exact.chainLength > 1 ? exact.chainLength * (strength === 'master' ? 10 : 8) : 0);
      prelim[i].score = prelim[i].strategicScore + prelim[i].mcScore * mcBlend;
    }
    prelim.sort((a, b) => {
      const scoreDiff = b.strategicScore - a.strategicScore;
      if (scoreDiff !== 0) return scoreDiff;
      return compareMoveStable(a.move, b.move);
    });
  }

  if ((ENABLE_TWO_PLY_WORST_CASE || difficulty === 'master') && prelim.length > 1) {
    const N = Math.min(strength === 'master' ? 6 : 5, prelim.length);
    const top = prelim.slice(0, N);
    for (const c of top) {
      const worst = twoPlyWorstCaseValue(state, c.move, weights, strength);
      c.score =
        worst +
        c.strategicScore * (strength === 'master' ? 0.14 : 0.25) +
        c.mcScore * (strength === 'master' ? 0.28 : 0.1);
    }
    top.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return compareMoveStable(a.move, b.move);
    });
    // Master: TIER_SELECT.master has poolSize 1 and pBest 1.0 → always top[0].
    // Elite:  poolSize 3, pBest 0.97 → ~3% non-best. pRandom = 0 so null never returned.
    const chosen = applyTierSelect(top, tierRand, TIER_SELECT[difficulty]) ?? top[0];
    return done(
      {
        move: chosen.move,
        score: chosen.score,
        explanation: explainStrategicMove(chosen.move, chosen.strategic),
        breakdown: chosen.breakdown,
      },
      '2ply',
    );
  }

  prelim.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return compareMoveStable(a.move, b.move);
  });
  const chosen = applyTierSelect(prelim, tierRand, TIER_SELECT[difficulty]) ?? prelim[0];
  return done(
    {
      move: chosen.move,
      score: chosen.score,
      explanation: explainStrategicMove(chosen.move, chosen.strategic),
      breakdown: chosen.breakdown,
    },
    'mc',
  )
}
