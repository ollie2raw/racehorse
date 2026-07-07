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
  BranchArm,
  Move,
  PlacementPosition,
  PlacedTile,
  Tile,
  TileOrientation,
} from '../../../types.ts';

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
  return tile.high === tile.low;
}

function tileMatchesEnd(tile: Tile, endValue: number): boolean {
  return tile.high === endValue || tile.low === endValue;
}

function parseBranchPosition(
  pos: PlacementPosition,
): { hubIndex: number; armIndex: number } | null {
  if (pos === 'left' || pos === 'right') return null;
  const match = pos.match(/^branch-(\d+)-(\d+)$/);
  if (!match) return null;
  return { hubIndex: Number(match[1]), armIndex: Number(match[2]) };
}

function removeTileOnce(hand: Tile[], tile: Tile): Tile[] {
  const idx = hand.findIndex((t) => tileEquals(t, tile));
  if (idx === -1) return [...hand];
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function sumPips(hand: Tile[]): number {
  return hand.reduce((sum, t) => sum + t.low + t.high, 0);
}

export function generateDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high++) {
    for (let low = 0; low <= high; low++) {
      tiles.push({ low, high });
    }
  }
  return tiles;
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

function nextHubId(board: BoardState): number {
  if (board.hubDoubles.length === 0) return 0;
  return Math.max(...board.hubDoubles.map((h, idx) => hubIdAt(h, idx))) + 1;
}

