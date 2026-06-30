import { describe, expect, it } from 'vitest';
import { createInitialState, startNewHand } from '../game/engine';
import {
  assertTileCountInvariant,
  collectTileAccountingViolations,
} from '../game/invariants';
import { getHandCounts, maskStateForRecipient } from './roomSession';

describe('hand masking security', () => {
  it('masks opponent hands during active play', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    expect(state.handOver).toBe(false);
    expect(state.gameOver).toBe(false);
    expect(state.players.playerA.hand.length).toBeGreaterThan(0);
    expect(state.players.playerB.hand.length).toBeGreaterThan(0);

    const forA = maskStateForRecipient(state, 'playerA');
    const forB = maskStateForRecipient(state, 'playerB');

    expect(forA.players.playerA.hand.length).toBeGreaterThan(0);
    expect(forA.players.playerB.hand).toEqual([]);
    expect(forB.players.playerB.hand.length).toBeGreaterThan(0);
    expect(forB.players.playerA.hand).toEqual([]);

    const counts = getHandCounts(state);
    expect(counts.playerA).toBe(state.players.playerA.hand.length);
    expect(counts.playerB).toBe(state.players.playerB.hand.length);
  });

  it('masks boneyard and deadTiles during active play', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    expect(state.boneyard.length).toBeGreaterThan(0);
    expect(state.deadTiles.length).toBeGreaterThan(0);

    const forA = maskStateForRecipient(state, 'playerA');
    expect(forA.boneyard.length).toBe(state.boneyard.length);
    expect(forA.deadTiles.length).toBe(state.deadTiles.length);

    // Verify all boneyard and deadTiles items are anonymized
    expect(forA.boneyard.every(tile => tile.high === -1 && tile.low === -1)).toBe(true);
    expect(forA.deadTiles.every(tile => tile.high === -1 && tile.low === -1)).toBe(true);
  });

  it('reveals all hands on handOver before gameOver ends', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    state.handOver = true;
    state.gameOver = false;

    const forA = maskStateForRecipient(state, 'playerA');
    expect(forA.players.playerA.hand.length).toBeGreaterThan(0);
    expect(forA.players.playerB.hand.length).toBeGreaterThan(0);
  });

  it('reveals all hands on gameOver', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    state.handOver = true;
    state.gameOver = true;
    state.winnerId = 'playerA';

    const forA = maskStateForRecipient(state, 'playerA');
    expect(forA.players.playerA.hand.length).toBeGreaterThan(0);
    expect(forA.players.playerB.hand.length).toBeGreaterThan(0);
  });

  it('spectator snapshot hides all hands during active play', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    const spectator = maskStateForRecipient(state, null);
    expect(spectator.players.playerA.hand).toEqual([]);
    expect(spectator.players.playerB.hand).toEqual([]);
  });
});

describe('assertTileCountInvariant', () => {
  it('passes on a freshly dealt hand', () => {
    const state = startNewHand(createInitialState(['playerA', 'playerB']));
    expect(() => assertTileCountInvariant(state, 'test')).not.toThrow();
    expect(collectTileAccountingViolations(state)).toEqual([]);
  });
});
