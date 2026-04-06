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
 */

import type { Move, Tile } from '../types.ts';
export type { Move, Tile };
import type { BotMatchState } from './botEngine.ts';
import { computeOpenEndsSum, getLegalMoves, previewPlayMove } from './botEngine.ts';

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

// Endgame minimax kicks in when total tiles (bot + you) is at or below this.
const ENDGAME_TILE_THRESHOLD = 8;
const ENABLE_TWO_PLY_WORST_CASE = false;
const FAIR_BOT_MODE = true;
let fairOpponentAccessWarned = false;

function makeDevOpponentHandTrap(): Tile[] {
  return new Proxy([] as Tile[], {
    get(_target, prop) {
      const key = String(prop);
      throw new Error(`[FairBotMode] Illegal access to hidden opponent hand via players.you.hand.${key}`);
    },
  });
}

export function toBotVisibleState(state: BotMatchState): BotVisibleState {
  const isDevRuntime = Boolean((import.meta as any)?.env?.DEV);
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
): Tile[][] {
  const hands: Tile[][] = [];

  for (let s = 0; s < n; s++) {
    const available = [...pool];
    const w = available.map((t) => weights.get(tileKey(t)) ?? 1.0);
    const hand: Tile[] = [];

    for (let i = 0; i < Math.min(handSize, available.length); i++) {
      const totalW = w.reduce((sum, wi, idx) => (available[idx] ? sum + wi : sum), 0);
      if (totalW <= 0) break;

      let rand = Math.random() * totalW;
      let chosen = -1;
      for (let j = 0; j < available.length; j++) {
        if (!available[j]) continue;
        rand -= w[j];
        if (rand <= 0) { chosen = j; break; }
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

// ─── Draw anticipation ────────────────────────────────────────────────────────

function estimateDrawCost(
  nextHand: Tile[],
  openEnds: number[],
  boneyard: Tile[],
): number {
  const endSet = new Set(openEnds);
  const playableAfter = nextHand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
  if (playableAfter > 0) return 0;

  const boneyardAvailable = Math.max(0, boneyard.length - 2);
  if (boneyardAvailable === 0) return 15;

  const playableInBoneyard = boneyard
    .slice(0, boneyardAvailable)
    .filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;

  if (playableInBoneyard === 0) return 20;

  const expectedDraws = boneyardAvailable / playableInBoneyard;
  const avgPip = boneyard.length > 0
    ? boneyard.reduce((s, t) => s + t.low + t.high, 0) / boneyard.length
    : 6;

  return Math.min(expectedDraws * avgPip * 0.4, 25);
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
    drawCostAccum: estimateDrawCost(firstPreview.nextHand, firstPreview.openEnds, state.boneyard),
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
        drawCostAccum: node.drawCostAccum + estimateDrawCost(p.nextHand, p.openEnds, state.boneyard),
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

  const drawCost = estimateDrawCost(
    firstPreview.nextHand,
    firstPreview.openEnds,
    state.boneyard,
  );

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
        .sort((a, b) => b!.val - a!.val)
        .slice(0, width) as Array<{ m: Move; p: NonNullable<ReturnType<typeof previewPlayMove>>; val: number }>;

      for (const { m, p } of scored) {
        const dc = estimateDrawCost(p.nextHand, p.openEnds, state.boneyard);
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

  if (forcedDraw && handAfter.length <= 2 && outletCount >= 1) {
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

  const unloadTieBreaker = (move.tile.low + move.tile.high) * 0.5;
  const score =
    p.immediateScore * 34 +
    endControlScore -
    endDangerPenalty -
    trapPenalty +
    pressureScore +
    doubleScore +
    refillRiskScore +
    goldenBonus +
    safeFinishBonus +
    playableNext * 3 +
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
): number {
  const afterUs = simulateAfterPlay(state, 'bot', ourMove);
  if (!afterUs) return -Infinity;
  if (afterUs.handOver || afterUs.players.bot.hand.length === 0) return 1_000_000;

  // If our turn continues, score our best immediate continuation.
  if (afterUs.currentPlayer === 'bot') {
    const replies = getLegalMoves(afterUs, 'bot').filter((m) => m.type === 'play');
    if (replies.length === 0) return 120;
    return Math.max(...replies.map((m) => evaluateStrategicMove(afterUs, m, holdWeights).score));
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

  if (afterUs.boneyard.length > 2 && oppPlayProb < 0.35) {
    if (phase === 'early') return -260 - draws * 26;
    if (phase === 'mid') return 110 - draws * 5;
    return 230 + draws * 10;
  }

  return (1 - oppPlayProb) * 90 - oppPlayProb * 70 - threat * 18;
}

// ─── Endgame minimax ──────────────────────────────────────────────────────────

const BONEYARD_LOCKED = 2; // mirrors botEngine constant

function simulateDrawUntilPlayable(
  state: BotMatchState,
  player: 'bot' | 'you',
): BotMatchState {
  let current = state;
  // Draw from boneyard until we find a playable tile or boneyard locks
  while (current.boneyard.length > BONEYARD_LOCKED) {
    const [drawn, ...rest] = current.boneyard;
    const newHand = [...current.players[player].hand, drawn];
    current = cloneState(current, {
      boneyard: rest,
      players: {
        ...current.players,
        [player]: { ...current.players[player], hand: newHand },
      },
    });
    // Check if newly drawn tile is playable
    const hasMoves = getLegalMoves(cloneState(current, { currentPlayer: player }), player)
      .some((m) => m.type === 'play');
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
      const drawnState = simulateDrawUntilPlayable(state, player);
      const afterDrawState = cloneState(drawnState, { currentPlayer: player });
      return minimaxFull(afterDrawState, depth - 1, isBot, alpha, beta, pointsAccum, passDepth, deadlineMs);
    }

    const passedState = cloneState(state, { currentPlayer: isBot ? 'you' : 'bot' });
    return minimaxFull(passedState, depth - 1, !isBot, alpha, beta, pointsAccum, passDepth + 1, deadlineMs);
  }

  const orderedMoves = [...moves].sort((a, b) => {
    const pa = previewPlayMove(state, player, a);
    const pb = previewPlayMove(state, player, b);
    return (pb?.immediateScore ?? 0) - (pa?.immediateScore ?? 0);
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
      const val = minimaxFull(next, depth - 1, p.turnContinues, alpha, beta, pointsAccum + p.immediateScore, 0, deadlineMs);
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
      const val = minimaxFull(next, depth - 1, p.turnContinues ? false : true, alpha, beta, pointsAccum - p.immediateScore, 0, deadlineMs);
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

  const preview = previewPlayMove(state, 'bot', move);
  if (!preview) return -Infinity;
  if (botScore + preview.immediateScore >= WIN_TARGET) return 1_000_000;

  const totalTiles = state.players.bot.hand.length + getOpponentTileCount(state);
  const { depth, width } = dynamicChainParams(
    state.players.bot.hand.length,
    totalTiles,
    difficulty === 'master' ? 'master' : 'base',
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
  const pipBurdenPenalty = isLateGame ? finalPips * 1.5 : finalPips * 0.1;

  const branchPen = branchPenalty(move, state, holdWeights);

  const botProximity = botScore / WIN_TARGET;
  const youProximity = youScore / WIN_TARGET;
  const aggressionBoost = botProximity >= 0.85 ? 1.4 : botProximity >= 0.7 ? 1.2 : 1.0;
  const defenseMultiplier =
    youProximity >= 0.85 ? 3.0 :
    youProximity >= 0.7  ? 1.8 :
    youProximity >= 0.5  ? 1.2 : 1.0;

  const youHandSize = getOpponentTileCount(state);
  const sampledHands = sampleOpponentHands(pool, holdWeights, youHandSize, mcSamples);

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

  return (
    totalPoints * 120 * aggressionBoost +
    selfSetup * 25 +
    threatDelta * 35 * defenseMultiplier +
    -avgThreatAfter * 22 * defenseMultiplier +
    mobilityAfter * 8 +
    -strandedDoubles * 35 +
    -branchPen +
    -pipBurdenPenalty +
    -drawCostAccum * 12 +
    (chainLength > 1 ? chainLength * 5 : 0)
  );
}

// ─── Weighted random selection ────────────────────────────────────────────────

function weightedSelect<T extends { score: number }>(scored: T[]): T {
  if (scored.length === 1) return scored[0];
  const top = scored.slice(0, Math.min(3, scored.length));
  const best = top[0].score;
  if (best >= 500_000 || (top.length > 1 && best - top[1].score > 200)) return top[0];

  const weights = [0.65, 0.25, 0.10].slice(0, top.length);
  let cumulative = 0;
  const rand = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < top.length; i++) {
    cumulative += weights[i];
    if (rand <= cumulative) return top[i];
  }
  return top[0];
}

// ─── Endgame depth scaling ────────────────────────────────────────────────────

function endgameDepth(totalTiles: number): number {
  if (totalTiles <= 2) return 12;
  if (totalTiles <= 4) return 10;
  if (totalTiles <= 6) return 8;
  return 6; // 7-8 tiles
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function chooseBotMove(
  inputState: BotVisibleState | BotMatchState,
  difficulty: BotDifficulty = 'hard',
): BotChoice | null {
  const state = asVisibleState(inputState);
  const t0 = performance.now();
  const isDevRuntime = Boolean((import.meta as any)?.env?.DEV);

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
      .sort((a, b) => b.score - a.score)[0];
    return done(best, label)
  }

  if (difficulty === 'casual') {
    const best = candidates
      .map((m) => ({ m, p: previewPlayMove(state, 'bot', m) }))
      .filter(({ p }) => p != null)
      .sort((a, b) => {
        const sa = a.p!.immediateScore * 10 + (a.m.tile?.low ?? 0) + (a.m.tile?.high ?? 0);
        const sb = b.p!.immediateScore * 10 + (b.m.tile?.low ?? 0) + (b.m.tile?.high ?? 0);
        return sb - sa;
      })[0];
    if (!best) return null;
    return done({
      move: best.m,
      score: best.p!.immediateScore,
      explanation: `Played ${best.m.tile?.low}-${best.m.tile?.high} for immediate value.`,
      breakdown: {
        immediate: best.p!.immediateScore,
        doubleBias: best.m.tile && isDoubleTile(best.m.tile) ? 1 : 0,
        mobility: 0, denial: 0,
        unload: (best.m.tile?.low ?? 0) + (best.m.tile?.high ?? 0),
        replyRisk: 0,
      },
    }, 'casual')
  }

  if (difficulty === 'standard') {
    const pool = buildUnseenPool(state);
    const missing = inferMissingPips(state);
    const weights = opponentHoldWeights(pool, new Set(missing));

    const scored = candidates
      .map((m) => {
        const p = previewPlayMove(state, 'bot', m);
        if (!p) return null;
        const threat = opponentThreat(p.openEnds, p.openSum, weights);
        return {
          move: m,
          score:
            p.immediateScore * 60 +
            selfOpportunity(p.openEnds, p.openSum, p.nextHand) * 10 +
            -threat * 8 +
            handMobility(p.nextHand, p.openEnds) * 5 +
            (m.tile ? m.tile.low + m.tile.high : 0) * 0.5,
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

    scored.sort((a, b) => b.score - a.score);
    if (!scored[0]) return null;
    return done({ move: scored[0].move, score: scored[0].score, breakdown: scored[0].breakdown }, 'standard')
  }

  // ── Hard / Master ─────────────────────────────────────────────────────────
  const pool = buildUnseenPool(state);
  const missing = inferMissingPips(state);
  const weights = opponentHoldWeights(pool, missing);
  const totalTiles = totalTilesForLog;

  const masterEndgameThreshold = 12;
  if (difficulty === 'master' && totalTiles <= masterEndgameThreshold) {
    const SAMPLE_COUNT = 16;
    const depth = endgameDepth(totalTiles);
    const deadlineMs = performance.now() + 200;
    const moveVotes = new Map<Move, number>();
    const moveScoreTotals = new Map<Move, number>();

    const sampledHands = sampleOpponentHands(pool, weights, getOpponentTileCount(state), SAMPLE_COUNT);

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
        const val =
          p.immediateScore * 100 +
          minimaxFull(next, depth, p.turnContinues, -Infinity, Infinity, p.immediateScore, 0, deadlineMs);
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
          return (moveScoreTotals.get(b[0]) ?? -Infinity) - (moveScoreTotals.get(a[0]) ?? -Infinity);
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
      const strategic = evaluateStrategicMove(state, move, weights);
      const mc = mcEvaluateMove(
        move,
        state,
        pool,
        weights,
        difficulty === 'master' ? 20 : MC_SAMPLES,
        difficulty,
      );
      return {
        move,
        strategic,
        strategicScore: strategic.score,
        mcScore: mc,
        score: strategic.score + mc * 0.35,
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
    .sort((a, b) => b.strategicScore - a.strategicScore);

  if (totalTiles <= 16 && prelim.length > 1) {
    const exactDeadlineMs = performance.now() + 80;
    const topN = Math.min(4, prelim.length);
    for (let i = 0; i < topN; i++) {
      if (performance.now() > exactDeadlineMs) break;
      const exact = searchExactTurnChain(state, prelim[i].move, exactDeadlineMs);
      if (!exact) continue;
      prelim[i].strategicScore +=
        exact.totalPoints * 22 +
        (exact.chainLength > 1 ? exact.chainLength * 8 : 0);
      prelim[i].score = prelim[i].strategicScore + prelim[i].mcScore * 0.35;
    }
    prelim.sort((a, b) => b.strategicScore - a.strategicScore);
  }

  if ((ENABLE_TWO_PLY_WORST_CASE || difficulty === 'master') && prelim.length > 1) {
    const N = Math.min(5, prelim.length);
    const top = prelim.slice(0, N);
    for (const c of top) {
      const worst = twoPlyWorstCaseValue(state, c.move, weights);
      c.score = worst + c.strategicScore * 0.25 + c.mcScore * 0.1;
    }
    top.sort((a, b) => b.score - a.score);
    const chosen = (difficulty === 'master' || totalTiles <= 12) ? top[0] : weightedSelect(top);
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

  prelim.sort((a, b) => b.score - a.score);
  const chosen = (difficulty === 'master' || totalTiles <= 12) ? prelim[0] : weightedSelect(prelim);
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
