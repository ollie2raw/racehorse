/**
 * serverBot.ts — Server-side Fritz bot for tournament matches (Racehorse All Fives)
 * Mirrors the client bot heuristic model for decision quality parity.
 */
import type { GameState, Move, Tile } from '../game/types';
import { getLegalMoves, getOpenEnds } from '../game/engine';
import { computeOpenEndsSum, computePlayScore, simulatePlacement } from '../game/scoring';
import { drawableBoneyardCount, estimateDrawCostFromPublicInfo } from './publicDrawCost';

const MC_SAMPLES = 8;
const CHAIN_TREE_DEPTH = 5;
const CHAIN_TREE_WIDTH = 3;
const WIN_TARGET = 60;
const BONEYARD_LOCK = 2;

export type ServerBotTier = 'standard' | 'elite' | 'master';

type TierSelectCfg = {
  poolSize: number;
  pBest: number;
  rankDecay: number;
};

type TierSearchCfg = {
  mcSamples: number;
  chainDepth: number;
  chainWidth: number;
  endgameDepth: (totalTiles: number) => number;
};

const TIER_SELECT: Record<ServerBotTier, TierSelectCfg> = {
  standard: { poolSize: 4, pBest: 0.82, rankDecay: 0.58 },
  elite: { poolSize: 3, pBest: 0.94, rankDecay: 0.5 },
  master: { poolSize: 1, pBest: 1, rankDecay: 1 },
};

const TIER_SEARCH: Record<ServerBotTier, TierSearchCfg> = {
  standard: {
    mcSamples: 4,
    chainDepth: 3,
    chainWidth: 2,
    endgameDepth: (totalTiles) => (totalTiles <= 4 ? 7 : 5),
  },
  elite: {
    mcSamples: MC_SAMPLES,
    chainDepth: CHAIN_TREE_DEPTH,
    chainWidth: CHAIN_TREE_WIDTH,
    endgameDepth: (totalTiles) => (totalTiles <= 4 ? 14 : 10),
  },
  master: {
    mcSamples: 20,
    chainDepth: 7,
    chainWidth: 5,
    endgameDepth: (totalTiles) => (totalTiles <= 2 ? 16 : totalTiles <= 4 ? 14 : 12),
  },
};

interface MovePreview {
  nextBoard: NonNullable<GameState['board']>;
  nextHand: Tile[];
  immediateScore: number;
  isDouble: boolean;
  turnContinues: boolean;
  openEnds: number[];
  openSum: number;
}

interface ChainNode {
  totalPoints: number;
  chainLength: number;
  finalHand: Tile[];
  finalOpenEnds: number[];
  finalOpenSum: number;
  finalBoard: NonNullable<GameState['board']>;
  drawCostAccum: number;
}

