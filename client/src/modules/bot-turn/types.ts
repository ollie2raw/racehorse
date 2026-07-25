import type { MoveEntry } from '../../game/moveLogger.ts';
import type { Move, Tile } from '../../types.ts';
import type {
  BotActionResult,
  BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import type { GhostMoveLogEntry, GhostResolvedMove } from '../ghost/ghostContracts.ts';

export type AuthoringFritzActionCapture = {
  result: BotActionResult;
  captureAction: 'play' | 'draw' | 'pass';
  playedTileForHighlight: Tile | null;
  ghostChosen: GhostResolvedMove | null;
  chosen: BotChoice | null;
};

export type AuthoringV2FritzEventCapture = {
  result: BotActionResult;
  captureAction: 'play' | 'draw' | 'pass';
  playedTileForHighlight: Tile | null;
  ghostChosen: GhostResolvedMove | null;
  chosen: BotChoice | null;
};

export type DailyFritzBotMoveAppliedInfo = {
  handNumber: number;
  handOver: boolean;
  gameOver: boolean;
  nextPlayer: BotMatchState['currentPlayer'];
  scored: number;
};

export type BotTurnPorts = {
  applyAndNotify: (result: BotActionResult) => void;
  appendMove: (entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>) => void;
  appendGhostMove: (entry: GhostMoveLogEntry) => void;
  captureGuidedMatchCandidateAction: (
    actor: 'player' | 'fritz',
    actionKind: 'tile-play' | 'draw' | 'pass',
    beforeState: BotMatchState,
    result: BotActionResult,
    move?: Move | null,
  ) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  setSelectedTile: (tile: Tile | null) => void;
  setDrawSequenceActiveBoth: (val: boolean) => void;
  setLastBotChoice: (choice: BotChoice | null) => void;
  setGhostPlayedTile: (tile: Tile | null) => void;
  showBoardToast: (
    message: string,
    tone: 'you' | 'bot',
    options?: {
      sticky?: boolean;
      holdMs?: number;
      points?: number;
      turnTotal?: number;
      actorLabel?: string;
    },
  ) => void;
  /** Clears a sticky score toast when Fritz's turn ends. */
  clearBoardToast: () => void;
  onAuthoringFritzActionCaptured?: (capture: AuthoringFritzActionCapture) => void;
  onAuthoringV2FritzEvent?: (capture: AuthoringV2FritzEventCapture) => void;
  onDailyFritzBotMoveApplied?: (info: DailyFritzBotMoveAppliedInfo) => void;
};
