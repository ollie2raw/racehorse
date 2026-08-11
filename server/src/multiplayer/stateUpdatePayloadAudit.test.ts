import { describe, expect, it, beforeEach } from 'vitest';
import type { GameState } from '../game/types';
import {
  applyMove,
  createInitialState,
  generateFullSet,
  getLegalMoves,
  startNewHand,
} from '../game/engine';
import { simulatePlacement } from '../game/scoring';
import {
  createReservedRoom,
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  getRoomMatchEventMeta,
  resetRoomRuntimeForTests,
} from '../rooms';
import { getHandCounts, maskStateForRecipient } from './roomSession';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function buildStateUpdatePayload(roomCode: string, state: GameState, recipientPlayerId: string) {
  const legalMoves = getRoomLegalMoves(roomCode, recipientPlayerId);
  const canDraw = getRoomCanDraw(roomCode, recipientPlayerId);
  const maskedState = maskStateForRecipient(state, recipientPlayerId);
  return {
    state: { ...maskedState, handCounts: getHandCounts(state) },
    legalMoves,
    canDraw,
    you: recipientPlayerId,
    eventMeta: getRoomMatchEventMeta(roomCode),
    matchStarted: true,
  };
}

function buildMidGamePrivateMatchState(): {
  roomCode: string;
  state: GameState;
  seatA: string;
  seatB: string;
} {
  const roomCode = 'AUDIT1';
  createReservedRoom(roomCode, { winningScore: 60 });
  const seatA = 'seat-a';
  const seatB = 'seat-b';
  const seatAHand = [t(6, 5), t(3, 1), t(6, 6), t(5, 5), t(4, 4), t(3, 3), t(2, 2)];
  const seatBHand = [t(5, 3), t(1, 0), t(6, 4), t(5, 4), t(4, 3), t(2, 1), t(0, 0)];
  const dealtTileKeys = new Set(
    [...seatAHand, ...seatBHand].map((tile) => `${tile.low}:${tile.high}`),
  );
  const fixedDeck = [
    ...seatAHand,
    ...seatBHand,
    ...generateFullSet(6).filter((tile) => !dealtTileKeys.has(`${tile.low}:${tile.high}`)),
  ];
  let state = startNewHand(
    createInitialState([seatA, seatB], { winningScore: 60, tilesPerPlayer: 7 }),
    fixedDeck,
    seatA,
  );

  const scriptedMoves: Array<{ playerId: string; tile: ReturnType<typeof t>; position: 'left' | 'right' }> = [
    { playerId: seatA, tile: t(6, 5), position: 'left' },
    { playerId: seatB, tile: t(5, 3), position: 'right' },
    { playerId: seatA, tile: t(3, 1), position: 'right' },
    { playerId: seatB, tile: t(1, 0), position: 'left' },
  ];

  for (const scripted of scriptedMoves) {
    const currentId = state.playerIds[state.currentPlayerIndex];
    if (currentId !== scripted.playerId) {
      break;
    }
    const moves = getLegalMoves(state, scripted.playerId).filter((move) => move.type === 'play');
    const match =
      moves.find(
        (move) =>
          move.type === 'play' &&
          move.tile.low === scripted.tile.low &&
          move.tile.high === scripted.tile.high &&
          move.position === scripted.position,
      ) ?? moves[0];
    if (!match || match.type !== 'play') break;
    state = applyMove(state, scripted.playerId, {
      type: 'play',
      tile: match.tile,
      position: match.position,
    }).state;
  }

  const room = getRoom(roomCode);
  room.state = state;
  room.players = [seatA, seatB];
  room.events = [
    {
      id: 'evt-1',
      version: 1,
      matchId: room.matchId,
      roomCode,
      sequence: 1,
      type: 'match_started',
      timestamp: new Date().toISOString(),
      handNumber: state.handNumber,
      stateSequence: state.sequence,
      actorSocketId: null,
      actorUserId: null,
      payload: {},
    },
  ];
  room.eventSequence = 1;

  return { roomCode, state, seatA, seatB };
}

function partitionPayload(payload: ReturnType<typeof buildStateUpdatePayload>) {
  const { state, legalMoves, canDraw, you, eventMeta, matchStarted } = payload;
  const board = state.board;
  const ownHand = state.players[you]?.hand ?? [];
  const opponentHands = Object.fromEntries(
    state.playerIds
      .filter((id) => id !== you)
      .map((id) => [id, state.players[id]?.hand ?? []]),
  );
  const boneyard = state.boneyard;
  const deadTiles = state.deadTiles;
  const scores = Object.fromEntries(state.playerIds.map((id) => [id, state.players[id]?.score ?? 0]));
  const handCounts = state.handCounts ?? {};

  return {
    board: byteLength(board),
    ownHand: byteLength(ownHand),
    opponentHands: byteLength(opponentHands),
    boneyard: byteLength(boneyard),
    deadTiles: byteLength(deadTiles),
    scores: byteLength(scores),
    handCounts: byteLength(handCounts),
    legalMoves: byteLength(legalMoves),
    canDraw: byteLength(canDraw),
    eventMeta: byteLength(eventMeta),
    matchStarted: byteLength(matchStarted),
    meta: byteLength({ canDraw, you, eventMeta, matchStarted }),
    total: byteLength(payload),
  };
}

