import {
  assertOpenEndsSumConsistent,
  branchHasPlayableTiles,
  branchTipPipFromGeometry,
  computeOpenEndsSum,
  endpointPipFromOrientation,
  isHubCrossedGeometrically,
  reconcileBoardOpenEndsMetadata,
  warnOpenEndsBoardIssues,
} from '../../../game/openEndsGeometry.ts';
import { tileEquals } from '../../../game/tileUtils.ts';
import type {
  BoardState,
  Move,
  PlacementPosition,
  Tile,
} from '../../../types.ts';
import { generateFullSet, isDouble as isCoreDouble } from '@racehorse/game-core';
import {
  applyCorePlay,
  drawCoreTile,
  drawUntilPlayableOrEmptyCoreState,
  getCoreMoves,
  passCoreTurn,
  previewCorePlacement,
  scoreCoreBoard,
} from './gameCoreAdapter.ts';

export {
  assertDisplayedOpenCountMatchesCanonical,
  assertOpenEndsSumConsistent,
  auditOpenEndsBoard,
  computeOpenEndsSum,
  getScoringOpenEndPips,
  reconcileBoardOpenEndsMetadata,
  hydrateBoardForOpenEnds,
  sanitizeBoardBranchSlots,
  warnOpenEndsBoardIssues,
} from '../../../game/openEndsGeometry.ts';

export type BotPlayerId = 'you' | 'bot';
export type BotHandEndReason = 'domino' | 'blocked';
export type BotDealSize = 7 | 14;

export interface BotPlayerState {
  hand: Tile[];
  score: number;
}

export interface BotMatchState {
  players: Record<BotPlayerId, BotPlayerState>;
  board: BoardState | null;
  boneyard: Tile[];
  deadTiles: Tile[];
  handOpen: boolean;
  currentPlayer: BotPlayerId;
  consecutivePasses: number;
  handNumber: number;
  turnIndex?: number;
  handOver: boolean;
  gameOver: boolean;
  winnerId: BotPlayerId | null;
  winningScore: number;
  lastHandWinner: BotPlayerId | null;
  lastHandReason: BotHandEndReason | null;
  dealSize: BotDealSize;
  /** Hand-1 starter from pre-game draw; odd hands use this player, even hands alternate. */
  matchStarter?: BotPlayerId;
  // Opponent hand inference
  opponentPassedOnEnds?: number[];
  opponentDrawCount?: number;
  opponentKnownMissing?: number[];
  opponentMissingEvidence?: Array<{ pip: number; handNumber: number; turnIndex: number }>;
}

export interface BotHandDeal {
  player_tiles: Tile[];
  fritz_tiles: Tile[];
  boneyard: Tile[];
  locked: Tile[];
}

export interface BotActionResult {
  state: BotMatchState;
  scored?: { player: BotPlayerId; points: number };
  drew?: { player: BotPlayerId; tile: Tile };
  passed?: { player: BotPlayerId };
  handEnded?: {
    winner: BotPlayerId | null;
    reason: BotHandEndReason;
    pointsAwarded: number;
    loserPips: number;
    calcText: string;
  };
}

export interface BotMovePreview {
  nextBoard: BoardState;
  nextHand: Tile[];
  immediateScore: number;
  isDouble: boolean;
  turnContinues: boolean;
  openEnds: number[];
  openSum: number;
}

type DailyFritzMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

