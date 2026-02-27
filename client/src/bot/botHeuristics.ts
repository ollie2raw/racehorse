import type { Move } from '../types';
import type { BotMatchState, BotMovePreview } from './botEngine';
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

function pipExposureLikelihood(openEnds: number[]): number {
  const counts = new Array<number>(7).fill(0);
  for (const pip of openEnds) {
    if (pip >= 0 && pip <= 6) counts[pip] += 1;
  }
  // In double-six, each pip appears in 7 tiles. Lower is better for denial.
  return counts.reduce((sum, count) => sum + count * 7, 0);
}

function estimateMobility(remaining: { low: number; high: number }[], openEnds: number[]): number {
  let mobility = 0;
  for (const tile of remaining) {
    if (openEnds.some((p) => p === tile.low || p === tile.high)) {
      mobility += 1;
    }
  }
  return mobility;
}

function estimateReplyRisk(openEnds: number[], openSum: number): number {
  // Rough one-ply risk proxy: number of ways opponent can likely score next.
  // Uses non-double replacement approximation.
  let risk = 0;
  for (const end of openEnds) {
    for (let nextPip = 0; nextPip <= 6; nextPip++) {
      const candidate = openSum - end + nextPip;
      if (candidate !== 0 && candidate % 5 === 0) {
        risk += 1;
      }
    }
  }
  return risk;
}

function tiebreak(move: Move): string {
  const tile = move.tile!;
  const total = tile.low + tile.high;
  const pos = move.position ?? '';
  return `${99 - total}-${99 - tile.high}-${99 - tile.low}-${pos}`;
}

function inferUnseenTiles(state: BotMatchState): { low: number; high: number }[] {
  // All 28 tiles in a double-six set
  const allTiles: { low: number; high: number }[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      allTiles.push({ low: i, high: j });
    }
  }

  // Remove bot's own hand
  const botHand = state.players.bot.hand;

  // Remove tiles visible on the board (mainLine + hub branches)
  const boardTiles: { low: number; high: number }[] = [];
  if (state.board) {
    for (const entry of state.board.mainLine) {
      boardTiles.push(entry.tile);
    }
    for (const hub of state.board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
        for (const entry of branch.tiles ?? []) {
          boardTiles.push(entry.tile);
        }
      }
    }
  }

  const known = [...botHand, ...boardTiles];
  return allTiles.filter((t) => !known.some((k) => k.low === t.low && k.high === t.high));
}

function stateAfterBotMove(state: BotMatchState, preview: BotMovePreview): BotMatchState {
  return {
    ...state,
    board: preview.nextBoard,
    currentPlayer: 'you',
    players: {
      ...state.players,
      bot: { ...state.players.bot, hand: preview.nextHand },
    },
  };
}

function estimateBestReply(_state: BotMatchState, afterMove: BotMatchState): number {
  // Simulate the best score the opponent (you) could get on the very next turn.
  const replyCandidates = getLegalMoves(afterMove, 'you').filter((m) => m.type === 'play');
  if (replyCandidates.length === 0) return 0;
  let best = 0;
  for (const reply of replyCandidates) {
    const rp = previewPlayMove(afterMove, 'you', reply);
    if (rp) {
      const effectiveScore = rp.turnContinues ? rp.immediateScore * 1.5 : rp.immediateScore;
      if (effectiveScore > best) best = effectiveScore;
    }
  }
  return best;
}

