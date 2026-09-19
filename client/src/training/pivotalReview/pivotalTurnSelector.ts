import { isScorable } from '@racehorse/review-engine';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { AnalyzedMove, GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { ConsequenceChain } from '../../analyzer/analysisTypes';
import type { MoveEntry } from '../../game/moveLogger';
import { lossBandLabelForEvaluation, type LossBandLabel } from '../../analyzer/gameAccuracyModel';

export type PivotalTurnPhase = 'opening' | 'midgame' | 'endgame';

export type PivotalTurnCandidate = {
  /** Chronological display order (1..n), after selecting by oracle loss. */
  rank: number;
  moveNumber: number;
  playerMoveIndex: number;
  evaluation: ReviewEvaluationV1;
  rating: LossBandLabel | null;
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
  /** Defaults to 3; eligible zero-loss decisions may fill remaining slots. */
  count?: number;
  winningScore?: number;
  analysis?: GameAnalysis;
  evaluationsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  decisionIdByMoveNumber: ReadonlyMap<number, string>;
};

function buildScoreStateAtMove(moveLog: MoveEntry[], upToMoveNumber: number) {
  let you = 0;
  let opp = 0;
  for (const entry of moveLog) {
    if (entry.moveNumber > upToMoveNumber) continue;
    if (entry.player === 'you') you += entry.pointsScored ?? 0;
    else opp += entry.pointsScored ?? 0;
  }
  return { you, opp };
}

/** Context labels only: phase and scores never influence selection. */
function resolvePhase(index: number, total: number, maxScore: number, winningScore: number): PivotalTurnPhase {
  const openingCutoff = Math.max(1, Math.floor(total * 0.33));
  const endgameCutoff = Math.max(openingCutoff + 1, Math.floor(total * 0.67));
  if (maxScore >= winningScore - 15 || index >= endgameCutoff) return 'endgame';
  if (index < openingCutoff || maxScore < 20) return 'opening';
  return 'midgame';
}

/** Select only correlated human decisions using the accuracy model's eligibility. */
export function selectPivotalTurns(
  moveLog: MoveEntry[],
  options: PivotalTurnSelectorOptions,
): PivotalTurnSelection {
  const { analysis, evaluationsByDecisionId, decisionIdByMoveNumber } = options;
  if (!analysis) {
    throw new Error('selectPivotalTurns requires options.analysis — run analyzeMoveLog or analyzeMoveLogDeferred first');
  }
  const humanMoves = new Set(moveLog.filter((entry) => entry.player === 'you').map((entry) => entry.moveNumber));
  const playerMoves = analysis.analyzedMoves.filter((move) => humanMoves.has(move.moveNumber));
  const eligible: Omit<PivotalTurnCandidate, 'rank'>[] = [];
  for (const [playerMoveIndex, move] of playerMoves.entries()) {
    const decisionId = decisionIdByMoveNumber.get(move.moveNumber);
    const evaluation = decisionId === undefined ? undefined : evaluationsByDecisionId.get(decisionId);
    if (!evaluation || !isScorable(evaluation, evaluation.candidates)) continue;
    const score = buildScoreStateAtMove(moveLog, move.moveNumber);
    eligible.push({
      moveNumber: move.moveNumber, playerMoveIndex, evaluation, move,
      rating: lossBandLabelForEvaluation(evaluation),
      scoreYou: score.you, scoreOpp: score.opp,
      phase: resolvePhase(playerMoveIndex, playerMoves.length, Math.max(score.you, score.opp), options.winningScore ?? 60),
      consequence: analysis.consequenceByMoveNumber[move.moveNumber],
    });
  }
  const candidates = eligible
    .sort((a, b) => b.evaluation.loss.expectedPointDifferential - a.evaluation.loss.expectedPointDifferential || a.moveNumber - b.moveNumber)
    .slice(0, Math.max(1, options.count ?? 3))
    .sort((a, b) => a.moveNumber - b.moveNumber)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  return { analysis, candidates, totalPlayerMoves: playerMoves.length };
}

export function selectPivotalTurnsFromAnalysis(
  analysis: GameAnalysis,
  moveLog: MoveEntry[],
  options: Omit<PivotalTurnSelectorOptions, 'analysis'>,
): PivotalTurnSelection {
  return selectPivotalTurns(moveLog, { ...options, analysis });
}
