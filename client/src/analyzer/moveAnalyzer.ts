import type { EngineBestMove, MoveEntry, TileTuple } from './moveLogger';
import { normalizeBoardRenderState, sameTileTuple } from './moveLogger';
import { chooseBotMove, evaluateMove, toBotVisibleState, type BotDifficulty } from '../bot/botHeuristics';
import { createBotMatch, getLegalMoves } from '../bot/botEngine';
import type { BotMatchState } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';
import { FRITZ_TIERS } from '../bot/fritzConfig';
import type { PlacementPosition } from '../types';
import type {
  AnalyzeMoveLogOptions,
  ConsequenceChain,
  HandAnalysis,
  OracleMode,
} from './analysisTypes';
import { buildConsequenceChainsForHand } from './consequenceChain';
import { buildHandVerdict, segmentMoveLogByHand } from './handSegmentation';

export type { AnalyzeMoveLogOptions, ConsequenceChain, HandAnalysis, OracleMode } from './analysisTypes';

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
  playedBreakdown?: EngineBestMove['breakdown'];
};

export type GameAnalysis = {
  accuracy: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  analyzedAt: number;
  analyzedMoves: AnalyzedMove[];
  timeline: Array<{ moveIndex: number; moveNumber: number; player: MoveEntry['player']; score: number }>;
  hands: HandAnalysis[];
  oracleMode: OracleMode;
  tierPlayed: FritzTier;
  oracleLabel: string;
  worstHandNumber: number | null;
  consequenceByMoveNumber: Record<number, ConsequenceChain>;
};

type StoredAnalysisItem = {
  id: string;
  mode: 'bot' | 'multiplayer';
  createdAt: number;
  analysis: GameAnalysis;
};

const ANALYSIS_HISTORY_KEY = 'racehorse_move_analysis_history_v1';
const MAX_STORED_ANALYSES = 40;

function botDifficultyForTier(tier: FritzTier): BotDifficulty {
  if (tier === 'rookie') return 'casual';
  if (tier === 'standard') return 'standard';
  if (tier === 'elite') return 'hard';
  return 'master';
}

function resolveAnalyzeOptions(options?: AnalyzeMoveLogOptions): Required<AnalyzeMoveLogOptions> {
  return {
    oracleMode: options?.oracleMode ?? 'tier',
    tierPlayed: options?.tierPlayed ?? 'standard',
    winningScore: options?.winningScore ?? 60,
  };
}

function oracleLabelFor(mode: OracleMode, tier: FritzTier): string {
  if (mode === 'master') return 'Master Fritz';
  return `${FRITZ_TIERS[tier].label} Fritz`;
}

function choiceToEngineMove(choice: ReturnType<typeof chooseBotMove>): EngineBestMove | null {
  if (!choice?.move?.tile) return null;
  return {
    tile: [choice.move.tile.low, choice.move.tile.high] as TileTuple,
    position: choice.move.position,
    score: choice.score,
    breakdown: choice.breakdown,
  };
}

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
    // Invariant: boardRenderState and handBefore must both describe the same pre-move
    // decision point. BotMatchScreen logs match.board (pre-move) with handBefore.
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

function scoredItemToEngineMove(
  item:
    | {
        move: { tile?: { low: number; high: number }; position?: string };
        scored: { score: number; breakdown?: EngineBestMove['breakdown'] } | null;
      }
    | undefined,
): EngineBestMove | null {
  if (!item?.move.tile || !item.scored) return null;
  return {
    tile: [item.move.tile.low, item.move.tile.high] as TileTuple,
    position: item.move.position as PlacementPosition | undefined,
    score: item.scored.score,
    breakdown: item.scored.breakdown,
  };
}

function isTileInLoggedValidMoves(tile: TileTuple | undefined, entry: MoveEntry): boolean {
  if (!tile) return false;
  const legalTileKeys = new Set(uniqueTiles(entry.validMoves).map(tileKey));
  return legalTileKeys.has(tileKey(tile));
}

