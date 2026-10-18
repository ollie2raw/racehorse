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
  /**
   * Engine scoreboard when the game ended. With `reviewSnapshots` it makes every hand's score (including the end-of-hand
   * award that no move-log row carries) authoritative; without it the last hand keeps the move-log total.
   */
  finalScores?: { you: number; opponent: number };
  /**
   * Snapshots used ONLY to read the engine scoreboard at hand boundaries (they do not switch the analyzer into V2 mode the way
   * `reviewSnapshots` does). Multiplayer passes its captured snapshots here; `reviewSnapshots` is used when this is absent.
   */
  scoreboardSnapshots?: readonly ReviewPositionSnapshotV2[];
  /** Engine id of the reviewed player in the snapshots (default `'you'`; multiplayer uses its socket id). */
  youActorId?: string;
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
  /** `engine-scoreboard`: derived from the engine's scores at the hand boundaries; absent: summed from move-log play points. */
  source?: 'engine-scoreboard';
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
