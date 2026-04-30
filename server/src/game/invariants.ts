// server/src/game/invariants.ts
//
// Minimal server-side invariant checker for authoritative multiplayer GameState.
// Called after every state-mutating action in rooms.ts and as a safety net
// inside broadcastStateUpdate in index.ts.
//
// Error policy:
//   - non-production (dev / test): throw so bugs surface immediately with a
//     full stack trace pointing to the callsite.
//   - production: console.error and return — do not crash the room; the
//     mutation has already committed and both players need a state update.

import { GameState, BoardState, Tile, totalTilesInSet } from './types';

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Internal helpers ──────────────────────────────────────────────────────

export function tileKey(tile: Tile): string {
  const lo = Math.min(tile.low, tile.high);
  const hi = Math.max(tile.low, tile.high);
  return `${lo}|${hi}`;
}

export function isValidTile(tile: Tile, maxPips: number): boolean {
  return (
    Number.isInteger(tile.low) &&
    Number.isInteger(tile.high) &&
    tile.low >= 0 &&
    tile.high >= 0 &&
    tile.low <= maxPips &&
    tile.high <= maxPips
  );
}

/**
 * Collect every physical Tile from the board.
 *
 * Counting rules:
 *  - Every PlacedTile in board.mainLine contributes one tile (this already
 *    includes hub doubles, which are tiles on the main spine).
 *  - Every PlacedTile in hubDoubles[*].branches[*].tiles contributes one tile
 *    (branch arms extend off the main line through crossed hubs).
 *  - Hub doubles are NOT counted a second time — they live in mainLine.
 *  - deadTiles are NOT counted here — they already sit inside boneyard.
 */
export function tilesOnBoard(board: BoardState | null): Tile[] {
  if (!board) return [];
  const result: Tile[] = board.mainLine.map((pt) => pt.tile);
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      for (const pt of arm.tiles) {
        result.push(pt.tile);
      }
    }
  }
  return result;
}

export function boardTileCount(board: BoardState | null): number {
  if (!board) return 0;
  let count = board.mainLine.length;
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      count += arm.tiles.length;
    }
  }
  return count;
}

// ─── Violation collector ───────────────────────────────────────────────────

/**
 * Returns a (possibly empty) array of human-readable violation strings.
 * An empty array means the state is valid.
 *
 * Total tile count formula:
 *   sum(player hand sizes) + boneyard.length + boardTileCount(board)
 *   === totalTilesInSet(config.maxPips)
 *
 * deadTiles are the protected tail of boneyard — they are already counted
 * inside boneyard.length and must NOT be added again.
 */
