// client/src/types.ts
// Shared types for the client

export interface Tile {
  high: number;
  low: number;
}

export type TileOrientation =
  | 'horizontal-normal'
  | 'horizontal-flipped'
  | 'vertical-normal'
  | 'vertical-flipped';

export type PlacementPosition = 'left' | 'right' | `branch-${number}-${number}`;

export interface PlacedTile {
  tile: Tile;
  orientation: TileOrientation;
}

export interface BranchArm {
  tiles: PlacedTile[];
  openEnd: number;
  openEndIsDouble: boolean;
}

export interface HubDouble {
  hubId?: number;
  laneType?: 'mainline' | 'branch';
  laneRef?: string;
  branchDepth?: number;
  tileIndex: number;
  mainlineIndex?: number;
  hubValue: number;
  leftSideFilled?: boolean;
  rightSideFilled?: boolean;
  isCrossed: boolean;
  branches: (BranchArm | null)[];
}

export interface BoardState {
  mainLine: PlacedTile[];
  leftEnd: number;
  rightEnd: number;
  leftEndIsDouble: boolean;
  rightEndIsDouble: boolean;
  hubDoubles: HubDouble[];
}

export interface GameState {
  config: { scoringMultiple: number; winningScore: number };
  playerIds: string[];
  players: Record<string, { id: string; hand: Tile[]; score: number }>;
  handCounts?: Record<string, number>;
  board: BoardState | null;
  boneyard: Tile[];
  deadTiles: Tile[];
  currentPlayerIndex: number;
  handNumber: number;
  handOpen: boolean;
  handOver: boolean;
  gameOver: boolean;
  winnerId: string | null;
  consecutivePasses: number;
  sequence: number;
}

export interface Move {
  type: 'play' | 'pass';
  tile?: Tile;
  position?: PlacementPosition;
}

export interface StateUpdate {
  state: GameState;
  legalMoves: Move[];
  canDraw: boolean;
}

export type AppMode =
  | 'home'
  | 'multiplayer'
  | 'noBrainer'
  | 'botSetup'
  | 'bot'
  | 'ghostSetup'
  | 'ghost'
  | 'daily'
  | 'dailyPuzzleLeaderboard'
  | 'dailyFritz'
  | 'dailyFritzLeaderboard'
  | 'puzzleRush'
  | 'learn'
  | 'guidedMatchRecorder'
  | 'guidedMatchAnnotator'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'journey'
  | 'tournament'
  | 'leaderboard'
  | 'profile'
  | 'feed'
  | 'live'
  | 'dailyFritzHealthAdmin';
