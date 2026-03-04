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
  const unseenTiles = allTiles.filter(
    (t) => !known.some((k) => k.low === t.low && k.high === t.high),
  );
  const knownMissing = new Set(state.opponentKnownMissing ?? []);
  if (knownMissing.size === 0) {
    return unseenTiles;
  }
  const filtered = unseenTiles.filter((t) => !knownMissing.has(t.low) && !knownMissing.has(t.high));
  return filtered.length > 0 ? filtered : unseenTiles;
}

function inferOpponentMissingPips(state: BotMatchState): number[] {
  const missing: number[] = [];
  const passedEnds = state.opponentPassedOnEnds ?? [];

  // If opponent passed/drew when an end was open, they likely don't have tiles matching that end
  for (const end of passedEnds) {
    const count = passedEnds.filter((e) => e === end).length;
    if (count >= 2 && !missing.includes(end)) {
      missing.push(end);
    }
  }
  return missing;
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

function threePlyScore(
  state: BotMatchState,
  botMove: Move,
  unseenTiles: { low: number; high: number }[],
): number {
  const preview1 = previewPlayMove(state, 'bot', botMove);
  if (!preview1) return 0;

  const afterBot: BotMatchState = {
    ...state,
    board: preview1.nextBoard,
    currentPlayer: 'you',
    players: {
      ...state.players,
      bot: { ...state.players.bot, hand: preview1.nextHand },
    },
  };

  const oppMoves = getLegalMoves(afterBot, 'you').filter((m) => m.type === 'play');
  if (oppMoves.length === 0) return preview1.immediateScore * 10;

  const likelyTiles = new Set(unseenTiles.map((tile) => `${tile.low}-${tile.high}`));
  const knownMissing = new Set(state.opponentKnownMissing ?? []);
  const weightedOppMoves = oppMoves.map((m) => {
    const tile = m.tile!;
    const tileKey = `${tile.low}-${tile.high}`;
    const unlikely =
      knownMissing.has(tile.low) || knownMissing.has(tile.high) || !likelyTiles.has(tileKey);
    return { move: m, weight: unlikely ? 0.2 : 1.0 };
  });
  const totalWeight = weightedOppMoves.reduce((s, w) => s + w.weight, 0);

  let worstNetScore = Infinity;

  for (const { move: oppMove, weight } of weightedOppMoves) {
    if (weight < 0.01) continue;
    const preview2 = previewPlayMove(afterBot, 'you', oppMove);
    if (!preview2) continue;

    const afterOpp: BotMatchState = {
      ...afterBot,
      board: preview2.nextBoard,
      currentPlayer: 'bot',
      players: {
        ...afterBot.players,
        you: { ...afterBot.players.you, hand: preview2.nextHand },
      },
    };

    const botReplies = getLegalMoves(afterOpp, 'bot').filter((m) => m.type === 'play');
    let bestReply3Score = 0;
    for (const reply of botReplies) {
      const preview3 = previewPlayMove(afterOpp, 'bot', reply);
      if (!preview3) continue;
      const s = preview3.immediateScore * 10 + preview3.nextHand.length * -2;
      if (s > bestReply3Score) bestReply3Score = s;
    }

    const netScore =
      (preview1.immediateScore * 10 - preview2.immediateScore * 8 + bestReply3Score) *
      (weight / totalWeight);

    if (netScore < worstNetScore) worstNetScore = netScore;
  }

  return worstNetScore === Infinity ? preview1.immediateScore * 10 : worstNetScore;
}

function evaluateBlockedGameOutcome(
  state: BotMatchState,
  afterPreview: BotMovePreview,
): number {
  const botPipsAfter = afterPreview.nextHand.reduce((s, t) => s + t.low + t.high, 0);
  const youPipsEstimate = state.players.you.hand.reduce((s, t) => s + t.low + t.high, 0);

  if (state.boneyard.length <= 3) {
    if (botPipsAfter < youPipsEstimate) {
      return (youPipsEstimate - botPipsAfter) * 4;
    }
    return (youPipsEstimate - botPipsAfter) * 3;
  }
  return 0;
}

function scorePipArithmetic(
  openEnds: number[],
  openSum: number,
  nextHand: { low: number; high: number }[],
): number {
  let bonus = 0;

  for (const tile of nextHand) {
    for (const end of openEnds) {
      if (tile.low === end || tile.high === end) {
        const pip = tile.low === end ? tile.high : tile.low;
        const futureSum = openSum - end + pip;
        if (futureSum > 0 && futureSum % 5 === 0) {
          bonus += 8;
        }
        if (futureSum > 0 && futureSum % 10 === 0) {
          bonus += 4;
        }
      }
    }
  }
  return Math.min(bonus, 32);
}

function doubleTimingPenalty(
  tile: { low: number; high: number },
  openEnds: number[],
  boneyard: { low: number; high: number }[],
  hand: { low: number; high: number }[],
): number {
  if (tile.low !== tile.high) return 0;
  const pip = tile.high;

  const handMatches = hand.filter((t) => t.low === pip || t.high === pip).length;
  const boneyardMatches = boneyard.filter((t) => t.low === pip || t.high === pip).length;

  const endAlreadyOpen = openEnds.includes(pip);
  if (endAlreadyOpen && boneyardMatches <= 2) {
    return 18;
  }

  if (handMatches >= 2 && boneyard.length > 6) {
    return 10;
  }

  return 0;
}

export function chooseBotMove(
  state: BotMatchState,
  difficulty: BotDifficulty = 'standard',
): BotChoice | null {
  const candidates: Move[] = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');

  if (candidates.length === 0) return null;

  const botHandSize = state.players.bot.hand.length;
  const youHandSize = state.players.you.hand.length;

  if (difficulty === 'hard' && botHandSize <= 7 && youHandSize <= 7) {
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
      const val = preview.immediateScore * 10 + minimaxEndgame(next, 8, false, -Infinity, Infinity);
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

  const inferredMissing = inferOpponentMissingPips(state);
  const inferredState: BotMatchState =
    inferredMissing.length === 0
      ? state
      : {
          ...state,
          opponentKnownMissing: [...new Set([...(state.opponentKnownMissing ?? []), ...inferredMissing])],
        };
  const unseenTiles = inferUnseenTiles(inferredState);

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

      if (botScore + immediate >= winTarget) return { ...base, score: 10000 };

      const scoreDiff = botScore - youScore;
      const aggressionMult = scoreDiff >= 15 ? 1.15 : scoreDiff <= -15 ? 0.88 : 1.0;

      const oppWinProximity = youScore / winTarget;
      const defenseUrgency = oppWinProximity >= 0.8 ? 1.8 : oppWinProximity >= 0.6 ? 1.3 : 1.0;

      const stateWithInference: BotMatchState = {
        ...state,
        opponentKnownMissing: [...new Set([...(state.opponentKnownMissing ?? []), ...inferredMissing])],
      };

      const plyScore = threePlyScore(stateWithInference, move, unseenTiles);
      const blockBonus = evaluateBlockedGameOutcome(state, preview);

      const boneyardFactor =
        state.boneyard.length <= 4 ? 2.0 : state.boneyard.length <= 10 ? 1.4 : 1.0;
      const openEndSet = new Set(preview.openEnds);
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

      const pipSetupBonus = scorePipArithmetic(
        preview.openEnds,
        preview.openSum,
        preview.nextHand,
      );

      const doubleTimingPen = doubleTimingPenalty(
        move.tile!,
        preview.openEnds,
        state.boneyard,
        preview.nextHand,
      );
      const defenseBonus = youScore >= winTarget - 10 ? denial * 0.6 : denial * 0.35;
      const handSize = preview.nextHand.length;
      const endgameBonus = handSize === 0 ? 500 : handSize === 1 ? 220 : handSize <= 3 ? 55 : 0;

      score =
        plyScore * 1.8 * aggressionMult +
        immediate * 45 +
        unload * 3.5 +
        mobility * 10 * boneyardFactor +
        playableTiles * 3 +
        defenseBonus * defenseUrgency +
        -deadTiles * 9 +
        -endDangerScore * 3.5 +
        -doubleDangerPenalty +
        -doubleTimingPen +
        pipSetupBonus +
        endgameBonus +
        blockBonus;
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
