import { applyMove, getLegalMoves } from './game/engine';
import type { GameState, Move, PlayMove, PlacementPosition } from './game/types';

type DailyPuzzleType = 'one_turn_high_score' | 'setup_and_strike';

interface Tile {
  low: number;
  high: number;
}

type TileOrientation =
  | 'horizontal-normal'
  | 'horizontal-flipped'
  | 'vertical-normal'
  | 'vertical-flipped';

interface PlacedTile {
  tile: Tile;
  orientation: TileOrientation;
}

interface BranchArm {
  tiles: PlacedTile[];
  openEnd: number;
  openEndIsDouble: boolean;
}

interface HubDouble {
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
  branches: BranchArm[];
}

interface BoardState {
  mainLine: PlacedTile[];
  leftEnd: number;
  rightEnd: number;
  leftEndIsDouble: boolean;
  rightEndIsDouble: boolean;
  hubDoubles: HubDouble[];
}

interface CuratedDailyPuzzle {
  id: string;
  puzzleDate: string;
  title: string | null;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  targetScore: number;
  puzzleType: DailyPuzzleType;
  dealSize: number;
}

interface CliOptions {
  from: string;
  days: number;
  overwriteExisting: boolean;
}

interface SupabasePuzzleRow {
  puzzle_date: string;
  puzzle_type: DailyPuzzleType | string | null;
}

interface SearchStep {
  move: PlayMove;
  delta: number;
  nextState: GameState;
  doublesUsed: number;
}

const YOU_ID = 'you';
const BOT_ID = 'bot';
const MAX_PIPS = 6;
const DEAL_SIZE = 14;
const MAX_ATTEMPTS_PER_DATE = 300;
const MIN_BEST_SCORE = 35;
const SETUP_STRIKE_MIN_SCORE = 5;
function parseCliArgs(argv: string[]): CliOptions {
  let from: string | null = null;
  let days = 30;
  let overwriteExisting = false;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--from') {
      from = argv[idx + 1] ?? null;
      idx += 1;
      continue;
    }
    if (arg === '--days') {
      const raw = argv[idx + 1];
      idx += 1;
      const parsed = Number.parseInt(raw ?? '', 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--days must be a positive integer.');
      }
      days = parsed;
      continue;
    }
    if (arg === '--overwrite-existing') {
      overwriteExisting = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!from) {
    throw new Error('Missing required argument: --from YYYY-MM-DD');
  }
  if (!isIsoDate(from)) {
    throw new Error(`Invalid --from date: ${from}`);
  }

  return { from, days, overwriteExisting };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && formatDateUtc(date) === value;
}

function formatDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateSeed: string, days: number): string {
  const date = new Date(`${dateSeed}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateUtc(date);
}

function hashString(value: string): number {
  let hash = 1779033703;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(idx), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let next = Math.imul(t ^ (t >>> 15), t | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(prng: () => number, min: number, max: number): number {
  return Math.floor(prng() * (max - min + 1)) + min;
}

function tileKey(tile: Tile): string {
  return `${tile.low}|${tile.high}`;
}

function normalizeTile(a: number, b: number): Tile {
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

function cloneTile(tile: Tile): Tile {
  return { low: tile.low, high: tile.high };
}

function cloneBoard(board: BoardState): BoardState {
  return {
    ...board,
    mainLine: board.mainLine.map((placed) => ({
      tile: cloneTile(placed.tile),
      orientation: placed.orientation,
    })),
    hubDoubles: board.hubDoubles.map((hub) => ({
      ...hub,
      branches: hub.branches.map((branch) => ({
        ...branch,
        tiles: branch.tiles.map((placed) => ({
          tile: cloneTile(placed.tile),
          orientation: placed.orientation,
        })),
      })),
    })),
  };
}

function isDouble(tile: Tile): boolean {
  return tile.low === tile.high;
}

function tileMatchesEnd(tile: Tile, endValue: number): boolean {
  return tile.low === endValue || tile.high === endValue;
}

function tilePips(tile: Tile): number {
  return tile.low + tile.high;
}

function buildFullDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= MAX_PIPS; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

function removeTileOnce(tiles: Tile[], tile: Tile): boolean {
  const idx = tiles.findIndex((candidate) => candidate.low === tile.low && candidate.high === tile.high);
  if (idx < 0) return false;
  tiles.splice(idx, 1);
  return true;
}

function pickAndRemove<T>(items: T[], index: number): T {
  const [picked] = items.splice(index, 1);
  return picked;
}

function sampleWithoutReplacement<T>(items: T[], count: number, prng: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pickAndRemove(pool, randInt(prng, 0, pool.length - 1)));
  }
  return out;
}

function exposedPip(tile: Tile, matchValue: number): number {
  if (tile.low === matchValue) return tile.high;
  if (tile.high === matchValue) return tile.low;
  throw new Error(`Tile ${tileKey(tile)} does not match ${matchValue}`);
}

function getPlacementOrientation(
  tile: Tile,
  matchValue: number,
  placementSide: 'left' | 'right' | 'branch',
): TileOrientation {
  if (isDouble(tile)) return 'vertical-normal';
  if (placementSide === 'left') {
    return tile.high === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  if (placementSide === 'right') {
    return tile.low === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  return tile.high === matchValue ? 'vertical-flipped' : 'vertical-normal';
}

function createSpinnerBoard(spinner: Tile): BoardState {
  return {
    mainLine: [{ tile: spinner, orientation: 'vertical-normal' }],
    leftEnd: spinner.low,
    rightEnd: spinner.high,
    leftEndIsDouble: true,
    rightEndIsDouble: true,
    hubDoubles: [
      {
        hubId: 0,
        laneType: 'mainline',
        laneRef: 'mainline',
        tileIndex: 0,
        mainlineIndex: 0,
        hubValue: spinner.high,
        leftSideFilled: false,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      },
    ],
  };
}

function placeMainLineTile(board: BoardState, tile: Tile, side: 'left' | 'right'): BoardState {
  const matchValue = side === 'left' ? board.leftEnd : board.rightEnd;
  const placed: PlacedTile = {
    tile,
    orientation: getPlacementOrientation(tile, matchValue, side),
  };
  const nextMainLine =
    side === 'left' ? [placed, ...board.mainLine] : [...board.mainLine, placed];

  const nextHubDoubles = board.hubDoubles.map((hub) => {
    const hubIndex = hub.mainlineIndex ?? hub.tileIndex;
    const endpointIndex = side === 'left' ? 0 : board.mainLine.length - 1;
    const updatedHub =
      hubIndex === endpointIndex
        ? {
            ...hub,
            leftSideFilled: side === 'left' ? true : (hub.leftSideFilled ?? false),
            rightSideFilled: side === 'right' ? true : (hub.rightSideFilled ?? false),
          }
        : { ...hub };
    return {
      ...updatedHub,
      isCrossed: Boolean(updatedHub.leftSideFilled && updatedHub.rightSideFilled),
      tileIndex:
        side === 'left' ? (updatedHub.mainlineIndex ?? updatedHub.tileIndex) + 1 : updatedHub.tileIndex,
      mainlineIndex:
        side === 'left' ? (updatedHub.mainlineIndex ?? updatedHub.tileIndex) + 1 : updatedHub.mainlineIndex,
    };
  });

  return {
    mainLine: nextMainLine,
    leftEnd: side === 'left' ? exposedPip(tile, matchValue) : board.leftEnd,
    rightEnd: side === 'right' ? exposedPip(tile, matchValue) : board.rightEnd,
    leftEndIsDouble: side === 'left' ? isDouble(tile) : board.leftEndIsDouble,
    rightEndIsDouble: side === 'right' ? isDouble(tile) : board.rightEndIsDouble,
    hubDoubles: nextHubDoubles,
  };
}

function placeBranchTile(board: BoardState, tile: Tile, armIndex: number): BoardState {
  const spinnerHub = board.hubDoubles[0];
  if (!spinnerHub || !spinnerHub.isCrossed) {
    throw new Error('Spinner hub must be crossed before adding branches.');
  }
  if (armIndex < 0 || armIndex > 1) {
    throw new Error(`Unsupported branch arm: ${armIndex}`);
  }

  const branches = [...spinnerHub.branches];
  const existing = branches[armIndex];
  const matchValue = existing ? existing.openEnd : spinnerHub.hubValue;
  const nextTile: PlacedTile = {
    tile,
    orientation: getPlacementOrientation(tile, matchValue, 'branch'),
  };
  const nextTiles = existing ? [...existing.tiles, nextTile] : [nextTile];
  branches[armIndex] = {
    tiles: nextTiles,
    openEnd: exposedPip(tile, matchValue),
    openEndIsDouble: isDouble(tile),
  };

  return {
    ...board,
    hubDoubles: [
      {
        ...spinnerHub,
        branches,
      },
    ],
  };
}

function countBoardTiles(board: BoardState): number {
  return (
    board.mainLine.length +
    board.hubDoubles.reduce(
      (sum, hub) => sum + hub.branches.reduce((branchSum, branch) => branchSum + branch.tiles.length, 0),
      0,
    )
  );
}

function getOpenEnds(board: BoardState): Array<{ value: number; isDouble: boolean; position: PlacementPosition }> {
  const ends: Array<{ value: number; isDouble: boolean; position: PlacementPosition }> = [
    { value: board.leftEnd, isDouble: board.leftEndIsDouble, position: 'left' },
    { value: board.rightEnd, isDouble: board.rightEndIsDouble, position: 'right' },
  ];

  for (const [hubIdx, hub] of board.hubDoubles.entries()) {
    if (!hub.isCrossed) continue;
    for (let armIdx = 0; armIdx < 2; armIdx += 1) {
      const branch = hub.branches[armIdx];
      if (!branch) {
        ends.push({
          value: hub.hubValue,
          isDouble: false,
          position: `branch-${hub.hubId ?? hubIdx}-${armIdx}`,
        });
      } else {
        ends.push({
          value: branch.openEnd,
          isDouble: branch.openEndIsDouble,
          position: `branch-${hub.hubId ?? hubIdx}-${armIdx}`,
        });
      }
    }
  }

  return ends;
}

function computeOpenEndsSum(board: BoardState): number {
  if (board.mainLine.length === 1) {
    const tile = board.mainLine[0]?.tile;
    return tile ? tile.low + tile.high : 0;
  }

  let sum = 0;
  sum += board.leftEndIsDouble ? board.leftEnd * 2 : board.leftEnd;
  sum += board.rightEndIsDouble ? board.rightEnd * 2 : board.rightEnd;

  for (const hub of board.hubDoubles) {
    if (!hub.isCrossed) continue;
    for (let armIdx = 0; armIdx < 2; armIdx += 1) {
      const branch = hub.branches[armIdx];
      if (!branch) continue;
      sum += branch.openEndIsDouble ? branch.openEnd * 2 : branch.openEnd;
    }
  }

  return sum;
}

function chooseMatchingNonDouble(
  pool: Tile[],
  matchValue: number,
  prng: () => number,
  preferredValues?: number[],
): Tile | null {
  const preferred = new Set(preferredValues ?? []);
  const candidates = pool.filter(
    (tile) => !isDouble(tile) && tileMatchesEnd(tile, matchValue) && tile.low !== tile.high,
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aOther = exposedPip(a, matchValue);
    const bOther = exposedPip(b, matchValue);
    const aScore = (preferred.has(aOther) ? 10 : 0) + aOther + tilePips(a);
    const bScore = (preferred.has(bOther) ? 10 : 0) + bOther + tilePips(b);
    if (aScore !== bScore) return bScore - aScore;
    return tileKey(a).localeCompare(tileKey(b));
  });

  const head = candidates.slice(0, Math.min(5, candidates.length));
  const picked = head[randInt(prng, 0, head.length - 1)];
  if (!removeTileOnce(pool, picked)) {
    return null;
  }
  return picked;
}

function getBoardPipProfile(dateSeed: string): {
  preferredMainLine: number[] | null;
  preferredBranches: number[] | null;
  preferredLeft?: number[] | null;
  preferredRight?: number[] | null;
} {
  const profile = hashString(`${dateSeed}:profile`) % 5;

  if (profile === 0) {
    return { preferredMainLine: [1, 2, 3], preferredBranches: [1, 2, 3] };
  }
  if (profile === 1) {
    return { preferredMainLine: [2, 3, 4], preferredBranches: [2, 3, 4] };
  }
  if (profile === 2) {
    return { preferredMainLine: [4, 5, 6], preferredBranches: [4, 5, 6] };
  }
  if (profile === 3) {
    return {
      preferredMainLine: null,
      preferredBranches: [0, 1, 2, 5, 6],
      preferredLeft: [5, 6],
      preferredRight: [0, 1, 2],
    };
  }
  return { preferredMainLine: null, preferredBranches: null };
}

function buildBoard(dateSeed: string, attempt: number): { board: BoardState; remainingPool: Tile[] } {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:board`));
  const spinnerValue = randInt(prng, 0, MAX_PIPS);
  const spinner = normalizeTile(spinnerValue, spinnerValue);
  const pool = buildFullDoubleSixSet();
  removeTileOnce(pool, spinner);

  const mainLineSize = randInt(prng, 3, 4);
  const extraMainLineTileOnLeft = mainLineSize === 4 ? prng() < 0.5 : false;
  const leftSteps = extraMainLineTileOnLeft ? 2 : 1;
  const rightSteps = mainLineSize - 1 - leftSteps;
  const branchLengths = [randInt(prng, 1, 2), randInt(prng, 1, 2)];
  const pipProfile = getBoardPipProfile(dateSeed);

  let board = createSpinnerBoard(spinner);
  let currentLeft = spinnerValue;
  let currentRight = spinnerValue;

  for (let idx = 0; idx < leftSteps; idx += 1) {
    const tile = chooseMatchingNonDouble(
      pool,
      currentLeft,
      prng,
      pipProfile.preferredLeft ?? pipProfile.preferredMainLine ?? undefined,
    );
    if (!tile) {
      throw new Error('Unable to build left main line.');
    }
    board = placeMainLineTile(board, tile, 'left');
    currentLeft = exposedPip(tile, currentLeft);
  }

  for (let idx = 0; idx < rightSteps; idx += 1) {
    const tile = chooseMatchingNonDouble(
      pool,
      currentRight,
      prng,
      pipProfile.preferredRight ?? pipProfile.preferredMainLine ?? undefined,
    );
    if (!tile) {
      throw new Error('Unable to build right main line.');
    }
    board = placeMainLineTile(board, tile, 'right');
    currentRight = exposedPip(tile, currentRight);
  }

  if (!board.hubDoubles[0]?.isCrossed) {
    throw new Error('Spinner hub was not crossed.');
  }

  for (let armIdx = 0; armIdx < branchLengths.length; armIdx += 1) {
    let current = spinnerValue;
    for (let depth = 0; depth < branchLengths[armIdx]; depth += 1) {
      const tile = chooseMatchingNonDouble(
        pool,
        current,
        prng,
        pipProfile.preferredBranches ?? undefined,
      );
      if (!tile) {
        throw new Error(`Unable to build branch ${armIdx}.`);
      }
      board = placeBranchTile(board, tile, armIdx);
      current = exposedPip(tile, current);
    }
  }

  const tileCount = countBoardTiles(board);
  const openEnds = getOpenEnds(board);
  if (tileCount < 4 || tileCount > 8) {
    throw new Error(`Board tile count out of range: ${tileCount}`);
  }
  if (openEnds.length < 3 || openEnds.length > 6) {
    throw new Error(`Open ends out of range: ${openEnds.length}`);
  }
  if (board.hubDoubles.length !== 1) {
    throw new Error('Generated board must contain only the spinner hub.');
  }

  return { board, remainingPool: pool };
}

