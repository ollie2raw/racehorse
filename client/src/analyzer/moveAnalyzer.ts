import type { EngineBestMove, MoveEntry, TileTuple } from './moveLogger';
import { sameTileTuple } from './moveLogger';
import { chooseBotMove } from '../bot/botHeuristics';
import { createBotMatch, previewPlayMove, getLegalMoves } from '../bot/botEngine';
import type { BotMatchState } from '../bot/botEngine';

export type MoveRating = 'Brilliant' | 'Great' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';

export type AnalyzedMove = {
  moveNumber: number;
  action: MoveEntry['action'];
  playedTile?: TileTuple;
  bestTile?: TileTuple;
  bestPosition?: string;
  score: number;
  rating: MoveRating;
  explanation: string;
  handBefore: TileTuple[];
  validMoves: TileTuple[];
  boardEnds: [number, number];
  boardState: MoveEntry['boardState'];
  boardRenderState: MoveEntry['boardRenderState'];
  handSnapshot: MoveEntry['handSnapshot'];
  engineBestMove: MoveEntry['engineBestMove'];
  bestBreakdown?: EngineBestMove['breakdown'];
};

export type GameAnalysis = {
  accuracy: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  analyzedAt: number;
  analyzedMoves: AnalyzedMove[];
  timeline: Array<{ moveIndex: number; moveNumber: number; player: MoveEntry['player']; score: number }>;
};

type StoredAnalysisItem = {
  id: string;
  mode: 'bot' | 'multiplayer';
  createdAt: number;
  analysis: GameAnalysis;
};

const ANALYSIS_HISTORY_KEY = 'racehorse_move_analysis_history_v1';

function tileKey(tile: TileTuple): string {
  const a = Math.min(tile[0], tile[1]);
  const b = Math.max(tile[0], tile[1]);
  return `${a}|${b}`;
}

function tileLabel(tile: TileTuple): string {
  return `${tile[0]}|${tile[1]}`;
}

function uniqueTiles(tiles: TileTuple[]): TileTuple[] {
  const seen = new Set<string>();
  const out: TileTuple[] = [];
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tile);
  }
  return out;
}

// ─── Build a consistent BotMatchState for engine evaluation ───────────────────
//
// IMPORTANT: All engine scores (bestScore, playedScore) must use the SAME
// evaluation function — chooseBotMove's internal scoring via previewPlayMove.
// We never mix moveLogger's simple heuristic scores with the bot engine scores.

function buildEvalState(
  entry: MoveEntry,
  perspective: 'bot' | 'you',
): BotMatchState | null {
  if (!entry.boardRenderState) return null;
  try {
    const template = createBotMatch(60, 7);
    const hand = entry.handBefore.map((t) => ({ low: t[0], high: t[1] }));
    return {
      ...template,
      board: entry.boardRenderState as unknown as typeof template.board,
      currentPlayer: perspective,
      handOpen: entry.boardRenderState.mainLine.length > 0 || true,
      handOver: false,
      gameOver: false,
      winningScore: 60,
      consecutivePasses: 0,
      // Use a realistic boneyard size so bot doesn't think the game is over
      boneyard: new Array(14).fill({ low: 0, high: 0 }),
      players: {
        you: {
          ...template.players.you,
          hand: perspective === 'you' ? [] : hand,
          score: 0,
        },
        bot: {
          ...template.players.bot,
          hand: perspective === 'bot' ? hand : [],
          score: 0,
        },
      },
    };
  } catch {
    return null;
  }
}

/**
 * Compute the engine score for a specific tile+position using the SAME
 * previewPlayMove path the bot uses internally.
 *
 * Returns null if the move is illegal or can't be previewed.
 */
