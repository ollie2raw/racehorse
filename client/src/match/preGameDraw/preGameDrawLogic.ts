import {
  comparePregameDrawTiles as comparePreGameDrawTiles,
  generateDoubleSixSet,
  shuffleTiles,
  tilePipSum,
} from '@racehorse/game-core';
import type { Tile } from '../../types.ts';

export type PreGameDrawPlayer = 'you' | 'bot';

export type PreGameDrawPhase =
  | 'pick-player'
  | 'pick-opponent'
  | 'showing-tie'
  | 'showing-reveal'
  | 'showing-result'
  | 'done'
  | 'resolved';

export interface PreGameDrawTileSlot {
  id: string;
  tile: Tile;
  revealed: boolean;
  outOfPlay: boolean;
}

export interface PreGameDrawRoundPick {
  player: PreGameDrawPlayer;
  tileId: string;
  tile: Tile;
  pipSum: number;
}

export interface PreGameDrawState {
  phase: PreGameDrawPhase;
  tiles: PreGameDrawTileSlot[];
  currentRound: {
    you: PreGameDrawRoundPick | null;
    bot: PreGameDrawRoundPick | null;
  };
  winner: PreGameDrawPlayer | null;
  remainingDeck: Tile[] | null;
}

export type Rng = () => number;

