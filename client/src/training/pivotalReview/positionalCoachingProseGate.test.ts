import { describe, expect, it } from 'vitest';
import { POST_GAME_REVIEW_VISIBLE, REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } from '../../appRouteTypes';
import type { ReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../analyzer/reviewCoachingProse';
import {
  isBotPostGameReviewLocallyEligible,
  isPositionalCoachingProseEnabled,
  isPostGameReviewEnabled,
} from './postGameReviewPolicy';

const fritzMatch = {
  mode: 'bot',
  isGhostMode: false,
  isDailyFritzMode: false,
  isGuidedMode: false,
  isAuthoringMode: false,
  isAuthoringV2Mode: false,
  isGuidedV2Mode: false,
  isJourneyTrial: false,
} as const;

function sampleFacts(): ReviewCoachingFacts {
  return {
    played: {
      action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'right' },
      immediatePoints: 0,
    },
    best: {
      action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'left' },
      immediatePoints: 0,
    },
    referenceSource: 'oracle',
    missKind: 'same_tile_wrong_end',
    deltas: {
      immediatePoints: 0,
      expectedPointDifferential: 1.2,
      referenceExpectedPointDifferential: 1.2,
    },
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    principalVariation: [],
    featureDeltas: [
      { feature: 'opponentOutsLeft', playedValue: 5, referenceValue: 2, delta: -3 },
    ],
  };
}

describe('Gate 4 positional coaching prose cohort gate', () => {
  it('A: cohort=true + public review switch=true → positional prose enabled', () => {
    expect(POST_GAME_REVIEW_VISIBLE).toBe(true);
    expect(REVIEW_POSITIONAL_EXPLANATIONS_ENABLED).toBe(true);
    expect(isPostGameReviewEnabled(true)).toBe(true);
    expect(isPositionalCoachingProseEnabled(true)).toBe(true);
  });

  it('B: cohort=false + public review switch=true → positional prose disabled', () => {
    expect(POST_GAME_REVIEW_VISIBLE).toBe(true);
    expect(isPositionalCoachingProseEnabled(false)).toBe(false);
  });

  it('C/D: loading/failure/guest (unresolved cohort) → positional prose disabled', () => {
    // usePostGameReviewAccess returns false until a successful same-user response.
    expect(isPositionalCoachingProseEnabled(false)).toBe(false);
  });

  it('E: locally available non-cohort review stays usable without new positional prose', () => {
    expect(isBotPostGameReviewLocallyEligible({ ...fritzMatch, serverCohortEnabled: false })).toBe(true);
    expect(isPositionalCoachingProseEnabled(false)).toBe(false);
    const legacy = buildReviewCoachingProse(sampleFacts(), false);
    const approved = buildReviewCoachingProse(sampleFacts(), true);
    expect(legacy).not.toEqual(approved);
    expect(legacy.headline).not.toMatch(/matching replies|engines disagree/i);
  });

  it('H: #298 voice output unchanged when positional enable is true', () => {
    const prose = buildReviewCoachingProse(sampleFacts(), true);
    expect(prose.headline.length).toBeGreaterThan(0);
    expect(`${prose.headline} ${prose.detail}`).toMatch(/matching replies|leaves your opponent/i);
  });

  it('I: positional gate takes only the server cohort boolean (no client allowlist)', () => {
    // Cohort membership stays on `/api/game-reviews/access`; this helper never
    // accepts user IDs or POST_GAME_REVIEW_COHORT_USER_IDS.
    expect(isPositionalCoachingProseEnabled(true)).toBe(true);
    expect(isPositionalCoachingProseEnabled(false)).toBe(false);
  });

  it('J: public rollout knobs unchanged (visibility still separate from prose gate)', () => {
    expect(POST_GAME_REVIEW_VISIBLE).toBe(true);
    expect(isPostGameReviewEnabled(false)).toBe(false);
    expect(isBotPostGameReviewLocallyEligible(fritzMatch)).toBe(true);
  });
});