function getPlacementOrientation(
  tile: Tile,
  matchValue: number,
  placementSide: 'left' | 'right' | 'branch',
): TileOrientation {
  if (isDouble(tile)) {
    return 'vertical-normal';
  }
  if (placementSide === 'left') {
    return tile.high === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  if (placementSide === 'right') {
    return tile.low === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  return tile.high === matchValue ? 'vertical-flipped' : 'vertical-normal';
}

function exposedPip(tile: Tile, matchValue: number): number {
  if (tile.high === matchValue) return tile.low;
  if (tile.low === matchValue) return tile.high;
  return tile.high;
}

function recomputeBranchLaneHubStates(
  hubDoubles: BoardState['hubDoubles'],
  laneRef: string,
  branchTiles: readonly PlacedTile[],
): BoardState['hubDoubles'] {
  return hubDoubles.map((h) => {
    if (h.laneType !== 'branch' || h.laneRef !== laneRef || typeof h.branchDepth !== 'number') {
      return h;
    }
    const depth = h.branchDepth;
    const leftSideFilled = depth === 0 ? true : depth > 0 && Boolean(branchTiles[depth - 1]);
    const rightSideFilled = Boolean(branchTiles[depth + 1]);
    return {
      ...h,
      leftSideFilled,
      rightSideFilled,
      isCrossed: leftSideFilled && rightSideFilled,
    };
  });
}

function placeTileOnMainLine(board: BoardState, tile: Tile, end: 'left' | 'right'): BoardState {
  const matchValue = end === 'left' ? board.leftEnd : board.rightEnd;
  const newExposedEnd = exposedPip(tile, matchValue);
  const tileIsDouble = isDouble(tile);

  const placedTile: PlacedTile = {
    tile,
    orientation: getPlacementOrientation(tile, matchValue, end),
  };

  const newMainLine =
    end === 'left' ? [placedTile, ...board.mainLine] : [...board.mainLine, placedTile];

  const newLeftEnd = end === 'left' ? newExposedEnd : board.leftEnd;
  const newRightEnd = end === 'right' ? newExposedEnd : board.rightEnd;
  const newLeftEndIsDouble = end === 'left' ? tileIsDouble : board.leftEndIsDouble;
  const newRightEndIsDouble = end === 'right' ? tileIsDouble : board.rightEndIsDouble;

  let newHubDoubles = [...board.hubDoubles];
  const endpointIndex = end === 'left' ? 0 : board.mainLine.length - 1;
  newHubDoubles = newHubDoubles.map((hub) => {
    const hubIndex = hub.mainlineIndex ?? hub.tileIndex;
    if (hubIndex !== endpointIndex) return hub;
    const leftSideFilled = hub.leftSideFilled ?? false;
    const rightSideFilled = hub.rightSideFilled ?? false;
    const updatedLeft = end === 'left' ? true : leftSideFilled;
    const updatedRight = end === 'right' ? true : rightSideFilled;
    return {
      ...hub,
      leftSideFilled: updatedLeft,
      rightSideFilled: updatedRight,
      isCrossed: updatedLeft && updatedRight,
    };
  });

  if (end === 'left') {
    newHubDoubles = newHubDoubles.map((h) => {
      const nextIndex = (h.mainlineIndex ?? h.tileIndex) + 1;
      return {
        ...h,
        tileIndex: nextIndex,
        mainlineIndex: nextIndex,
      };
    });
  } else {
    newHubDoubles = newHubDoubles.map((h) => ({
      ...h,
      mainlineIndex: h.mainlineIndex ?? h.tileIndex,
    }));
  }

  if (tileIsDouble) {
    const newHubIndex = end === 'left' ? 0 : newMainLine.length - 1;
    const hubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
    const leftSideFilled = end === 'right';
    const rightSideFilled = end === 'left';
    newHubDoubles.push({
      hubId,
      laneType: 'mainline',
      laneRef: 'mainline',
      tileIndex: newHubIndex,
      mainlineIndex: newHubIndex,
      hubValue: tile.high,
      isCrossed: leftSideFilled && rightSideFilled,
      leftSideFilled,
      rightSideFilled,
      branches: [],
    });
  }

  return {
    mainLine: newMainLine,
    leftEnd: newLeftEnd,
    rightEnd: newRightEnd,
    leftEndIsDouble: newLeftEndIsDouble,
    rightEndIsDouble: newRightEndIsDouble,
    hubDoubles: newHubDoubles,
  };
}

function placeTileOnBranch(
  board: BoardState,
  tile: Tile,
  hubRef: number,
  armIndex: number,
): BoardState {
  const hubIndex = board.hubDoubles.findIndex((h, idx) => hubIdAt(h, idx) === hubRef);
  const hub = hubIndex >= 0 ? board.hubDoubles[hubIndex] : null;
  if (!hub || !hub.isCrossed || armIndex >= 2) {
    throw new Error('Invalid branch placement.');
  }

  const tileIsDouble = isDouble(tile);
  const laneRef = `branch-${hubRef}-${armIndex}`;
  let newBranches: (BranchArm | null)[];
  let newHubDoubles = [...board.hubDoubles];

  const existingBranch = hub.branches[armIndex];
  if (existingBranch && existingBranch.tiles.length > 0) {
    const branchMatchValue = existingBranch.openEnd;
    const branchNewEnd = exposedPip(tile, branchMatchValue);
    const depthBeforeAppend = existingBranch.tiles.length;

    const placedTile: PlacedTile = {
      tile,
      orientation: getPlacementOrientation(tile, branchMatchValue, 'branch'),
    };

    newBranches = hub.branches.map((b, i) =>
      i === armIndex
        ? {
            tiles: [...existingBranch.tiles, placedTile],
            openEnd: branchNewEnd,
            openEndIsDouble: tileIsDouble,
          }
        : b,
    );

    if (tileIsDouble) {
      const newHubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
      newHubDoubles.push({
        hubId: newHubId,
        laneType: 'branch',
        laneRef,
        branchDepth: depthBeforeAppend,
        tileIndex: -1,
        mainlineIndex: undefined,
        hubValue: tile.high,
        leftSideFilled: true,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      });
    }

    newHubDoubles = [
      ...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? []),
    ];
  } else {
    const matchValue = hub.hubValue;
    const newExposedEnd = exposedPip(tile, matchValue);
    const placedTile: PlacedTile = {
      tile,
      orientation: getPlacementOrientation(tile, matchValue, 'branch'),
    };

    newBranches = [...hub.branches];
    newBranches[armIndex] = {
      tiles: [placedTile],
      openEnd: newExposedEnd,
      openEndIsDouble: tileIsDouble,
    };

    if (tileIsDouble) {
      const newHubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
      newHubDoubles.push({
        hubId: newHubId,
        laneType: 'branch',
        laneRef,
        branchDepth: 0,
        tileIndex: -1,
        mainlineIndex: undefined,
        hubValue: tile.high,
        leftSideFilled: true,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      });
    }

    newHubDoubles = [
      ...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? []),
    ];
  }

  newHubDoubles = newHubDoubles.map((h, i) =>
    i === hubIndex ? { ...h, branches: newBranches } : h,
  );

  return {
    ...board,
    hubDoubles: newHubDoubles,
  };
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
  let next: BoardState;
  if (board === null) {
    const placedTile: PlacedTile = {
      tile,
      orientation: isDouble(tile) ? 'vertical-normal' : 'horizontal-normal',
    };
    const nextBoard: BoardState = {
      mainLine: [placedTile],
      leftEnd: tile.low,
      rightEnd: tile.high,
      leftEndIsDouble: isDouble(tile),
      rightEndIsDouble: isDouble(tile),
      hubDoubles: [],
    };
    if (isDouble(tile)) {
      const hubId = nextHubId(nextBoard);
      next = {
        ...nextBoard,
        hubDoubles: [
          {
            hubId,
            laneType: 'mainline',
            laneRef: 'mainline',
            tileIndex: 0,
            mainlineIndex: 0,
            hubValue: tile.high,
            isCrossed: false,
            leftSideFilled: false,
            rightSideFilled: false,
            branches: [],
          },
        ],
      };
    } else {
      next = nextBoard;
    }
  } else {
    const branchPos = parseBranchPosition(position);
    if (branchPos) {
      next = placeTileOnBranch(board, tile, branchPos.hubIndex, branchPos.armIndex);
    } else {
      next = placeTileOnMainLine(board, tile, position as 'left' | 'right');
    }
  }
  return recomputeBoardEnds(next);
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
  const sum = computeOpenEndsSum(board);
  return sum !== 0 && sum % 5 === 0 ? sum / 5 : 0;
}

