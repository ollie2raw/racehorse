import type { AnalyzedMove, GameAnalysis, MoveRating } from '../../analyzer/moveAnalyzer';
import type { ConsequenceChain } from '../../analyzer/analysisTypes';
import type { MoveEntry } from '../../game/moveLogger';

export type PivotalTurnSignal =
  | 'rating_blunder'
  | 'rating_mistake'
  | 'rating_inaccuracy'
  | 'engine_gap'
  | 'pass_with_legal_play'
  | 'endgame_leverage'
  | 'branch_moment'
  | 'opponent_scored_next'
  | 'learning_upgrade';

export type PivotalTurnPhase = 'opening' | 'midgame' | 'endgame';

export type PivotalTurnScoreBreakdown = {
  ratingPenalty: number;
  engineGap: number;
  immediateGap: number;
  passPenalty: number;
  endgameBonus: number;
  branchBonus: number;
  replyRiskBonus: number;
  scoreStateBonus: number;
};

export type PivotalTurnCandidate = {
  /** Review order (1..n), sorted chronologically by move number. */
  rank: number;
  moveNumber: number;
  /** 0-based index among the player's moves in this game. */
  playerMoveIndex: number;
  pivotalScore: number;
  signals: PivotalTurnSignal[];
  scoreBreakdown: PivotalTurnScoreBreakdown;
  scoreYou: number;
  scoreOpp: number;
  phase: PivotalTurnPhase;
  move: AnalyzedMove;
  consequence?: ConsequenceChain;
};

export type PivotalTurnSelection = {
  analysis: GameAnalysis;
  candidates: PivotalTurnCandidate[];
  totalPlayerMoves: number;
};

export type PivotalTurnSelectorOptions = {
  /** Number of pivotal turns to return (default 3). */
  count?: number;
  /** Race target used for endgame detection (default 60). */
  winningScore?: number;
  /** Skip re-running analyzeMoveLog when the caller already has analysis. */
  analysis?: GameAnalysis;
};

const DEFAULT_COUNT = 3;
const DEFAULT_WINNING_SCORE = 60;
const ENDGAME_MARGIN = 15;

const RATING_PENALTY: Record<MoveRating, number> = {
  Blunder: 100,
  Mistake: 70,
  Inaccuracy: 35,
  Good: 12,
  Great: 5,
  Brilliant: 0,
};

type ScoredCandidate = Omit<PivotalTurnCandidate, 'rank'>;

function buildScoreStateAtMove(
  moveLog: MoveEntry[],
  upToMoveNumber: number,
): { you: number; opp: number } {
  let you = 0;
  let opp = 0;
  for (const entry of moveLog) {
    if (entry.moveNumber > upToMoveNumber) continue;
    if (entry.player === 'you') {
      you += entry.pointsScored ?? 0;
    } else {
      opp += entry.pointsScored ?? 0;
    }
  }
  return { you, opp };
}

function opponentScoredOnNextTurn(moveLog: MoveEntry[], playerMoveNumber: number): boolean {
  const startIndex = moveLog.findIndex(
    (entry) => entry.player === 'you' && entry.moveNumber === playerMoveNumber,
  );
  if (startIndex < 0) return false;

  for (let index = startIndex + 1; index < moveLog.length; index += 1) {
    const entry = moveLog[index]!;
    if (entry.player === 'you') return false;
    return (entry.pointsScored ?? 0) > 0;
  }
  return false;
}

function isBranchMoment(entry: MoveEntry): boolean {
  if (entry.boardState.some((snapshot) => snapshot.source === 'branch')) {
    return true;
  }
  const board = entry.boardRenderState;
  if (!board) return false;
  return board.hubDoubles.some((hub) =>
    hub.branches.some((branch) => branch != null && (branch.tiles?.length ?? 0) > 0),
  );
}

function resolvePhase(params: {
  playerMoveIndex: number;
  totalPlayerMoves: number;
  scoreYou: number;
  scoreOpp: number;
  winningScore: number;
}): PivotalTurnPhase {
  const { playerMoveIndex, totalPlayerMoves, scoreYou, scoreOpp, winningScore } = params;
  const maxScore = Math.max(scoreYou, scoreOpp);
  const openingCutoff = Math.max(1, Math.floor(totalPlayerMoves * 0.33));
  const endgameCutoff = Math.max(openingCutoff + 1, Math.floor(totalPlayerMoves * 0.67));

  if (maxScore >= winningScore - ENDGAME_MARGIN || playerMoveIndex >= endgameCutoff) {
    return 'endgame';
  }
  if (playerMoveIndex < openingCutoff || (scoreYou < 20 && scoreOpp < 20)) {
    return 'opening';
  }
  return 'midgame';
}

