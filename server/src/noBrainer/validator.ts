import { applyMove, createInitialState, getLegalMoves, startNewHand } from '../game/engine';
import type { Config, GameState, Move, PlayMove, Tile } from '../game/types';
import { isDouble, tileEquals } from '../game/types';

export interface NoBrainerValidationResult {
  ok: boolean;
  line?: Move[];
  reason?: string;
}

const YOU_ID = 'you';
const OPP_ID = 'opp';

function tileKey(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;
}

function buildFullSet(maxPips: number): Tile[] {
  const out: Tile[] = [];
  for (let high = 0; high <= maxPips; high++) {
    for (let low = 0; low <= high; low++) {
      out.push({ low, high });
    }
  }
  return out;
}

function removeTileOnce(tiles: Tile[], tile: Tile): boolean {
  const idx = tiles.findIndex((t) => tileEquals(t, tile));
  if (idx < 0) return false;
  tiles.splice(idx, 1);
  return true;
}

function buildInjectedStartState(handTiles: Tile[], cfg?: Partial<Config>) {
  const initial = createInitialState([YOU_ID, OPP_ID], cfg);
  const dealt = startNewHand(initial);
  const config = dealt.config;

  const hand = handTiles.map((t) => ({ low: Math.min(t.low, t.high), high: Math.max(t.low, t.high) }));
  if (hand.length !== config.tilesPerPlayer) {
    return { ok: false as const, reason: `Expected ${config.tilesPerPlayer} tiles, got ${hand.length}.` };
  }

  const remaining = buildFullSet(config.maxPips);
  for (const tile of hand) {
    if (!removeTileOnce(remaining, tile)) {
      return { ok: false as const, reason: `Hand contains invalid/duplicate tile ${tileKey(tile)}.` };
    }
  }

  const opponentHand = remaining.slice(0, config.tilesPerPlayer);
  const rest = remaining.slice(config.tilesPerPlayer);
  const deadCount = Math.max(0, Math.min(config.deadTileCount, rest.length));
  const boneyardCount = rest.length - deadCount;
  const boneyard = rest.slice(0, boneyardCount);
  const deadTiles = rest.slice(boneyardCount);

  const youIndex = dealt.playerIds.indexOf(YOU_ID);
  if (youIndex < 0) {
    return { ok: false as const, reason: 'Unable to identify player "you" in fresh state.' };
  }

  const injected = {
    ...dealt,
    players: {
      ...dealt.players,
      [YOU_ID]: { ...dealt.players[YOU_ID], hand },
      [OPP_ID]: { ...dealt.players[OPP_ID], hand: opponentHand },
    },
    boneyard,
    deadTiles,
    currentPlayerIndex: youIndex,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
  };

  return { ok: true as const, state: injected };
}

export function isNoBrainerHand(
  handTiles: Tile[],
  cfg?: Partial<Config>,
): NoBrainerValidationResult {
  const injected = buildInjectedStartState(handTiles, cfg);
  if (!injected.ok) return { ok: false, reason: injected.reason };

  const start = injected.state;
  const youIndex = start.playerIds.indexOf(YOU_ID);

  const dfs = (state: GameState, depth: number, line: Move[]): Move[] | null => {
    const currentId = state.playerIds[state.currentPlayerIndex];
    if (currentId !== YOU_ID) return null;

    if (depth === 7) {
      return state.handOver && state.players[YOU_ID].hand.length === 0 ? line : null;
    }

    const legal = getLegalMoves(state, YOU_ID).filter((m): m is PlayMove => m.type === 'play');
    if (legal.length === 0) return null;

    for (const move of legal) {
      let next;
      try {
        next = applyMove(state, YOU_ID, move).state;
      } catch {
        continue;
      }

      const scoreDelta = (next.players[YOU_ID]?.score ?? 0) - (state.players[YOU_ID]?.score ?? 0);
      const scoringOrDouble = scoreDelta > 0 || isDouble(move.tile);

      if (depth < 6) {
        if (!scoringOrDouble) continue;
        if (next.players[YOU_ID].hand.length === 0) continue;
        if (next.currentPlayerIndex !== youIndex) continue;
      } else {
        if (!(next.handOver && next.players[YOU_ID].hand.length === 0)) continue;
      }

      const nextLine = [...line, move];
      if (depth === 6) return nextLine;

      const solved = dfs(next, depth + 1, nextLine);
      if (solved) return solved;
    }

    return null;
  };

  const line = dfs(start, 0, []);
  if (line) return { ok: true, line };

  return {
    ok: false,
    reason:
      'No valid 7-play line found where plays 1-6 are scoring-or-double and player goes out before opponent turn.',
  };
}