function engineScoreForMove(
  evalState: BotMatchState,
  tile: TileTuple,
  position: string | undefined,
  perspective: 'bot' | 'you',
): { score: number; breakdown: EngineBestMove['breakdown'] } | null {
  // Find the matching legal move to get the correct position
  const legalMoves = getLegalMoves(evalState, perspective);
  const tileObj = { low: tile[0], high: tile[1] };

  // Try to find exact position match first, then fall back to any legal position for this tile
  const matchingMoves = legalMoves.filter(
    (m) => m.type === 'play' && m.tile &&
      m.tile.low === tileObj.low && m.tile.high === tileObj.high,
  );

  if (matchingMoves.length === 0) return null;

  // Prefer the position we recorded; otherwise take the highest-scoring legal placement
  const targetMove = position
    ? matchingMoves.find((m) => m.type === 'play' && m.position === position) ?? matchingMoves[0]
    : matchingMoves[0];

  const preview = previewPlayMove(evalState, perspective, targetMove);
  if (!preview) return null;

  const immediate = preview.immediateScore;
  const isDouble = tile[0] === tile[1];
  const mobility = preview.nextHand.filter((t) =>
    preview.openEnds.some((e) => e === t.low || e === t.high),
  ).length;
  const unload = tile[0] + tile[1];
  const denial = -preview.openEnds.reduce((sum, end) => {
    return sum + (end >= 0 && end <= 6 ? 7 : 0);
  }, 0);

  // Use the same scoring formula as chooseBotMove standard mode for comparability
  const score = immediate * 100 + unload * 0.8 + mobility * 8 + denial * 0.3 + (isDouble ? 2 : 0);

  return {
    score,
    breakdown: {
      immediate,
      doubleBias: isDouble ? 1 : 0,
      mobility,
      denial,
      unload,
      replyRisk: 0,
    },
  };
}

function buildExplanation(
  playedTile: TileTuple | undefined,
  bestTile: TileTuple | undefined,
  rating: MoveRating,
  playedBreakdown: EngineBestMove['breakdown'] | null,
  bestBreakdown: EngineBestMove['breakdown'] | null,
  context?: string,
): string {
  const played = playedTile ? tileLabel(playedTile) : null;
  const best = bestTile ? tileLabel(bestTile) : null;
  const suffix = context ? ` ${context}` : '';

  if (rating === 'Brilliant') {
    const parts: string[] = [];
    if (bestBreakdown?.immediate && bestBreakdown.immediate > 0)
      parts.push(`scores ${bestBreakdown.immediate} pt${bestBreakdown.immediate !== 1 ? 's' : ''}`);
    if (bestBreakdown?.mobility && bestBreakdown.mobility >= 3)
      parts.push(`keeps ${bestBreakdown.mobility} tiles in play`);
    if (bestBreakdown?.replyRisk !== undefined && bestBreakdown.replyRisk < 3)
      parts.push('low reply risk');
    return `Brilliant — you matched the engine's top choice${parts.length ? ` (${parts.join(', ')})` : ''}.${suffix}`;
  }

  if (!played || !best) return `No alternatives available to compare.${suffix}`;

  const reasons: string[] = [];
  const scoreDiff = (bestBreakdown?.immediate ?? 0) - (playedBreakdown?.immediate ?? 0);
  const mobilityDiff = (bestBreakdown?.mobility ?? 0) - (playedBreakdown?.mobility ?? 0);
  const unloadDiff = (bestBreakdown?.unload ?? 0) - (playedBreakdown?.unload ?? 0);
  const riskDiff = (playedBreakdown?.replyRisk ?? 0) - (bestBreakdown?.replyRisk ?? 0);
  const denialDiff = (bestBreakdown?.denial ?? 0) - (playedBreakdown?.denial ?? 0);

  // Only report immediate score diff if it's a real scoring difference (actual game points)
  if (scoreDiff > 0)
    reasons.push(`${best} scores ${scoreDiff} more pt${scoreDiff !== 1 ? 's' : ''}`);
  if (mobilityDiff >= 2)
    reasons.push(`keeps ${mobilityDiff} more tile${mobilityDiff !== 1 ? 's' : ''} playable`);
  if (unloadDiff >= 3)
    reasons.push(`sheds ${unloadDiff} more pips`);
  if (riskDiff >= 3)
    reasons.push('reduces opponent scoring chance');
  if (denialDiff > 5)
    reasons.push('stronger board control');

  const warnings: string[] = [];
  if ((playedBreakdown?.replyRisk ?? 0) >= 7)
    warnings.push('left board open for opponent to score');
  if ((playedBreakdown?.mobility ?? 0) <= 1 && (playedBreakdown?.unload ?? 0) <= 3)
    warnings.push('low pip value and strands tiles in hand');

  const reasonText = reasons.length > 0 ? ` — ${reasons.join('; ')}` : '';
  const warningText = warnings.length > 0 ? `. Also: ${warnings.join(', ')}` : '';

  if (rating === 'Great')
    return `Great. ${best} was the engine's top choice${reasonText}, but ${played} was close${warningText}.${suffix}`;
  if (rating === 'Good')
    return `Good. ${best} was stronger${reasonText}${warningText}.${suffix}`;
  if (rating === 'Inaccuracy')
    return `Inaccuracy. You played ${played}, but ${best} was noticeably better${reasonText}${warningText}.${suffix}`;
  if (rating === 'Mistake')
    return `Mistake. ${best} was a significant upgrade over ${played}${reasonText}${warningText}.${suffix}`;
  return `Blunder. ${best} was far stronger than ${played}${reasonText}${warningText}.${suffix}`;
}

