import { applyMove, canDraw, drawOne } from './engine';
import type { GameState, PlacementPosition, Tile } from './types';
import { GAME_COMMAND_VERSION } from './versions';

export type GameCommand =
  | {
      version: typeof GAME_COMMAND_VERSION;
      commandId: string;
      sequence: number;
      actorId: string;
      kind: 'play';
      tile: Tile;
      position: PlacementPosition;
    }
  | {
      version: typeof GAME_COMMAND_VERSION;
      commandId: string;
      sequence: number;
      actorId: string;
      kind: 'draw';
    }
  | {
      version: typeof GAME_COMMAND_VERSION;
      commandId: string;
      sequence: number;
      actorId: string;
      kind: 'pass';
    };

export type GameCommandEvent =
  | { kind: 'tile_played'; actorId: string; tile: Tile; position: PlacementPosition }
  | { kind: 'tile_drawn'; actorId: string }
  | { kind: 'passed'; actorId: string }
  | { kind: 'hand_ended'; winnerId: string | null };

export type GameCommandResult = {
  state: GameState;
  events: GameCommandEvent[];
};

function validateCommandEnvelope(state: GameState, command: GameCommand): void {
  if (command.version !== GAME_COMMAND_VERSION) throw new Error('Unsupported command version.');
  if (!command.commandId || command.commandId.length > 128) throw new Error('Invalid command id.');
  if (!Number.isSafeInteger(command.sequence) || command.sequence !== state.sequence) {
    throw new Error('Stale command sequence.');
  }
  if (state.playerIds[state.currentPlayerIndex] !== command.actorId) {
    throw new Error('Actor does not own the current turn.');
  }
  if (state.handOver || state.gameOver) throw new Error('Cannot act after terminal state.');
}

export function applyGameCommand(state: GameState, command: GameCommand): GameCommandResult {
  validateCommandEnvelope(state, command);
  if (command.kind === 'draw') {
    if (!canDraw(state, command.actorId)) throw new Error('Draw is not legal.');
    const result = drawOne(state, command.actorId);
    if (!result.drew) throw new Error('Draw did not produce a tile.');
    return { state: result.state, events: [{ kind: 'tile_drawn', actorId: command.actorId }] };
  }

  const beforeHandOver = state.handOver;
  const move = command.kind === 'pass'
    ? { type: 'pass' as const }
    : { type: 'play' as const, tile: command.tile, position: command.position };
  const result = applyMove(state, command.actorId, move);
  const events: GameCommandEvent[] = command.kind === 'pass'
    ? [{ kind: 'passed', actorId: command.actorId }]
    : [{
        kind: 'tile_played',
        actorId: command.actorId,
        tile: command.tile,
        position: command.position,
      }];
  if (!beforeHandOver && result.state.handOver) {
    events.push({ kind: 'hand_ended', winnerId: result.state.winnerId });
  }
  return { state: result.state, events };
}
