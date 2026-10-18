import { DEFAULT_CONFIG, type Config } from '@racehorse/game-core';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

/**
 * The engine config a review search must simulate with: the ruleset the reviewed game was ACTUALLY played under.
 *
 * Fresh captures store it (`snapshot.rulesetConfig`, covered by the position hash). Every solver used to rebuild its config
 * from `DEFAULT_CONFIG` plus `maxPips`/`winningScore`, silently dropping the stored scoring multiple, blocked-hand rule and
 * end-of-hand bonus: a game played under any other rules was evaluated under the defaults, so values, the recommended move
 * and the loss were wrong. Historical captures without `rulesetConfig` fall back to the defaults, as before.
 */
export function resolveReviewConfig(snapshot: ReviewPositionSnapshotV2, maxPipsFallback = 6): Config {
  const rules = snapshot.rulesetConfig;
  return {
    ...DEFAULT_CONFIG,
    maxPips: rules?.maxPips ?? maxPipsFallback,
    ...(rules
      ? {
          tilesPerPlayer: rules.tilesPerPlayer,
          deadTileCount: rules.deadTileCount,
          scoringMultiple: rules.scoringMultiple,
          blockedHandRule: rules.blockedHandRule,
          endHandBonus: rules.endHandBonus,
          skipPregameDraw: rules.skipPregameDraw,
        }
      : {}),
    winningScore: snapshot.preAction.winningTarget,
  };
}
