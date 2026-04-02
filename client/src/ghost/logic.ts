import type { BoardState, Move, PlacementPosition, Tile } from '../types';
import type { BotMatchState, BotPlayerId } from '../bot/botEngine';
import { previewPlayMove } from '../bot/botEngine';
import type { GhostProfileSummary, GhostResolvedMove } from './api';
import { chooseBotMove } from '../bot/botHeuristics';

function normalizeTileKey(value: string): string {
  const [aRaw, bRaw] = value.split('|');
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return value;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return `${low}|${high}`;
}

export function toTileKey(tile: Tile): string {
  return normalizeTileKey(`${tile.low}|${tile.high}`);
}

export function parseTileKey(value: string): Tile | null {
  const normalized = normalizeTileKey(value);
  const [lowRaw, highRaw] = normalized.split('|');
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

export function serializeGhostBoardState(board: BoardState | null): string {
  if (!board) return 'board:empty';
  return JSON.stringify({
    mainLine: board.mainLine.map((placed) => ({
      tile: [placed.tile.low, placed.tile.high],
      orientation: placed.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubs: board.hubDoubles.map((hub, hubIndex) => ({
      hubId: hub.hubId ?? hub.tileIndex ?? hubIndex,
      laneType: hub.laneType ?? null,
      laneRef: hub.laneRef ?? null,
      branchDepth: hub.branchDepth ?? null,
      tileIndex: hub.tileIndex,
      mainlineIndex: hub.mainlineIndex ?? null,
      hubValue: hub.hubValue,
      leftSideFilled: Boolean(hub.leftSideFilled),
      rightSideFilled: Boolean(hub.rightSideFilled),
      isCrossed: Boolean(hub.isCrossed),
      branches: hub.branches.map((branch) =>
        branch
          ? {
              openEnd: branch.openEnd,
              openEndIsDouble: branch.openEndIsDouble,
              tiles: branch.tiles.map((placed) => ({
                tile: [placed.tile.low, placed.tile.high],
                orientation: placed.orientation,
              })),
            }
          : null,
      ),
    })),
  });
}

function sameMove(move: Move, tile: Tile, position: PlacementPosition): boolean {
  return Boolean(
    move.type === 'play' &&
      move.tile &&
      move.position === position &&
      toTileKey(move.tile) === toTileKey(tile),
  );
}

function sortMoves(a: Move, b: Move): number {
  const aTile = a.tile ? toTileKey(a.tile) : '';
  const bTile = b.tile ? toTileKey(b.tile) : '';
  if (aTile !== bTile) return aTile.localeCompare(bTile);
  return String(a.position ?? '').localeCompare(String(b.position ?? ''));
}

export function resolveGhostMove(params: {
  state: BotMatchState;
  player: BotPlayerId;
  legalMoves: Move[];
  profile: GhostProfileSummary | null;
}): GhostResolvedMove | null {
  const playMoves = params.legalMoves.filter(
    (move): move is Move & { type: 'play'; tile: Tile; position: PlacementPosition } =>
      move.type === 'play' && Boolean(move.tile) && Boolean(move.position),
  );
  if (playMoves.length === 0) return null;

  const turn = (params.state.turnIndex ?? 0) + 1;
  const boardState = serializeGhostBoardState(params.state.board);
  const composite = params.profile?.compositeLog?.states.find(
    (state) => state.turn === turn && state.boardState === boardState,
  );

  if (composite) {
    const tile = parseTileKey(composite.recommendedMove.tilePlayed);
    if (tile) {
      const position = (composite.recommendedMove.branch ?? 'left') as PlacementPosition;
      const legal = playMoves.find((move) => sameMove(move, tile, position));
      if (legal?.tile && legal.position) {
        return {
          tile: legal.tile,
          position: legal.position,
          source: 'composite',
        };
      }
    }
  }

  // Use the style profile to guide the bot choice when no exact match exists.
  // The 'hard' bot uses strategic heuristics that capture a lot of 'good' play style.
  const botChoice = chooseBotMove(params.state, 'hard');
  if (botChoice && botChoice.move.tile && botChoice.move.position) {
    return {
      tile: botChoice.move.tile,
      position: botChoice.move.position as PlacementPosition,
      source: 'best-score',
    };
  }

  if ((params.profile?.gamesPlayed ?? 0) < 5) {
    const randomMove = playMoves[Math.floor(Math.random() * playMoves.length)];
    return randomMove?.tile && randomMove.position
      ? {
          tile: randomMove.tile,
          position: randomMove.position,
          source: 'random-padding',
        }
      : null;
  }

  const scored = playMoves
    .map((move) => ({
      move,
      score: previewPlayMove(params.state, params.player, move)?.immediateScore ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return sortMoves(a.move, b.move);
    });

  const best = scored[0]?.move;
  if (!best?.tile || !best.position) return null;
  return {
    tile: best.tile,
    position: best.position,
    source: 'best-score',
  };
}

export function isSameResolvedMove(
  actual: { tile: Tile; position: PlacementPosition } | null,
  expected: GhostResolvedMove | null,
): boolean {
  if (!actual || !expected) return false;
  return toTileKey(actual.tile) === toTileKey(expected.tile) && actual.position === expected.position;
}
