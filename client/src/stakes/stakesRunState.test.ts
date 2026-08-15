import { describe, it, expect } from 'vitest';
import { stakesReducer, INITIAL_STAKES_STATE } from './stakesRunState';


describe('Stakes Run Reducer', () => {
  it('should handle START_RUN action', () => {
    const state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test-seed' });
    expect(state.seed).toBe('test-seed');
    expect(state.currentPurse).toBe(500);
    expect(state.currentStage).toBe(1);
    expect(state.phase).toBe('offer');
    expect(state.offers.length).toBe(2);
  });

  it('should handle CHOOSE_OFFER action', () => {
    let state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test-seed' });
    const offer = state.offers[0];
    state = stakesReducer(state, { type: 'CHOOSE_OFFER', offerId: offer.id });
    expect(state.selectedOffer).toBe(offer);
    expect(state.phase).toBe('table_active');
    expect(state.currentPurse).toBe(500 - offer.entry);
  });

  it('should handle SETTLE_HAND and transition to settlement', () => {
    let state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test-seed' });
    const offer = state.offers[0]; // s1_safe, entry=60, return=120, contract=firstBlood, bonus=30
    state = stakesReducer(state, { type: 'CHOOSE_OFFER', offerId: offer.id });

    // Settle win with contract complete
    state = stakesReducer(state, {
      type: 'SETTLE_HAND',
      result: {
        won: true,
        scoreMargin: 10,
        youGoOut: true,
        botPassCount: 1,
        youScoreFirst: true,
        youScore: 25,
        botScore: 15,
      },
    });

    expect(state.phase).toBe('settlement');
    expect(state.currentPurse).toBe(500 - offer.entry + offer.baseReturn + offer.contractBonus);
    expect(state.settlementHistory.length).toBe(1);
    expect(state.settlementHistory[0].contractCompleted).toBe(true);
  });

  it('should handle PROCEED_FROM_SETTLEMENT from stage 1 to stage 2', () => {
    let state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test-seed' });
    const offer = state.offers[0];
    state = stakesReducer(state, { type: 'CHOOSE_OFFER', offerId: offer.id });
    state = stakesReducer(state, {
      type: 'SETTLE_HAND',
      result: {
        won: true,
        scoreMargin: 10,
        youGoOut: true,
        botPassCount: 1,
        youScoreFirst: true,
        youScore: 25,
        botScore: 15,
      },
    });

    state = stakesReducer(state, { type: 'PROCEED_FROM_SETTLEMENT' });
    expect(state.currentStage).toBe(2);
    expect(state.phase).toBe('offer');
    expect(state.offers.length).toBe(2);
  });

  it('should handle DECIDE_CASH_OUT bank decision', () => {
    // Jump straight to cash out
    let state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test-seed' });
    state = stakesReducer(state, { type: 'DEV_JUMP_TO_CASH_OUT' });
    expect(state.phase).toBe('cash_out_decision');

    // Bank it
    state = stakesReducer(state, { type: 'DECIDE_CASH_OUT', action: 'bank' });
    expect(state.phase).toBe('results');
    expect(state.banked).toBe(true);
    expect(state.busted).toBe(false);
  });

  it('should handle RESET_RUN action', () => {
    let state = stakesReducer(INITIAL_STAKES_STATE, { type: 'START_RUN', seed: 'test' });
    state = stakesReducer(state, { type: 'RESET_RUN' });
    expect(state).toEqual(INITIAL_STAKES_STATE);
  });
});
