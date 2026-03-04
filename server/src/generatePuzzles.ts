import { applyMove, getLegalMoves } from './game/engine';
import type { GameState, Move, PlayMove, PlacementPosition } from './game/types';

type DailyPuzzleType = 'one_turn_high_score';

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
  title: string;
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
}

interface SupabasePuzzleRow {
  puzzle_date: string;
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
const DEAL_SIZE = 7;
const MAX_ATTEMPTS_PER_DATE = 50;
const MIN_BEST_SCORE = 20;
const TITLE_ROTATION = [
  'Amber Crossroads',
  'Ashen Gallop',
  'Blue Lantern Run',
  'Brass Switchback',
  'Cinder Spur',
  'Copper Halo',
  'Crown of Dust',
  'Dawn Relay',
  'Ember Meridian',
  'Fallow Circuit',
  'Flint Horizon',
  'Golden Siding',
  'Harbor of Pips',
  'Iron Canopy',
  'Last Light Junction',
  'Lucky Semaphore',
  'Marble Turn',
  'Northbound Echo',
  'Sable Current',
  'Velvet Junction',
];

function parseCliArgs(argv: string[]): CliOptions {
  let from: string | null = null;
  let days = 30;

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
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!from) {
    throw new Error('Missing required argument: --from YYYY-MM-DD');
  }
  if (!isIsoDate(from)) {
    throw new Error(`Invalid --from date: ${from}`);
  }

  return { from, days };
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
    for (let armIdx = 0; armIdx < Math.min(hub.branches.length, 2); armIdx += 1) {
      const branch = hub.branches[armIdx];
      if (!branch) continue;
      ends.push({
        value: branch.openEnd,
        isDouble: branch.openEndIsDouble,
        position: `branch-${hub.hubId ?? hubIdx}-${armIdx}`,
      });
    }
  }

  return ends;
}

