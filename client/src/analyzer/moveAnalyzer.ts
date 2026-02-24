import type { MoveEntry } from './moveLogger';
import { sameTileTuple } from './moveLogger';

export type MoveRating = 'Brilliant' | 'Great' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';

export type AnalyzedMove = {
  moveNumber: number;
  action: MoveEntry['action'];
  playedTile?: [number, number];
  bestTile?: [number, number];
  bestPosition?: string;
  score: number;
  rating: MoveRating;
  explanation: string;
  handBefore: [number, number][];
  validMoves: [number, number][];
  boardEnds: [number, number];
  boardState: MoveEntry['boardState'];
  boardRenderState: MoveEntry['boardRenderState'];
  handSnapshot: MoveEntry['handSnapshot'];
  engineBestMove: MoveEntry['engineBestMove'];
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

function tileKey(tile: [number, number]): string {
  const a = Math.min(tile[0], tile[1]);
  const b = Math.max(tile[0], tile[1]);
  return `${a}|${b}`;
}

function tileLabel(tile: [number, number]): string {
  return `${tile[0]}|${tile[1]}`;
}

function uniqueTiles(tiles: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tile);
  }
  return out;
}

function remainingHandAfterPlay(
  handBefore: [number, number][],
  played: [number, number],
): [number, number][] {
  const key = tileKey(played);
  let removed = false;
  return handBefore.filter((tile) => {
    if (!removed && tileKey(tile) === key) {
      removed = true;
      return false;
    }
    return true;
  });
}

function nextEndsForTile(
  tile: [number, number],
  boardEnds: [number, number],
): Array<[number, number]> {
  const [left, right] = boardEnds;
  if (left < 0 || right < 0) return [[tile[0], tile[1]]];

  const out: Array<[number, number]> = [];
  if (tile[0] === left) out.push([tile[1], right]);
  if (tile[1] === left) out.push([tile[0], right]);
  if (tile[0] === right) out.push([left, tile[1]]);
  if (tile[1] === right) out.push([left, tile[0]]);
  return out;
}

function setupScore(remaining: [number, number][], ends: [number, number]): number {
  let score = 0;
  for (const tile of remaining) {
    const matchesLeft = tile[0] === ends[0] || tile[1] === ends[0];
    const matchesRight = tile[0] === ends[1] || tile[1] === ends[1];
    if (matchesLeft || matchesRight) score += 1;
    if (matchesLeft && matchesRight) score += 1;
  }
  return score;
}

function immediatePoints(ends: [number, number]): number {
  const sum = ends[0] + ends[1];
  return sum;
}

function valueForTile(
  tile: [number, number],
  boardEnds: [number, number],
  handBefore: [number, number][],
): { value: number; points: number } {
  const possibilities = nextEndsForTile(tile, boardEnds);
  if (possibilities.length === 0) {
    return { value: Number.NEGATIVE_INFINITY, points: 0 };
  }

  const remaining = remainingHandAfterPlay(handBefore, tile);
  let best = Number.NEGATIVE_INFINITY;
  let bestPoints = 0;

  for (const ends of possibilities) {
    const points = immediatePoints(ends);
    const future = setupScore(remaining, ends);
    const value = points * 3 + future * 2;
    if (value > best) {
      best = value;
      bestPoints = points;
    }
  }

  return { value: best, points: bestPoints };
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

  if ((entry.action === 'draw' || entry.action === 'pass') && validTiles.length > 0) {
    const bestText = bestTile ? ` ${tileLabel(bestTile)} was playable.` : '';
    return {
      score: 12,
      rating: 'Blunder',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: `You could have played a tile instead of drawing/passing.${bestText}`,
    };
  }

  if (entry.action !== 'place' || !entry.tile) {
    if (validTiles.length === 0) {
      return {
        score: 84,
        rating: 'Good',
        explanation: 'No legal play was available on this turn.',
      };
    }
    return {
      score: 46,
      rating: 'Inaccuracy',
      explanation: 'A playable option existed but was not used.',
    };
  }

  if (validTiles.length === 0) {
    return {
      score: 72,
      rating: 'Good',
      explanation: 'Move quality could not be compared against alternatives.',
    };
  }

  let fallbackBestTile = validTiles[0];
  let bestEval = valueForTile(fallbackBestTile, entry.boardEnds, entry.handBefore);
  for (const tile of validTiles.slice(1)) {
    const nextEval = valueForTile(tile, entry.boardEnds, entry.handBefore);
    if (nextEval.value > bestEval.value) {
      bestEval = nextEval;
      fallbackBestTile = tile;
    }
  }

  const playedEval = valueForTile(entry.tile, entry.boardEnds, entry.handBefore);
  const bestForAdvice = bestTile ?? fallbackBestTile;
  const bestPosition = bestMove?.position;
  const diff = bestEval.value - playedEval.value;

  if (sameTileTuple(entry.tile, bestForAdvice) && Math.abs(diff) <= 0.3) {
    return {
      score: 99,
      rating: 'Brilliant',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: `Brilliant. You matched the engine line with ${tileLabel(bestForAdvice)}.`,
    };
  }
  if (sameTileTuple(entry.tile, bestForAdvice) || diff <= 1.25) {
    return {
      score: 91,
      rating: 'Great',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: `Great move. ${tileLabel(bestForAdvice)} was the cleanest engine continuation.`,
    };
  }
  if (diff <= 3) {
    return {
      score: 79,
      rating: 'Good',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: `Solid move. ${tileLabel(bestForAdvice)} was slightly stronger.`,
    };
  }
  if (diff <= 6) {
    return {
      score: 62,
      rating: 'Inaccuracy',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: `You played ${tileLabel(entry.tile)}, but ${tileLabel(bestForAdvice)} was more accurate here.`,
    };
  }
  if (diff <= 10) {
    return {
      score: 44,
      rating: 'Mistake',
      bestTile: bestForAdvice,
      bestPosition,
      explanation: `You played ${tileLabel(entry.tile)}, but ${tileLabel(bestForAdvice)} would have scored better and improved control.`,
    };
  }
  return {
    score: 19,
    rating: 'Blunder',
    bestTile: bestForAdvice,
    bestPosition,
    explanation: `You played ${tileLabel(entry.tile)}, but ${tileLabel(bestForAdvice)} was a major upgrade for score and board denial.`,
  };
}

function gradeFromAccuracy(accuracy: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (accuracy >= 92) return 'S';
  if (accuracy >= 82) return 'A';
  if (accuracy >= 72) return 'B';
  if (accuracy >= 60) return 'C';
  return 'D';
}

export function analyzeMoveLog(entries: MoveEntry[]): GameAnalysis {
  const verdictByMoveNumber = new Map<number, ReturnType<typeof classifyMove>>();
  const myMoves = entries.filter((entry) => entry.player === 'you');
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
    };
  });

  const timeline = entries.map((entry, moveIndex) => {
    if (entry.player === 'you') {
      const verdict = verdictByMoveNumber.get(entry.moveNumber) ?? classifyMove(entry);
      return { moveIndex, moveNumber: entry.moveNumber, player: entry.player, score: verdict.score };
    }
    const opponentScore = 50;
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
