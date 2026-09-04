/**
 * GC-3a (HARDENING_PLAN §7.3): compile-time drift guard for the game value types
 * that cross the client/server verification boundary.
 *
 * `client/src/types.ts` re-declares these (it is not a re-export of
 * `@racehorse/game-core`), so nothing else stops the client's `Tile` / `Move` /
 * board geometry from drifting from the engine the server replays against. If
 * any of the assertions below stop holding, `tsc -b` fails — the same mechanism
 * `server/src/contractsDriftTypes.ts` uses for the wire DTOs.
 *
 * This file is intentionally NOT `*.test.ts` so the client `tsc -b` type-checks
 * it directly. `coreTypeContracts.test.ts` also imports it for the vitest run.
 *
 * Scope note: only the seven leaf value types are asserted here. `GameState` /
 * `Move` / `Config` are deliberately looser on the client (`handCounts`, minimal
 * `config`, non-discriminated `Move`) — reconciling those is GC-3b, a separate
 * effort, not this guard.
 */
import { expectTypeOf } from 'expect-type';
import type {
  BoardState as CoreBoardState,
  BranchArm as CoreBranchArm,
  HubDouble as CoreHubDouble,
  PlacedTile as CorePlacedTile,
  PlacementPosition as CorePlacementPosition,
  Tile as CoreTile,
  TileOrientation as CoreTileOrientation,
} from '@racehorse/game-core';
import type {
  BoardState as ClientBoardState,
  BranchArm as ClientBranchArm,
  HubDouble as ClientHubDouble,
  PlacedTile as ClientPlacedTile,
  PlacementPosition as ClientPlacementPosition,
  Tile as ClientTile,
  TileOrientation as ClientTileOrientation,
} from '../types';

export function assertNoClientCoreTypeDrift(): void {
  expectTypeOf<ClientTile>().toEqualTypeOf<CoreTile>();
  expectTypeOf<ClientTileOrientation>().toEqualTypeOf<CoreTileOrientation>();
  expectTypeOf<ClientPlacementPosition>().toEqualTypeOf<CorePlacementPosition>();
  expectTypeOf<ClientPlacedTile>().toEqualTypeOf<CorePlacedTile>();
  expectTypeOf<ClientBranchArm>().toEqualTypeOf<CoreBranchArm>();
  expectTypeOf<ClientHubDouble>().toEqualTypeOf<CoreHubDouble>();
  expectTypeOf<ClientBoardState>().toEqualTypeOf<CoreBoardState>();
}
