import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { BoardHandle } from '../components';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import type { GameState, Move, Tile } from '../types';
import type { PlacementPosition } from '../types';

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

type ScoreToast = {
  message: string;
  tone: 'you' | 'opp';
  visible: boolean;
} | null;

export type MultiplayerRatingSummary = {
  pending: boolean;
  delta: number | null;
  newRating: number | null;
} | null;

/** Route props derived from live multiplayer session — consumed by AppRoutesGamePropsHost. */
export type MultiplayerGameRouteProps = {
  state: GameState | null;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  play: (position: PlacementPosition) => Promise<void>;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  handleTileTap: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: ScoreToast;
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string;
  handReveal: HandEndedPayload | null;
  handRevealAutoProgress: number;
  flyingTiles: FlyingTile[];
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  requestRematch: () => void;
  multiplayerRatingSummary: MultiplayerRatingSummary;
  openMultiplayerAnalyzer: () => void;
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  startGame: () => Promise<void>;
  actionError: string;
  isRoomHost: boolean;
};

export type MultiplayerGameSnapshot = {
  routeProps: MultiplayerGameRouteProps;
  inGame: boolean;
  liveGameOver: boolean;
  hasState: boolean;
};

export const EMPTY_ROUTE_PROPS: MultiplayerGameRouteProps = {
  state: null,
  pendingUiAction: null,
  opponentId: null,
  opponentName: 'Rival',
  myName: 'you',
  myScore: 0,
  opponentScore: 0,
  opponentTileCount: 0,
  isMyTurn: false,
  isHandActive: false,
  hudScorePulse: {},
  hudRightLabel: 'you',
  hudRightScore: 0,
  hudRightScorePulse: false,
  opponentPillRef: { current: null },
  boneyardRef: { current: null },
  boneyardCount: 0,
  openEndsSum: 0,
  boardRef: { current: null },
  handAreaRef: { current: null },
  confettiCanvasRef: { current: null },
  boardForDisplay: null,
  boardLegalMoves: [],
  boardSelectedTile: null,
  lastPlayedTile: null,
  boardShowOpenEndGlow: false,
  play: async () => {},
  myHand: [],
  handSelectedTile: null,
  handleTileTap: () => {},
  legalMoves: [],
  handTileSize: 44,
  handCompactStacked: false,
  drawPulseIndex: null,
  scoreToast: null,
  scoreTrackOpen: false,
  setScoreTrackOpen: () => {},
  opponentDisconnected: false,
  opponentDisconnectMessage: '',
  handReveal: null,
  handRevealAutoProgress: 1,
  flyingTiles: [],
  canUseRematch: false,
  rematchRequested: false,
  rematchWaitingText: undefined,
  requestRematch: () => {},
  multiplayerRatingSummary: null,
  openMultiplayerAnalyzer: () => {},
  showLeaveConfirm: false,
  setShowLeaveConfirm: () => {},
  startGame: async () => {},
  actionError: '',
  isRoomHost: false,
};

const EMPTY_SNAPSHOT: MultiplayerGameSnapshot = {
  routeProps: EMPTY_ROUTE_PROPS,
  inGame: false,
  liveGameOver: false,
  hasState: false,
};

let snapshot: MultiplayerGameSnapshot = EMPTY_SNAPSHOT;
const snapshotListeners = new Set<() => void>();

let lastPublishedGameOver = false;
const gameOverListeners = new Set<() => void>();

let lastPublishedHasState = false;
const hasStateListeners = new Set<() => void>();

function notifySnapshotListeners() {
  snapshotListeners.forEach((listener) => listener());
}

function notifyGameOverListeners() {
  gameOverListeners.forEach((listener) => listener());
}

function notifyHasStateListeners() {
  hasStateListeners.forEach((listener) => listener());
}

export function getGameSnapshot(): MultiplayerGameSnapshot {
  return snapshot;
}

export function subscribeGameSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

export function getLiveGameOver(): boolean {
  return snapshot.liveGameOver;
}

export function subscribeLiveGameOver(listener: () => void): () => void {
  gameOverListeners.add(listener);
  return () => gameOverListeners.delete(listener);
}

export function getHasLiveGameState(): boolean {
  return snapshot.hasState;
}

export function subscribeHasLiveGameState(listener: () => void): () => void {
  hasStateListeners.add(listener);
  return () => hasStateListeners.delete(listener);
}

export function publishGameSnapshot(next: MultiplayerGameSnapshot): void {
  snapshot = next;

  notifySnapshotListeners();

  const gameOver = next.liveGameOver;
  if (gameOver !== lastPublishedGameOver) {
    lastPublishedGameOver = gameOver;
    notifyGameOverListeners();
  }

  const hasState = next.hasState;
  if (hasState !== lastPublishedHasState) {
    lastPublishedHasState = hasState;
    notifyHasStateListeners();
  }
}

export function resetGameSnapshot(): void {
  lastPublishedGameOver = false;
  lastPublishedHasState = false;
  publishGameSnapshot(EMPTY_SNAPSHOT);
}
