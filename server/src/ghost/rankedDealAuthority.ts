import { randomBytes } from 'crypto';
import {
  applyMove,
  canDraw,
  createDeterministicDoubleSixDeal,
  createInitialState,
  drawUntilPlayableOrEmpty,
  startNewHand,
  type PlacementPosition,
  type Tile,
} from '@racehorse/game-core';

export type RankedDealSize = 7 | 14;
export type RankedSeat = 'you' | 'bot';

export type RankedHandDeal = {
  playerTiles: Tile[];
  opponentTiles: Tile[];
  boneyard: Tile[];
  deadTiles: Tile[];
};

export type RankedDealSnapshot = {
  v: 1;
  seed: string;
  dealSize: RankedDealSize;
  winningScore: number;
  matchStarter: RankedSeat;
  firstHand: RankedHandDeal;
};

export type RankedMoveSequenceEntry = {
  turn: number;
  actor: 'you' | 'opponent' | 'ghost' | 'bot' | 'fritz';
  action?: 'play' | 'draw' | 'pass';
  tile?: string | null;
  tile_played?: string | null;
  position?: string | null;
  branch?: string | null;
  board_state?: string;
  hand_before?: string[];
  score_delta?: number;
};

export type RankedReplayResult =
  | {
      ok: true;
      playerScore: number;
      opponentScore: number;
      gameOver: true;
    }
  | {
      ok: false;
      reason: string;
      entryIndex: number;
    };

const MAX_REPLAY_STEPS = 4000;

function cloneTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.map((tile) => ({ low: tile.low, high: tile.high }));
}

function cloneDeal(deal: RankedHandDeal): RankedHandDeal {
  return {
    playerTiles: cloneTiles(deal.playerTiles),
    opponentTiles: cloneTiles(deal.opponentTiles),
    boneyard: cloneTiles(deal.boneyard),
    deadTiles: cloneTiles(deal.deadTiles),
  };
}

export function isRankedDealSnapshot(value: unknown): value is RankedDealSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return false;
  if (typeof record.seed !== 'string' || record.seed.length < 8 || record.seed.length > 128) {
    return false;
  }
  if (record.dealSize !== 7 && record.dealSize !== 14) return false;
  if (!Number.isInteger(record.winningScore) || Number(record.winningScore) < 5 || Number(record.winningScore) > 250) {
    return false;
  }
  if (record.matchStarter !== 'you' && record.matchStarter !== 'bot') return false;
  const firstHand = record.firstHand;
  if (!firstHand || typeof firstHand !== 'object') return false;
  const hand = firstHand as Record<string, unknown>;
  return [hand.playerTiles, hand.opponentTiles, hand.boneyard, hand.deadTiles].every(Array.isArray);
}

export function dealRankedHand(seed: string, dealSize: RankedDealSize): RankedHandDeal {
  const dealt = createDeterministicDoubleSixDeal({
    seed,
    tilesPerPlayer: dealSize,
    deadTileCount: dealSize === 14 ? 0 : 2,
  });
  return {
    playerTiles: cloneTiles(dealt.playerTiles),
    opponentTiles: cloneTiles(dealt.opponentTiles),
    boneyard: cloneTiles(dealt.boneyard),
    deadTiles: cloneTiles(dealt.deadTiles),
  };
}

export function rankedHandSeed(seed: string, handNumber: number): string {
  return `${seed}:h${handNumber}`;
}

export function rankedDealStartPayload(match: { matchId: string; dealSnapshot: RankedDealSnapshot | null | undefined }): {
  ok: true;
  matchId: string;
  seed?: string;
  playerTiles?: Tile[];
  dealSize?: RankedDealSize;
  winningScore?: number;
  matchStarter?: RankedSeat;
} {
  const snapshot = match.dealSnapshot;
  if (!isRankedDealSnapshot(snapshot)) {
    return { ok: true, matchId: match.matchId };
  }
  return {
    ok: true,
    matchId: match.matchId,
    seed: snapshot.seed,
    playerTiles: cloneTiles(snapshot.firstHand.playerTiles),
    dealSize: snapshot.dealSize,
    winningScore: snapshot.winningScore,
    matchStarter: snapshot.matchStarter,
  };
}

export function createRankedDealSnapshot(input: {
  seed?: string;
  dealSize?: number;
  winningScore?: number;
  matchStarter?: string | null;
}): { snapshot: RankedDealSnapshot; playerTiles: Tile[] } {
  const dealSize: RankedDealSize = input.dealSize === 14 ? 14 : 7;
  const winningScore = Number.isInteger(input.winningScore) && Number(input.winningScore) >= 5 && Number(input.winningScore) <= 250
    ? Number(input.winningScore)
    : 60;
  const matchStarter: RankedSeat = input.matchStarter === 'bot' ? 'bot' : 'you';
  const seed = input.seed && input.seed.trim() ? input.seed.trim() : randomBytes(16).toString('hex');
  const firstHand = dealRankedHand(rankedHandSeed(seed, 1), dealSize);
  const snapshot: RankedDealSnapshot = {
    v: 1,
    seed,
    dealSize,
    winningScore,
    matchStarter,
    firstHand,
  };
  return { snapshot, playerTiles: cloneTiles(firstHand.playerTiles) };
}

function handDealForNumber(snapshot: RankedDealSnapshot, handNumber: number): RankedHandDeal {
  if (handNumber === 1) return cloneDeal(snapshot.firstHand);
  return dealRankedHand(rankedHandSeed(snapshot.seed, handNumber), snapshot.dealSize);
}

