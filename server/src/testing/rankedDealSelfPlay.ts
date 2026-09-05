import {
  applyMove,
  canDraw,
  createInitialState,
  drawOne,
  getLegalMoves,
  startNewHand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import {
  dealRankedHand,
  rankedHandSeed,
  type RankedDealSnapshot,
  type RankedMoveSequenceEntry,
} from '../ghost/rankedDealAuthority';
import type { GhostMoveLogEntry } from '../ghost/service';

function tileKey(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;
}

function parseTileKey(value: string): Tile {
  const [lowRaw, highRaw] = value.split('|');
  const low = Number(lowRaw);
  const high = Number(highRaw);
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function dealCustomDeck(snapshot: RankedDealSnapshot, handNumber: number): Tile[] {
  const deal =
    handNumber === 1
      ? snapshot.firstHand
      : dealRankedHand(rankedHandSeed(snapshot.seed, handNumber), snapshot.dealSize);
  return [...deal.playerTiles, ...deal.opponentTiles, ...deal.boneyard];
}

function starterId(snapshot: RankedDealSnapshot, handNumber: number): 'you' | 'bot' {
  return handNumber % 2 === 1
    ? snapshot.matchStarter
    : snapshot.matchStarter === 'you'
      ? 'bot'
      : 'you';
}

function buildHandState(
  snapshot: RankedDealSnapshot,
  previous: GameState | null,
  handNumber: number,
): GameState {
  const base = previous ?? createInitialState(['you', 'bot'], {
    tilesPerPlayer: snapshot.dealSize,
    deadTileCount: snapshot.dealSize === 14 ? 0 : 2,
    winningScore: snapshot.winningScore,
    skipPregameDraw: true,
  });
  const withScores = previous
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
  return startNewHand(withScores, dealCustomDeck(snapshot, handNumber), starterId(snapshot, handNumber));
}

export function playHonestRankedGame(snapshot: RankedDealSnapshot): {
  moveLog: RankedMoveSequenceEntry[];
  playerScore: number;
  opponentScore: number;
} {
  let state = buildHandState(snapshot, null, 1);
  const moveLog: RankedMoveSequenceEntry[] = [];
  let guard = 0;
  while (!state.gameOver && guard < 4000) {
    guard += 1;
    if (state.handOver) {
      state = buildHandState(snapshot, state, state.handNumber + 1);
      continue;
    }
    const actorId = state.playerIds[state.currentPlayerIndex] as 'you' | 'bot';
    const actor = actorId === 'you' ? 'you' : 'opponent';
    const legal = getLegalMoves(state, actorId);
    const play = legal.find((move) => move.type === 'play');
    if (play && play.type === 'play') {
      moveLog.push({
        turn: moveLog.length + 1,
        actor,
        action: 'play',
        tile: tileKey(play.tile),
        position: play.position,
        board_state: 'ignored-client-board',
        hand_before: ['6|6', '5|5', '4|4'],
        score_delta: 999,
      });
      state = applyMove(state, actorId, play).state;
      continue;
    }
    if (canDraw(state, actorId)) {
      moveLog.push({
        turn: moveLog.length + 1,
        actor,
        action: 'draw',
        tile: null,
        position: null,
        board_state: 'ignored-client-board',
        hand_before: ['0|1'],
        score_delta: 0,
      });
      state = drawOne(state, actorId).state;
      continue;
    }
    moveLog.push({
      turn: moveLog.length + 1,
      actor,
      action: 'pass',
      tile: null,
      position: null,
      board_state: 'ignored-client-board',
      hand_before: ['0|1'],
      score_delta: 0,
    });
    state = applyMove(state, actorId, { type: 'pass' }).state;
  }
  if (!state.gameOver) {
    throw new Error('Honest driver failed to finish the game.');
  }
  return {
    moveLog,
    playerScore: state.players.you.score,
    opponentScore: state.players.bot.score,
  };
}

/**
 * Drives an honest multi-hand game and emits it in the REAL client move-log
 * shape (`GhostMoveLogEntry` — `branch`/`tile_played`/`actor: 'you'|'ghost'`),
 * not the `RankedMoveSequenceEntry` shape `playHonestRankedGame` above emits.
 *
 * GM-2 (HARDENING_PLAN.md §10.3): confirms this real shape is actually
 * accepted by `isSafeRankedMoveSequence` — previously only established by
 * tracing, not by a test — using a low `winningScore` so the game reliably
 * spans multiple hands (`hand_number` incrementing), the case most likely to
 * catch a future drift between the two independently-maintained shapes.
 */
export function playHonestGhostShapedGame(snapshot: RankedDealSnapshot): {
  moveLog: GhostMoveLogEntry[];
  playerScore: number;
  opponentScore: number;
  handCount: number;
} {
  let state = buildHandState(snapshot, null, 1);
  const moveLog: GhostMoveLogEntry[] = [];
  let guard = 0;
  while (!state.gameOver && guard < 4000) {
    guard += 1;
    if (state.handOver) {
      state = buildHandState(snapshot, state, state.handNumber + 1);
      continue;
    }
    const actorId = state.playerIds[state.currentPlayerIndex] as 'you' | 'bot';
    const actor: GhostMoveLogEntry['actor'] = actorId === 'you' ? 'you' : 'ghost';
    const handNumber = state.handNumber;
    const legal = getLegalMoves(state, actorId);
    const play = legal.find((move) => move.type === 'play');
    if (play && play.type === 'play') {
      moveLog.push({
        turn: moveLog.length + 1,
        hand_number: handNumber,
        actor,
        board_state: 'ignored-by-isSafeRankedMoveSequence',
        hand_before: [tileKey(play.tile)],
        score_delta: 0,
        tile_played: tileKey(play.tile),
        branch: play.position,
      });
      state = applyMove(state, actorId, play).state;
      continue;
    }
    if (canDraw(state, actorId)) {
      const { state: afterDraw, drew } = drawOne(state, actorId);
      moveLog.push({
        turn: moveLog.length + 1,
        hand_number: handNumber,
        actor,
        board_state: 'ignored-by-isSafeRankedMoveSequence',
        hand_before: [],
        score_delta: 0,
        tile_played: null,
        branch: 'draw',
        drawn_tile: drew ? tileKey(drew) : null,
      });
      state = afterDraw;
      continue;
    }
    moveLog.push({
      turn: moveLog.length + 1,
      hand_number: handNumber,
      actor,
      board_state: 'ignored-by-isSafeRankedMoveSequence',
      hand_before: [],
      score_delta: 0,
      tile_played: null,
      branch: 'pass',
    });
    state = applyMove(state, actorId, { type: 'pass' }).state;
  }
  if (!state.gameOver) {
    throw new Error('Honest ghost-shaped driver failed to finish the game.');
  }
  return {
    moveLog,
    playerScore: state.players.you.score,
    opponentScore: state.players.bot.score,
    handCount: state.handNumber,
  };
}

export function mutateOnePlayedTile(moveLog: RankedMoveSequenceEntry[]): RankedMoveSequenceEntry[] {
  const index = moveLog.findIndex((entry) => entry.action === 'play' && entry.tile);
  if (index < 0) throw new Error('No play to mutate.');
  const original = moveLog[index]!;
  const tile = parseTileKey(original.tile!);
  let mutatedLow = tile.low;
  let mutatedHigh = tile.high === 6 ? 5 : tile.high + 1;
  mutatedHigh = Math.max(mutatedLow, mutatedHigh);
  if (`${mutatedLow}|${mutatedHigh}` === original.tile) {
    mutatedHigh = mutatedLow === 0 ? 1 : mutatedLow;
    mutatedLow = Math.min(mutatedLow, mutatedHigh);
    mutatedHigh = Math.max(mutatedLow, mutatedHigh);
  }
  const mutatedKey = `${Math.min(mutatedLow, mutatedHigh)}|${Math.max(mutatedLow, mutatedHigh)}`;
  return moveLog.map((entry, entryIndex) =>
    entryIndex === index
      ? { ...entry, tile: mutatedKey, hand_before: [mutatedKey, '0|0'] }
      : entry,
  );
}
