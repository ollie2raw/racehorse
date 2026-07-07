import type { RefObject } from 'react';
import type { BoardHandle } from '../components';
import type { RoomChatEvent, RoomEmoteEvent } from '../multiplayer/protocol';
import type { PreGameDrawState } from './preGameDraw/preGameDrawLogic';
import type { TournamentMatchContext } from './session/useTournamentMatchSession';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { RoomPlayer } from '../multiplayer/protocol';

export type HandRevealState = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

export type ScoreToastState = {
  message: string;
  tone: 'you' | 'opp';
  visible: boolean;
} | null;

/** Root visibility, core game state, and transient presentation overlays. */
export type LiveMatchScreenShellProps = {
  visible: boolean;
  state: GameState | null;
  flyingTiles: FlyingTile[];
  scoreToast: ScoreToastState;
};

/** Player identity labels and room roster. */
export type LiveMatchScreenIdentityProps = {
  you: string;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  players: RoomPlayer[];
};

/** Score HUD, turn state, and board counters. */
export type LiveMatchScreenHudProps = {
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  boneyardCount: number;
  openEndsSum: number;
  winTarget?: number;
};

/** Board display, refs, and placement interaction. */
export type LiveMatchScreenBoardProps = {
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  onPositionClick: (position: PlacementPosition) => void;
};

/** Player hand rack and tile selection. */
export type LiveMatchScreenHandProps = {
  myHand: Tile[];
  handSelectedTile: Tile | null;
  onHandTileSelect: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
};

/** Audio, fullscreen, score track, and room reactions. */
export type LiveMatchScreenChromeProps = {
  scoreTrackOpen: boolean;
  onScoreTrackOpenChange: (open: boolean) => void;
  roomReactions: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat: (message: string) => void;
  onSendRoomEmote: (emote: RoomEmoteEvent['emote']) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

/** Disconnect banners and room recovery UI. */
export type LiveMatchScreenConnectionProps = {
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string | null;
  roomRecoveryState: 'idle' | 'reconnecting' | 'resyncing' | 'failed';
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;
};

/** Tournament match context and navigation callbacks. */
export type LiveMatchScreenTournamentProps = {
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  onTournamentViewBracket: () => void;
  onTournamentViewFinalResult: () => void;
  onTournamentReturnToHub: () => void;
};

/** Post-hand reveal, rematch, rating summary, and analyzer entry. */
export type LiveMatchScreenPostGameProps = {
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  onRematch: () => void;
  onPostGame: () => void;
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  onOpenMultiplayerAnalyzer: () => void;
  handReveal: HandRevealState | null;
  handRevealAutoProgress: number;
};

/** Leave-match confirmation modal. */
export type LiveMatchScreenLeaveProps = {
  showLeaveConfirm: boolean;
  onRequestLeaveConfirm: () => void;
  onLeaveConfirmDismiss: () => void;
  leaveModalIsTournament: boolean;
  onConfirmLeaveMatch: () => void;
};

/** Optional pre-game tile draw overlay. */
export type LiveMatchScreenPreGameDrawProps = {
  preGameDraw?: PreGameDrawState | null;
  onPregameTileTap?: (tileId: string) => void;
};

export type LiveMatchScreenProps = {
  shell: LiveMatchScreenShellProps;
  identity: LiveMatchScreenIdentityProps;
  hud: LiveMatchScreenHudProps;
  board: LiveMatchScreenBoardProps;
  hand: LiveMatchScreenHandProps;
  chrome: LiveMatchScreenChromeProps;
  connection: LiveMatchScreenConnectionProps;
  tournament: LiveMatchScreenTournamentProps;
  postGame: LiveMatchScreenPostGameProps;
  leave: LiveMatchScreenLeaveProps;
  preGameDraw?: LiveMatchScreenPreGameDrawProps;
};