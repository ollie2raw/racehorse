import { describe, expect, it } from 'vitest';
import {
  deriveFritzRatingDisplayState,
  resolveFritzProfilePatchRating,
} from './fritzRatingDisplayState';

const PREDICTION = { glickoRating: 820, glickoDelta: 20 };

describe('deriveFritzRatingDisplayState — confirm only after ghostResult', () => {
  it('1. prediction alone → confirmed false, syncing true, no profile patch source', () => {
    const state = deriveFritzRatingDisplayState({
      isGhostMode: false,
      ghostResult: null,
      predictedFritzGlicko: PREDICTION,
      ghostResultLoading: true,
      matchStartGlickoRating: 800,
    });

    expect(state.hasConfirmedFritzRatingUpdate).toBe(false);
    expect(state.showFritzRatingSyncing).toBe(true);
    // Prediction may still be exposed for UI, but overlay uses syncing while pending.
    expect(state.fritzNewGlickoRating).toBe(820);
    expect(resolveFritzProfilePatchRating(null)).toBeNull();
  });

  it('2. server ghostResult matching prediction → confirmed true, profile uses server value', () => {
    const ghostResult = { glickoRating: 820, glickoDelta: 20 };
    const state = deriveFritzRatingDisplayState({
      isGhostMode: false,
      ghostResult,
      predictedFritzGlicko: PREDICTION,
      ghostResultLoading: false,
      matchStartGlickoRating: 800,
    });

    expect(state.hasConfirmedFritzRatingUpdate).toBe(true);
    expect(state.showFritzRatingSyncing).toBe(false);
    expect(state.fritzNewGlickoRating).toBe(820);
    expect(state.fritzGlickoDelta).toBe(20);
    expect(resolveFritzProfilePatchRating(ghostResult)).toBe(820);
  });

  it('3. server ghostResult diverges from prediction → profile + display use server, not prediction', () => {
    const ghostResult = { glickoRating: 805, glickoDelta: 5 };
    const state = deriveFritzRatingDisplayState({
      isGhostMode: false,
      ghostResult,
      predictedFritzGlicko: PREDICTION,
      ghostResultLoading: false,
      matchStartGlickoRating: 800,
    });

    expect(state.hasConfirmedFritzRatingUpdate).toBe(true);
    expect(state.showFritzRatingSyncing).toBe(false);
    expect(state.fritzNewGlickoRating).toBe(805);
    expect(state.fritzGlickoDelta).toBe(5);
    expect(state.fritzNewGlickoRating).not.toBe(PREDICTION.glickoRating);
    expect(resolveFritzProfilePatchRating(ghostResult)).toBe(805);
    expect(resolveFritzProfilePatchRating(ghostResult)).not.toBe(PREDICTION.glickoRating);
  });

  it('loading with no prediction yet is still syncing / unconfirmed', () => {
    const state = deriveFritzRatingDisplayState({
      isGhostMode: false,
      ghostResult: null,
      predictedFritzGlicko: null,
      ghostResultLoading: true,
      matchStartGlickoRating: 800,
    });
    expect(state.hasConfirmedFritzRatingUpdate).toBe(false);
    expect(state.showFritzRatingSyncing).toBe(true);
  });
});