function tileKey(t: Tile): string {
  return `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;
}

function tilePips(t: Tile): number {
  return t.high + t.low;
}

function isDoubleTile(t: Tile): boolean {
  return t.low === t.high;
}

function racehorsePoints(sum: number): number {
  return sum > 0 && sum % 5 === 0 ? sum / 5 : 0;
}

function pipSum(hand: readonly Tile[]): number {
  return hand.reduce((s, t) => s + t.low + t.high, 0);
}

function removeTileOnce(hand: readonly Tile[], tile: Tile): Tile[] {
  const idx = hand.findIndex((t) => t.high === tile.high && t.low === tile.low);
  if (idx < 0) return [...hand];
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function getOpponentId(state: GameState, botId: string): string {
  return state.playerIds.find((id) => id !== botId) ?? '';
}

function setCurrentPlayer(state: GameState, playerId: string): GameState {
  const idx = state.playerIds.findIndex((id) => id === playerId);
  if (idx < 0) return state;
  return { ...state, currentPlayerIndex: idx };
}

function previewPlayMove(state: GameState, playerId: string, move: Move): MovePreview | null {
  if (move.type !== 'play') return null;
  const board = simulatePlacement(state.board, move.tile, move.position);
  const nextHand = removeTileOnce(state.players[playerId]?.hand ?? [], move.tile);
  const immediateScore = computePlayScore(board, state.config);
  const openEnds = getOpenEnds(board).map((e) => e.matchValue);
  return {
    nextBoard: board,
    nextHand,
    immediateScore,
    isDouble: isDoubleTile(move.tile),
    turnContinues: isDoubleTile(move.tile) || immediateScore > 0,
    openEnds,
    openSum: computeOpenEndsSum(board),
  };
}

function buildUnseenPool(state: GameState, botId: string): Tile[] {
  const known = new Set<string>();
  for (const t of state.players[botId]?.hand ?? []) known.add(tileKey(t));
  if (state.board) {
    for (const pt of state.board.mainLine) known.add(tileKey(pt.tile));
    for (const hub of state.board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
        if (!branch || !branch.tiles) continue;
        for (const pt of branch.tiles) known.add(tileKey(pt.tile));
      }
    }
  }

  const pool: Tile[] = [];
  for (let low = 0; low <= 6; low++) {
    for (let high = low; high <= 6; high++) {
      const t: Tile = { low, high };
      if (!known.has(tileKey(t))) pool.push(t);
    }
  }
  return pool;
}

function opponentHoldWeights(pool: Tile[], missingPips: Set<number>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of pool) {
    const w = missingPips.has(t.low) || missingPips.has(t.high) ? 0.05 : 1.0;
    weights.set(tileKey(t), w);
  }
  return weights;
}

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
      let totalW = 0;
      for (let j = 0; j < available.length; j++) {
        if (available[j]) totalW += w[j];
      }
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
        chosen = available.findIndex((t) => t != null);
      }
      if (chosen === -1) break;

      hand.push(available[chosen]);
      (available as Array<Tile | null>)[chosen] = null;
      w[chosen] = 0;
    }

    hands.push(hand);
  }

  return hands;
}

function selfOpportunity(openEnds: number[], openSum: number, hand: readonly Tile[]): number {
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

function handMobility(hand: readonly Tile[], openEnds: number[]): number {
  const endSet = new Set(openEnds);
  return hand.filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
}

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
  opponentHand: readonly Tile[],
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

function estimateDrawCostForState(
  state: GameState,
  botId: string,
  nextHand: Tile[],
  openEnds: number[],
): number {
  return estimateDrawCostFromPublicInfo(
    nextHand,
    openEnds,
    buildUnseenPool(state, botId),
    drawableBoneyardCount(state.boneyard.length, BONEYARD_LOCK),
  );
}

function moveChoiceKey(move: Move): string {
  if (move.type !== 'play' || !move.tile) return move.type;
  return `${move.tile.low}-${move.tile.high}@${move.position ?? 'open'}`;
}

function maskOpponentHandForSearch(
  state: GameState,
  opponentId: string,
  sampledHand: Tile[],
): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [opponentId]: { ...state.players[opponentId], hand: sampledHand },
    },
  };
}

function chooseEndgameMoveSampled(
  state: GameState,
  botId: string,
  opponentId: string,
  candidates: Move[],
  tier: ServerBotTier,
  opponentKnownMissing: Set<number>,
): Move {
  const pool = buildUnseenPool(state, botId);
  const weights = opponentHoldWeights(pool, opponentKnownMissing);
  const opponentHandSize = state.players[opponentId]?.hand?.length ?? 0;
  const totalTiles = (state.players[botId]?.hand?.length ?? 0) + opponentHandSize;
  const search = TIER_SEARCH[tier];
  const sampleCount = tier === 'master' ? 16 : tier === 'elite' ? 10 : 8;
  const sampledHands = sampleOpponentHands(pool, weights, opponentHandSize, sampleCount);

  const moveVotes = new Map<string, number>();
  const moveScoreTotals = new Map<string, number>();

  for (const sampledHand of sampledHands) {
    const masked = maskOpponentHandForSearch(state, opponentId, sampledHand);
    let bestMove = candidates[0];
    let bestVal = -Infinity;
    const depth = search.endgameDepth(totalTiles);

    for (const move of candidates) {
      const p = previewPlayMove(masked, botId, move);
      if (!p) continue;
      const next = setCurrentPlayer(
        {
          ...masked,
          board: p.nextBoard,
          handOpen: true,
          players: {
            ...masked.players,
            [botId]: { ...masked.players[botId], hand: p.nextHand },
          },
        },
        p.turnContinues ? botId : opponentId,
      );
      const val =
        p.immediateScore * 100 +
        minimax(next, botId, opponentId, depth, p.turnContinues, -Infinity, Infinity, p.immediateScore);
      if (val > bestVal) {
        bestVal = val;
        bestMove = move;
      }
    }

    const key = moveChoiceKey(bestMove);
    moveVotes.set(key, (moveVotes.get(key) ?? 0) + 1);
    moveScoreTotals.set(key, (moveScoreTotals.get(key) ?? 0) + bestVal);
  }

  const ranked = [...moveVotes.entries()].sort((a, b) => {
    const voteDiff = b[1] - a[1];
    if (voteDiff !== 0) return voteDiff;
    return (moveScoreTotals.get(b[0]) ?? -Infinity) - (moveScoreTotals.get(a[0]) ?? -Infinity);
  });
  const bestKey = ranked[0]?.[0];
  return candidates.find((m) => moveChoiceKey(m) === bestKey) ?? candidates[0];
}

function searchChainTree(
  state: GameState,
  botId: string,
  firstMove: Move,
  maxDepth = CHAIN_TREE_DEPTH,
  width = CHAIN_TREE_WIDTH,
): ChainNode | null {
  const firstPreview = previewPlayMove(state, botId, firstMove);
  if (!firstPreview) return null;

  const root: ChainNode = {
    totalPoints: firstPreview.immediateScore,
    chainLength: 1,
    finalHand: firstPreview.nextHand,
    finalOpenEnds: firstPreview.openEnds,
    finalOpenSum: firstPreview.openSum,
    finalBoard: firstPreview.nextBoard,
    drawCostAccum: estimateDrawCostForState(state, botId, firstPreview.nextHand, firstPreview.openEnds),
  };

  if (!firstPreview.turnContinues) return root;

  let frontier: ChainNode[] = [root];
  let bestLeaf: ChainNode = root;

  for (let depth = 0; depth < maxDepth - 1; depth++) {
    const nextFrontier: ChainNode[] = [];

    for (const node of frontier) {
      const tempState = setCurrentPlayer(
        {
          ...state,
          board: node.finalBoard,
          handOpen: true,
          players: {
            ...state.players,
            [botId]: { ...state.players[botId], hand: node.finalHand },
          },
        },
        botId,
      );

      const continuations = getLegalMoves(tempState, botId).filter((m) => m.type === 'play');
      if (continuations.length === 0) {
        if (node.totalPoints > bestLeaf.totalPoints) bestLeaf = node;
        continue;
      }

      const scored: Array<{ p: MovePreview; val: number }> = [];
      for (const m of continuations) {
        if (m.type !== 'play') continue;
        const p = previewPlayMove(tempState, botId, m);
        if (!p) continue;
        const val = p.immediateScore * 100 + selfOpportunity(p.openEnds, p.openSum, p.nextHand) * 10 + tilePips(m.tile) * 0.3;
        scored.push({ p, val });
      }
      scored.sort((a, b) => b.val - a.val);

      for (const { p } of scored.slice(0, width)) {
        const child: ChainNode = {
          totalPoints: node.totalPoints + p.immediateScore,
          chainLength: node.chainLength + 1,
          finalHand: p.nextHand,
          finalOpenEnds: p.openEnds,
          finalOpenSum: p.openSum,
          finalBoard: p.nextBoard,
          drawCostAccum:
            node.drawCostAccum + estimateDrawCostForState(state, botId, p.nextHand, p.openEnds),
        };

        if (p.turnContinues) nextFrontier.push(child);
        else if (child.totalPoints > bestLeaf.totalPoints) bestLeaf = child;
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

function branchPenalty(move: Move, state: GameState, botId: string, holdWeights: Map<string, number>): number {
  if (move.type !== 'play' || !isDoubleTile(move.tile)) return 0;
  const pip = move.tile.low;

  const ourFollowups = (state.players[botId]?.hand ?? []).filter(
    (t) => (t.low === pip || t.high === pip) && !(t.low === pip && t.high === pip),
  ).length;

  const oppFollowupWeight = Array.from(holdWeights.entries())
    .filter(([k]) => {
      const [loS, hiS] = k.split('|');
      const lo = parseInt(loS, 10);
      const hi = parseInt(hiS, 10);
      return (lo === pip || hi === pip) && !(lo === pip && hi === pip);
    })
    .reduce((sum, [, w]) => sum + w, 0);

  if (ourFollowups === 0 && oppFollowupWeight > 1.5) return 40 + oppFollowupWeight * 8;
  if (oppFollowupWeight > ourFollowups * 2) return 15 + (oppFollowupWeight - ourFollowups) * 5;
  return 0;
}

function minimax(
  state: GameState,
  botId: string,
  opponentId: string,
  depth: number,
  isBotTurn: boolean,
  alpha: number,
  beta: number,
  pointsAccum: number,
): number {
  if (state.handOver || state.gameOver || depth === 0) {
    const botPips = pipSum(state.players[botId]?.hand ?? []);
    const oppPips = pipSum(state.players[opponentId]?.hand ?? []);
    return pointsAccum * 100 + (oppPips - botPips);
  }

  const playerId = isBotTurn ? botId : opponentId;
  const aligned = setCurrentPlayer(state, playerId);
  const moves = getLegalMoves(aligned, playerId).filter((m) => m.type === 'play');
  if (moves.length === 0) {
    return minimax(aligned, botId, opponentId, depth - 1, !isBotTurn, alpha, beta, pointsAccum);
  }

  const orderedMoves = [...moves].sort((a, b) => {
    const pa = previewPlayMove(aligned, playerId, a);
    const pb = previewPlayMove(aligned, playerId, b);
    return (pb?.immediateScore ?? 0) - (pa?.immediateScore ?? 0);
  });

  if (isBotTurn) {
    let best = -Infinity;
    for (const move of orderedMoves) {
      const p = previewPlayMove(aligned, botId, move);
      if (!p) continue;
      const next = setCurrentPlayer(
        {
          ...aligned,
          board: p.nextBoard,
          handOpen: true,
          players: {
            ...aligned.players,
            [botId]: { ...aligned.players[botId], hand: p.nextHand },
          },
        },
        p.turnContinues ? botId : opponentId,
      );
      const val = minimax(
        next,
        botId,
        opponentId,
        depth - 1,
        p.turnContinues,
        alpha,
        beta,
        pointsAccum + p.immediateScore,
      );
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of orderedMoves) {
    const p = previewPlayMove(aligned, opponentId, move);
    if (!p) continue;
    const next = setCurrentPlayer(
      {
        ...aligned,
        board: p.nextBoard,
        handOpen: true,
        players: {
          ...aligned.players,
          [opponentId]: { ...aligned.players[opponentId], hand: p.nextHand },
        },
      },
      p.turnContinues ? opponentId : botId,
    );
    const val = minimax(
      next,
      botId,
      opponentId,
      depth - 1,
      !p.turnContinues,
      alpha,
      beta,
      pointsAccum - p.immediateScore,
    );
    best = Math.min(best, val);
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function mcEvaluateMove(
  move: Move,
  state: GameState,
  botId: string,
  opponentId: string,
  pool: Tile[],
  holdWeights: Map<string, number>,
  search: TierSearchCfg,
): number {
  const botScore = state.players[botId]?.score ?? 0;
  const oppScore = state.players[opponentId]?.score ?? 0;
  const boneyardSize = state.boneyard.length;

  const preview = previewPlayMove(state, botId, move);
  if (!preview) return -Infinity;
  if (botScore + preview.immediateScore >= WIN_TARGET) return 1_000_000;

  const chain = searchChainTree(state, botId, move, search.chainDepth, search.chainWidth);
  if (!chain) return -Infinity;

  const { totalPoints, chainLength, finalHand, finalOpenEnds, finalOpenSum, drawCostAccum } = chain;

  const selfSetup = selfOpportunity(finalOpenEnds, finalOpenSum, finalHand);
  const mobilityAfter = handMobility(finalHand, finalOpenEnds);
  const finalEndSet = new Set(finalOpenEnds);
  const strandedDoubles = finalHand.filter((t) => isDoubleTile(t) && !finalEndSet.has(t.low)).length;
  const finalPips = pipSum(finalHand);
  const isLateGame = boneyardSize <= 6 || finalHand.length <= 3;
  const pipBurdenPenalty = isLateGame ? finalPips * 0.8 : finalPips * 0.1;

  const branchPen = branchPenalty(move, state, botId, holdWeights);

  const botProximity = botScore / WIN_TARGET;
  const oppProximity = oppScore / WIN_TARGET;
  const aggressionBoost = botProximity >= 0.85 ? 1.4 : botProximity >= 0.7 ? 1.2 : 1.0;
  const defenseMultiplier =
    oppProximity >= 0.85 ? 3.0 :
    oppProximity >= 0.7 ? 1.8 :
    oppProximity >= 0.5 ? 1.2 : 1.0;

  const opponentHandSize = (state.players[opponentId]?.hand ?? []).length;
  const sampledHands = sampleOpponentHands(pool, holdWeights, opponentHandSize, search.mcSamples);

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

function weightedSelectFromPool<T>(pool: T[], rankDecay: number): T {
  if (pool.length <= 1) return pool[0];
  const weights = pool.map((_, idx) => Math.pow(rankDecay, idx));
  const totalW = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * totalW;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function tierSelect<T extends { score: number }>(scored: T[], tier: ServerBotTier): T {
  if (scored.length === 1) return scored[0];
  const cfg = TIER_SELECT[tier];
  const pool = scored.slice(0, Math.min(cfg.poolSize, scored.length));
  if (pool.length <= 1 || Math.random() < cfg.pBest) return pool[0];
  return weightedSelectFromPool(pool.slice(1), cfg.rankDecay);
}

function standardScoreMove(
  move: Move,
  state: GameState,
  botId: string,
  holdWeights: Map<string, number>,
): number {
  if (move.type !== 'play') return -Infinity;
  const preview = previewPlayMove(state, botId, move);
  if (!preview) return -Infinity;
  const threat = opponentThreat(preview.openEnds, preview.openSum, holdWeights);
  return (
    preview.immediateScore * 60 +
    selfOpportunity(preview.openEnds, preview.openSum, preview.nextHand) * 10 -
    threat * 8 +
    handMobility(preview.nextHand, preview.openEnds) * 5 +
    tilePips(move.tile) * 0.5
  );
}

export function chooseBotMoveServer(
  state: GameState,
  botId: string,
  opponentKnownMissing: Set<number>,
  tier: ServerBotTier = 'elite',
): Move {
  const aligned = setCurrentPlayer(state, botId);
  const candidates = getLegalMoves(aligned, botId).filter((m) => m.type === 'play');
  if (candidates.length === 0) return { type: 'pass' };
  if (candidates.length === 1) return candidates[0];

  const opponentId = getOpponentId(aligned, botId);
  const pool = buildUnseenPool(aligned, botId);
  const weights = opponentHoldWeights(pool, opponentKnownMissing);

  const totalTiles = (aligned.players[botId]?.hand?.length ?? 0) + (aligned.players[opponentId]?.hand?.length ?? 0);

  if (tier === 'standard') {
    const scored = candidates
      .map((move) => ({ move, score: standardScoreMove(move, aligned, botId, weights) }))
      .sort((a, b) => b.score - a.score);
    return tierSelect(scored, tier).move;
  }

  if (totalTiles <= 6) {
    return chooseEndgameMoveSampled(aligned, botId, opponentId, candidates, tier, opponentKnownMissing);
  }

  const scored = candidates
    .map((move) => ({
      move,
      score: mcEvaluateMove(move, aligned, botId, opponentId, pool, weights, TIER_SEARCH[tier]),
    }))
    .sort((a, b) => b.score - a.score);

  return tierSelect(scored, tier).move;
}
