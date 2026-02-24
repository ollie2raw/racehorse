export type MoveEntry = {
  moveNumber: number;
  player: 'you' | 'opponent';
  action: 'place' | 'draw' | 'pass';
  tile?: [number, number];
  boardEnds: [number, number];
  handBefore: [number, number][];
  validMoves: [number, number][];
  pipDelta: number;
};

export type MoveRating = 'Optimal' | 'Good' | 'Mistake' | 'Blunder';

export type AnalyzedMove = {
  moveNumber: number;
  action: MoveEntry['action'];
  playedTile?: [number, number];
  bestTile?: [number, number];
  score: number;
  rating: MoveRating;
  explanation: string;
  handBefore: [number, number][];
  validMoves: [number, number][];
  boardEnds: [number, number];
};

export type GameAnalysis = {
  accuracy: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  analyzedAt: number;
  analyzedMoves: AnalyzedMove[];
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

function sameTile(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return false;
  return tileKey(a) === tileKey(b);
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
  explanation: string;
} {
  const validTiles = uniqueTiles(entry.validMoves);

  if ((entry.action === 'draw' || entry.action === 'pass') && validTiles.length > 0) {
    return {
      score: 12,
      rating: 'Blunder',
      explanation: 'You could have played a tile instead of drawing/passing.',
    };
  }

  if (entry.action !== 'place' || !entry.tile) {
    if (validTiles.length === 0) {
      return {
        score: 78,
        rating: 'Good',
        explanation: 'No legal play was available on this turn.',
      };
    }
    return {
      score: 55,
      rating: 'Mistake',
      explanation: 'A playable option existed but was not used.',
    };
  }

  if (validTiles.length === 0) {
    return {
      score: 55,
      rating: 'Mistake',
      explanation: 'Move quality could not be compared against alternatives.',
    };
  }

  let bestTile = validTiles[0];
  let bestEval = valueForTile(bestTile, entry.boardEnds, entry.handBefore);
  for (const tile of validTiles.slice(1)) {
    const nextEval = valueForTile(tile, entry.boardEnds, entry.handBefore);
    if (nextEval.value > bestEval.value) {
      bestEval = nextEval;
      bestTile = tile;
    }
  }

  const playedEval = valueForTile(entry.tile, entry.boardEnds, entry.handBefore);
  const diff = bestEval.value - playedEval.value;

  if (sameTile(entry.tile, bestTile) || diff <= 0.75) {
    return {
      score: 97,
      rating: 'Optimal',
      bestTile,
      explanation: `Best move found: ${tileLabel(bestTile)}.`,
    };
  }
  if (diff <= 3) {
    return {
      score: 82,
      rating: 'Good',
      bestTile,
      explanation: `Good move. ${tileLabel(bestTile)} had slightly better follow-up potential.`,
    };
  }
  if (diff <= 8) {
    return {
      score: 58,
      rating: 'Mistake',
      bestTile,
      explanation: `Could have played ${tileLabel(bestTile)} for a stronger board setup.`,
    };
  }
  return {
    score: 28,
    rating: 'Blunder',
    bestTile,
    explanation: `Could have played ${tileLabel(bestTile)} for a much stronger position.`,
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
  const myMoves = entries.filter((entry) => entry.player === 'you');
  const analyzedMoves: AnalyzedMove[] = myMoves.map((entry) => {
    const verdict = classifyMove(entry);
    return {
      moveNumber: entry.moveNumber,
      action: entry.action,
      playedTile: entry.tile,
      bestTile: verdict.bestTile,
      score: verdict.score,
      rating: verdict.rating,
      explanation: verdict.explanation,
      handBefore: entry.handBefore,
      validMoves: entry.validMoves,
      boardEnds: entry.boardEnds,
    };
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