function getMoveScores(
  entry: MoveEntry,
  gradeTier: FritzTier,
): {
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

  const gradeDifficulty = botDifficultyForTier(gradeTier);
  let masterBest = choiceToEngineMove(chooseBotMove(toBotVisibleState(evalState), 'master'));
  let gradeBest = choiceToEngineMove(chooseBotMove(toBotVisibleState(evalState), gradeDifficulty));

  const legalMoves = getLegalMoves(evalState, 'bot')
    .filter((move) => move.type === 'play' && move.tile)
    .map((move) => ({
      move,
      scored: evaluateMove(toBotVisibleState(evalState), move, gradeDifficulty),
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

  if (!isTileInLoggedValidMoves(masterBest?.tile, entry)) {
    masterBest = scoredItemToEngineMove(legalMoves[0]);
  }
  if (!isTileInLoggedValidMoves(gradeBest?.tile, entry)) {
    gradeBest = scoredItemToEngineMove(legalMoves[0]);
  }

  const bestMove = masterBest;

  const playedCandidate = entry.tile
    ? legalMoves.find(({ move }) =>
        sameMoveByTileAndPosition(
          { tile: [move.tile!.low, move.tile!.high], position: move.position },
          { tile: entry.tile, position: undefined },
        ),
      ) ??
      legalMoves.find(({ move }) => sameTileTuple([move.tile!.low, move.tile!.high], entry.tile))
    : null;

  const gradeReference = gradeBest ?? masterBest;
  const bestCandidate = gradeReference
    ? legalMoves.find(({ move }) =>
        sameMoveByTileAndPosition(
          { tile: [move.tile!.low, move.tile!.high], position: move.position },
          { tile: gradeReference.tile, position: gradeReference.position },
        ),
      ) ?? legalMoves[0]
    : legalMoves[0];

  return {
    bestMove,
    bestScore: bestCandidate?.scored?.score ?? gradeReference?.score ?? null,
    bestBreakdown: bestCandidate?.scored?.breakdown ?? gradeReference?.breakdown ?? null,
    playedScore: playedCandidate?.scored?.score ?? null,
    playedBreakdown: playedCandidate?.scored?.breakdown ?? null,
    exactMatch: Boolean(
      entry.tile &&
      gradeReference &&
      sameMoveByTileAndPosition(
        { tile: entry.tile, position: undefined },
        { tile: gradeReference.tile, position: gradeReference.position },
      ),
    ) || Boolean(entry.tile && gradeReference && sameTileTuple(entry.tile, gradeReference.tile)),
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

function classifyMove(entry: MoveEntry, gradeTier: FritzTier): {
  score: number;
  rating: MoveRating;
  bestTile?: TileTuple;
  bestPosition?: string;
  explanation: string;
  bestBreakdown: EngineBestMove['breakdown'] | null;
  playedBreakdown: EngineBestMove['breakdown'] | null;
} {
  const validTiles = uniqueTiles(entry.validMoves);
  const moveEval = getMoveScores(entry, gradeTier);
  const bestMove = moveEval.bestMove;
  const bestTile = bestMove?.tile;

  if (entry.action === 'pass' && validTiles.length > 0) {
    return {
      score: 12,
      rating: 'Blunder',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Blunder', null, bestMove?.breakdown ?? null),
      bestBreakdown: bestMove?.breakdown ?? null,
      playedBreakdown: null,
    };
  }

  if (entry.action !== 'place' || !entry.tile) {
    if (validTiles.length === 0) {
      return { score: 84, rating: 'Good', explanation: 'No legal plays — forced draw or pass.', bestBreakdown: null, playedBreakdown: null };
    }
    return { score: 46, rating: 'Inaccuracy', explanation: 'Non-play action when plays were available.', bestBreakdown: null, playedBreakdown: null };
  }

  if (validTiles.length === 0) {
    return {
      score: 72,
      rating: 'Good',
      explanation: 'No legal plays recorded for this move.',
      bestBreakdown: null,
      playedBreakdown: null,
    };
  }

  if (validTiles.length === 1) {
    const onlyLegal = validTiles[0];
    return {
      score: 80,
      rating: 'Good',
      bestTile: onlyLegal,
      bestPosition: bestMove?.position,
      explanation: 'Only legal move available.',
      bestBreakdown: moveEval.bestBreakdown,
      playedBreakdown: moveEval.playedBreakdown,
    };
  }

  if (!bestTile || !entry.engineBestMove) {
    return { score: 72, rating: 'Good', explanation: 'No engine evaluation available for this move.', bestBreakdown: null, playedBreakdown: null };
  }

  // ── Score both moves on the SAME scale using the engine ──────────────────────
  const bestScore = moveEval.bestScore;
  const bestBreakdown = moveEval.bestBreakdown;
  const playedScore = moveEval.playedScore;
  const playedBreakdown = moveEval.playedBreakdown;

  if (bestScore == null || playedScore == null) {
    return {
      score: 72,
      rating: 'Good',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: 'Analyzer could not reconstruct a full Master Fritz comparison for this move.',
      bestBreakdown,
      playedBreakdown,
    };
  }

  if (moveEval.exactMatch) {
    return {
      score: 99,
      rating: 'Brilliant',
      bestTile,
      bestPosition: bestMove?.position,
      explanation: buildExplanation(entry.tile, bestTile, 'Brilliant', playedBreakdown, bestBreakdown),
      bestBreakdown,
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
      bestBreakdown,
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
      bestBreakdown,
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
      bestBreakdown,
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
      bestBreakdown,
      playedBreakdown,
    };
  }
  return {
    score: 18,
    rating: 'Blunder',
    bestTile,
    bestPosition: bestMove?.position,
    explanation: buildExplanation(entry.tile, bestTile, 'Blunder', playedBreakdown, bestBreakdown),
    bestBreakdown,
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

export function enrichMovesWithFritz(entries: MoveEntry[], referenceTier: FritzTier = 'master'): MoveEntry[] {
  const referenceDifficulty = botDifficultyForTier(referenceTier);
  return entries.map((entry) => {
    if (entry.player !== 'you') return entry;
    if (!entry.boardRenderState) return entry;
    if (entry.engineBestMove) return entry;

    try {
      const evalState = buildEvalState(entry);
      if (!evalState) return entry;

      const choice = chooseBotMove(toBotVisibleState(evalState), referenceDifficulty);
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

function analyzeHandMoves(
  handEntries: MoveEntry[],
  gradeTier: FritzTier,
  opponentLabel: string,
  handNumber: number,
  startingScores: { you: number; opponent: number },
  endingScores: { you: number; opponent: number },
): HandAnalysis {
  const myMoves = handEntries.filter((entry) => entry.player === 'you');
  const analyzedMoves: AnalyzedMove[] = myMoves.map((entry) => {
    const verdict = classifyMove(entry, gradeTier);
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
      boardRenderState: normalizeBoardRenderState(entry.boardRenderState),
      handSnapshot: entry.handSnapshot,
      engineBestMove: entry.engineBestMove,
      bestBreakdown: verdict.bestBreakdown ?? undefined,
      playedBreakdown: verdict.playedBreakdown ?? undefined,
    };
  });

  const handAccuracyRaw =
    analyzedMoves.length > 0
      ? analyzedMoves.reduce((sum, move) => sum + move.score, 0) / analyzedMoves.length
      : 0;
  const handAccuracy = Math.round(handAccuracyRaw * 10) / 10;

  const consequenceChains = buildConsequenceChainsForHand(handEntries, analyzedMoves, opponentLabel);
  const pivotalMoments = [...analyzedMoves]
    .filter((move) => move.rating === 'Blunder' || move.rating === 'Mistake' || move.rating === 'Inaccuracy')
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  const segment = {
    handNumber,
    entries: handEntries,
    startingScores,
    endingScores,
  };

  return {
    handNumber,
    startingScores,
    endingScores,
    analyzedMoves,
    handAccuracy,
    pivotalMoments,
    verdict: buildHandVerdict(segment),
    consequenceChains,
  };
}

function buildGameSummary(
  hands: HandAnalysis[],
  processedEntries: MoveEntry[],
  options: Required<AnalyzeMoveLogOptions>,
): GameAnalysis {
  const allMoves = hands.flatMap((hand) => hand.analyzedMoves);
  const verdictByMoveNumber = new Map(allMoves.map((move) => [move.moveNumber, move]));

  const timeline = processedEntries.map((entry, moveIndex) => {
    if (entry.player === 'you') {
      const verdict = verdictByMoveNumber.get(entry.moveNumber);
      return {
        moveIndex,
        moveNumber: entry.moveNumber,
        player: entry.player,
        score: verdict?.score ?? 72,
      };
    }
    const opponentScore = entry.engineBestMove
      ? Math.min(99, Math.round(entry.engineBestMove.score * 2))
      : 50;
    return { moveIndex, moveNumber: entry.moveNumber, player: entry.player, score: opponentScore };
  });

  const accuracyRaw =
    allMoves.length > 0 ? allMoves.reduce((sum, move) => sum + move.score, 0) / allMoves.length : 0;
  const accuracy = Math.round(accuracyRaw * 10) / 10;

  const worstHand =
    hands.length > 0
      ? hands.reduce((worst, hand) => (hand.handAccuracy < worst.handAccuracy ? hand : worst))
      : null;

  const consequenceByMoveNumber: Record<number, ConsequenceChain> = {};
  for (const hand of hands) {
    for (const chain of hand.consequenceChains) {
      consequenceByMoveNumber[chain.moveNumber] = chain;
    }
  }

  return {
    accuracy,
    grade: gradeFromAccuracy(accuracy),
    analyzedAt: Date.now(),
    analyzedMoves: allMoves,
    timeline,
    hands,
    oracleMode: options.oracleMode,
    tierPlayed: options.tierPlayed,
    oracleLabel: oracleLabelFor(options.oracleMode, options.tierPlayed),
    worstHandNumber: worstHand?.handNumber ?? null,
    consequenceByMoveNumber,
  };
}

export function analyzeMoveLog(
  entries: MoveEntry[],
  enrichWithFritz = false,
  options?: AnalyzeMoveLogOptions,
): GameAnalysis {
  const resolved = resolveAnalyzeOptions(options);
  const gradeTier = resolved.oracleMode === 'master' ? 'master' : resolved.tierPlayed;
  const referenceTier: FritzTier = 'master';
  const processedEntries = enrichWithFritz
    ? enrichMovesWithFritz(entries, referenceTier)
    : entries;

  const segments = segmentMoveLogByHand(processedEntries);
  const hands = segments.map((segment) =>
    analyzeHandMoves(
      segment.entries,
      gradeTier,
      'Fritz',
      segment.handNumber,
      segment.startingScores,
      segment.endingScores,
    ),
  );

  return buildGameSummary(hands, processedEntries, resolved);
}

export function analyzeMoveLogDeferred(
  entries: MoveEntry[],
  enrichWithFritz = false,
  options?: AnalyzeMoveLogOptions,
): Promise<GameAnalysis> {
  return new Promise((resolve, reject) => {
    const run = () => {
      try {
        resolve(analyzeMoveLog(entries, enrichWithFritz, options));
      } catch (error) {
        reject(error);
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => run(), { timeout: 4000 });
      return;
    }
    setTimeout(run, 0);
  });
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
  if (typeof window === 'undefined') return [next];
  try {
    const existing = loadGameAnalysisHistory();
    const merged = [next, ...existing].slice(0, MAX_STORED_ANALYSES);
    window.localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return [next];
  }
}
