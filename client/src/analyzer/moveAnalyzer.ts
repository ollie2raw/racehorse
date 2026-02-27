import type { EngineBestMove, MoveEntry, TileTuple } from './moveLogger';
import { sameTileTuple } from './moveLogger';
import { chooseBotMove } from '../bot/botHeuristics';
import { createBotMatch, previewPlayMove } from '../bot/botEngine';
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

function buildExplanation(
  playedTile: TileTuple | undefined,
  bestTile: TileTuple | undefined,
  rating: MoveRating,
  playedBreakdown: EngineBestMove['breakdown'] | null,
  bestBreakdown: { immediate: number; mobility: number; denial: number; unload: number } | null,
): string {
  if (rating === 'Brilliant') {
    const pts = bestBreakdown?.immediate ?? 0;
    const mob = bestBreakdown?.mobility ?? 0;
    const parts: string[] = [];
    if (pts > 0) parts.push(`scores ${pts} point${pts !== 1 ? 's' : ''}`);
    if (mob >= 3) parts.push(`keeps ${mob} tiles playable`);
    const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
    return `Brilliant. You found the Fritz line${detail}.`;
  }
  if (!playedTile || !bestTile) return 'No alternatives available to compare.';
  const played = tileLabel(playedTile);
  const best = tileLabel(bestTile);
  const reasons: string[] = [];
  if (bestBreakdown) {
    if (bestBreakdown.immediate > (playedBreakdown?.immediate ?? 0)) {
      const diff = bestBreakdown.immediate - (playedBreakdown?.immediate ?? 0);
      reasons.push(`scores ${diff} more point${diff !== 1 ? 's' : ''}`);
    }
    if (bestBreakdown.mobility > (playedBreakdown?.mobility ?? 0) + 1) {
      reasons.push(`leaves more tiles playable`);
    }
    if (bestBreakdown.denial < (playedBreakdown?.denial ?? 0) - 2) {
      reasons.push(`better board denial`);
    }
    if (bestBreakdown.unload > (playedBreakdown?.unload ?? 0)) {
      reasons.push(`unloads higher pip liability`);
    }
  }
  const reasonText = reasons.length > 0 ? ` — ${reasons.join(', ')}` : '';
  if (rating === 'Great') return `Great move. Fritz also liked ${best}${reasonText}.`;
  if (rating === 'Good') return `Good move. ${best} was slightly stronger${reasonText}.`;
  if (rating === 'Inaccuracy')
    return `Inaccuracy. You played ${played}, but ${best} was more accurate${reasonText}.`;
  if (rating === 'Mistake')
    return `Mistake. You played ${played}, but ${best} would have been significantly better${reasonText}.`;
  return `Blunder. You played ${played}, but ${best} was a major upgrade${reasonText}.`;
}

function computePlayedBreakdown(
  entry: MoveEntry,
): EngineBestMove['breakdown'] | null {
  if (!entry.tile || !entry.boardRenderState) return null;
  try {
    const template = createBotMatch(60, 7);
    const hand = entry.handBefore.map((t) => ({ low: t[0], high: t[1] }));
    const evalState: BotMatchState = {
      ...template,
      board: entry.boardRenderState as unknown as typeof template.board,
      currentPlayer: 'you',
      handOpen: true,
      handOver: false,
      gameOver: false,
      winningScore: 60,
      consecutivePasses: 0,
      boneyard: new Array(14).fill({ low: 0, high: 0 }),
      players: {
        you: { ...template.players.you, hand, score: 0 },
        bot: { ...template.players.bot, hand: [], score: 0 },
      },
    };
    const move = {
      type: 'play' as const,
      tile: { low: entry.tile[0], high: entry.tile[1] },
      position: entry.boardRenderState.mainLine.length === 0
        ? ('left' as const)
        : ('right' as const),
    };
    const preview = previewPlayMove(evalState, 'you', move);
    if (!preview) return null;
    const immediate = preview.immediateScore;
    const mobility = preview.nextHand.filter((t) =>
      preview.openEnds.some((e) => e === t.low || e === t.high),
    ).length;
    const unload = entry.tile[0] + entry.tile[1];
    const denial = preview.openEnds.reduce((sum, end) => {
      return sum - (end >= 0 && end <= 6 ? 7 : 0);
    }, 0);
    return {
      immediate,
      doubleBias: entry.tile[0] === entry.tile[1] ? 1 : 0,
      mobility,
      denial,
      unload,
      replyRisk: 0,
    };
  } catch {
    return null;
  }
}