function minimaxEndgame(
  state: BotMatchState,
  depth: number,
  isBot: boolean,
  alpha: number,
  beta: number,
): number {
  if (state.handOver || state.gameOver || depth === 0) {
    const botPips = state.players.bot.hand.reduce((s, t) => s + t.low + t.high, 0);
    const youPips = state.players.you.hand.reduce((s, t) => s + t.low + t.high, 0);
    return youPips - botPips; // positive = good for bot
  }

  const player = isBot ? 'bot' : 'you';
  const moves = getLegalMoves(state, player).filter((m) => m.type === 'play');

  if (moves.length === 0) {
    if (state.boneyard.length > 2) {
      const next: BotMatchState = {
        ...state,
        currentPlayer: isBot ? 'bot' : 'you',
        boneyard: state.boneyard.slice(1),
      };
      return minimaxEndgame(next, depth - 1, isBot, alpha, beta);
    }
    return 0;
  }

  if (isBot) {
    let best = -Infinity;
    for (const move of moves) {
      const preview = previewPlayMove(state, 'bot', move);
      if (!preview) continue;
      const continuesTurn = preview.turnContinues;
      const next: BotMatchState = {
        ...state,
        board: preview.nextBoard,
        currentPlayer: continuesTurn ? 'bot' : 'you',
        players: {
          ...state.players,
          bot: { ...state.players.bot, hand: preview.nextHand },
        },
      };
      const val = minimaxEndgame(next, depth - 1, continuesTurn ? true : false, alpha, beta);
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const preview = previewPlayMove(state, 'you', move);
      if (!preview) continue;
      const continuesTurn = preview.turnContinues;
      const next: BotMatchState = {
        ...state,
        board: preview.nextBoard,
        currentPlayer: continuesTurn ? 'you' : 'bot',
        players: {
          ...state.players,
          you: { ...state.players.you, hand: preview.nextHand },
        },
      };
      const val = minimaxEndgame(next, depth - 1, continuesTurn ? false : true, alpha, beta);
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function chooseBotMove(
  state: BotMatchState,
  difficulty: BotDifficulty = 'standard',
): BotChoice | null {
  const candidates: Move[] = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');

  if (candidates.length === 0) return null;

  const botHandSize = state.players.bot.hand.length;
  const youHandSize = state.players.you.hand.length;

  if (difficulty === 'hard' && botHandSize <= 4 && youHandSize <= 4) {
    // Use exact minimax instead of heuristics.
    let bestMove = candidates[0];
    let bestVal = -Infinity;
    for (const move of candidates) {
      const preview = previewPlayMove(state, 'bot', move);
      if (!preview) continue;
      if (preview.nextHand.length === 0 && move.tile && move.tile.low === move.tile.high) continue;
      const next: BotMatchState = {
        ...state,
        board: preview.nextBoard,
        currentPlayer: 'you',
        players: {
          ...state.players,
          bot: { ...state.players.bot, hand: preview.nextHand },
        },
      };
      const val = preview.immediateScore * 10 + minimaxEndgame(next, 6, false, -Infinity, Infinity);
      if (val > bestVal) {
        bestVal = val;
        bestMove = move;
      }
    }
    return {
      move: bestMove,
      score: bestVal,
      breakdown: {
        immediate: 0,
        doubleBias: 0,
        mobility: 0,
        denial: 0,
        unload: 0,
        replyRisk: 0,
      },
    };
  }

  const scored = candidates.map((move) => {
    const preview = previewPlayMove(state, 'bot', move)!;
    const immediate = preview.immediateScore;
    const doubleBias = preview.isDouble ? 1 : 0;
    const mobility = estimateMobility(preview.nextHand, preview.openEnds);
    const denial = -pipExposureLikelihood(preview.openEnds);
    const unload = move.tile ? move.tile.low + move.tile.high : 0;
    const replyRisk = estimateReplyRisk(preview.openEnds, preview.openSum);
    const base = {
      move,
      score: 0,
      breakdown: {
        immediate,
        doubleBias,
        mobility,
        denial,
        unload,
        replyRisk,
      },
      tie: tiebreak(move),
    };

    let score = immediate * 100 + unload * 0.5;
    if (difficulty === 'hard') {
      const botScore = state.players.bot.score;
      const youScore = state.players.you.score;
      const winTarget = state.winningScore;

      // Always choose an immediate game-winning move.
      if (botScore + immediate >= winTarget) return { ...base, score: 10000 };

      // Two-ply: simulate opponent's best immediate scoring reply.
      const afterState = stateAfterBotMove(state, preview);
      const bestReply = estimateBestReply(state, afterState);

      // Hand mobility matters more in a thin boneyard.
      const boneyardFactor = state.boneyard.length <= 7 ? 1.6 : 1.0;

      // Penalize stranding tiles that match none of the current open ends.
      const openEndSet = new Set(preview.openEnds);
      const unseenTiles = inferUnseenTiles(state);
      // High count means opponent likely has matches, so opening that end is riskier.
      const endDangerScore = preview.openEnds.reduce((sum, end) => {
        const matches = unseenTiles.filter((t) => t.low === end || t.high === end).length;
        return sum + matches;
      }, 0);
      const deadTiles = preview.nextHand.filter(
        (t) => !openEndSet.has(t.low) && !openEndSet.has(t.high),
      ).length;
      const playableTiles = preview.nextHand.filter(
        (t) => openEndSet.has(t.low) || openEndSet.has(t.high),
      ).length;
      const doubleDangerPenalty = preview.isDouble && youScore >= winTarget - 20 ? 30 : 0;

      // Defensive urgency increases when the opponent is one scoring play from winning.
      const defenseBonus = youScore >= winTarget - 10 ? denial * 0.6 : denial * 0.35;

      // Endgame hand reduction pressure.
      const handSize = preview.nextHand.length;
      const endgameBonus = handSize <= 1 ? 200 : handSize <= 3 ? 40 : 0;

      score =
        immediate * 60 +
        -bestReply * 55 +
        unload * 1.2 +
        mobility * 8 * boneyardFactor +
        playableTiles * 5 +
        defenseBonus +
        -deadTiles * 6 +
        -endDangerScore * 2 +
        -doubleDangerPenalty +
        endgameBonus;
    } else if (difficulty !== 'casual') {
      score += mobility * 8 + denial * 0.35;
      score += doubleBias * 2;
    } else {
      score += doubleBias * 4;
    }

    return {
      ...base,
      score,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tie.localeCompare(b.tie);
  });

  return {
    move: scored[0].move,
    score: scored[0].score,
    breakdown: scored[0].breakdown,
  };
}
