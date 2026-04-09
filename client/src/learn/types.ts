import type { BotMatchState, BotPlayerId } from '../bot/botEngine';
import type { Move, Tile } from '../types';

export type ConceptTag = 'matching' | 'scoring_5' | 'doubles' | 'blocking' | 'board_control';

export interface LessonScenario {
  id: string;
  title: string;
  type: 'guided_tutorial' | 'practice_drill';
  concepts: ConceptTag[];
  
  // The exact starting state
  setup: {
    boardTiles?: Array<{ tile: Tile; position: 'left' | 'right' | string }>;
    playerHand: Tile[];
    botHand: Tile[];
    boneyard: Tile[];
    currentPlayer?: BotPlayerId;
  };

  // For Guided Tutorials: The strict golden path
  script?: {
    expectedMove: {
      tile: Tile;
      position: string;
    };
    instructionText: string;
    successText: string;
    // Visual cues
    highlightHandTile?: Tile;
    highlightBoardEnds?: number[];
    actionCue?: string;
    // Dynamic feedback if they try to play something else
    mistakeHandlers: Array<{
      condition: (move: Move, state: BotMatchState) => boolean;
      feedbackText: string;
    }>;
  }[];

  // For Practice Drills: Engine-evaluated
  drillGoal?: 'max_score' | 'best_block' | 'survive';
}
