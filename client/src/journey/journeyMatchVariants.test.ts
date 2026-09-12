// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getJourneyMatchVariant, JOURNEY_MATCH_VARIANTS } from './journeyMatchVariants';

describe('journeyMatchVariants', () => {
  it('looks up a registered variant by id', () => {
    const variant = getJourneyMatchVariant('handicap-underdog-blowout');
    expect(variant).not.toBeNull();
    expect(variant!.id).toBe('handicap-underdog-blowout');
    expect(variant!.scoreHandicap).toEqual({ you: 0, bot: 15 });
  });

  it('returns null for an unknown variant id', () => {
    expect(getJourneyMatchVariant('does-not-exist')).toBeNull();
  });

  it('every registered variant carries its own id as the map key', () => {
    for (const [key, variant] of Object.entries(JOURNEY_MATCH_VARIANTS)) {
      expect(variant.id).toBe(key);
    }
  });

  it('exposes a no-draw-pile variant using dealSize 14', () => {
    const variant = getJourneyMatchVariant('no-draw-pile-standard');
    expect(variant!.dealSize).toBe(14);
  });

  it('exposes a blocked-hand-rule variant', () => {
    const variant = getJourneyMatchVariant('no-score-blocked-hands');
    expect(variant!.blockedHandRule).toBe('noScore');
    expect(variant!.endHandBonus).toBe('none');
  });

  it('exposes an alternate-scoring-multiple variant', () => {
    const variant = getJourneyMatchVariant('all-fives-scoring');
    expect(variant!.scoringMultiple).toBe(1);
  });
});