function computeOpenEndsSum(board: BoardState): number {
  return getOpenEnds(board).reduce((sum, end) => sum + (end.isDouble ? end.value * 2 : end.value), 0);
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

  let board = createSpinnerBoard(spinner);
  let currentLeft = spinnerValue;
  let currentRight = spinnerValue;

  for (let idx = 0; idx < leftSteps; idx += 1) {
    const tile = chooseMatchingNonDouble(pool, currentLeft, prng, [5, 6, spinnerValue]);
    if (!tile) {
      throw new Error('Unable to build left main line.');
    }
    board = placeMainLineTile(board, tile, 'left');
    currentLeft = exposedPip(tile, currentLeft);
  }

  for (let idx = 0; idx < rightSteps; idx += 1) {
    const tile = chooseMatchingNonDouble(pool, currentRight, prng, [5, 6, spinnerValue]);
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
      const tile = chooseMatchingNonDouble(pool, current, prng, [4, 5, 6]);
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

  if (hand.length > 7) {
    throw new Error('Path exceeds hand size limit.');
  }

  const currentDoubles = hand.filter(isDouble).length;
  const targetHandSize = Math.max(hand.length + 1, randInt(prng, 5, 7));
  const desiredDoubleCount = Math.max(1, Math.min(3, Math.max(currentDoubles, randInt(prng, 1, 3))));

  if (currentDoubles > 3) {
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
  const maxExtraDoubles = Math.max(0, 3 - hand.filter(isDouble).length);
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

  if (hand.length < 5 || hand.length > 7) {
    throw new Error(`Hand size out of range: ${hand.length}`);
  }

  const doubles = hand.filter(isDouble).length;
  if (doubles < 1 || doubles > 3) {
    throw new Error(`Hand double count out of range: ${doubles}`);
  }

  return hand.sort((a, b) => tileKey(a).localeCompare(tileKey(b)));
}

function buildTitle(dateSeed: string): string {
  return TITLE_ROTATION[hashString(dateSeed) % TITLE_ROTATION.length];
}

function createPuzzle(dateSeed: string, attempt: number): CuratedDailyPuzzle {
  const { board, remainingPool } = buildBoard(dateSeed, attempt);
  const pathTiles = findScoringPath(board, remainingPool, dateSeed, attempt);
  if (!pathTiles) {
    throw new Error('Unable to find a scoring path to 20+ points.');
  }

  const startingHand = buildHandFromPath(remainingPool, pathTiles, dateSeed, attempt);
  const puzzle: CuratedDailyPuzzle = {
    id: `generated-${dateSeed}`,
    puzzleDate: dateSeed,
    title: buildTitle(dateSeed),
    startingBoard: board,
    startingHand,
    maxMoves: 1,
    targetScore: 999,
    puzzleType: 'one_turn_high_score',
    dealSize: DEAL_SIZE,
  };

  validateGeneratedPuzzle(puzzle);
  return puzzle;
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
  const bestScore = computeBestPossiblePuzzleScore(puzzle);

  if (puzzle.puzzleType !== 'one_turn_high_score') {
    throw new Error('Puzzle type must be one_turn_high_score.');
  }
  if (puzzle.dealSize !== 7) {
    throw new Error('Deal size must be 7.');
  }
  if (!puzzle.startingBoard.hubDoubles[0]?.isCrossed) {
    throw new Error('Spinner hub must be crossed.');
  }
  if (puzzle.startingBoard.hubDoubles.length !== 1) {
    throw new Error('Board must contain exactly one hub double entry.');
  }
  if (openEnds.length < 3 || openEnds.length > 6) {
    throw new Error(`Board open end count must be 3-6, got ${openEnds.length}.`);
  }
  if (tileCount < 4 || tileCount > 8) {
    throw new Error(`Board tile count must be 4-8, got ${tileCount}.`);
  }
  if (handSize < 5 || handSize > 7) {
    throw new Error(`Hand size must be 5-7, got ${handSize}.`);
  }
  if (handDoubles < 1 || handDoubles > 3) {
    throw new Error(`Hand double count must be 1-3, got ${handDoubles}.`);
  }
  if (bestScore < MIN_BEST_SCORE) {
    throw new Error(`Best score ${bestScore} is below ${MIN_BEST_SCORE}.`);
  }
  if (computeOpenEndsSum(puzzle.startingBoard) < 0) {
    throw new Error('Open ends sum computation failed.');
  }

  return { bestScore, openEnds };
}

async function fetchExistingPuzzleDates(
  supabaseUrl: string,
  serviceKey: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const url = new URL('/rest/v1/daily_puzzles', supabaseUrl);
  url.searchParams.set('select', 'puzzle_date');
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
  return new Set(rows.map((row) => row.puzzle_date));
}

async function upsertPuzzle(
  supabaseUrl: string,
  serviceKey: string,
  puzzle: CuratedDailyPuzzle,
): Promise<void> {
  const url = new URL('/rest/v1/daily_puzzles', supabaseUrl);
  url.searchParams.set('on_conflict', 'puzzle_date');

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

  for (let offset = 0; offset < options.days; offset += 1) {
    const dateSeed = addDays(options.from, offset);
    if (existingDates.has(dateSeed)) {
      console.log(`${dateSeed} | skipped | existing puzzle`);
      continue;
    }

    let generated: CuratedDailyPuzzle | null = null;
    let bestScore = 0;
    let openEnds: number[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_DATE; attempt += 1) {
      try {
        generated = createPuzzle(dateSeed, attempt);
        const validation = validateGeneratedPuzzle(generated);
        bestScore = validation.bestScore;
        openEnds = validation.openEnds;
        break;
      } catch {
        generated = null;
      }
    }

    if (!generated) {
      throw new Error(`Failed to generate a valid puzzle for ${dateSeed} after ${MAX_ATTEMPTS_PER_DATE} attempts.`);
    }

    await upsertPuzzle(supabaseUrl, serviceKey, generated);
    console.log(`${dateSeed} | ${generated.title} | ${bestScore} | ${openEnds.join(',')}`);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
