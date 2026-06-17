import type { Tile } from '../../types.ts';

export type PreGameDrawPlayer = 'you' | 'bot';

export type PreGameDrawPhase =
  | 'pick-player'
  | 'pick-opponent'
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

export function generateDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high++) {
    for (let low = 0; low <= high; low++) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

export function shuffleTiles(deck: readonly Tile[], rng: Rng = Math.random): Tile[] {
  const out = deck.map((tile) => ({ low: tile.low, high: tile.high }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function tilePipSum(tile: Tile): number {
  return tile.low + tile.high;
}

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

/** Both picks revealed with equal pips — tiles still on the scatter before redraw. */
export function isTieHoldState(state: PreGameDrawState): boolean {
  const { you, bot } = state.currentRound;
  return (
    state.phase === 'pick-opponent' &&
    you != null &&
    bot != null &&
    you.pipSum === bot.pipSum &&
    state.winner == null
  );
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
 * Scripted draw (Daily Fritz): player may tap any tile, but the canonical player tile
 * is fixed server-side. Reveal the tapped slot with the scripted pips so the flip
 * matches the user's touch target (not a different tile elsewhere on the scatter).
 */
export function applyScriptedPlayerPick(
  state: PreGameDrawState,
  tappedTileId: string,
  scriptedPlayerTileId: string,
  scriptedFritzTileId?: string | null,
): PreGameDrawState {
  if (
    tappedTileId === scriptedPlayerTileId ||
    (scriptedFritzTileId != null && tappedTileId === scriptedFritzTileId)
  ) {
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

  const scriptedTile = scriptedSlot.tile;
  const tiles = state.tiles.map((entry) => {
    if (entry.id === tappedTileId) {
      return {
        ...entry,
        revealed: true,
        tile: { low: scriptedTile.low, high: scriptedTile.high },
      };
    }
    if (entry.id === scriptedPlayerTileId) {
      return { ...entry, outOfPlay: true };
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
  if (youPick.pipSum === botPick.pipSum) {
    return {
      ...state,
      phase: 'pick-opponent',
      tiles,
      currentRound: { you: youPick, bot: botPick },
      winner: null,
      remainingDeck: null,
    };
  }

  const winner: PreGameDrawPlayer = youPick.pipSum > botPick.pipSum ? 'you' : 'bot';
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