/**
 * Playable match pip values for chips / legality / coaching copy.
 * Do NOT use this for the Open Ends count pill — use `computeOpenEndsSum(board)`.
 */
export function getDisplayOpenEnds(state: BotMatchState): number[] {
  if (!state.board) return [];
  return getMatchableOpenEnds(state.board).map((end) => end.matchValue);
}

function nextPlayer(player: BotPlayerId): BotPlayerId {
  return player === 'you' ? 'bot' : 'you';
}

/** Race-to-N: game ends only when at least one player has reached target and leads on points. */
function winnerFromScores(scores: Record<BotPlayerId, number>, target: number): BotPlayerId | null {
  const youQualified = scores.you >= target;
  const botQualified = scores.bot >= target;
  if (!youQualified && !botQualified) return null;
  if (scores.you === scores.bot) return null;
  return scores.you > scores.bot ? 'you' : 'bot';
}

function computeHandPenalty(hand: Tile[]): number {
  const total = sumPips(hand);
  return Math.round(total / 5);
}

function computeGoOutBonusPoints(hand: Tile[]): number {
  const total = sumPips(hand);
  return Math.round(total / 5);
}

function getPlayMoves(state: BotMatchState, player: BotPlayerId): Move[] {
  if (state.handOver || state.gameOver || state.currentPlayer !== player) return [];
  const hand = state.players[player].hand;
  const playMoves: Move[] = [];

  if (!state.handOpen) {
    for (const tile of hand) {
      const simBoard = simulatePlacement(null, tile, 'left');
      const scores = computePlayScore(simBoard) > 0;
      if (isDouble(tile) || scores) {
        playMoves.push({ type: 'play', tile, position: 'left' });
      }
    }
    return playMoves;
  }

  const openEnds = getMatchableOpenEnds(state.board);
  for (const tile of hand) {
    const matching: PlacementPosition[] = [];
    for (const end of openEnds) {
      if (tileMatchesEnd(tile, end.matchValue)) {
        matching.push(end.position);
      }
    }
    const uniquePositions = [...new Set(matching)];
    for (const position of uniquePositions) {
      playMoves.push({ type: 'play', tile, position });
    }
  }
  return playMoves;
}