function scoreCandidate(params: {
  move: AnalyzedMove;
  entry: MoveEntry | undefined;
  moveLog: MoveEntry[];
  playerMoveIndex: number;
  totalPlayerMoves: number;
  winningScore: number;
}): ScoredCandidate {
  const { move, entry, moveLog, playerMoveIndex, totalPlayerMoves, winningScore } = params;
  const scoreState = buildScoreStateAtMove(moveLog, move.moveNumber);
  const phase = resolvePhase({
    playerMoveIndex,
    totalPlayerMoves,
    scoreYou: scoreState.you,
    scoreOpp: scoreState.opp,
    winningScore,
  });

  const ratingPenalty = RATING_PENALTY[move.rating];
  const engineGap = Math.max(0, 100 - move.score);
  const bestImmediate = move.engineBestMove?.breakdown?.immediate ?? move.bestBreakdown?.immediate ?? 0;
  const playedImmediate = entry?.pointsScored ?? 0;
  const immediateGap = Math.max(0, bestImmediate - playedImmediate) * 2;

  const passPenalty =
    move.action === 'pass' && (entry?.validMoves.length ?? move.validMoves.length) > 0 ? 80 : 0;

  const endgameBonus =
    Math.max(scoreState.you, scoreState.opp) >= winningScore - ENDGAME_MARGIN ? 25 : 0;

  const branchBonus = entry && isBranchMoment(entry) ? 15 : 0;

  const replyRiskBonus = opponentScoredOnNextTurn(moveLog, move.moveNumber) ? 20 : 0;

  const scoreDiff = scoreState.you - scoreState.opp;
  const scoreStateBonus =
    (move.rating === 'Blunder' || move.rating === 'Mistake') && Math.abs(scoreDiff) <= 10
      ? 10
      : move.rating === 'Blunder' && scoreDiff <= -10
        ? 15
        : 0;

  const pivotalScore =
    ratingPenalty +
    engineGap +
    immediateGap +
    passPenalty +
    endgameBonus +
    branchBonus +
    replyRiskBonus +
    scoreStateBonus;

  const signals: PivotalTurnSignal[] = [];
  if (move.rating === 'Blunder') signals.push('rating_blunder');
  if (move.rating === 'Mistake') signals.push('rating_mistake');
  if (move.rating === 'Inaccuracy') signals.push('rating_inaccuracy');
  if (engineGap >= 20 || immediateGap >= 4) signals.push('engine_gap');
  if (passPenalty > 0) signals.push('pass_with_legal_play');
  if (endgameBonus > 0) signals.push('endgame_leverage');
  if (branchBonus > 0) signals.push('branch_moment');
  if (replyRiskBonus > 0) signals.push('opponent_scored_next');
  if (
    move.rating === 'Good' ||
    move.rating === 'Great' ||
    (move.rating === 'Brilliant' && engineGap > 0)
  ) {
    signals.push('learning_upgrade');
  }

  return {
    moveNumber: move.moveNumber,
    playerMoveIndex,
    pivotalScore,
    signals,
    scoreBreakdown: {
      ratingPenalty,
      engineGap,
      immediateGap,
      passPenalty,
      endgameBonus,
      branchBonus,
      replyRiskBonus,
      scoreStateBonus,
    },
    scoreYou: scoreState.you,
    scoreOpp: scoreState.opp,
    phase,
    move,
  };
}

function pickDiverseCandidates(scored: ScoredCandidate[], count: number): ScoredCandidate[] {
  if (scored.length <= count) {
    return [...scored].sort((a, b) => a.moveNumber - b.moveNumber);
  }

  const sorted = [...scored].sort((a, b) => {
    if (b.pivotalScore !== a.pivotalScore) return b.pivotalScore - a.pivotalScore;
    return a.moveNumber - b.moveNumber;
  });

  const selected: ScoredCandidate[] = [];
  const selectedMoveNumbers = new Set<number>();

  const push = (candidate: ScoredCandidate | undefined) => {
    if (!candidate || selected.length >= count) return;
    if (selectedMoveNumbers.has(candidate.moveNumber)) return;
    selected.push(candidate);
    selectedMoveNumbers.add(candidate.moveNumber);
  };

  push(sorted[0]);

  const openingCutoff = Math.max(1, Math.floor(scored.length / 2));
  const earlyCandidate = sorted.find(
    (candidate) =>
      !selectedMoveNumbers.has(candidate.moveNumber) && candidate.playerMoveIndex < openingCutoff,
  );
  push(earlyCandidate);

  for (const candidate of sorted) {
    if (selected.length >= count) break;
    push(candidate);
  }

  return selected.sort((a, b) => a.moveNumber - b.moveNumber);
}

/**
 * Select the most review-worthy player turns from a completed match log.
 *
 * Uses analyzeMoveLog() (Master Fritz enrichment + classifyMove ratings) and layers
 * Racehorse-specific leverage signals: pass blunders, endgame pressure, branches,
 * and opponent reply scoring.
 */
export function selectPivotalTurns(
  moveLog: MoveEntry[],
  options: PivotalTurnSelectorOptions = {},
): PivotalTurnSelection {
  const count = Math.max(1, options.count ?? DEFAULT_COUNT);
  const winningScore = options.winningScore ?? DEFAULT_WINNING_SCORE;

  const analysis = options.analysis;
  if (!analysis) {
    throw new Error(
      'selectPivotalTurns requires options.analysis — run analyzeMoveLog or analyzeMoveLogDeferred first',
    );
  }

  const entryByMoveNumber = new Map<number, MoveEntry>();
  for (const entry of moveLog) {
    if (entry.player === 'you') {
      entryByMoveNumber.set(entry.moveNumber, entry);
    }
  }

  const scored = analysis.analyzedMoves.map((move, playerMoveIndex) =>
    scoreCandidate({
      move,
      entry: entryByMoveNumber.get(move.moveNumber),
      moveLog,
      playerMoveIndex,
      totalPlayerMoves: analysis.analyzedMoves.length,
      winningScore,
    }),
  );

  const candidates = pickDiverseCandidates(scored, count).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    consequence: analysis.consequenceByMoveNumber[candidate.moveNumber],
  }));

  return {
    analysis,
    candidates,
    totalPlayerMoves: analysis.analyzedMoves.length,
  };
}

/**
 * Convenience wrapper when analysis was already computed for the same move log.
 */
export function selectPivotalTurnsFromAnalysis(
  analysis: GameAnalysis,
  moveLog: MoveEntry[],
  options: Omit<PivotalTurnSelectorOptions, 'analysis'> = {},
): PivotalTurnSelection {
  return selectPivotalTurns(moveLog, {
    ...options,
    analysis,
  });
}