function classifyMove(
  entry: MoveEntry,
): {
  score: number;
  rating: MoveRating;
  bestTile?: [number, number];
  bestPosition?: string;
  explanation: string;
} {
  const validTiles = uniqueTiles(entry.validMoves);
  const bestMove = entry.engineBestMove;
  const bestTile = bestMove?.tile;
  const bestBreakdown = entry.engineBestMove?.breakdown ?? null;
  const playedBreakdown = computePlayedBreakdown(entry);

  if (entry.action === 'pass' && validTiles.length > 0) {
    return {
      score: 12,
      rating: 'Blunder',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Blunder', playedBreakdown, bestBreakdown),
    };
  }

  if (entry.action !== 'place' || !entry.tile) {
    if (validTiles.length === 0) {
      return {
        score: 84,
        rating: 'Good',
        explanation: buildExplanation(entry.tile, bestTile, 'Good', playedBreakdown, bestBreakdown),
      };
    }
    return {
      score: 46,
      rating: 'Inaccuracy',
      explanation: buildExplanation(entry.tile, bestTile, 'Inaccuracy', playedBreakdown, bestBreakdown),
    };
  }

  if (validTiles.length === 0) {
    return {
      score: 72,
      rating: 'Good',
      explanation: buildExplanation(entry.tile, bestTile, 'Good', playedBreakdown, bestBreakdown),
    };
  }

  // If no Fritz evaluation available, rate as Good with no comparison
  if (!bestTile || !entry.engineBestMove) {
    return {
      score: 72,
      rating: 'Good',
      explanation: 'No engine evaluation available for this move.',
    };
  }

  const bestForAdvice = bestTile;
  const bestPosition = bestMove?.position;

  // Brilliant: played exactly Fritz's top choice
  if (sameTileTuple(entry.tile, bestTile)) {
    return {
      score: 99,
      rating: 'Brilliant',
      bestTile,
      bestPosition,
      explanation: buildExplanation(entry.tile, bestTile, 'Brilliant', playedBreakdown, bestBreakdown),
    };
  }

  // Use Fritz score difference to rate the move
  // Fritz score for best move vs played move
  const bestScore = entry.engineBestMove.score;
  const playedScore = playedBreakdown
    ? playedBreakdown.immediate * 60 +
      playedBreakdown.mobility * 8 +
      playedBreakdown.unload * 1.2
    : 0;
  const diff = bestScore - playedScore;

  if (diff <= 1.5) {
    return {
      score: 88,
      rating: 'Great',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: buildExplanation(entry.tile, bestForAdvice, 'Great', playedBreakdown, bestBreakdown),
    };
  }
  if (diff <= 3.0) {
    return {
      score: 74,
      rating: 'Good',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: buildExplanation(entry.tile, bestForAdvice, 'Good', playedBreakdown, bestBreakdown),
    };
  }
  if (diff <= 5.0) {
    return {
      score: 58,
      rating: 'Inaccuracy',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: buildExplanation(entry.tile, bestForAdvice, 'Inaccuracy', playedBreakdown, bestBreakdown),
    };
  }
  if (diff <= 8.0) {
    return {
      score: 38,
      rating: 'Mistake',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: buildExplanation(entry.tile, bestForAdvice, 'Mistake', playedBreakdown, bestBreakdown),
    };
  }
  return {
    score: 18,
    rating: 'Blunder',
    bestTile: bestForAdvice,
    bestPosition,
    explanation: buildExplanation(entry.tile, bestForAdvice, 'Blunder', playedBreakdown, bestBreakdown),
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
    // Only evaluate your moves, only placements draws and passes
    if (entry.player !== 'you') return entry;
    // Already has a real Fritz evaluation from bot mode — skip
    if (entry.engineBestMove !== null) return entry;
    // Need a board to evaluate against
    if (!entry.boardRenderState) return entry;

    try {
      const template = createBotMatch(60, 7);
      const hand = entry.handBefore.map((t) => ({ low: t[0], high: t[1] }));
      const evalState: BotMatchState = {
        ...template,
        board: entry.boardRenderState as unknown as typeof template.board,
        currentPlayer: 'bot',
        handOpen: true,
        handOver: false,
        gameOver: false,
        winningScore: 60,
        consecutivePasses: 0,
        boneyard: new Array(14).fill({ low: 0, high: 0 }),
        players: {
          you: { ...template.players.you, hand: [], score: 0 },
          bot: { ...template.players.bot, hand, score: 0 },
        },
      };
      const choice = chooseBotMove(evalState, 'hard');
      if (!choice || !choice.move.tile) return entry;
      return {
        ...entry,
        engineBestMove: {
          tile: [choice.move.tile.low, choice.move.tile.high] as [number, number],
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

export function analyzeMoveLog(entries: MoveEntry[], enrichWithFritz = false): GameAnalysis {
  const processedEntries = enrichWithFritz ? enrichMovesWithFritz(entries) : entries;
  const verdictByMoveNumber = new Map<number, ReturnType<typeof classifyMove>>();
  const myMoves = processedEntries.filter((entry) => entry.player === 'you');
  const analyzedMoves: AnalyzedMove[] = myMoves.map((entry) => {
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