export function getLegalMoves(state: BotMatchState, player: BotPlayerId): Move[] {
  const start =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  if (!state.players[player] || state.currentPlayer !== player || state.handOver || state.gameOver) return [];
  const playMoves = getPlayMoves(state, player);
  const result: Move[] =
    playMoves.length === 0 && state.boneyard.length <= BONEYARD_LOCKED_COUNT
      ? [{ type: 'pass' }]
      : playMoves;
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

  const nextBoard = simulatePlacement(state.board, move.tile, move.position);
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

function resolveHandEnd(
  state: BotMatchState,
  winner: BotPlayerId,
  reason: BotHandEndReason,
  pointsAwarded: number,
): BotMatchState {
  const nextScores = {
    you: state.players.you.score,
    bot: state.players.bot.score,
  };
  nextScores[winner] += pointsAwarded;
  const finalWinner = winnerFromScores(nextScores, state.winningScore);

  return {
    ...state,
    players: {
      you: { ...state.players.you, score: nextScores.you },
      bot: { ...state.players.bot, score: nextScores.bot },
    },
    handOver: true,
    gameOver: finalWinner !== null,
    winnerId: finalWinner,
    lastHandWinner: winner,
    lastHandReason: reason,
  };
}

export function applyPlayMove(
  state: BotMatchState,
  player: BotPlayerId,
  move: Move,
): BotActionResult {
  if (move.type !== 'play' || !move.tile || !move.position) return { state };
  if (state.currentPlayer !== player || state.handOver || state.gameOver) return { state };

  const preview = previewPlayMove(state, player, move);
  if (!preview) return { state };

  const updatedHand = preview.nextHand;
  const scoredPoints = preview.immediateScore;
  let nextState: BotMatchState = {
    ...state,
    board: preview.nextBoard,
    handOpen: true,
    players: {
      ...state.players,
      [player]: {
        ...state.players[player],
        hand: updatedHand,
        score: state.players[player].score + scoredPoints,
      },
    },
    consecutivePasses: 0,
    turnIndex: (state.turnIndex ?? 0) + 1,
  };

  if (updatedHand.length === 0) {
    if (
      (preview.isDouble || preview.immediateScore > 0) &&
      nextState.boneyard.length > BONEYARD_LOCKED_COUNT
    ) {
      const [drawnTile, ...remainingBoneyard] = nextState.boneyard;
      nextState = {
        ...nextState,
        boneyard: remainingBoneyard,
        players: {
          ...nextState.players,
          [player]: {
            ...nextState.players[player],
            hand: [drawnTile],
          },
        },
      };
      return {
        state: nextState,
        scored: scoredPoints > 0 ? { player, points: scoredPoints } : undefined,
        drew: { player, tile: drawnTile },
      };
    }

    const loser = nextPlayer(player);
    const loserPips = sumPips(nextState.players[loser].hand);
    const pointsAwarded = computeGoOutBonusPoints(nextState.players[loser].hand);
    nextState = resolveHandEnd(nextState, player, 'domino', pointsAwarded);
    return {
      state: nextState,
      scored: scoredPoints > 0 ? { player, points: scoredPoints } : undefined,
      handEnded: {
        winner: player,
        reason: 'domino',
        pointsAwarded,
        loserPips,
        calcText: `round(${loserPips}/5) = ${pointsAwarded}`,
      },
    };
  }

  if (!preview.turnContinues) {
    nextState = {
      ...nextState,
      currentPlayer: nextPlayer(player),
    };
  }

  return {
    state: nextState,
    scored: scoredPoints > 0 ? { player, points: scoredPoints } : undefined,
  };
}

export function drawOne(state: BotMatchState, player: BotPlayerId): BotActionResult {
  if (
    state.currentPlayer !== player ||
    state.handOver ||
    state.gameOver ||
    state.boneyard.length <= BONEYARD_LOCKED_COUNT
  ) {
    return { state };
  }
  const [drawn, ...rest] = state.boneyard;
  return {
    state: {
      ...state,
      turnIndex: (state.turnIndex ?? 0) + 1,
      boneyard: rest,
      players: {
        ...state.players,
        [player]: {
          ...state.players[player],
          hand: [...state.players[player].hand, drawn],
        },
      },
    },
    drew: { player, tile: drawn },
  };
}

export function passTurn(state: BotMatchState, player: BotPlayerId): BotActionResult {
  if (state.currentPlayer !== player || state.handOver || state.gameOver) return { state };
  if (getPlayMoves(state, player).length > 0) return { state };
  if (state.boneyard.length > BONEYARD_LOCKED_COUNT) return { state };

  const nextConsecutive = state.consecutivePasses + 1;
  const moved = {
    ...state,
    turnIndex: (state.turnIndex ?? 0) + 1,
    currentPlayer: nextPlayer(player),
    consecutivePasses: nextConsecutive,
  };

  if (moved.boneyard.length <= BONEYARD_LOCKED_COUNT && nextConsecutive >= 2) {
    const youPips = sumPips(moved.players.you.hand);
    const botPips = sumPips(moved.players.bot.hand);
    if (youPips === botPips) {
      const finalWinner = winnerFromScores(
        { you: moved.players.you.score, bot: moved.players.bot.score },
        moved.winningScore,
      );
      return {
        state: {
          ...moved,
          handOver: true,
          gameOver: finalWinner !== null,
          winnerId: finalWinner,
          lastHandWinner: null,
          lastHandReason: 'blocked',
        },
        passed: { player },
        handEnded: {
          winner: null,
          reason: 'blocked',
          pointsAwarded: 0,
          loserPips: youPips,
          calcText: 'tie — no hand bonus',
        },
      };
    }
    const winner: BotPlayerId = youPips < botPips ? 'you' : 'bot';
    const loser: BotPlayerId = winner === 'you' ? 'bot' : 'you';
    const loserPips = sumPips(moved.players[loser].hand);
    const pointsAwarded = computeHandPenalty(moved.players[loser].hand);
    const resolved = resolveHandEnd(moved, winner, 'blocked', pointsAwarded);
    return {
      state: resolved,
      passed: { player },
      handEnded: {
        winner,
        reason: 'blocked',
        pointsAwarded,
        loserPips,
        calcText: `round(${loserPips}/5) = ${pointsAwarded}`,
      },
    };
  }

  return {
    state: moved,
    passed: { player },
  };
}

export function drawUntilPlayableOrEmpty(
  state: BotMatchState,
  player: BotPlayerId,
): BotActionResult {
  if (state.currentPlayer !== player || state.handOver || state.gameOver) return { state };
  if (getPlayMoves(state, player).length > 0) return { state };

  let current = state;
  // Capture the opponent's missing pips at draw-start only (pre-draw snapshot).
  // This evidence is useful for pressure heuristics even after they draw.
  if (player === 'you' && current.boneyard.length > BONEYARD_LOCKED_COUNT && current.board) {
    const startEnds = getMatchableOpenEnds(current.board).map((e) => e.matchValue);
    const turnIndex = current.turnIndex ?? 0;
    const handNumber = current.handNumber;
    const prevEvidence = current.opponentMissingEvidence ?? [];
    const prevMissing = new Set<number>(current.opponentKnownMissing ?? []);
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
    current = {
      ...current,
      opponentKnownMissing: Array.from(prevMissing),
      opponentMissingEvidence: appended,
    };
  }

  let lastDrawn: Tile | null = null;
  while (current.boneyard.length > BONEYARD_LOCKED_COUNT) {
    const [drawn, ...rest] = current.boneyard;
    lastDrawn = drawn;
    current = {
      ...current,
      boneyard: rest,
      players: {
        ...current.players,
        [player]: {
          ...current.players[player],
          hand: [...current.players[player].hand, drawn],
        },
      },
    };
    if (getPlayMoves(current, player).length > 0) {
      break;
    }
  }

  if (getPlayMoves(current, player).length === 0) {
    const passResult = passTurn(current, player);
    return {
      ...passResult,
      drew: lastDrawn ? { player, tile: lastDrawn } : undefined,
    };
  }

  return {
    state: current,
    drew: lastDrawn ? { player, tile: lastDrawn } : undefined,
  };
}
