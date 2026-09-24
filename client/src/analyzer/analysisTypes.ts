import type { FritzTier } from '../modules/fritz/fritzConfig.ts';
import type { AnalyzedMove } from './moveAnalyzer';
import type { MoveEntry } from '../game/moveLogger';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';

/** Shared analysis types — structured for future `shared/analysis/` extraction. */

export type OracleMode = 'tier' | 'master';

export type AnalyzeMoveLogOptions = {
  oracleMode?: OracleMode;
  tierPlayed?: FritzTier;
  winningScore?: number;
  /**
   * A5: when non-empty, the analyzer refuses to fabricate placeholder
   * opponent-hand/boneyard state in buildEvalState — see moveAnalyzer.ts.
   * Presence is currently detected at the whole-game level; per-decision
   * correlation is Phase B (oracle) work, not this shim.
   */
  reviewSnapshots?: readonly ReviewPositionSnapshotV2[];
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
  /**
   * Calibrated hand accuracy (same model as game scored accuracy), or
   * `null` when the hand has no complete calibrated population yet.
   * Legacy analyzeMoveLog still fills a Fritz-ish mean until overlay runs.
   */
  handAccuracy: number | null;
  pivotalMoments: AnalyzedMove[];
  verdict: HandVerdict;
  consequenceChains: ConsequenceChain[];
};