describe('state:update payload audit', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
  });

  it('reports mid-game private match payload sizes for both seats', () => {
    const { roomCode, state, seatA, seatB } = buildMidGamePrivateMatchState();
    expect(state.players[seatA].hand.length).toBeGreaterThanOrEqual(5);
    expect(state.players[seatB].hand.length).toBeGreaterThanOrEqual(5);
    expect((state.board?.mainLine.length ?? 0) + (state.board?.hubDoubles.length ?? 0)).toBeGreaterThan(0);

    const payloadA = buildStateUpdatePayload(roomCode, state, seatA);
    const payloadB = buildStateUpdatePayload(roomCode, state, seatB);
    const partsA = partitionPayload(payloadA);
    const partsB = partitionPayload(payloadB);

    const averageBytes = Math.round((partsA.total + partsB.total) / 2);

    // eslint-disable-next-line no-console -- intentional audit output for backlog item 9
    console.log(
      JSON.stringify(
        {
          scenario: 'mid_game_private_7_tile_deal_after_4_moves',
          handSizes: {
            [seatA]: state.players[seatA].hand.length,
            [seatB]: seatB in state.players ? state.players[seatB].hand.length : 0,
          },
          boardTiles: state.board?.mainLine.length ?? 0,
          boneyardCount: state.boneyard.length,
          averageStateUpdateBytes: averageBytes,
          seatA: partsA,
          seatB: partsB,
        },
        null,
        2,
      ),
    );

    expect(averageBytes).toBeGreaterThan(500);
    expect(partsA.opponentHands).toBeLessThanOrEqual(20);
    expect(partsB.opponentHands).toBeLessThanOrEqual(20);
    expect(partsA.board).toBe(partsB.board);
    expect(partsA.legalMoves).toBeGreaterThan(0);
  });

  it('shows board dominates payload vs hand-only diff opportunity', () => {
    let board = simulatePlacement(null, t(6, 5), 'left');
    board = simulatePlacement(board, t(5, 3), 'right');
    board = simulatePlacement(board, t(3, 1), 'right');
    board = simulatePlacement(board, t(1, 0), 'left');
    board = simulatePlacement(board, t(4, 4), 'right');
    board = simulatePlacement(board, t(4, 2), 'left');
    board = simulatePlacement(board, t(2, 2), 'right');
    board = simulatePlacement(board, t(2, 0), 'left');

    const state = startNewHand(createInitialState(['A', 'B'], { winningScore: 60, tilesPerPlayer: 7 }));
    state.board = board;
    state.boneyard = Array.from({ length: 10 }, (_, i) => t(i % 6, (i + 2) % 6));
    state.players.A.hand = [t(6, 6), t(5, 5), t(4, 3), t(3, 0), t(2, 1), t(1, 1), t(0, 0)];
    state.players.B.hand = [t(6, 4), t(5, 2), t(4, 1), t(3, 2), t(2, 3), t(1, 2), t(0, 3)];

    createReservedRoom('AUDIT2', { winningScore: 60 });
    const room = getRoom('AUDIT2');
    room.state = state;
    room.players = ['A', 'B'];
    room.events = [
      {
        id: 'evt-2',
        version: 1,
        matchId: room.matchId,
        roomCode: 'AUDIT2',
        sequence: 1,
        type: 'match_started',
        timestamp: new Date().toISOString(),
        handNumber: state.handNumber,
        stateSequence: state.sequence,
        actorSocketId: null,
        actorUserId: null,
        payload: {},
      },
    ];
    room.eventSequence = 1;

    const full = buildStateUpdatePayload('AUDIT2', state, 'A');
    const handOnlyDelta = {
      you: 'A',
      sequence: state.sequence,
      handCounts: getHandCounts(state),
      players: {
        A: { hand: state.players.A.hand },
        B: { hand: [] as typeof state.players.B.hand },
      },
      legalMoves: getRoomLegalMoves('AUDIT2', 'A'),
      canDraw: getRoomCanDraw('AUDIT2', 'A'),
      eventMeta: getRoomMatchEventMeta('AUDIT2'),
    };

    const fullBytes = byteLength(full);
    const handOnlyBytes = byteLength(handOnlyDelta);
    const boardOnlyBytes = byteLength(state.board);

    expect(boardOnlyBytes / fullBytes).toBeGreaterThan(0.35);
    expect(handOnlyBytes).toBeLessThan(fullBytes * 0.35);
  });
});