function createSearchState(board: BoardState, hand: Tile[]): GameState {
  return {
    config: {
      maxPips: MAX_PIPS,
      tilesPerPlayer: DEAL_SIZE,
      deadTileCount: 0,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 999,
    },
    playerIds: [YOU_ID, BOT_ID],
    players: {
      [YOU_ID]: { id: YOU_ID, hand: hand.map(cloneTile), score: 0 },
      [BOT_ID]: { id: BOT_ID, hand: [], score: 0 },
    },
    board: cloneBoard(board),
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

function boardKey(board: BoardState | null): string {
  if (!board) return 'empty';
  const mainLine = board.mainLine
    .map((placed) => `${tileKey(placed.tile)}:${placed.orientation}`)
    .join(',');
  const hubs = board.hubDoubles
    .map((hub, hubIdx) => {
      const hubId = hub.hubId ?? hubIdx;
      const branches = hub.branches
        .map((branch, branchIdx) => {
          const tiles = branch.tiles
            .map((placed) => `${tileKey(placed.tile)}:${placed.orientation}`)
            .join('/');
          return `${branchIdx}:${branch.openEnd}:${branch.openEndIsDouble ? 1 : 0}:${tiles}`;
        })
        .join(';');
      return `${hubId}:${hub.hubValue}:${hub.isCrossed ? 1 : 0}:${branches}`;
    })
    .join('|');
  return `${mainLine}::${hubs}`;
}

function stateKey(state: GameState): string {
  const hand = [...state.players[YOU_ID].hand].map(tileKey).sort().join(',');
  return `${state.currentPlayerIndex}:${state.players[YOU_ID].score}:${hand}:${boardKey(
    state.board as BoardState | null,
  )}`;
}

function moveSortValue(step: SearchStep, prng: () => number): number {
  const doubleBonus = isDouble(step.move.tile) ? 4 : 0;
  const pipBonus = tilePips(step.move.tile) / 20;
  return step.delta + doubleBonus + pipBonus + prng() / 1000;
}

function shuffleTiles(tiles: Tile[], prng: () => number): Tile[] {
  const out = [...tiles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(prng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeSimState(dateSeed: string, attempt: number): GameState {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:sim:deal`));
  const shuffled = shuffleTiles(buildFullDoubleSixSet(), prng);
  const youHand = shuffled.slice(0, DEAL_SIZE);
  const botHand = shuffled.slice(DEAL_SIZE, DEAL_SIZE * 2);

  return {
    config: {
      maxPips: MAX_PIPS,
      tilesPerPlayer: DEAL_SIZE,
      deadTileCount: 0,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 999,
    },
    playerIds: [YOU_ID, BOT_ID],
    players: {
      [YOU_ID]: { id: YOU_ID, hand: youHand.map(cloneTile), score: 0 },
      [BOT_ID]: { id: BOT_ID, hand: botHand.map(cloneTile), score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: randInt(prng, 0, 1),
    handNumber: 1,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

function evaluateSimMove(state: GameState, move: PlayMove, dateSeed: string, attempt: number): number {
  const next = applyMove(state, state.playerIds[state.currentPlayerIndex], move as Move).state;
  const delta =
    next.players[state.playerIds[state.currentPlayerIndex]].score -
    state.players[state.playerIds[state.currentPlayerIndex]].score;
  const nextPlayerId = next.playerIds[next.currentPlayerIndex];
  const nextOptions = getLegalMoves(next, nextPlayerId).filter((m): m is PlayMove => m.type === 'play').length;
  const boardTiles = next.board ? countBoardTiles(next.board as BoardState) : 0;
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:sim:rank:${tileKey(move.tile)}:${move.position}`));
  return delta * 3 + nextOptions * 2 + boardTiles * 0.5 + (isDouble(move.tile) ? 2 : 0) + prng() * 0.001;
}

function pickTacticalMove(state: GameState, dateSeed: string, attempt: number): Move {
  const currentId = state.playerIds[state.currentPlayerIndex];
  const legal = getLegalMoves(state, currentId);
  const plays = legal.filter((m): m is PlayMove => m.type === 'play');
  if (plays.length === 0) return { type: 'pass' };

  const ranked = plays
    .map((move) => ({ move, rank: evaluateSimMove(state, move, dateSeed, attempt) }))
    .sort((a, b) => b.rank - a.rank);
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:sim:pick:${state.currentPlayerIndex}:${state.consecutivePasses}:${ranked.length}`));
  const topN = Math.max(1, Math.min(3, ranked.length));
  return ranked[randInt(prng, 0, topN - 1)].move;
}

function buildMidHandPuzzleState(
  dateSeed: string,
  attempt: number,
): { board: BoardState; hand: Tile[] } {
  const minTurns = 12;
  const maxTurns = 140;
  const minBoardTiles = 8;
  const minOptions = 4;
  const minHandSize = 8;

  let state = makeSimState(dateSeed, attempt);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (state.handOver || state.gameOver) {
      throw new Error('Simulation ended before finding a tactical state.');
    }

    const currentId = state.playerIds[state.currentPlayerIndex];
    const nextMove = pickTacticalMove(state, dateSeed, attempt + turn);
    state = applyMove(state, currentId, nextMove as Move).state;

    if (turn < minTurns) continue;
    if (state.currentPlayerIndex !== 0) continue;
    if (!state.board) continue;

    const boardTiles = countBoardTiles(state.board as BoardState);
    const options = getLegalMoves(state, YOU_ID).filter((m): m is PlayMove => m.type === 'play').length;
    const handSize = state.players[YOU_ID].hand.length;
    if (boardTiles < minBoardTiles || options < minOptions || handSize < minHandSize) continue;

    return {
      board: cloneBoard(state.board as BoardState),
      hand: [...state.players[YOU_ID].hand].map(cloneTile).sort((a, b) => tileKey(a).localeCompare(tileKey(b))),
    };
  }

  throw new Error('Could not synthesize tactical mid-hand puzzle state.');
}

function buildSetupMidHandPuzzleState(
  dateSeed: string,
  attempt: number,
): { board: BoardState; hand: Tile[]; setupTile: Tile; strikeTile: Tile } {
  const minTurns = 8;
  const maxTurns = 220;
  const minBoardTiles = 6;
  const minHandSize = 6;

  let state = makeSimState(dateSeed, attempt);

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (state.handOver || state.gameOver) {
      throw new Error('Simulation ended before finding a setup state.');
    }

    const currentId = state.playerIds[state.currentPlayerIndex];
    const nextMove = pickTacticalMove(state, dateSeed, attempt + turn);
    state = applyMove(state, currentId, nextMove as Move).state;

    if (turn < minTurns) continue;
    if (state.currentPlayerIndex !== 0) continue;
    if (!state.board) continue;

    const boardTiles = countBoardTiles(state.board as BoardState);
    const handSize = state.players[YOU_ID].hand.length;
    if (boardTiles < minBoardTiles || handSize < minHandSize) continue;

    const sequence = findSetupAndStrikeSequence(
      state.board as BoardState,
      [...state.players[YOU_ID].hand].map(cloneTile),
    );
    if (!sequence) continue;

    return {
      board: cloneBoard(state.board as BoardState),
      hand: [...state.players[YOU_ID].hand].map(cloneTile).sort((a, b) => tileKey(a).localeCompare(tileKey(b))),
      setupTile: sequence.setupTile,
      strikeTile: sequence.strikeTile,
    };
  }

  throw new Error('Could not synthesize setup-and-strike mid-hand puzzle state.');
}

function findScoringPath(board: BoardState, remainingPool: Tile[], dateSeed: string, attempt: number): Tile[] | null {
  const searchState = createSearchState(board, remainingPool);
  const memo = new Set<string>();
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:path`));

  const dfs = (state: GameState, doublesUsed: number, depth: number): Tile[] | null => {
    const score = state.players[YOU_ID].score;
    if (score >= MIN_BEST_SCORE) return [];
    if (depth >= 5 || state.currentPlayerIndex !== 0) return null;

    const key = `${stateKey(state)}:${doublesUsed}:${depth}`;
    if (memo.has(key)) return null;
    memo.add(key);

    const legalMoves = getLegalMoves(state, YOU_ID).filter((move): move is PlayMove => move.type === 'play');
    const candidates: SearchStep[] = [];

    for (const move of legalMoves) {
      const next = applyMove(state, YOU_ID, move as Move).state;
      const delta = next.players[YOU_ID].score - state.players[YOU_ID].score;
      const nextDoubles = doublesUsed + (isDouble(move.tile) ? 1 : 0);
      if (nextDoubles > 3) continue;
      if (delta <= 0 && !isDouble(move.tile)) continue;
      candidates.push({ move, delta, nextState: next, doublesUsed: nextDoubles });
    }

    candidates.sort((a, b) => moveSortValue(b, prng) - moveSortValue(a, prng));

    for (const candidate of candidates.slice(0, 14)) {
      const tail = dfs(candidate.nextState, candidate.doublesUsed, depth + 1);
      if (tail) {
        return [cloneTile(candidate.move.tile), ...tail];
      }
    }

    return null;
  };

  return dfs(searchState, 0, 0);
}

function buildHandFromPath(
  remainingPool: Tile[],
  pathTiles: Tile[],
  dateSeed: string,
  attempt: number,
): Tile[] {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:hand`));
  const handPool = remainingPool.map(cloneTile);
  const hand: Tile[] = [];

  for (const tile of pathTiles) {
    if (!removeTileOnce(handPool, tile)) {
      throw new Error(`Path tile missing from pool: ${tileKey(tile)}`);
    }
    hand.push(cloneTile(tile));
  }

  if (hand.length > DEAL_SIZE) {
    throw new Error('Path exceeds hand size limit.');
  }

  const currentDoubles = hand.filter(isDouble).length;
  const targetHandSize = Math.max(hand.length + 1, randInt(prng, 8, DEAL_SIZE));
  const desiredDoubleCount = Math.max(1, Math.min(4, Math.max(currentDoubles, randInt(prng, 1, 4))));

  if (currentDoubles > 4) {
    throw new Error('Path uses too many doubles for the final hand.');
  }

  const availableDoubles = handPool.filter(isDouble);
  const availableNonDoubles = handPool.filter((tile) => !isDouble(tile));
  const doublesNeeded = Math.max(0, desiredDoubleCount - currentDoubles);

  if (availableDoubles.length < doublesNeeded) {
    throw new Error('Not enough doubles remain for the hand.');
  }

  const selectedDoubles = sampleWithoutReplacement(availableDoubles, doublesNeeded, prng);
  for (const tile of selectedDoubles) {
    removeTileOnce(handPool, tile);
    hand.push(cloneTile(tile));
  }

  const fillerSlots = targetHandSize - hand.length;
  const maxExtraDoubles = Math.max(0, 4 - hand.filter(isDouble).length);
  const fillerDoubles = Math.min(maxExtraDoubles, Math.max(0, randInt(prng, 0, Math.min(1, fillerSlots))));
  const fillerDoubleTiles = sampleWithoutReplacement(
    handPool.filter(isDouble),
    fillerDoubles,
    prng,
  );
  for (const tile of fillerDoubleTiles) {
    removeTileOnce(handPool, tile);
    hand.push(cloneTile(tile));
  }

  const remainingSlots = targetHandSize - hand.length;
  const fillers = sampleWithoutReplacement(
    handPool.filter((tile) => !isDouble(tile)),
    remainingSlots,
    prng,
  );
  if (fillers.length !== remainingSlots) {
    throw new Error('Not enough filler tiles remain.');
  }
  hand.push(...fillers.map(cloneTile));

  if (hand.length < 8 || hand.length > DEAL_SIZE) {
    throw new Error(`Hand size out of range: ${hand.length}`);
  }

  const doubles = hand.filter(isDouble).length;
  if (doubles < 1 || doubles > 4) {
    throw new Error(`Hand double count out of range: ${doubles}`);
  }

  return hand.sort((a, b) => tileKey(a).localeCompare(tileKey(b)));
}

export function createHighScorePuzzle(dateSeed: string, attempt: number): CuratedDailyPuzzle {
  try {
    const { board, remainingPool } = buildBoard(dateSeed, attempt);
    const pathTiles = findScoringPath(board, remainingPool, dateSeed, attempt);
    if (!pathTiles) {
      throw new Error('Unable to find high-score path.');
    }
    const hand = buildHandFromPath(remainingPool, pathTiles, dateSeed, attempt);
    const puzzle: CuratedDailyPuzzle = {
      id: `generated-${dateSeed}`,
      puzzleDate: dateSeed,
      title: null,
      startingBoard: board,
      startingHand: hand,
      maxMoves: 1,
      targetScore: 999,
      puzzleType: 'one_turn_high_score',
      dealSize: DEAL_SIZE,
    };

    validateGeneratedPuzzle(puzzle);
    return puzzle;
  } catch {
    const fallback = buildMidHandPuzzleState(dateSeed, attempt);
    const puzzle: CuratedDailyPuzzle = {
      id: `generated-${dateSeed}`,
      puzzleDate: dateSeed,
      title: null,
      startingBoard: fallback.board,
      startingHand: fallback.hand,
      maxMoves: 1,
      targetScore: 999,
      puzzleType: 'one_turn_high_score',
      dealSize: DEAL_SIZE,
    };

    validateGeneratedPuzzle(puzzle);
    return puzzle;
  }
}

function boardShapeSignature(board: BoardState): string {
  const ends = getOpenEnds(board)
    .map((end) => `${end.position}:${end.value}`)
    .sort()
    .join('|');
  return `${board.leftEnd}:${board.rightEnd}:${ends}`;
}

function buildSetupHand(
  remainingPool: Tile[],
  setupTile: Tile,
  strikeTile: Tile,
  dateSeed: string,
  attempt: number,
): Tile[] {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:setup-hand`));
  const pool = remainingPool.map(cloneTile);
  const hand: Tile[] = [];

  for (const tile of [setupTile, strikeTile]) {
    if (!removeTileOnce(pool, tile)) {
      throw new Error(`Setup path tile missing from pool: ${tileKey(tile)}`);
    }
    hand.push(cloneTile(tile));
  }

  const currentDoubles = hand.filter(isDouble).length;
  const targetHandSize = randInt(prng, 6, 10);
  const desiredDoubleCount = Math.max(1, Math.min(2, Math.max(currentDoubles, randInt(prng, 1, 2))));
  const doublesNeeded = Math.max(0, desiredDoubleCount - currentDoubles);
  const availableDoubles = pool.filter(isDouble);
  if (availableDoubles.length < doublesNeeded) {
    throw new Error('Not enough doubles remain for setup hand.');
  }

  const selectedDoubles = sampleWithoutReplacement(availableDoubles, doublesNeeded, prng);
  for (const tile of selectedDoubles) {
    removeTileOnce(pool, tile);
    hand.push(cloneTile(tile));
  }

  const remainingSlots = targetHandSize - hand.length;
  const fillerPool = pool.filter((tile) => !isDouble(tile));
  const fillers = sampleWithoutReplacement(fillerPool, remainingSlots, prng);
  if (fillers.length !== remainingSlots) {
    throw new Error('Not enough filler tiles remain for setup hand.');
  }
  hand.push(...fillers.map(cloneTile));

  const doubles = hand.filter(isDouble).length;
  if (hand.length < 6 || hand.length > 10) {
    throw new Error(`Setup hand size out of range: ${hand.length}`);
  }
  if (doubles < 1 || doubles > 2) {
    throw new Error(`Setup hand double count out of range: ${doubles}`);
  }

  return hand.sort((a, b) => tileKey(a).localeCompare(tileKey(b)));
}