function classifyMove(entry: MoveEntry): {
  score: number;
  rating: MoveRating;
  bestTile?: TileTuple;
  bestPosition?: string;
  explanation: string;
  playedBreakdown: EngineBestMove['breakdown'] | null;
} {
  const validTiles = uniqueTiles(entry.validMoves);
  const bestMove = entry.engineBestMove;
  const bestTile = bestMove?.tile;

  if (entry.action === 'pass' && validTiles.length > 0) {
    return {
      score: 12,
      rating: 'Blunder',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Blunder', null, bestMove?.breakdown ?? null),
      playedBreakdown: null,
    };
  }

  if (entry.action !== 'place' || !entry.tile) {
    if (validTiles.length === 0) {
      return { score: 84, rating: 'Good', explanation: 'No legal plays — forced draw or pass.', playedBreakdown: null };
    }
    return { score: 46, rating: 'Inaccuracy', explanation: 'Non-play action when plays were available.', playedBreakdown: null };
  }

  if (validTiles.length === 0) {
    return { score: 72, rating: 'Good', explanation: 'Only one legal move available.', playedBreakdown: null };
  }

  if (!bestTile || !entry.engineBestMove) {
    return { score: 72, rating: 'Good', explanation: 'No engine evaluation available for this move.', playedBreakdown: null };
  }

  // ── Score both moves on the SAME scale using the engine ──────────────────────
  const evalState = buildEvalState(entry, 'bot');

  let bestScore = entry.engineBestMove.score;
  let bestBreakdown: EngineBestMove['breakdown'] | null = entry.engineBestMove.breakdown ?? null;
  let playedScore: number | null = null;
  let playedBreakdown: EngineBestMove['breakdown'] | null = null;

  if (evalState) {
    // Re-score the best move through the engine to get a consistent scale
    const bestEval = engineScoreForMove(evalState, bestTile, bestMove?.position, 'bot');
    if (bestEval) {
      bestScore = bestEval.score;
      bestBreakdown = bestEval.breakdown;
    }

    // Score the played move through the same engine
    const playedEval = engineScoreForMove(evalState, entry.tile, entry.boardState?.find(
      (s) => s.tile[0] === entry.tile![0] && s.tile[1] === entry.tile![1]
    )?.position, 'bot');
    if (playedEval) {
      playedScore = playedEval.score;
      playedBreakdown = playedEval.breakdown;
    }
  }

  // Fallback: if we couldn't score the played move, use best score as baseline
  if (playedScore === null) {
    playedScore = bestScore * 0.7; // conservative assumption
  }

  // ── Check if played tile is a double (turn continues) ────────────────────────
  // A double that continues the turn should not be penalised for the immediate
  // move alone — we look at whether it was part of a deliberate chain.
  const playedIsDouble = entry.tile[0] === entry.tile[1];
  const bestIsDouble = bestTile[0] === bestTile[1];

  // If player played a double and best move was not a double, the double grants
  // an extra turn — add a turn-continuation bonus to played score.
  // We approximate this as worth ~0.5 extra mobility points on the same scale.
  let adjustedPlayedScore = playedScore;
  if (playedIsDouble && !bestIsDouble) {
    adjustedPlayedScore += 40; // ~0.5 mobility units on our 100-pt scale
  }
  // Conversely if best move is a double and played isn't, best gets the bonus
  let adjustedBestScore = bestScore;
  if (bestIsDouble && !playedIsDouble) {
    adjustedBestScore += 40;
  }

  const diff = adjustedBestScore - adjustedPlayedScore;

  // Normalize against best score magnitude so thresholds are scale-independent
  const magnitude = Math.max(Math.abs(adjustedBestScore), 20);
  const normalizedDiff = diff / magnitude;

  if (normalizedDiff <= 0.0) {
    // Played move was equal or better than engine's choice
    return {
      score: 99,
      rating: 'Brilliant',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Brilliant', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.08) {
    return {
      score: 88,
      rating: 'Great',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Great', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.20) {
    return {
      score: 74,
      rating: 'Good',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Good', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.36) {
    return {
      score: 58,
      rating: 'Inaccuracy',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Inaccuracy', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.55) {
    return {
      score: 38,
      rating: 'Mistake',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Mistake', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  return {
    score: 18,
    rating: 'Blunder',
    bestTile,
    bestPosition: bestMove?.position,
    explanation: buildExplanation(entry.tile, bestTile, 'Blunder', playedBreakdown, bestBreakdown),
    playedBreakdown,
  };
}

function gradeFromAccuracy(accuracy: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 92) return 'S';
  if (accuracy >= 82) return 'A';
  if (accuracy >= 72) return 'B';
  if (accuracy >= 60) return 'C';
  return 'D';
}

export function enrichMovesWithFritz(entries: MoveEntry[]): MoveEntry[] {
  return entries.map((entry) => {
    if (entry.player !== 'you') return entry;
    if (entry.engineBestMove !== null) return entry;
    if (!entry.boardRenderState) return entry;

    try {
      const evalState = buildEvalState(entry, 'bot');
      if (!evalState) return entry;

      const choice = chooseBotMove(evalState, 'hard');
      if (!choice || !choice.move.tile) return entry;
      return {
        ...entry,
        engineBestMove: {
          tile: [choice.move.tile.low, choice.move.tile.high] as TileTuple,
          position: choice.move.position,
          score: choice.score,
          breakdown: choice.breakdown,
        },
      };
    } catch {
      return entry;
    }
  });
}

function sequenceAdjustRatings(
  analyzedMoves: AnalyzedMove[],
  allEntries: MoveEntry[],
): AnalyzedMove[] {
  // Build actual game points scored per move number (real points, not engine scores)
  const pointsByMove = new Map<number, number>();
  for (const entry of allEntries) {
    if (entry.player === 'you') {
      pointsByMove.set(entry.moveNumber, entry.pointsScored ?? 0);
    }
  }

  const moveNumbers = analyzedMoves.map((m) => m.moveNumber);

  return analyzedMoves.map((move, idx) => {
    if (move.rating === 'Brilliant') return move;

    // Actual points scored over next 3 moves (real game points, not engine scale)
    const windowPts =
      (pointsByMove.get(moveNumbers[idx]) ?? 0) +
      (pointsByMove.get(moveNumbers[idx + 1]) ?? 0) +
      (pointsByMove.get(moveNumbers[idx + 2]) ?? 0);

    // Engine's best immediate in REAL game points (from breakdown.immediate)
    const fritzImmediateRealPts = move.engineBestMove?.breakdown?.immediate ?? 0;

    // ── Soften: bad rating but sequence scored well ───────────────────────────
    // E.g. played a double to chain into scoring moves
    if (
      (move.rating === 'Blunder' || move.rating === 'Mistake') &&
      windowPts >= Math.max(fritzImmediateRealPts, 1)
    ) {
      const softenedRating: MoveRating = move.rating === 'Blunder' ? 'Inaccuracy' : 'Good';
      const softenedScore = move.rating === 'Blunder' ? 62 : 76;
      return {
        ...move,
        rating: softenedRating,
        score: softenedScore,
        explanation:
          move.explanation +
          ` (Sequence context: you scored ${windowPts} pts over the next ${Math.min(3, moveNumbers.length - idx)} moves, suggesting a deliberate setup.)`,
      };
    }

    // ── Harden: good rating but sequence scored 0 when engine expected points ─
    if (
      (move.rating === 'Good' || move.rating === 'Great') &&
      windowPts === 0 &&
      fritzImmediateRealPts >= 1 &&
      idx < analyzedMoves.length - 2
    ) {
      const hardenedRating: MoveRating = move.rating === 'Great' ? 'Good' : 'Inaccuracy';
      const hardenedScore = move.rating === 'Great' ? 74 : 58;
      return {
        ...move,
        rating: hardenedRating,
        score: hardenedScore,
        explanation:
          move.explanation +
          ` (Sequence context: the next ${Math.min(3, moveNumbers.length - idx)} moves scored 0 pts, suggesting this setup didn't pay off.)`,
      };
    }

    // ── Soften inaccuracy: next move scored at least as much as engine expected ─
    if (
      move.rating === 'Inaccuracy' &&
      (pointsByMove.get(moveNumbers[idx + 1]) ?? 0) >= fritzImmediateRealPts
    ) {
      return {
        ...move,
        rating: 'Good',
        score: 76,
        explanation:
          move.explanation +
          ` (Sequence context: your next move scored ${pointsByMove.get(moveNumbers[idx + 1])} pts, indicating a successful setup.)`,
      };
    }

    return move;
  });
}

export function analyzeMoveLog(entries: MoveEntry[], enrichWithFritz = false): GameAnalysis {
  const processedEntries = enrichWithFritz ? enrichMovesWithFritz(entries) : entries;
  const verdictByMoveNumber = new Map<number, ReturnType<typeof classifyMove>>();
  const myMoves = processedEntries.filter((entry) => entry.player === 'you');

  const rawAnalyzedMoves: AnalyzedMove[] = myMoves.map((entry) => {
    const verdict = classifyMove(entry);
    verdictByMoveNumber.set(entry.moveNumber, verdict);
    return {
      moveNumber: entry.moveNumber,
      action: entry.action,
      playedTile: entry.tile,
      bestTile: verdict.bestTile,
      bestPosition: verdict.bestPosition,
      score: verdict.score,
      rating: verdict.rating,
      explanation: verdict.explanation,
      handBefore: entry.handBefore,
      validMoves: entry.validMoves,
      boardEnds: entry.boardEnds,
      boardState: entry.boardState,
      boardRenderState: entry.boardRenderState,
      handSnapshot: entry.handSnapshot,
      engineBestMove: entry.engineBestMove,
      bestBreakdown: entry.engineBestMove?.breakdown,
    };
  });

  const analyzedMoves = sequenceAdjustRatings(rawAnalyzedMoves, processedEntries);

  const timeline = processedEntries.map((entry, moveIndex) => {
    if (entry.player === 'you') {
      const verdict = verdictByMoveNumber.get(entry.moveNumber) ?? classifyMove(entry);
      return { moveIndex, moveNumber: entry.moveNumber, player: entry.player, score: verdict.score };
    }
    const opponentScore = entry.engineBestMove
      ? Math.min(99, Math.round(entry.engineBestMove.score * 2))
      : 50;
    return { moveIndex, moveNumber: entry.moveNumber, player: entry.player, score: opponentScore };
  });

  const accuracyRaw =
    analyzedMoves.length > 0
      ? analyzedMoves.reduce((sum, move) => sum + move.score, 0) / analyzedMoves.length
      : 0;
  const accuracy = Math.round(accuracyRaw * 10) / 10;

  return {
    accuracy,
    grade: gradeFromAccuracy(accuracy),
    analyzedAt: Date.now(),
    analyzedMoves,
    timeline,
  };
}

export function loadGameAnalysisHistory(): StoredAnalysisItem[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(ANALYSIS_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredAnalysisItem =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        (item.mode === 'bot' || item.mode === 'multiplayer') &&
        typeof item.createdAt === 'number' &&
        item.analysis &&
        typeof item.analysis === 'object',
    );
  } catch {
    return [];
  }
}

export function saveGameAnalysis(
  mode: 'bot' | 'multiplayer',
  analysis: GameAnalysis,
): StoredAnalysisItem[] {
  const next: StoredAnalysisItem = {
    id: `${mode}-${analysis.analyzedAt}-${Math.random().toString(16).slice(2)}`,
    mode,
    createdAt: Date.now(),
    analysis,
  };
  const merged = [next, ...loadGameAnalysisHistory()].slice(0, 10);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(merged));
  }
  return merged;
}
