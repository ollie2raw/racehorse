/**
 * Compile-time drift guard for shapes shared between client and server.
 *
 * These types are declared once in @racehorse/game-core's dtoContracts
 * module and imported (not re-declared) by the client call sites below, as
 * well as by their server counterparts (server/src/rooms.ts,
 * server/src/dailyPuzzle.ts, server/src/dailyFritz.ts — see
 * server/src/contractsDrift.test.ts for the server-side half of this check).
 *
 * `expectTypeOf(...).toEqualTypeOf<...>()` / `.toExtend<...>()` are
 * type-level assertions: if the types are not structurally compatible, this
 * file fails to type-check (`npm run build` / `tsc --noEmit`), regardless of
 * whether the runtime assertion below ever executes. That's what prevents a
 * client type quietly drifting from what the server actually sends — the
 * exact bug class that motivated this wave (a client `LeaderboardEntry` with
 * `rating`/`rank` fields the server never sent).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  DailyFritzDrawWinner,
  DailyFritzSetGameNumber,
  DailyFritzSetGameResult,
  DailyFritzSetResult,
  DailyPuzzleLeaderboardEntry,
  RoomGameActionPayload,
} from '@racehorse/game-core';
import type { GameActionPayload } from './roomTransport';
import type { DailyPuzzleLeaderboardRow } from '../dailyPuzzle/types';
import type {
  DailyFritzDrawWinner as ClientDailyFritzDrawWinner,
  DailyFritzSetGameNumber as ClientDailyFritzSetGameNumber,
  DailyFritzSetGameResult as ClientDailyFritzSetGameResult,
  DailyFritzSetResult as ClientDailyFritzSetResult,
} from '../dailyFritz/api';

describe('shared DTO contracts are not locally re-declared (drift guard)', () => {
  it('room/match action payload (MOVE/PASS/DRAW): roomTransport.GameActionPayload === game-core.RoomGameActionPayload', () => {
    expectTypeOf<GameActionPayload>().toEqualTypeOf<RoomGameActionPayload>();
    expect(true).toBe(true);
  });

  it('daily puzzle leaderboard row === game-core.DailyPuzzleLeaderboardEntry', () => {
    expectTypeOf<DailyPuzzleLeaderboardRow>().toEqualTypeOf<DailyPuzzleLeaderboardEntry>();
    expect(true).toBe(true);
  });

  it('daily fritz set/game DTOs: dailyFritz/api.* is sourced from game-core.*', () => {
    expectTypeOf<ClientDailyFritzSetGameNumber>().toEqualTypeOf<DailyFritzSetGameNumber>();
    expectTypeOf<ClientDailyFritzDrawWinner>().toEqualTypeOf<DailyFritzDrawWinner>();
    expectTypeOf<ClientDailyFritzSetGameResult>().toEqualTypeOf<DailyFritzSetGameResult>();
    // Client's DailyFritzSetResult legitimately adds legacy snake_case
    // fields on top of the shared base shape, so it must extend (not equal)
    // the canonical type — but every shared field must still line up.
    expectTypeOf<ClientDailyFritzSetResult>().toExtend<DailyFritzSetResult>();
    expect(true).toBe(true);
  });
});
