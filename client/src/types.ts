// client/src/types.ts
// Shared types for the client.
//
// GC-3a (HARDENING_PLAN §7.3): the value types below (`Tile` .. `BoardState`,
// `PlacementPosition`, `TileOrientation`) MUST stay structurally identical to
// `@racehorse/game-core`'s — they cross the client/server verification boundary.
// `client/src/game/coreTypeContracts.ts` is a compile-time `expectTypeOf` guard:
// if these drift from core again, `tsc -b` fails. Keep them `readonly` to match.

export interface Tile {
  readonly high: number;
  readonly low: number;
}

export type TileOrientation =
  | 'horizontal-normal'
  | 'horizontal-flipped'
  | 'vertical-normal'
  | 'vertical-flipped';

export type PlacementPosition = 'left' | 'right' | `branch-${number}-${number}`;

export interface PlacedTile {
  readonly tile: Tile;
  readonly orientation: TileOrientation;
}

export interface BranchArm {
  readonly tiles: readonly PlacedTile[];
  readonly openEnd: number;
  readonly openEndIsDouble: boolean;
}

export interface HubDouble {
  readonly hubId?: number;
  readonly laneType?: 'mainline' | 'branch';
  readonly laneRef?: string;
  readonly branchDepth?: number;
  readonly tileIndex: number;
  readonly mainlineIndex?: number;
  readonly hubValue: number;
  readonly leftSideFilled?: boolean;
  readonly rightSideFilled?: boolean;
  readonly isCrossed: boolean;
  readonly branches: readonly (BranchArm | null)[];
}

export interface BoardState {
  readonly mainLine: readonly PlacedTile[];
  readonly leftEnd: number;
  readonly rightEnd: number;
  readonly leftEndIsDouble: boolean;
  readonly rightEndIsDouble: boolean;
  readonly hubDoubles: readonly HubDouble[];
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
  | 'settings'
  | 'dailyFritzHealthAdmin';
