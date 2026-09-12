import type { BlockedHandRule, EndHandBonus } from '@racehorse/game-core';
import type { BotDealSize } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';

/**
 * A named, referenceable bundle of match-engine knobs — tier, deal size,
 * winning score, plus the optional rule overrides in `MatchRuleOverrides`
 * (see `client/src/modules/match/runtime/botEngine.ts`). A node references
 * one of these by `id` (`{ kind: 'botMatchVariant', variantId }`) instead of
 * hand-threading each knob as a separate action field — see
 * `docs/scoping/journey-overhaul-2026-09-12.md` §2 for why: without this,
 * every new knob becomes another prop threaded by hand through Journey's
 * node action, the resolver, `JourneyActiveChallenge`, and the route layer,
 * repeating the same dead-knob risk `trialFormat` already fell into.
 */
export interface JourneyMatchVariant {
  id: string;
  fritzTier: FritzTier;
  dealSize: BotDealSize;
  winningScore: number;
  trialFormat?: 'fullMatch' | 'shortRace';
  blockedHandRule?: BlockedHandRule;
  endHandBonus?: EndHandBonus;
  scoringMultiple?: number;
  scoreHandicap?: { you: number; bot: number };
}

/**
 * The real, zero-new-engine-work variant menu (scoping doc §2): every field
 * here already exists as a `packages/game-core` `Config` knob or a
 * `MatchRuleOverrides` field. Content authoring (docs/scoping §6, PR 6) picks
 * from — or adds to — this menu; it does not need new engine work to do so.
 */
export const JOURNEY_MATCH_VARIANTS: Record<string, JourneyMatchVariant> = {
  'standard-race': {
    id: 'standard-race',
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 35,
  },
  'no-draw-pile-standard': {
    id: 'no-draw-pile-standard',
    fritzTier: 'standard',
    dealSize: 14,
    winningScore: 60,
  },
  'handicap-underdog-blowout': {
    id: 'handicap-underdog-blowout',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 45,
    scoreHandicap: { you: 0, bot: 15 },
  },
  'no-score-blocked-hands': {
    id: 'no-score-blocked-hands',
    fritzTier: 'master',
    dealSize: 7,
    winningScore: 60,
    blockedHandRule: 'noScore',
    endHandBonus: 'none',
  },
  'all-fives-scoring': {
    id: 'all-fives-scoring',
    fritzTier: 'standard',
    dealSize: 7,
    winningScore: 60,
    scoringMultiple: 1,
  },
};

export function getJourneyMatchVariant(id: string): JourneyMatchVariant | null {
  return JOURNEY_MATCH_VARIANTS[id] ?? null;
}