function buildConstructiveSetupAndStrikeState(
  dateSeed: string,
  attempt: number,
): { board: BoardState; remainingPool: Tile[]; setupTile: Tile; strikeTile: Tile } {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:setup-constructive`));

  const fixedTemplate = (() => {
    const spinner = normalizeTile(1, 1);
    const setupTile = normalizeTile(6, 6);
    const strikeTile = normalizeTile(2, 6);
    const leftOne = normalizeTile(1, 5);
    const leftTwo = normalizeTile(5, 6);
    const rightOne = normalizeTile(0, 1);
    const rightTwo = normalizeTile(0, 2);
    const branchTileA = normalizeTile(1, 4);
    const branchTileB = normalizeTile(1, 3);
    const requiredTiles = [leftOne, leftTwo, rightOne, rightTwo, branchTileA, branchTileB];

    const pool = buildFullDoubleSixSet();
    let removable = true;
    for (const tile of [spinner, ...requiredTiles]) {
      if (!removeTileOnce(pool, tile)) {
        removable = false;
        break;
      }
    }
    if (!removable) return null;

    let board = createSpinnerBoard(spinner);
    board = placeMainLineTile(board, leftOne, 'left');
    board = placeMainLineTile(board, rightOne, 'right');
    if (!board.hubDoubles[0]?.isCrossed) return null;
    board = placeMainLineTile(board, leftTwo, 'left');
    board = placeMainLineTile(board, rightTwo, 'right');
    board = placeBranchTile(board, branchTileA, 0);
    board = placeBranchTile(board, branchTileB, 1);

    const initialState = createSearchState(board, [setupTile, strikeTile]);
    const setupMove = getLegalMoves(initialState, YOU_ID).find(
      (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(setupTile),
    );
    const strikeDirectMove = getLegalMoves(initialState, YOU_ID).find(
      (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(strikeTile),
    );
    if (!setupMove || !strikeDirectMove) return null;

    const setupState = applyMove(initialState, YOU_ID, setupMove as Move).state;
    const setupScore = setupState.players[YOU_ID].score - initialState.players[YOU_ID].score;
    if (setupScore !== 0 || setupState.currentPlayerIndex !== 0) return null;

    const strikeAfterSetupMove = getLegalMoves(setupState, YOU_ID).find(
      (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(strikeTile),
    );
    if (!strikeAfterSetupMove) return null;

    const strikeAfterSetupState = applyMove(setupState, YOU_ID, strikeAfterSetupMove as Move).state;
    const strikeScore =
      strikeAfterSetupState.players[YOU_ID].score - setupState.players[YOU_ID].score;
    if (strikeScore < SETUP_STRIKE_MIN_SCORE) return null;

    const directStrikeState = applyMove(initialState, YOU_ID, strikeDirectMove as Move).state;
    const directStrikeScore =
      directStrikeState.players[YOU_ID].score - initialState.players[YOU_ID].score;
    if (directStrikeScore >= Math.max(3, strikeScore - 2)) return null;

    return {
      board,
      remainingPool: pool,
      setupTile,
      strikeTile,
    };
  })();

  if (fixedTemplate) {
    return fixedTemplate;
  }

  const shuffledPips = (): number[] => {
    const pips = Array.from({ length: MAX_PIPS + 1 }, (_, idx) => idx);
    for (let idx = pips.length - 1; idx > 0; idx -= 1) {
      const swapIdx = randInt(prng, 0, idx);
      [pips[idx], pips[swapIdx]] = [pips[swapIdx], pips[idx]];
    }
    return pips;
  };

  const spinnerValues = shuffledPips();
  const strikeEnds = shuffledPips().filter((pip) => pip !== 1 && pip !== 6);
  const strikeOthers = shuffledPips();
  const branchAValues = shuffledPips();
  const branchBValues = shuffledPips();
  const leftMids = shuffledPips();
  const rightMids = shuffledPips();

  for (const spinnerValue of spinnerValues) {
    for (const strikeEnd of strikeEnds) {
      for (const strikeOther of strikeOthers) {
        for (const branchA of branchAValues) {
          for (const branchB of branchBValues) {
            if (strikeOther + branchA + branchB !== 13) continue;
            if (new Set([strikeOther, branchA, branchB]).size !== 3) continue;
            if ([strikeOther, branchA, branchB].includes(spinnerValue)) continue;

            for (const leftMid of leftMids) {
              if (leftMid === spinnerValue || leftMid === 6) continue;
              for (const rightMid of rightMids) {
                if (rightMid === spinnerValue || rightMid === strikeEnd) continue;

                const spinner = normalizeTile(spinnerValue, spinnerValue);
                const setupTile = normalizeTile(6, 6);
                const strikeTile = normalizeTile(strikeEnd, strikeOther);

                const leftOne = normalizeTile(spinnerValue, leftMid);
                const leftTwo = normalizeTile(leftMid, 6);
                const rightOne = normalizeTile(spinnerValue, rightMid);
                const rightTwo = normalizeTile(rightMid, strikeEnd);
                const branchTileA = normalizeTile(spinnerValue, branchA);
                const branchTileB = normalizeTile(spinnerValue, branchB);

                const requiredTiles = [leftOne, leftTwo, rightOne, rightTwo, branchTileA, branchTileB];
                if (requiredTiles.some((tile) => isDouble(tile)) || isDouble(strikeTile)) continue;

                const seenKeys = new Set<string>([tileKey(spinner), tileKey(setupTile), tileKey(strikeTile)]);
                let hasCollision = false;
                for (const tile of requiredTiles) {
                  const key = tileKey(tile);
                  if (seenKeys.has(key)) {
                    hasCollision = true;
                    break;
                  }
                  seenKeys.add(key);
                }
                if (hasCollision) continue;

                const pool = buildFullDoubleSixSet();
                let removable = true;
                for (const tile of [spinner, ...requiredTiles]) {
                  if (!removeTileOnce(pool, tile)) {
                    removable = false;
                    break;
                  }
                }
                if (!removable) continue;

                let board = createSpinnerBoard(spinner);
                board = placeMainLineTile(board, leftOne, 'left');
                board = placeMainLineTile(board, rightOne, 'right');
                if (!board.hubDoubles[0]?.isCrossed) continue;
                board = placeMainLineTile(board, leftTwo, 'left');
                board = placeMainLineTile(board, rightTwo, 'right');
                board = placeBranchTile(board, branchTileA, 0);
                board = placeBranchTile(board, branchTileB, 1);

                const initialState = createSearchState(board, [setupTile, strikeTile]);
                const setupMove = getLegalMoves(initialState, YOU_ID).find(
                  (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(setupTile),
                );
                const strikeDirectMove = getLegalMoves(initialState, YOU_ID).find(
                  (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(strikeTile),
                );
                if (!setupMove || !strikeDirectMove) continue;

                const setupState = applyMove(initialState, YOU_ID, setupMove as Move).state;
                const setupScore = setupState.players[YOU_ID].score - initialState.players[YOU_ID].score;
                if (setupScore !== 0 || setupState.currentPlayerIndex !== 0) continue;

                const strikeAfterSetupMove = getLegalMoves(setupState, YOU_ID).find(
                  (move): move is PlayMove => move.type === 'play' && tileKey(move.tile) === tileKey(strikeTile),
                );
                if (!strikeAfterSetupMove) continue;

                const strikeAfterSetupState = applyMove(setupState, YOU_ID, strikeAfterSetupMove as Move).state;
                const strikeScore =
                  strikeAfterSetupState.players[YOU_ID].score - setupState.players[YOU_ID].score;
                if (strikeScore < SETUP_STRIKE_MIN_SCORE) continue;

                const directStrikeState = applyMove(initialState, YOU_ID, strikeDirectMove as Move).state;
                const directStrikeScore =
                  directStrikeState.players[YOU_ID].score - initialState.players[YOU_ID].score;
                if (directStrikeScore >= Math.max(3, strikeScore - 2)) continue;

                return {
                  board,
                  remainingPool: pool,
                  setupTile,
                  strikeTile,
                };
              }
            }
          }
        }
      }
    }
  }

  throw new Error('Unable to construct setup-and-strike board.');
}

function findSetupAndStrikeSequence(
  board: BoardState,
  candidateTiles: Tile[],
): { setupTile: Tile; strikeTile: Tile; bestScore: number } | null {
  const initialState = createSearchState(board, candidateTiles);
  const openingMoves = getLegalMoves(initialState, YOU_ID).filter(
    (move): move is PlayMove => move.type === 'play',
  );

  let bestFound: { setupTile: Tile; strikeTile: Tile; bestScore: number } | null = null;

  for (const setupMove of openingMoves) {
    const setupResult = applyMove(initialState, YOU_ID, setupMove as Move).state;
    const setupScore = setupResult.players[YOU_ID].score - initialState.players[YOU_ID].score;
    if (setupScore !== 0) continue;
    if (!isDouble(setupMove.tile)) continue;
    if (setupResult.currentPlayerIndex !== 0) continue;
    const setupBoard = setupResult.board as BoardState | null;
    if (!setupBoard) continue;
    if (boardShapeSignature(setupBoard) === boardShapeSignature(board)) continue;

    const followUpMoves = getLegalMoves(setupResult, YOU_ID).filter(
      (move): move is PlayMove => move.type === 'play',
    );

    for (const strikeMove of followUpMoves) {
      const strikeResult = applyMove(setupResult, YOU_ID, strikeMove as Move).state;
      const strikeScore = strikeResult.players[YOU_ID].score - setupResult.players[YOU_ID].score;
      if (strikeScore < SETUP_STRIKE_MIN_SCORE) continue;

      const directStrike = openingMoves.find((move) => tileKey(move.tile) === tileKey(strikeMove.tile));
      if (directStrike) {
        const directResult = applyMove(initialState, YOU_ID, directStrike as Move).state;
        const directScore = directResult.players[YOU_ID].score - initialState.players[YOU_ID].score;
        if (directScore >= Math.max(3, strikeScore - 2)) continue;
      }

      if (!bestFound || strikeScore > bestFound.bestScore) {
        bestFound = {
          setupTile: cloneTile(setupMove.tile),
          strikeTile: cloneTile(strikeMove.tile),
          bestScore: strikeScore,
        };
      }
    }
  }

  return bestFound;
}

function buildSetupHandFromExistingHand(
  existingHand: Tile[],
  setupTile: Tile,
  strikeTile: Tile,
  dateSeed: string,
  attempt: number,
): Tile[] {
  const prng = mulberry32(hashString(`${dateSeed}:${attempt}:setup-existing-hand`));
  const pool = existingHand.map(cloneTile);
  const hand: Tile[] = [];

  for (const tile of [setupTile, strikeTile]) {
    if (!removeTileOnce(pool, tile)) {
      throw new Error(`Setup path tile missing from existing hand: ${tileKey(tile)}`);
    }
    hand.push(cloneTile(tile));
  }

  const currentDoubles = hand.filter(isDouble).length;
  if (currentDoubles > 2) {
    throw new Error('Setup pair uses too many doubles.');
  }

  const targetHandSize = Math.min(pool.length + hand.length, randInt(prng, 6, 10));
  const desiredDoubleCount = Math.max(1, Math.min(2, Math.max(currentDoubles, randInt(prng, 1, 2))));
  const doublesNeeded = Math.max(0, desiredDoubleCount - currentDoubles);
  const availableDoubles = pool.filter(isDouble);
  if (availableDoubles.length < doublesNeeded) {
    throw new Error('Not enough doubles remain in existing hand.');
  }

  const selectedDoubles = sampleWithoutReplacement(availableDoubles, doublesNeeded, prng);
  for (const tile of selectedDoubles) {
    removeTileOnce(pool, tile);
    hand.push(cloneTile(tile));
  }

  const remainingSlots = targetHandSize - hand.length;
  const fillerPool = pool.filter((tile) => !isDouble(tile));
  const fillers = sampleWithoutReplacement(fillerPool, remainingSlots, prng);
  if (fillers.length !== remainingSlots) {
    throw new Error('Not enough filler tiles remain in existing hand.');
  }
  hand.push(...fillers.map(cloneTile));

  const doubles = hand.filter(isDouble).length;
  if (hand.length < 6 || hand.length > 10) {
    throw new Error(`Setup hand size out of range: ${hand.length}`);
  }
  if (doubles < 1 || doubles > 2) {
    throw new Error(`Setup hand double count out of range: ${doubles}`);
  }

  return hand.sort((a, b) => tileKey(a).localeCompare(tileKey(b)));
}

function generateSetupAndStrikePuzzle(dateSeed: string, attempt: number): CuratedDailyPuzzle {
  try {
    const constructed = buildConstructiveSetupAndStrikeState(dateSeed, attempt);
    const hand = buildSetupHand(
      constructed.remainingPool,
      constructed.setupTile,
      constructed.strikeTile,
      dateSeed,
      attempt,
    );

    const puzzle: CuratedDailyPuzzle = {
      id: `generated-${dateSeed}-setup`,
      puzzleDate: dateSeed,
      title: null,
      startingBoard: constructed.board,
      startingHand: hand,
      maxMoves: 2,
      targetScore: 999,
      puzzleType: 'setup_and_strike',
      dealSize: DEAL_SIZE,
    };

    validateGeneratedPuzzle(puzzle);
    return puzzle;
  } catch (error) {
    if (process.env.DEBUG_SETUP_STRIKE === '1' && attempt === 0) {
      console.error('[setup_and_strike][constructive] failed:', error);
    }
    // Fall through to opportunistic search paths below.
  }

  try {
    const { board, remainingPool } = buildBoard(dateSeed, attempt);
    const sequence = findSetupAndStrikeSequence(board, remainingPool);
    if (!sequence) {
      throw new Error('Unable to find setup-and-strike sequence.');
    }

    const hand = buildSetupHand(
      remainingPool,
      sequence.setupTile,
      sequence.strikeTile,
      dateSeed,
      attempt,
    );

    const puzzle: CuratedDailyPuzzle = {
      id: `generated-${dateSeed}-setup`,
      puzzleDate: dateSeed,
      title: null,
      startingBoard: board,
      startingHand: hand,
      maxMoves: 2,
      targetScore: 999,
      puzzleType: 'setup_and_strike',
      dealSize: DEAL_SIZE,
    };

    validateGeneratedPuzzle(puzzle);
    return puzzle;
  } catch (error) {
    if (process.env.DEBUG_SETUP_STRIKE === '1' && attempt === 0) {
      console.error('[setup_and_strike][direct-board] failed:', error);
    }
    const fallback = buildSetupMidHandPuzzleState(dateSeed, attempt);
    const hand = buildSetupHandFromExistingHand(
      fallback.hand,
      fallback.setupTile,
      fallback.strikeTile,
      dateSeed,
      attempt,
    );

    const puzzle: CuratedDailyPuzzle = {
      id: `generated-${dateSeed}-setup`,
      puzzleDate: dateSeed,
      title: null,
      startingBoard: fallback.board,
      startingHand: hand,
      maxMoves: 2,
      targetScore: 999,
      puzzleType: 'setup_and_strike',
      dealSize: DEAL_SIZE,
    };

    validateGeneratedPuzzle(puzzle);
    return puzzle;
  }
}

function computeBestPossiblePuzzleScore(puzzle: CuratedDailyPuzzle): number {
  const initialState = createSearchState(puzzle.startingBoard, puzzle.startingHand);
  const memo = new Map<string, number>();

  const dfs = (state: GameState): number => {
    const key = stateKey(state);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = state.players[YOU_ID].score;
    if (state.currentPlayerIndex !== 0) {
      memo.set(key, best);
      return best;
    }

    const legalMoves = getLegalMoves(state, YOU_ID).filter((move): move is PlayMove => move.type === 'play');
    if (legalMoves.length === 0) {
      memo.set(key, best);
      return best;
    }

    for (const move of legalMoves) {
      const next = applyMove(state, YOU_ID, move as Move).state;
      best = Math.max(best, dfs(next));
    }

    memo.set(key, best);
    return best;
  };

  return dfs(initialState);
}

function validateGeneratedPuzzle(puzzle: CuratedDailyPuzzle): { bestScore: number; openEnds: number[] } {
  const openEnds = getOpenEnds(puzzle.startingBoard).map((end) => end.value);
  const tileCount = countBoardTiles(puzzle.startingBoard);
  const handSize = puzzle.startingHand.length;
  const handDoubles = puzzle.startingHand.filter(isDouble).length;
  const initialState = createSearchState(puzzle.startingBoard, puzzle.startingHand);
  const openingMoves = getLegalMoves(initialState, YOU_ID).filter(
    (move): move is PlayMove => move.type === 'play',
  );
  const optionsAtStart = openingMoves.length;
  const bestScore = computeBestPossiblePuzzleScore(puzzle);
  const singleMoveScores = openingMoves
    .map((move) => {
      const next = applyMove(initialState, YOU_ID, move as Move).state;
      return next.players[YOU_ID].score - initialState.players[YOU_ID].score;
    })
    .filter((score) => score > 0)
    .sort((a, b) => b - a);
  const topSingleMoveScore = singleMoveScores[0] ?? 0;
  const secondSingleMoveScore = singleMoveScores[1] ?? null;

  if (puzzle.dealSize !== DEAL_SIZE) {
    throw new Error(`Deal size must be ${DEAL_SIZE}.`);
  }
  if (openEnds.length < 2 || openEnds.length > 8) {
    throw new Error(`Board open end count must be 2-8, got ${openEnds.length}.`);
  }
  if (tileCount < 7 || tileCount > 24) {
    throw new Error(`Board tile count must be 7-24, got ${tileCount}.`);
  }
  if (puzzle.puzzleType === 'one_turn_high_score') {
    if (handSize < 8 || handSize > DEAL_SIZE) {
      throw new Error(`Hand size must be 8-${DEAL_SIZE}, got ${handSize}.`);
    }
    if (handDoubles < 1 || handDoubles > 6) {
      throw new Error(`Hand double count must be 1-6, got ${handDoubles}.`);
    }
    if (optionsAtStart < 4) {
      throw new Error(`Playable options at start must be >= 4, got ${optionsAtStart}.`);
    }
    if (bestScore < MIN_BEST_SCORE) {
      throw new Error(`Best score ${bestScore} is below ${MIN_BEST_SCORE}.`);
    }

    // Single-move score check is too strict for sequence-based puzzles (where
    // a double may open the turn with 0 pts). We rely on bestScore instead.

    if (
      topSingleMoveScore >= MIN_BEST_SCORE &&
      secondSingleMoveScore !== null &&
      topSingleMoveScore - secondSingleMoveScore < 5
    ) {
      throw new Error(
        `Puzzle is too obvious: top two single-move scores are ${topSingleMoveScore} and ${secondSingleMoveScore}.`,
      );
    }
  } else if (puzzle.puzzleType === 'setup_and_strike') {
    if (handSize < 6 || handSize > 10) {
      throw new Error(`Hand size must be 6-10, got ${handSize}.`);
    }
    if (handDoubles < 1 || handDoubles > 2) {
      throw new Error(`Hand double count must be 1-2, got ${handDoubles}.`);
    }
    const setupValidation = validateSetupAndStrikeGeneratedPuzzle(puzzle);
    if (!setupValidation.valid) {
      throw new Error(setupValidation.reason);
    }
  } else {
    throw new Error(`Unsupported puzzle type: ${puzzle.puzzleType}`);
  }
  if (computeOpenEndsSum(puzzle.startingBoard) < 0) {
    throw new Error('Open ends sum computation failed.');
  }

  return { bestScore, openEnds };
}

function validateSetupAndStrikeGeneratedPuzzle(
  puzzle: CuratedDailyPuzzle,
): { valid: boolean; reason: string; bestScore: number } {
  const initialState = createSearchState(puzzle.startingBoard, puzzle.startingHand);
  const firstMoves = getLegalMoves(initialState, YOU_ID).filter(
    (move): move is PlayMove => move.type === 'play',
  );

  let bestStrikeScore = 0;

  for (const setupMove of firstMoves) {
    const setupResult = applyMove(initialState, YOU_ID, setupMove as Move).state;
    const setupScore = setupResult.players[YOU_ID].score - initialState.players[YOU_ID].score;
    if (setupScore !== 0) continue;
    const setupBoard = setupResult.board as BoardState | null;
    if (!setupBoard) continue;
    if (boardShapeSignature(setupBoard) === boardShapeSignature(puzzle.startingBoard)) continue;

    const followUpMoves = getLegalMoves(setupResult, YOU_ID).filter(
      (move): move is PlayMove => move.type === 'play',
    );

    for (const strikeMove of followUpMoves) {
      const strikeResult = applyMove(setupResult, YOU_ID, strikeMove as Move).state;
      const strikeScore = strikeResult.players[YOU_ID].score - setupResult.players[YOU_ID].score;
      bestStrikeScore = Math.max(bestStrikeScore, strikeScore);
      if (strikeScore < SETUP_STRIKE_MIN_SCORE) continue;

      const directStrike = firstMoves.find((move) => tileKey(move.tile) === tileKey(strikeMove.tile));
      if (directStrike) {
        const directResult = applyMove(initialState, YOU_ID, directStrike as Move).state;
        const directScore = directResult.players[YOU_ID].score - initialState.players[YOU_ID].score;
        if (directScore >= Math.max(6, strikeScore - 4)) continue;
      }

      return { valid: true, reason: 'OK', bestScore: strikeScore };
    }
  }

  return {
    valid: false,
    reason: 'No setup+strike sequence found.',
    bestScore: bestStrikeScore,
  };
}

async function fetchExistingPuzzleDates(
  supabaseUrl: string,
  serviceKey: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const url = new URL('/rest/v1/daily_puzzles', supabaseUrl);
  url.searchParams.set('select', 'puzzle_date,puzzle_type');
  url.searchParams.append('puzzle_date', `gte.${from}`);
  url.searchParams.append('puzzle_date', `lte.${to}`);

  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch existing puzzles: ${response.status} ${await response.text()}`);
  }

  const rows = (await response.json()) as SupabasePuzzleRow[];
  return new Set(rows.map((row) => `${row.puzzle_date}::${row.puzzle_type ?? 'one_turn_high_score'}`));
}