export function collectGameStateViolations(state: GameState): string[] {
  const v: string[] = [];

  const {
    config,
    playerIds,
    players,
    board,
    boneyard,
    deadTiles,
    currentPlayerIndex,
    handNumber,
    handOver,
    gameOver,
    winnerId,
    consecutivePasses,
    sequence,
  } = state;

  const { maxPips, deadTileCount } = config;
  const expectedTotal = totalTilesInSet(maxPips);

  // A hand has been dealt when handNumber > 0.
  // Some invariants only apply once tiles exist.
  const handActive = handNumber > 0;

  // ── sequence ─────────────────────────────────────────────────────────────
  if (!Number.isFinite(sequence) || sequence < 0) {
    v.push(`sequence must be finite and >= 0, got ${sequence}`);
  }

  // ── handNumber ────────────────────────────────────────────────────────────
  if (!Number.isFinite(handNumber) || handNumber < 0) {
    v.push(`handNumber must be finite and >= 0, got ${handNumber}`);
  }

  // ── playerIds length ──────────────────────────────────────────────────────
  if (playerIds.length < 2 || playerIds.length > 4) {
    v.push(`playerIds.length must be 2–4, got ${playerIds.length}`);
  }

  // ── every playerId has a player state ─────────────────────────────────────
  for (const id of playerIds) {
    if (!players[id]) {
      v.push(`player state missing for playerId "${id}"`);
    }
  }

  // ── currentPlayerIndex in bounds ──────────────────────────────────────────
  if (
    !Number.isInteger(currentPlayerIndex) ||
    currentPlayerIndex < 0 ||
    currentPlayerIndex >= playerIds.length
  ) {
    v.push(
      `currentPlayerIndex ${currentPlayerIndex} is out of bounds ` +
        `(playerIds.length=${playerIds.length})`,
    );
  }

  // ── current player belongs to playerIds ───────────────────────────────────
  const currentId = playerIds[currentPlayerIndex];
  if (currentId !== undefined && !players[currentId]) {
    v.push(`currentPlayer "${currentId}" (index ${currentPlayerIndex}) has no player state`);
  }

  // ── scores are finite and nonnegative ─────────────────────────────────────
  for (const id of playerIds) {
    const ps = players[id];
    if (!ps) continue;
    if (!Number.isFinite(ps.score) || ps.score < 0) {
      v.push(`player "${id}" has invalid score: ${ps.score}`);
    }
  }

  // ── pip validity helper ───────────────────────────────────────────────────
  function checkPips(tiles: readonly Tile[], label: string): void {
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!isValidTile(tile, maxPips)) {
        v.push(
          `${label}[${i}] has invalid pips {low:${tile.low}, high:${tile.high}} ` +
            `(maxPips=${maxPips})`,
        );
      }
    }
  }

  // ── pip validity across all tile pools ────────────────────────────────────
  for (const id of playerIds) {
    if (players[id]) checkPips(players[id].hand, `players["${id}"].hand`);
  }
  checkPips(boneyard, 'boneyard');
  checkPips(tilesOnBoard(board), 'board');
  checkPips(deadTiles, 'deadTiles');

  // ── hand-active tile invariants ───────────────────────────────────────────
  if (handActive) {
    // Gather: all hand tiles + all boneyard tiles + all board tiles.
    // deadTiles are a snapshot of the protected tail of boneyard — do NOT add them again.
    const allTiles: Tile[] = [];
    for (const id of playerIds) {
      if (players[id]) allTiles.push(...players[id].hand);
    }
    allTiles.push(...boneyard);
    allTiles.push(...tilesOnBoard(board));

    // INV-11: total tile count
    const total = allTiles.length;
    if (total !== expectedTotal) {
      const handTotal = allTiles.length - boneyard.length - boardTileCount(board);
      v.push(
        `tile count mismatch: expected ${expectedTotal} for double-${maxPips} set, ` +
          `got ${total} (hands=${handTotal}, boneyard=${boneyard.length}, ` +
          `board=${boardTileCount(board)})`,
      );
    }

    // INV-12: no duplicate tiles across hands + boneyard + board
    const seen = new Map<string, number>();
    for (const tile of allTiles) {
      const k = tileKey(tile);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, count] of seen) {
      if (count > 1) {
        v.push(
          `duplicate tile [${k}] appears ${count} times across hands+boneyard+board`,
        );
      }
    }

    // INV-09: deadTiles.length === config.deadTileCount
    if (deadTiles.length !== deadTileCount) {
      v.push(
        `deadTiles.length should be ${deadTileCount}, got ${deadTiles.length}`,
      );
    }

    // INV-10: boneyard.length >= deadTileCount
    if (boneyard.length < deadTileCount) {
      v.push(
        `boneyard.length ${boneyard.length} is below deadTileCount ${deadTileCount}`,
      );
    }
  }

  // ── gameOver implies handOver ──────────────────────────────────────────────
  if (gameOver && !handOver) {
    v.push('gameOver is true but handOver is false');
  }

  // ── gameOver implies winnerId exists and belongs to playerIds ─────────────
  if (gameOver) {
    if (!winnerId) {
      v.push('gameOver is true but winnerId is null');
    } else if (!playerIds.includes(winnerId)) {
      v.push(`gameOver is true but winnerId "${winnerId}" is not in playerIds`);
    }
  }

  // ── !gameOver implies winnerId is null ────────────────────────────────────
  if (!gameOver && winnerId !== null) {
    v.push(`gameOver is false but winnerId is "${winnerId}" (expected null)`);
  }

  // ── consecutivePasses is finite and valid ─────────────────────────────────
  if (!Number.isFinite(consecutivePasses) || consecutivePasses < 0) {
    v.push(`consecutivePasses must be finite and >= 0, got ${consecutivePasses}`);
  } else if (!handOver && consecutivePasses >= playerIds.length) {
    v.push(
      `consecutivePasses ${consecutivePasses} >= playerIds.length ${playerIds.length} ` +
        `but handOver is false`,
    );
  }

  return v;
}

// ─── Public assertion ──────────────────────────────────────────────────────

export function assertValidGameState(state: GameState, context = 'unknown'): void {
  const violations = collectGameStateViolations(state);
  if (violations.length === 0) return;

  const message =
    `[invariant:${context}] ${violations.length} violation(s):\n` +
    violations.map((s) => `  • ${s}`).join('\n');

  if (IS_PROD) {
    console.error(message);
  } else {
    throw new Error(message);
  }
}
