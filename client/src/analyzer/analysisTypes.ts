import type { FritzTier } from '../modules/fritz/fritzConfig.ts';
import type { AnalyzedMove } from './moveAnalyzer';
import type { MoveEntry } from '../game/moveLogger';

/** Shared analysis types — structured for future `shared/analysis/` extraction. */

export type OracleMode = 'tier' | 'master';

export type AnalyzeMoveLogOptions = {
  oracleMode?: OracleMode;
  tierPlayed?: FritzTier;
  winningScore?: number;
};

export type InitiativeShift = 'lost' | 'maintained' | 'gained';

export type HandOutcomeContribution = 'critical' | 'significant' | 'minor';

export type ConsequenceChain = {
  moveNumber: number;
  playedMove: MoveEntry;
  pointsLeftOnTable: number;
  opponentExploited: boolean;
  opponentScore: number;
  initiativeShift: InitiativeShift;
  handOutcomeContribution: HandOutcomeContribution;
  rippleSummary: string;
};

export type HandVerdict = {
  winner: 'you' | 'opponent' | 'tie';
  pointsYou: number;
  pointsOpponent: number;
  margin: number;
};

export type HandMoveSegment = {
  handNumber: number;
  entries: MoveEntry[];
  startingScores: { you: number; opponent: number };
  endingScores: { you: number; opponent: number };
};

export type HandAnalysis = {
  handNumber: number;
  startingScores: { you: number; opponent: number };
  endingScores: { you: number; opponent: number };
  analyzedMoves: AnalyzedMove[];
  handAccuracy: number;
  pivotalMoments: AnalyzedMove[];
  verdict: HandVerdict;
  consequenceChains: ConsequenceChain[];
};