function starterForHand(snapshot: RankedDealSnapshot, handNumber: number): RankedSeat {
  return handNumber % 2 === 1
    ? snapshot.matchStarter
    : snapshot.matchStarter === 'you'
      ? 'bot'
      : 'you';
}

function customDeckFromDeal(deal: RankedHandDeal): Tile[] {
  return [...deal.playerTiles, ...deal.opponentTiles, ...deal.boneyard];
}

function openHandState(
  snapshot: RankedDealSnapshot,
  previous: ReturnType<typeof createInitialState> | null,
  handNumber: number,
) {
  const base = previous ?? createInitialState(['you', 'bot'], {
    tilesPerPlayer: snapshot.dealSize,
    deadTileCount: snapshot.dealSize === 14 ? 0 : 2,
    winningScore: snapshot.winningScore,
    skipPregameDraw: true,
  });
  const carried = previous
    ? {
        ...base,
        players: {
          you: { ...base.players.you, score: previous.players.you.score, hand: [] },
          bot: { ...base.players.bot, score: previous.players.bot.score, hand: [] },
        },
        handOver: false,
        gameOver: false,
        winnerId: null,
      }
    : base;
  return startNewHand(
    carried,
    customDeckFromDeal(handDealForNumber(snapshot, handNumber)),
    starterForHand(snapshot, handNumber),
  );
}

function normalizeActor(actor: RankedMoveSequenceEntry['actor']): 'you' | 'bot' {
  return actor === 'you' ? 'you' : 'bot';
}

function parseTileKey(value: string | null | undefined): Tile | null {
  if (!value || typeof value !== 'string') return null;
  const match = /^([0-6])\|([0-6])$/.exec(value.trim());
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(match[2]);
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function isPlacementPosition(value: string | null | undefined): value is PlacementPosition {
  return value === 'left' || value === 'right' || Boolean(value && /^branch-\d+-\d+$/.test(value));
}

export function resolveRankedMoveAction(entry: RankedMoveSequenceEntry): 'play' | 'draw' | 'pass' | null {
  if (entry.action === 'play' || entry.action === 'draw' || entry.action === 'pass') return entry.action;
  const branch = entry.branch ?? entry.position ?? null;
  if (branch === 'draw') return 'draw';
  if (branch === 'pass') return 'pass';
  const tile = entry.tile ?? entry.tile_played ?? null;
  if (tile && (branch === 'left' || branch === 'right' || (typeof branch === 'string' && branch.startsWith('branch-')))) {
    return 'play';
  }
  if (tile) return 'play';
  return null;
}

export function isSafeRankedMoveSequence(raw: unknown): raw is RankedMoveSequenceEntry[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4000) return false;
  let previousTurn = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as RankedMoveSequenceEntry;
    const turn = Number(record.turn);
    if (!Number.isInteger(turn) || turn <= 0 || turn <= previousTurn) return false;
    const actor = record.actor;
    if (actor !== 'you' && actor !== 'opponent' && actor !== 'ghost' && actor !== 'bot' && actor !== 'fritz') {
      return false;
    }
    const action = resolveRankedMoveAction(record);
    if (!action) return false;
    previousTurn = turn;
  }
  return true;
}

export function replayRankedMoveLog(
  snapshot: RankedDealSnapshot,
  moveLog: RankedMoveSequenceEntry[],
): RankedReplayResult {
  if (!isRankedDealSnapshot(snapshot)) {
    return { ok: false, reason: 'Server deal snapshot is invalid.', entryIndex: -1 };
  }

  let state = openHandState(snapshot, null, 1);

  for (let i = 0; i < moveLog.length; i += 1) {
    if (i > MAX_REPLAY_STEPS) {
      return { ok: false, reason: 'Move log exceeded replay limit.', entryIndex: i };
    }
    const entry = moveLog[i]!;
    const action = resolveRankedMoveAction(entry);
    if (!action) {
      return { ok: false, reason: 'Move log entry is not a play, draw, or pass.', entryIndex: i };
    }
    if (action === 'draw') continue;

    try {
      if (state.gameOver) {
        return { ok: false, reason: 'Move log continues after the game is over.', entryIndex: i };
      }
      if (state.handOver) {
        state = openHandState(snapshot, state, state.handNumber + 1);
      }

      const actorId = normalizeActor(entry.actor);
      if (state.playerIds[state.currentPlayerIndex] !== actorId) {
        if (action === 'pass') continue;
        return {
          ok: false,
          reason: 'Move actor does not match the server-owned turn.',
          entryIndex: i,
        };
      }

      if (canDraw(state, actorId)) {
        state = drawUntilPlayableOrEmpty(state, actorId).state;
      }

      if (action === 'pass') {
        state = applyMove(state, actorId, { type: 'pass' }).state;
        continue;
      }

      const tile = parseTileKey(entry.tile ?? entry.tile_played ?? null);
      const position = entry.position ?? entry.branch ?? null;
      if (!tile || !isPlacementPosition(position)) {
        return { ok: false, reason: 'Play is missing a tile or placement position.', entryIndex: i };
      }
      state = applyMove(state, actorId, { type: 'play', tile, position }).state;
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Move is not legal from the server-owned deal.',
        entryIndex: i,
      };
    }
  }

  if (state.handOver && !state.gameOver) {
    // Final hand ended without crossing the race target; scores are still exact.
  }

  if (!state.gameOver) {
    return {
      ok: false,
      reason: 'Move log does not finish the game from the server-owned deal.',
      entryIndex: moveLog.length - 1,
    };
  }

  return {
    ok: true,
    playerScore: state.players.you.score,
    opponentScore: state.players.bot.score,
    gameOver: true,
  };
}