function recordDailyFritzMetric(name: 'getLegalMoves', durationMs: number): void {
  if (typeof window === 'undefined') return;
  const win = window as typeof window & {
    __dailyFritzProfileActive?: boolean;
    __dailyFritzProfile?: {
      metrics?: Record<string, DailyFritzMetric>;
    };
  };
  if (!win.__dailyFritzProfileActive) return;
  const profile = (win.__dailyFritzProfile ??= {});
  const metrics = (profile.metrics ??= {});
  const current = metrics[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  metrics[name] = current;
}

const BONEYARD_LOCKED_COUNT = 2;

export function isDouble(tile: Tile): boolean {
  return isCoreDouble(tile);
}

function tileMatchesEnd(tile: Tile, endValue: number): boolean {
  return tile.high === endValue || tile.low === endValue;
}

function removeTileOnce(hand: Tile[], tile: Tile): Tile[] {
  const idx = hand.findIndex((t) => tileEquals(t, tile));
  if (idx === -1) return [...hand];
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

export function generateDoubleSixSet(): Tile[] {
  return generateFullSet(6).map((tile) => ({ low: tile.low, high: tile.high }));
}

function otherBotPlayer(player: BotPlayerId): BotPlayerId {
  return player === 'you' ? 'bot' : 'you';
}

export function resolveHandStarter(matchStarter: BotPlayerId, handNumber: number): BotPlayerId {
  return handNumber % 2 === 1 ? matchStarter : otherBotPlayer(matchStarter);
}

const PRE_GAME_DRAW_REMAINING_TILE_COUNT = 26;

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createDealtHand(
  scores: Record<BotPlayerId, number>,
  handNumber: number,
  winningScore: number,
  dealSize: BotDealSize,
  matchStarter: BotPlayerId = 'you',
  deck?: readonly Tile[],
): BotMatchState {
  const shuffled = shuffle(deck ? [...deck] : generateDoubleSixSet());
  const youHand = shuffled.slice(0, dealSize);
  const botHand = shuffled.slice(dealSize, dealSize * 2);
  const remaining = shuffled.slice(dealSize * 2);
  const deadTiles =
    dealSize === 14 ? [] : remaining.slice(remaining.length - BONEYARD_LOCKED_COUNT);
  const boneyard = dealSize === 14 ? [] : remaining;
  const currentPlayer = resolveHandStarter(matchStarter, handNumber);

  return {
    players: {
      you: { hand: youHand, score: scores.you },
      bot: { hand: botHand, score: scores.bot },
    },
    board: null,
    boneyard,
    deadTiles,
    handOpen: false,
    currentPlayer,
    consecutivePasses: 0,
    handNumber,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize,
    matchStarter,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

function cloneTile(tile: Tile): Tile {
  return { low: tile.low, high: tile.high };
}

export function createFixedBotHand(
  scores: Record<BotPlayerId, number>,
  handNumber: number,
  winningScore: number,
  dealSize: BotDealSize,
  handDeal: BotHandDeal,
  matchStarter: BotPlayerId = 'you',
): BotMatchState {
  const currentPlayer = resolveHandStarter(matchStarter, handNumber);
  return {
    players: {
      you: { hand: handDeal.player_tiles.map(cloneTile), score: scores.you },
      bot: { hand: handDeal.fritz_tiles.map(cloneTile), score: scores.bot },
    },
    board: null,
    boneyard: handDeal.boneyard.map(cloneTile),
    deadTiles: handDeal.locked.map(cloneTile),
    handOpen: false,
    currentPlayer,
    consecutivePasses: 0,
    handNumber,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize,
    matchStarter,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

export function createBotMatch(winningScore = 60, dealSize: BotDealSize = 7): BotMatchState {
  return createDealtHand({ you: 0, bot: 0 }, 1, winningScore, dealSize);
}

export function createBotMatchWithStarter(
  remainingDeck: readonly Tile[],
  matchStarter: BotPlayerId,
  winningScore = 60,
  dealSize: BotDealSize = 7,
): BotMatchState {
  if (dealSize === 14) {
    throw new Error('Pre-game draw is not supported for 14-tile deals');
  }
  if (remainingDeck.length !== PRE_GAME_DRAW_REMAINING_TILE_COUNT) {
    throw new Error(
      `Pre-game draw expects ${PRE_GAME_DRAW_REMAINING_TILE_COUNT} remaining tiles, got ${remainingDeck.length}`,
    );
  }
  return createDealtHand({ you: 0, bot: 0 }, 1, winningScore, dealSize, matchStarter, remainingDeck);
}

export function createFixedBotMatch(
  handDeal: BotHandDeal,
  winningScore = 60,
  dealSize: BotDealSize = 7,
): BotMatchState {
  return createFixedBotMatchWithStarter(handDeal, 'you', winningScore, dealSize);
}

export function createFixedBotMatchWithStarter(
  handDeal: BotHandDeal,
  matchStarter: BotPlayerId,
  winningScore = 60,
  dealSize: BotDealSize = 7,
): BotMatchState {
  return createFixedBotHand({ you: 0, bot: 0 }, 1, winningScore, dealSize, handDeal, matchStarter);
}

export function startNextBotHand(state: BotMatchState): BotMatchState {
  return createDealtHand(
    { you: state.players.you.score, bot: state.players.bot.score },
    state.handNumber + 1,
    state.winningScore,
    state.dealSize,
    state.matchStarter ?? 'you',
  );
}

export function startNextFixedBotHand(state: BotMatchState, handDeal: BotHandDeal): BotMatchState {
  return createFixedBotHand(
    { you: state.players.you.score, bot: state.players.bot.score },
    state.handNumber + 1,
    state.winningScore,
    state.dealSize,
    handDeal,
    state.matchStarter ?? 'you',
  );
}

function hubIdAt(hub: BoardState['hubDoubles'][number], fallbackIdx: number): number {
  return hub.hubId ?? fallbackIdx;
}

export function recomputeBoardEnds(board: BoardState): BoardState {
  const reconciled = reconcileBoardOpenEndsMetadata(board);
  assertOpenEndsSumConsistent(reconciled, 'recomputeBoardEnds');
  return reconciled;
}

export function simulatePlacement(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition,
): BoardState {
  return previewCorePlacement(board, tile, position);
}

export function endpointMatchFromOrientation(board: BoardState, side: 'left' | 'right'): number {
  const mainLine = board.mainLine;
  if (!mainLine || mainLine.length === 0) return side === 'left' ? board.leftEnd : board.rightEnd;
  const placed = side === 'left' ? mainLine[0] : mainLine[mainLine.length - 1];
  return endpointPipFromOrientation(placed, side);
}

function getOpenEnds(
  board: BoardState | null,
): Array<{ position: PlacementPosition; matchValue: number }> {
  if (!board) {
    return [{ position: 'left', matchValue: -1 }];
  }
  const ends: Array<{ position: PlacementPosition; matchValue: number }> = [
    { position: 'left', matchValue: endpointMatchFromOrientation(board, 'left') },
    { position: 'right', matchValue: endpointMatchFromOrientation(board, 'right') },
  ];

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    const hubId = hubIdAt(hub, hubIdx);
    if (!isHubCrossedGeometrically(hub, board)) continue;

    for (let armIdx = 0; armIdx < 2; armIdx++) {
      const branch = hub.branches[armIdx];
      const matchValue = branchHasPlayableTiles(branch)
        ? branchTipPipFromGeometry(hub.hubValue, branch)
        : hub.hubValue;

      ends.push({
        position: `branch-${hubId}-${armIdx}`,
        matchValue,
      });
    }
  }
  return ends;
}

export function getMatchableOpenEnds(
  board: BoardState | null,
): Array<{ position: PlacementPosition; matchValue: number }> {
  const raw = getOpenEnds(board);
  if (!board) return raw;
  return raw.map((end) => {
    if (end.position === 'left') {
      return { ...end, matchValue: endpointMatchFromOrientation(board, 'left') };
    }
    if (end.position === 'right') {
      return { ...end, matchValue: endpointMatchFromOrientation(board, 'right') };
    }
    return end;
  });
}

export function getPlacementTargetsForTile(
  board: BoardState | null,
  tile: Tile,
): PlacementPosition[] {
  if (!board) return ['left'];
  return getMatchableOpenEnds(board)
    .filter((end) => tileMatchesEnd(tile, end.matchValue))
    .map((end) => end.position);
}

export function placeTileOnBoard(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition,
): BoardState {
  return simulatePlacement(board, tile, position);
}

export function computePlayScore(board: BoardState): number {
  warnOpenEndsBoardIssues(board, 'computePlayScore');
  return scoreCoreBoard(board);
}

/**
 * Playable match pip values for chips / legality / coaching copy.
 * Do NOT use this for the Open Ends count pill — use `computeOpenEndsSum(board)`.
 */
export function getDisplayOpenEnds(state: BotMatchState): number[] {
  if (!state.board) return [];
  return getMatchableOpenEnds(state.board).map((end) => end.matchValue);
}

function getPlayMoves(state: BotMatchState, player: BotPlayerId): Move[] {
  return getCoreMoves(state, player).filter((move) => move.type === 'play');
}

export function getLegalMoves(state: BotMatchState, player: BotPlayerId): Move[] {
  const start =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const result = getCoreMoves(state, player);
  const end =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  recordDailyFritzMetric('getLegalMoves', end - start);
  return result;
}

export function previewPlayMove(
  state: BotMatchState,
  player: BotPlayerId,
  move: Move,
): BotMovePreview | null {
  if (!state.players[player]) return null;
  if (move.type !== 'play' || !move.tile || !move.position) return null;
  if (state.currentPlayer !== player) return null;
  const legal = getPlayMoves(state, player).some(
    (m) =>
      m.type === 'play' && m.tile && m.position === move.position && tileEquals(m.tile, move.tile!),
  );
  if (!legal) return null;

  const nextBoard = previewCorePlacement(state.board, move.tile, move.position);
  const nextHand = removeTileOnce(state.players[player].hand, move.tile);
  const immediateScore = computePlayScore(nextBoard);
  const openSum = computeOpenEndsSum(nextBoard);

  return {
    nextBoard,
    nextHand,
    immediateScore,
    isDouble: isDouble(move.tile),
    turnContinues: isDouble(move.tile) || immediateScore > 0,
    openEnds: getMatchableOpenEnds(nextBoard).map((end) => end.matchValue),
    openSum,
  };
}

export function applyPlayMove(
  state: BotMatchState,
  player: BotPlayerId,
  move: Move,
): BotActionResult {
  return applyCorePlay(state, player, move);
}

export function drawOne(state: BotMatchState, player: BotPlayerId): BotActionResult {
  return drawCoreTile(state, player);
}

export function passTurn(state: BotMatchState, player: BotPlayerId): BotActionResult {
  return passCoreTurn(state, player);
}

export function drawUntilPlayableOrEmpty(
  state: BotMatchState,
  player: BotPlayerId,
): BotActionResult {
  if (state.currentPlayer !== player || state.handOver || state.gameOver) return { state };
  if (getPlayMoves(state, player).length > 0) return { state };
  // Capture the opponent's missing pips at draw-start only (pre-draw snapshot).
  // This evidence is useful for pressure heuristics even after they draw.
  if (player === 'you' && state.boneyard.length > BONEYARD_LOCKED_COUNT && state.board) {
    const startEnds = getMatchableOpenEnds(state.board).map((e) => e.matchValue);
    const turnIndex = state.turnIndex ?? 0;
    const handNumber = state.handNumber;
    const prevEvidence = state.opponentMissingEvidence ?? [];
    const prevMissing = new Set<number>(state.opponentKnownMissing ?? []);
    for (const pip of startEnds) prevMissing.add(pip);
    const dedupKey = new Set(prevEvidence.map((e) => `${e.pip}:${e.handNumber}:${e.turnIndex}`));
    const appended = [...prevEvidence];
    for (const pip of startEnds) {
      const key = `${pip}:${handNumber}:${turnIndex}`;
      if (!dedupKey.has(key)) {
        dedupKey.add(key);
        appended.push({ pip, handNumber, turnIndex });
      }
    }
    state = {
      ...state,
      opponentKnownMissing: Array.from(prevMissing),
      opponentMissingEvidence: appended,
    };
  }

  return drawUntilPlayableOrEmptyCoreState(state, player);
}
