export {
  FRITZ_ELITE_ID,
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
  FRITZ_TIERS,
  FRITZ_TIER_PVF_COLORS,
} from './fritzConfig.ts';
export type { FritzTier } from './fritzConfig.ts';
export {
  chooseBotMove,
  toBotVisibleState,
} from './botHeuristics.ts';
export type {
  BotChoice,
  BotDifficulty,
} from './botHeuristics.ts';