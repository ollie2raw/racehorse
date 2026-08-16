/**
 * Compile-time drift guard for shapes shared between client and server.
 *
 * These types are declared once in @racehorse/game-core's dtoContracts
 * module and re-exported (not re-declared) by both server/src/rooms.ts,
 * server/src/dailyPuzzle.ts, server/src/dailyFritz.ts and their client-side
 * counterparts (client/src/multiplayer/roomTransport.ts,
 * client/src/dailyPuzzle/types.ts, client/src/dailyFritz/api.ts).
 *
 * `expectTypeOf(...).toEqualTypeOf<...>()` is a type-level assertion: if the
 * two types are not structurally identical, this file fails to type-check.
 *
 * IMPORTANT: this file intentionally is NOT named `*.test.ts` — the server's
 * tsconfig.json excludes `**\/*.test.ts` from `tsc -p tsconfig.json` (the
 * `npm run build` step), so a check living only in a `.test.ts` file would
 * never actually run through the compiler during a build and could drift
 * silently. Naming it `contractsDriftTypes.ts` means `npm run build --prefix
 * server` type-checks it directly — that's what actually prevents the bug
 * class this wave targets (a client type quietly drifting from what the
 * server sends, e.g. the historical `LeaderboardEntry` with `rating`/`rank`
 * fields the server never sent). contractsDrift.test.ts imports this module
 * so it also runs as part of the normal vitest suite.
 */
// Imported from `expect-type` directly (the library vitest's own
// `expectTypeOf` re-exports) rather than from `vitest`, so this module has
// no runtime dependency on the test framework — only on a small type-level
// assertion helper.
import { expectTypeOf } from 'expect-type';
import type {
  DailyFritzDrawWinner,
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
  DailyPuzzleAttempt,
  DailyPuzzleLeaderboardEntry,
  DailyPuzzleSlot,
  DailyPuzzleSlotResult,
  RoomGameActionPayload,
} from '@racehorse/game-core';
import type { ActionPayload } from './rooms';
import type {
  DailyPuzzleAttempt as ServerDailyPuzzleAttempt,
  DailyPuzzleLeaderboardEntry as ServerDailyPuzzleLeaderboardEntry,
  DailyPuzzleSlot as ServerDailyPuzzleSlot,
  DailyPuzzleSlotResult as ServerDailyPuzzleSlotResult,
} from './dailyPuzzle';
import type {
  DailyFritzDrawWinner as ServerDailyFritzDrawWinner,
  DailyFritzSetGameNumber as ServerDailyFritzSetGameNumber,
  DailyFritzSetGameResult as ServerDailyFritzSetGameResult,
  DailyFritzSetResult as ServerDailyFritzSetResult,
} from './dailyFritz';

export function assertNoServerContractDrift(): void {
  // Room/match action payload (MOVE / PASS / DRAW).
  expectTypeOf<ActionPayload>().toEqualTypeOf<RoomGameActionPayload>();

  // Daily puzzle ladder DTOs.
  expectTypeOf<ServerDailyPuzzleSlot>().toEqualTypeOf<DailyPuzzleSlot>();
  expectTypeOf<ServerDailyPuzzleSlotResult>().toEqualTypeOf<DailyPuzzleSlotResult>();
  expectTypeOf<ServerDailyPuzzleAttempt>().toEqualTypeOf<DailyPuzzleAttempt>();
  expectTypeOf<ServerDailyPuzzleLeaderboardEntry>().toEqualTypeOf<DailyPuzzleLeaderboardEntry>();

  // Daily fritz set/game DTOs.
  expectTypeOf<ServerDailyFritzSetGameNumber>().toEqualTypeOf<DailyFritzSetGameNumber>();
  expectTypeOf<ServerDailyFritzDrawWinner>().toEqualTypeOf<DailyFritzDrawWinner>();
  expectTypeOf<ServerDailyFritzSetGameResult>().toEqualTypeOf<DailyFritzSetGameResult>();
  // DailyFritzSetResult itself is the canonical shape (server does not add
  // the client's legacy snake_case fields), so it must equal exactly.
  expectTypeOf<ServerDailyFritzSetResult>().toEqualTypeOf<DailyFritzSetResult>();
}
