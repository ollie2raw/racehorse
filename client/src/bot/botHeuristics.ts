/**
 * botHeuristics.ts — Racehorse Domino AI (Hard Bot) v3
 *
 * Racehorse rules:
 *  - All Fives scoring: open-end sum divisible by 5 → sum/5 points
 *  - Playing a DOUBLE continues your turn
 *  - Playing a SCORING move continues your turn
 *  - Turn ends only on a non-scoring, non-double play
 *  - Turn must continue but no legal play → auto-draw until playable
 *  - Boneyard locks at 2 tiles (max 26 tiles seen per hand)
 *  - Doubles create branch arms (up to 4 open ends once both sides filled)
 *  - Hand ends: domino or blocked → winner scores round(loser_pips / 5)
 *  - Match: first to 60 points
 *
 * v3 upgrades over v2:
 *  1. CHAIN TREE SEARCH    — full branching tree over turn sequences instead
 *                            of greedy single-path simulation. Finds sequences
 *                            like "take 0 now, set up +3 two moves later" that
 *                            greedy misses entirely.
 *  2. MONTE CARLO SAMPLING — sample 8 plausible opponent hands from the
 *                            weighted pool, evaluate each, average the results.
 *                            Blocking/denial decisions are now based on what
 *                            the opponent can actually do, not just probability
 *                            weights on individual tiles.
 *  3. DRAW ANTICIPATION    — when a chain continuation would require drawing
 *                            (no legal play but turn continues), estimate the
 *                            boneyard draw cost and factor it into the move
 *                            score. Avoids committing to chains that force
 *                            expensive draws into bad tiles.
 */

import type { Move, Tile } from '../types';
import type { BotMatchState } from './botEngine';
import { getLegalMoves, previewPlayMove } from './botEngine';

export type BotDifficulty = 'casual' | 'standard' | 'hard';

