import type { EngineBestMove, MoveEntry, TileTuple } from './moveLogger';
import { sameTileTuple } from './moveLogger';
import { chooseBotMove, evaluateMove, toBotVisibleState } from '../bot/botHeuristics';
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

function buildEvalState(entry: MoveEntry): BotMatchState | null {
  if (!entry.boardRenderState) return null;
  try {
    const template = createBotMatch(60, 7);
    const hand = entry.handBefore.map((t) => ({ low: t[0], high: t[1] }));
    return {
      ...template,
      board: entry.boardRenderState as unknown as typeof template.board,
      currentPlayer: 'bot',
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
          hand: [],
          score: 0,
        },
        bot: {
          ...template.players.bot,
          hand,
          score: 0,
        },
      },
    };
  } catch {
    return null;
  }
}

function sameMoveByTileAndPosition(
  candidate: { tile?: TileTuple; position?: string },
  target: { tile?: TileTuple; position?: string },
): boolean {
  return sameTileTuple(candidate.tile, target.tile) && String(candidate.position ?? '') === String(target.position ?? '');
}

function compareTileTupleNumeric(a?: TileTuple, b?: TileTuple): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[0] !== b[0]) return a[0] - b[0];
  return 0;
}

function compareRecordedMoves(
  a: { tile?: TileTuple; position?: string },
  b: { tile?: TileTuple; position?: string },
): number {
  const tileCompare = compareTileTupleNumeric(a.tile, b.tile);
  if (tileCompare !== 0) return tileCompare;
  return String(a.position ?? '').localeCompare(String(b.position ?? ''));
}

function getMasterMoveScores(entry: MoveEntry): {
  bestMove: EngineBestMove | null;
  bestScore: number | null;
  bestBreakdown: EngineBestMove['breakdown'] | null;
  playedScore: number | null;
  playedBreakdown: EngineBestMove['breakdown'] | null;
  exactMatch: boolean;
} {
  const evalState = buildEvalState(entry);
  if (!evalState) {
    return {
      bestMove: null,
      bestScore: null,
      bestBreakdown: null,
      playedScore: null,
      playedBreakdown: null,
      exactMatch: false,
    };
  }

  const masterBest = chooseBotMove(toBotVisibleState(evalState), 'master');
  const bestMove = masterBest?.move?.tile
    ? {
        tile: [masterBest.move.tile.low, masterBest.move.tile.high] as TileTuple,
        position: masterBest.move.position,
        score: masterBest.score,
        breakdown: masterBest.breakdown,
      }
    : null;

  const legalMoves = getLegalMoves(evalState, 'bot')
    .filter((move) => move.type === 'play' && move.tile)
    .map((move) => ({
      move,
      scored: evaluateMove(toBotVisibleState(evalState), move, 'master'),
    }))
    .filter((item) => item.scored && item.move.tile)
    .sort((a, b) => {
      const scoreDiff = (b.scored?.score ?? -Infinity) - (a.scored?.score ?? -Infinity);
      if (scoreDiff !== 0) return scoreDiff;
      return compareRecordedMoves(
        { tile: [a.move.tile!.low, a.move.tile!.high], position: a.move.position },
        { tile: [b.move.tile!.low, b.move.tile!.high], position: b.move.position },
      );
    });

  const playedCandidate = entry.tile
    ? legalMoves.find(({ move }) =>
        sameMoveByTileAndPosition(
          { tile: [move.tile!.low, move.tile!.high], position: move.position },
          { tile: entry.tile, position: undefined },
        ),
      ) ??
      legalMoves.find(({ move }) => sameTileTuple([move.tile!.low, move.tile!.high], entry.tile))
    : null;

  const bestCandidate = bestMove
    ? legalMoves.find(({ move }) =>
        sameMoveByTileAndPosition(
          { tile: [move.tile!.low, move.tile!.high], position: move.position },
          { tile: bestMove.tile, position: bestMove.position },
        ),
      ) ?? legalMoves[0]
    : legalMoves[0];

  return {
    bestMove,
    bestScore: bestCandidate?.scored?.score ?? bestMove?.score ?? null,
    bestBreakdown: bestCandidate?.scored?.breakdown ?? bestMove?.breakdown ?? null,
    playedScore: playedCandidate?.scored?.score ?? null,
    playedBreakdown: playedCandidate?.scored?.breakdown ?? null,
    exactMatch: Boolean(
      entry.tile &&
      bestMove &&
      sameMoveByTileAndPosition(
        { tile: entry.tile, position: undefined },
        { tile: bestMove.tile, position: bestMove.position },
      ),
    ) || Boolean(entry.tile && bestMove && sameTileTuple(entry.tile, bestMove.tile)),
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
  const masterEval = getMasterMoveScores(entry);
  const bestMove = masterEval.bestMove;
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
  const bestScore = masterEval.bestScore;
  const bestBreakdown = masterEval.bestBreakdown;
  const playedScore = masterEval.playedScore;
  const playedBreakdown = masterEval.playedBreakdown;

  if (bestScore == null || playedScore == null) {
    return {
      score: 72,
      rating: 'Good',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: 'Analyzer could not reconstruct a full Master Fritz comparison for this move.',
      playedBreakdown,
    };
  }

  if (masterEval.exactMatch) {
    return {
      score: 99,
      rating: 'Brilliant',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Brilliant', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }

  const diff = bestScore - playedScore;
  const magnitude = Math.max(Math.abs(bestScore), 20);
  const normalizedDiff = diff / magnitude;

  if (normalizedDiff <= 0.03) {
    return {
      score: 92,
      rating: 'Great',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Great', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.12) {
    return {
      score: 80,
      rating: 'Good',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Good', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.28) {
    return {
      score: 60,
      rating: 'Inaccuracy',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Inaccuracy', playedBreakdown, bestBreakdown),
      playedBreakdown,
    };
  }
  if (normalizedDiff <= 0.48) {
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
    if (!entry.boardRenderState) return entry;

    try {
      const evalState = buildEvalState(entry);
      if (!evalState) return entry;

      const choice = chooseBotMove(toBotVisibleState(evalState), 'master');
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

  const analyzedMoves = rawAnalyzedMoves;

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