/** Canonical domino identity for the pre-game draw deck (`low-high`, smaller pip first). */
export function normalizePreGameDrawTile(value: unknown): Tile | null {
  if (Array.isArray(value) && value.length === 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    if (low < 0 || high > 6 || !Number.isInteger(low) || !Number.isInteger(high)) return null;
    return { low, high };
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const a = Number(rec.low);
  const b = Number(rec.high);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (low < 0 || high > 6 || !Number.isInteger(low) || !Number.isInteger(high)) return null;
  return { low, high };
}

export function toPreGameDrawTileId(tile: Tile | null | undefined): string | null {
  const normalized = tile ? normalizePreGameDrawTile(tile) : null;
  if (!normalized) return null;
  return `${normalized.low}-${normalized.high}`;
}

function tileKey(tile: Tile): string {
  return toPreGameDrawTileId(tile)!;
}

export { comparePreGameDrawTiles, generateDoubleSixSet, shuffleTiles, tilePipSum };

export function initPreGameDraw(
  deck: readonly Tile[] = generateDoubleSixSet(),
  rng: Rng = Math.random,
): PreGameDrawState {
  if (deck.length !== 28) {
    throw new Error(`Pre-game draw requires 28 tiles, got ${deck.length}`);
  }

  const shuffled = shuffleTiles(deck, rng);
  return {
    phase: 'pick-player',
    tiles: shuffled.map((tile) => ({
      id: tileKey(tile),
      tile: { low: tile.low, high: tile.high },
      revealed: false,
      outOfPlay: false,
    })),
    currentRound: { you: null, bot: null },
    winner: null,
    remainingDeck: null,
  };
}

export function getPickableTileIds(state: PreGameDrawState): string[] {
  return state.tiles
    .filter((slot) => !slot.outOfPlay && !slot.revealed)
    .map((slot) => slot.id);
}

function findSlot(state: PreGameDrawState, tileId: string): PreGameDrawTileSlot | undefined {
  return state.tiles.find((slot) => slot.id === tileId);
}

function markRoundTilesOutOfPlay(tiles: PreGameDrawTileSlot[]): PreGameDrawTileSlot[] {
  return tiles.map((slot) => (slot.revealed ? { ...slot, outOfPlay: true } : slot));
}

function remainingDeckFromTiles(tiles: readonly PreGameDrawTileSlot[]): Tile[] {
  return tiles
    .filter((slot) => !slot.outOfPlay)
    .map((slot) => ({ low: slot.tile.low, high: slot.tile.high }));
}

function resolveWinner(
  state: PreGameDrawState,
  winner: PreGameDrawPlayer,
  tiles: PreGameDrawTileSlot[],
  youPick: PreGameDrawRoundPick,
  botPick: PreGameDrawRoundPick,
): PreGameDrawState {
  const tilesForDeal = markRoundTilesOutOfPlay(tiles);
  return {
    ...state,
    phase: 'resolved',
    // Keep both flipped tiles on the board for reveal/result UI; deal pool excludes them.
    tiles,
    winner,
    remainingDeck: remainingDeckFromTiles(tilesForDeal),
    currentRound: { you: youPick, bot: botPick },
  };
}

function resolveTie(state: PreGameDrawState, tiles: PreGameDrawTileSlot[]): PreGameDrawState {
  return {
    ...state,
    phase: 'pick-player',
    tiles,
    currentRound: { you: null, bot: null },
    winner: null,
    remainingDeck: null,
  };
}

/** Both picks revealed with a genuine pip-identity tie — tiles still on the scatter before redraw. */
export function isTieHoldState(state: PreGameDrawState): boolean {
  const { you, bot } = state.currentRound;
  if (state.phase !== 'pick-opponent' || you == null || bot == null || state.winner != null) {
    return false;
  }
  return comparePreGameDrawTiles(you.tile, bot.tile) === 0;
}

export function commitTieRedraw(state: PreGameDrawState): PreGameDrawState {
  return resolveTie(state, markRoundTilesOutOfPlay(state.tiles));
}

export function applyPlayerPick(state: PreGameDrawState, tileId: string): PreGameDrawState {
  if (state.phase !== 'pick-player') {
    throw new Error(`Cannot pick player tile while phase is ${state.phase}`);
  }

  const slot = findSlot(state, tileId);
  if (!slot || slot.outOfPlay || slot.revealed) {
    throw new Error(`Tile ${tileId} is not available to pick`);
  }

  const tiles = state.tiles.map((entry) =>
    entry.id === tileId ? { ...entry, revealed: true } : entry,
  );
  const picked = findSlot({ ...state, tiles }, tileId)!;

  return {
    ...state,
    phase: 'pick-opponent',
    tiles,
    currentRound: {
      you: {
        player: 'you',
        tileId,
        tile: { low: picked.tile.low, high: picked.tile.high },
        pipSum: tilePipSum(picked.tile),
      },
      bot: null,
    },
  };
}

/**
 * Which scatter slot Fritz flips for his scripted tile.
 *
 * `applyScriptedPlayerPick` swaps *pips* between slots while leaving slot ids
 * (positions) fixed, so a slot id stops being a reliable pointer to the tile it
 * was named after. When the player taps the very slot Fritz was scripted to
 * flip, the player's tap wins that position and Fritz's pips are displaced into
 * the scripted player slot.
 *
 * Derived from the board rather than from the tap, so it gives the same answer
 * when recomputed later — after a remount that restores a persisted draw, for
 * instance, where the original tap is no longer known. The deck holds one of
 * each domino, so at most one unrevealed slot can carry these pips.
 *
 * Fritz still draws the same tile either way; only its position on the scatter
 * changes, so the scripted outcome and the remaining deck are untouched.
 */
export function findScriptedFritzSlotId(
  state: PreGameDrawState,
  scriptedFritzTileId: string,
): string | null {
  const slot = state.tiles.find(
    (entry) =>
      !entry.revealed &&
      !entry.outOfPlay &&
      toPreGameDrawTileId(entry.tile) === scriptedFritzTileId,
  );
  return slot ? slot.id : null;
}

/**
 * Scripted draw (Daily Fritz): player may tap any tile, but the canonical player tile
 * is fixed server-side. Reveal the tapped slot with the scripted pips so the flip
 * matches the user's touch target (not a different tile elsewhere on the scatter).
 *
 * This holds even when the player taps the slot Fritz was scripted to flip: the
 * tap wins the position and Fritz is displaced to the scripted player slot (see
 * `resolveScriptedFritzSlotId`). Previously that case short-circuited to
 * `applyPlayerPick(scriptedPlayerTileId)`, which flipped a slot the player never
 * touched and then handed the tapped slot to Fritz.
 */
export function applyScriptedPlayerPick(
  state: PreGameDrawState,
  tappedTileId: string,
  scriptedPlayerTileId: string,
  scriptedFritzTileId?: string | null,
): PreGameDrawState {
  if (tappedTileId === scriptedPlayerTileId) {
    return applyPlayerPick(state, scriptedPlayerTileId);
  }

  if (state.phase !== 'pick-player') {
    throw new Error(`Cannot pick player tile while phase is ${state.phase}`);
  }

  const tappedSlot = findSlot(state, tappedTileId);
  const scriptedSlot = findSlot(state, scriptedPlayerTileId);
  if (!tappedSlot || tappedSlot.outOfPlay || tappedSlot.revealed) {
    throw new Error(`Tile ${tappedTileId} is not available to pick`);
  }
  if (!scriptedSlot || scriptedSlot.outOfPlay) {
    throw new Error(`Scripted player tile ${scriptedPlayerTileId} is not available`);
  }
  if (scriptedFritzTileId != null) {
    // Fail fast on a stale scripted id rather than letting the mismatch surface
    // later as a wrong-looking flip.
    const fritzSlot = findSlot(state, scriptedFritzTileId);
    if (!fritzSlot || fritzSlot.outOfPlay || fritzSlot.revealed) {
      throw new Error(`Scripted fritz tile ${scriptedFritzTileId} is not available`);
    }
  }

  const scriptedTile = scriptedSlot.tile;
  const tappedTile = tappedSlot.tile;
  const tiles = state.tiles.map((entry) => {
    if (entry.id === tappedTileId) {
      return {
        ...entry,
        revealed: true,
        tile: { low: scriptedTile.low, high: scriptedTile.high },
      };
    }
    if (entry.id === scriptedPlayerTileId) {
      // Preserve every scatter position: move the tapped tile into the scripted
      // tile's original face-down slot instead of removing that slot visually.
      return {
        ...entry,
        tile: { low: tappedTile.low, high: tappedTile.high },
      };
    }
    return entry;
  });

  return {
    ...state,
    phase: 'pick-opponent',
    tiles,
    currentRound: {
      you: {
        player: 'you',
        tileId: scriptedPlayerTileId,
        tile: { low: scriptedTile.low, high: scriptedTile.high },
        pipSum: tilePipSum(scriptedTile),
      },
      bot: null,
    },
  };
}

export function pickRandomOpponentTileId(
  state: PreGameDrawState,
  rng: Rng = Math.random,
): string {
  const pickable = getPickableTileIds(state);
  if (pickable.length === 0) {
    throw new Error('No tiles remain for opponent pick');
  }
  const index = Math.floor(rng() * pickable.length);
  return pickable[index]!;
}

export function applyOpponentPick(state: PreGameDrawState, tileId: string): PreGameDrawState {
  if (state.phase !== 'pick-opponent') {
    throw new Error(`Cannot pick opponent tile while phase is ${state.phase}`);
  }
  if (!state.currentRound.you) {
    throw new Error('Player pick is required before opponent pick');
  }

  const slot = findSlot(state, tileId);
  if (!slot || slot.outOfPlay || slot.revealed) {
    throw new Error(`Tile ${tileId} is not available to pick`);
  }

  const tiles = state.tiles.map((entry) =>
    entry.id === tileId ? { ...entry, revealed: true } : entry,
  );
  const picked = findSlot({ ...state, tiles }, tileId)!;
  const botPick: PreGameDrawRoundPick = {
    player: 'bot',
    tileId,
    tile: { low: picked.tile.low, high: picked.tile.high },
    pipSum: tilePipSum(picked.tile),
  };

  const youPick = state.currentRound.you;
  const comparison = comparePreGameDrawTiles(youPick.tile, botPick.tile);
  if (comparison === 0) {
    return {
      ...state,
      phase: 'pick-opponent',
      tiles,
      currentRound: { you: youPick, bot: botPick },
      winner: null,
      remainingDeck: null,
    };
  }

  const winner: PreGameDrawPlayer = comparison > 0 ? 'you' : 'bot';
  return resolveWinner(
    { ...state, tiles, currentRound: { you: youPick, bot: botPick } },
    winner,
    tiles,
    youPick,
    botPick,
  );
}

/** Run one full draw round: player pick, then opponent pick. Useful in tests. */
export function simulateDrawRound(
  state: PreGameDrawState,
  playerTileId: string,
  opponentTileId: string,
): PreGameDrawState {
  const afterOpponent = applyOpponentPick(applyPlayerPick(state, playerTileId), opponentTileId);
  return isTieHoldState(afterOpponent) ? commitTieRedraw(afterOpponent) : afterOpponent;
}