export interface BotChoice {
  move: Move;
  score: number;
  breakdown: {
    immediate: number;
    doubleBias: number;
    mobility: number;
    denial: number;
    unload: number;
    replyRisk: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MC_SAMPLES = 8;          // Monte Carlo opponent hand samples
const CHAIN_TREE_DEPTH = 5;    // Max moves to explore in chain tree
const CHAIN_TREE_WIDTH = 3;    // Top N continuations to branch at each step
const WIN_TARGET = 60;

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

function cloneState(
  state: BotMatchState,
  overrides: Partial<BotMatchState>,
): BotMatchState {
  return { ...state, ...overrides };
}

// ─── Tile pool & inference ────────────────────────────────────────────────────

function buildUnseenPool(state: BotMatchState): Tile[] {
  const known = new Set<string>();
  for (const t of state.players.bot.hand) known.add(tileKey(t));
  if (state.board) {
    for (const pt of state.board.mainLine) known.add(tileKey(pt.tile));
    for (const hub of state.board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
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

/** Single pass = confirmed missing pip (2-player game — this is exact). */
function inferMissingPips(state: BotMatchState): Set<number> {
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

/**
 * Sample `n` plausible opponent hands from the unseen pool.
 * Uses weighted sampling without replacement — tiles the opponent is known
 * to be missing get very low weight (0.05) so they almost never appear.
 *
 * Returns an array of sampled hands (each is an array of Tiles).
 */
function sampleOpponentHands(
  pool: Tile[],
  weights: Map<string, number>,
  handSize: number,
  n: number,
): Tile[][] {
  const hands: Tile[][] = [];

  for (let s = 0; s < n; s++) {
    // Weighted shuffle: Fisher-Yates with weighted selection
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
        if (rand <= 0) {
          chosen = j;
          break;
        }
      }
      if (chosen === -1) {
        // Fallback: pick first available
        chosen = available.findIndex((t) => t != null);
      }
      if (chosen === -1) break;

      hand.push(available[chosen]);
      // Mark as taken
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

/**
 * Exact opponent threat given a known sampled hand.
 * Used in Monte Carlo evaluation.
 */
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

// ─── Draw anticipation ────────────────────────────────────────────────────────

/**
 * Estimate the cost of being forced to draw during a chain continuation.
 *
 * When a move is a double or scores (turn continues) but we have no legal
 * play afterward, we must draw. This function estimates:
 *  - How likely are we to need to draw? (check if hand has no legal plays)
 *  - How many draws might we need? (how sparse is the pip in the boneyard)
 *  - What's the expected pip cost of drawing bad tiles?
 *
 * Returns a penalty value (positive = bad for bot).
 */
function estimateDrawCost(
  nextHand: Tile[],
  openEnds: number[],
  boneyard: Tile[],
): number {
  const endSet = new Set(openEnds);
  const playableAfter = nextHand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;

  // If we have playable tiles, no draw risk
  if (playableAfter > 0) return 0;

  // We'd need to draw. How many draws until we find a playable tile?
  const boneyardAvailable = Math.max(0, boneyard.length - 2); // locked at 2
  if (boneyardAvailable === 0) return 15; // completely stuck = high penalty

  // Count playable tiles in the boneyard
  const playableInBoneyard = boneyard
    .slice(0, boneyardAvailable)
    .filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;

  if (playableInBoneyard === 0) return 20; // no help in boneyard

  // Expected draws = boneyardAvailable / playableInBoneyard (geometric)
  const expectedDraws = boneyardAvailable / playableInBoneyard;

  // Average pip value of a boneyard tile (we're drawing unknown tiles)
  const avgPip = boneyard.length > 0
    ? boneyard.reduce((s, t) => s + t.low + t.high, 0) / boneyard.length
    : 6;

  // Cost: expected draws × average pip burden per draw
  // (drawing is bad because it adds pips to our hand)
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

/**
 * Full chain tree search — explores branching turn sequences up to `maxDepth`
 * moves deep, keeping the top `width` continuations at each step.
 *
 * This replaces the greedy single-path simulation. It finds sequences like:
 *   "play 0|5 for 1pt → then double-0 continues → then 0|3 for 2pts"
 * even when the greedy approach would have taken a different 0|5 play instead.
 *
 * Returns the best ChainNode found (highest totalPoints, tiebreak by setup).
 */
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

  // BFS/beam: expand nodes level by level, keep top `width` at each level
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
        // Turn ends here (no legal plays left in chain)
        if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
        continue;
      }

      // Score each continuation to select top `width`
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
          // Chain ends here
          if (child.totalPoints > bestLeaf.totalPoints) bestLeaf = child;
        }
      }
    }

    if (nextFrontier.length === 0) break;

    // Keep the most promising frontier nodes (by points scored so far)
    nextFrontier.sort((a, b) => b.totalPoints - a.totalPoints);
    frontier = nextFrontier.slice(0, width * 2);

    // Track best leaf seen so far
    for (const node of frontier) {
      if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
    }
  }

  // Also check all remaining frontier nodes as potential leaves
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

// ─── Endgame minimax ──────────────────────────────────────────────────────────

function minimax(
  state: BotMatchState,
  depth: number,
  isBot: boolean,
  alpha: number,
  beta: number,
  pointsAccum: number,
): number {
  if (state.handOver || state.gameOver || depth === 0) {
    const botPips = pipSum(state.players.bot.hand);
    const youPips = pipSum(state.players.you.hand);
    return pointsAccum * 100 + (youPips - botPips);
  }

  const player = isBot ? 'bot' : 'you';
  const moves = getLegalMoves(state, player).filter((m) => m.type === 'play');
  if (moves.length === 0) return minimax(state, depth - 1, !isBot, alpha, beta, pointsAccum);

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
      const val = minimax(next, depth - 1, p.turnContinues ? true : false, alpha, beta, pointsAccum + p.immediateScore);
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
      const val = minimax(next, depth - 1, p.turnContinues ? false : true, alpha, beta, pointsAccum - p.immediateScore);
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ─── Monte Carlo move evaluation ──────────────────────────────────────────────

/**
 * Evaluate a candidate move using Monte Carlo opponent hand sampling.
 *
 * Instead of using probability-weighted heuristics to estimate the opponent's
 * threat, we:
 *  1. Sample MC_SAMPLES plausible opponent hands from the unseen pool
 *  2. For each sampled hand, compute the exact threat they pose after our move
 *  3. Average the results
 *
 * This gives a much more accurate estimate of blocking value because it
 * accounts for tile combinations the opponent might hold, not just individual
 * pip probabilities.
 */
function mcEvaluateMove(
  move: Move,
  state: BotMatchState,
  pool: Tile[],
  holdWeights: Map<string, number>,
): number {
  const botScore = state.players.bot.score;
  const youScore = state.players.you.score;
  const boneyardSize = state.boneyard.length;

  // Instant win check
  const preview = previewPlayMove(state, 'bot', move);
  if (!preview) return -Infinity;
  if (botScore + preview.immediateScore >= WIN_TARGET) return 1_000_000;

  // Chain tree search for this move
  const chain = searchChainTree(state, move);
  if (!chain) return -Infinity;

  const { totalPoints, chainLength, finalHand, finalOpenEnds, finalOpenSum, drawCostAccum } = chain;

  // Self position after chain
  const selfSetup = selfOpportunity(finalOpenEnds, finalOpenSum, finalHand);
  const mobilityAfter = handMobility(finalHand, finalOpenEnds);
  const finalEndSet = new Set(finalOpenEnds);
  const strandedDoubles = finalHand.filter((t) => isDoubleTile(t) && !finalEndSet.has(t.low)).length;
  const finalPips = pipSum(finalHand);
  const isLateGame = boneyardSize <= 6 || finalHand.length <= 3;
  const pipBurdenPenalty = isLateGame ? finalPips * 0.8 : finalPips * 0.1;

  // Branch discipline
  const branchPen = branchPenalty(move, state, holdWeights);

  // Score proximity multipliers
  const botProximity = botScore / WIN_TARGET;
  const youProximity = youScore / WIN_TARGET;
  const aggressionBoost = botProximity >= 0.85 ? 1.4 : botProximity >= 0.7 ? 1.2 : 1.0;
  const defenseMultiplier =
    youProximity >= 0.85 ? 3.0 :
    youProximity >= 0.7  ? 1.8 :
    youProximity >= 0.5  ? 1.2 : 1.0;

  // Monte Carlo threat estimation
  // Sample opponent hands and compute exact threat for each
  const youHandSize = state.players.you.hand.length;
  const sampledHands = sampleOpponentHands(pool, holdWeights, youHandSize, MC_SAMPLES);

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

// ─── Public API ───────────────────────────────────────────────────────────────

export function chooseBotMove(
  state: BotMatchState,
  difficulty: BotDifficulty = 'hard',
): BotChoice | null {
  const candidates = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
  if (candidates.length === 0) return null;

  // ── Casual ───────────────────────────────────────────────────────────────
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
    return {
      move: best.m,
      score: best.p!.immediateScore,
      breakdown: {
        immediate: best.p!.immediateScore,
        doubleBias: best.m.tile && isDoubleTile(best.m.tile) ? 1 : 0,
        mobility: 0, denial: 0,
        unload: (best.m.tile?.low ?? 0) + (best.m.tile?.high ?? 0),
        replyRisk: 0,
      },
    };
  }

  // ── Standard ─────────────────────────────────────────────────────────────
  if (difficulty === 'standard') {
    const pool = buildUnseenPool(state);
    const missing = inferMissingPips(state);
    const weights = opponentHoldWeights(pool, missing);

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
    return { move: scored[0].move, score: scored[0].score, breakdown: scored[0].breakdown };
  }

  // ── Hard ─────────────────────────────────────────────────────────────────
  const pool = buildUnseenPool(state);
  const missing = inferMissingPips(state);
  const weights = opponentHoldWeights(pool, missing);
  const totalTiles = state.players.bot.hand.length + state.players.you.hand.length;

  // Late game: deep exact minimax
  if (totalTiles <= 6) {
    let bestMove = candidates[0];
    let bestVal = -Infinity;

    for (const move of candidates) {
      const p = previewPlayMove(state, 'bot', move);
      if (!p) continue;
      const next = cloneState(state, {
        board: p.nextBoard,
        currentPlayer: p.turnContinues ? 'bot' : 'you',
        players: { ...state.players, bot: { ...state.players.bot, hand: p.nextHand } },
      });
      const depth = totalTiles <= 4 ? 14 : 10;
      const val = p.immediateScore * 100 + minimax(next, depth, p.turnContinues, -Infinity, Infinity, p.immediateScore);
      if (val > bestVal) { bestVal = val; bestMove = move; }
    }

    const bp = previewPlayMove(state, 'bot', bestMove);
    return {
      move: bestMove,
      score: bestVal,
      breakdown: {
        immediate: bp?.immediateScore ?? 0,
        doubleBias: bestMove.tile && isDoubleTile(bestMove.tile) ? 1 : 0,
        mobility: 0, denial: 0,
        unload: (bestMove.tile?.low ?? 0) + (bestMove.tile?.high ?? 0),
        replyRisk: 0,
      },
    };
  }

  // Mid/early game: chain tree + Monte Carlo evaluation + weighted selection
  const scored = candidates
    .map((move) => {
      const p = previewPlayMove(state, 'bot', move);
      return {
        move,
        score: mcEvaluateMove(move, state, pool, weights),
        breakdown: {
          immediate: p?.immediateScore ?? 0,
          doubleBias: move.tile && isDoubleTile(move.tile) ? 1 : 0,
          mobility: p ? handMobility(p.nextHand, p.openEnds) : 0,
          denial: p ? -opponentThreat(p.openEnds, p.openSum, weights) : 0,
          unload: (move.tile?.low ?? 0) + (move.tile?.high ?? 0),
          replyRisk: p ? opponentThreat(p.openEnds, p.openSum, weights) : 0,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = weightedSelect(scored);
  return { move: chosen.move, score: chosen.score, breakdown: chosen.breakdown };
}