async function upsertPuzzle(
  supabaseUrl: string,
  serviceKey: string,
  puzzle: CuratedDailyPuzzle,
): Promise<void> {
  const url = new URL('/rest/v1/daily_puzzles', supabaseUrl);
  url.searchParams.set('on_conflict', 'puzzle_date,puzzle_type');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      puzzle_date: puzzle.puzzleDate,
      title: puzzle.title,
      starting_board: puzzle.startingBoard,
      starting_hand: puzzle.startingHand,
      max_moves: puzzle.maxMoves,
      target_score: puzzle.targetScore,
      puzzle_type: puzzle.puzzleType,
      deal_size: puzzle.dealSize,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upsert ${puzzle.puzzleDate}: ${response.status} ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required.');
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_KEY is required.');
  }

  const finalDate = addDays(options.from, options.days - 1);
  const existingDates = await fetchExistingPuzzleDates(
    supabaseUrl,
    serviceKey,
    options.from,
    finalDate,
  );
  let hadFailures = false;

  for (let offset = 0; offset < options.days; offset += 1) {
    const dateSeed = addDays(options.from, offset);
    const generators: Array<{
      puzzleType: DailyPuzzleType;
      build: (seed: string, attempt: number) => CuratedDailyPuzzle;
    }> = [
      { puzzleType: 'one_turn_high_score', build: createHighScorePuzzle },
    ];

    for (const generator of generators) {
      const existingKey = `${dateSeed}::${generator.puzzleType}`;
      if (existingDates.has(existingKey) && !options.overwriteExisting) {
        console.log(`${dateSeed} | ${generator.puzzleType} | skipped | existing puzzle`);
        continue;
      }

      let generated: CuratedDailyPuzzle | null = null;
      let bestScore = 0;
      let openEnds: number[] = [];

      const maxAttempts = MAX_ATTEMPTS_PER_DATE;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          generated = generator.build(dateSeed, attempt);
          const validation = validateGeneratedPuzzle(generated);
          bestScore = validation.bestScore;
          openEnds = validation.openEnds;
          break;
        } catch {
          generated = null;
        }
      }

      if (!generated) {
        hadFailures = true;
        console.error(
          `${dateSeed} | ${generator.puzzleType} | failed after ${maxAttempts} attempts`,
        );
        continue;
      }

      await upsertPuzzle(supabaseUrl, serviceKey, generated);
      console.log(`${dateSeed} | ${generator.puzzleType} | ${bestScore} | ${openEnds.join(',')}`);
    }
  }

  if (hadFailures) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
