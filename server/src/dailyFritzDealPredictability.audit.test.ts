/**
 * AUDIT (2026-11-17, tests-only, no production change). Documents a property,
 * it does not assert that the property is desired.
 *
 * Every Daily Fritz deal, including Fritz's hidden tiles and the boneyard
 * order, is a pure function of the PUBLIC date string and code that ships in
 * the client bundle (`createDeterministicDoubleSixDeal` from game-core, used
 * by client/src/modules/match/runtime/botEngine.ts). There is no server
 * secret in the seed. So anyone can compute today's (and any future day's)
 * full deal offline. Combined with the deterministic, server-verified Fritz
 * policy (also in the client bundle), a modified client can search for a
 * strong line before playing and submit a transcript that verifies.
 *
 * If this test starts failing because a server secret was added to the seed,
 * that is the fix landing: delete this file.
 */
import { describe, expect, it } from 'vitest';
import { createDeterministicDoubleSixDeal } from '@racehorse/game-core';
import {
  generateDailyFritzRun,
  generateSingleDailyFritzGameHand,
} from './dailyFritz';

describe('AUDIT: Daily Fritz deals are predictable from the public date alone', () => {
  const futureDate = '2027-03-14';

  it('game 1 hand 0 of a future date is reproduced with only the date string and game-core', () => {
    const run = generateDailyFritzRun(futureDate, 'elite', 7, 60);
    const attackerDeal = createDeterministicDoubleSixDeal({
      seed: `daily-fritz-${futureDate}:game:1:hand:0`,
      tilesPerPlayer: 7,
    });
    expect(run.handDeals[0]!.fritz_tiles).toEqual(attackerDeal.opponentTiles);
    expect(run.handDeals[0]!.boneyard).toEqual(attackerDeal.boneyard);
    expect(run.handDeals[0]!.player_tiles).toEqual(attackerDeal.playerTiles);
  });

  it('on-demand hands (games 2/3, hand beyond the snapshot) are equally predictable', () => {
    const serverDeal = generateSingleDailyFritzGameHand(futureDate, 3, 15, 7);
    const attackerDeal = createDeterministicDoubleSixDeal({
      seed: `daily-fritz-${futureDate}:game:3:hand:15`,
      tilesPerPlayer: 7,
    });
    expect(serverDeal.fritz_tiles).toEqual(attackerDeal.opponentTiles);
    expect(serverDeal.boneyard).toEqual(attackerDeal.boneyard);
  });
});
