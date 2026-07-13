import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  applyGameCommand,
  collectGameStateViolations,
  createDeterministicDoubleSixDeal,
  getLegalMoves,
  type GameCommand,
  type GameState,
} from '../index';

function initial(seed: string): GameState {
  const deal = createDeterministicDoubleSixDeal({ seed, tilesPerPlayer: 7 });
  return {
    config: DEFAULT_CONFIG,
    playerIds: ['A', 'B'],
    players: {
      A: { id: 'A', hand: deal.playerTiles, score: 0 },
      B: { id: 'B', hand: deal.opponentTiles, score: 0 },
    },
    board: null,
    boneyard: deal.boneyard,
    deadTiles: deal.deadTiles,
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
    handStarters: ['A'],
  };
}

function run(seed: string): GameState {
  let state = initial(seed);
  for (let step = 0; step < 300 && !state.handOver; step += 1) {
    const actorId = state.playerIds[state.currentPlayerIndex];
    const moves = getLegalMoves(state, actorId);
    const play = moves.find((move) => move.type === 'play');
    const command: GameCommand = play?.type === 'play'
      ? { version: 1, commandId: `${seed}:${step}`, sequence: state.sequence, actorId, kind: 'play', tile: play.tile, position: play.position }
      : moves.some((move) => move.type === 'pass')
        ? { version: 1, commandId: `${seed}:${step}`, sequence: state.sequence, actorId, kind: 'pass' }
        : { version: 1, commandId: `${seed}:${step}`, sequence: state.sequence, actorId, kind: 'draw' };
    const before = JSON.stringify(state);
    const next = applyGameCommand(state, command).state;
    expect(JSON.stringify(state)).toBe(before);
    expect(next.players.A.score).toBeGreaterThanOrEqual(state.players.A.score);
    expect(next.players.B.score).toBeGreaterThanOrEqual(state.players.B.score);
    expect(collectGameStateViolations(next)).toEqual([]);
    state = next;
  }
  expect(state.handOver).toBe(true);
  return state;
}

describe('deterministic simulation properties', () => {
  it('replays identical seeds to identical terminal states', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(run(`property:${seed}`)).toEqual(run(`property:${seed}`));
    }
  });

  it('rejects stale and post-terminal commands', () => {
    const start = initial('stale');
    expect(() => applyGameCommand(start, { version: 1, commandId: 'bad', sequence: 1, actorId: 'A', kind: 'draw' })).toThrow(/stale/i);
    const terminal = run('terminal');
    expect(() => applyGameCommand(terminal, { version: 1, commandId: 'late', sequence: terminal.sequence, actorId: terminal.playerIds[terminal.currentPlayerIndex], kind: 'pass' })).toThrow(/terminal/i);
  });
});
