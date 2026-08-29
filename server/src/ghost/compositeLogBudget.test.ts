import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_LOG_STATE_BUDGET_BYTES,
  capCompositeLogStates,
} from './service';
import type { GhostCompositeLog, GhostCompositeState } from './service';

/**
 * Production shape: `boardState` runs ~800 chars at the median and is repeated
 * verbatim inside `key`, so a single state costs ~2.2 KB. The heaviest live
 * profile carries 1,190 of them — a 2.6 MB response on every profile fetch.
 */
function makeState(turn: number, count: number, boardChars = 800): GhostCompositeState {
  const boardState = `board:${'x'.repeat(boardChars)}:${turn}`;
  return {
    key: `${turn}::${boardState}`,
    turn,
    boardState,
    recommendedMove: { tilePlayed: '6|6', branch: 'left', count, bestScoreDelta: 2 },
    candidates: [{ tilePlayed: '6|6', branch: 'left', count, bestScoreDelta: 2 }],
  };
}

function makeLog(states: GhostCompositeState[]): GhostCompositeLog {
  return {
    generatedAt: '2026-08-29T00:00:00.000Z',
    sourceGameIds: ['g1', 'g2', 'g3'],
    states,
    recentGameStyles: [],
  };
}

const bytes = (value: unknown) => JSON.stringify(value).length;

describe('capCompositeLogStates', () => {
  it('bounds a heavy profile to the byte budget', () => {
    const log = makeLog(Array.from({ length: 1200 }, (_, i) => makeState(i + 1, 1)));
    expect(bytes(log.states)).toBeGreaterThan(2_000_000);

    const capped = capCompositeLogStates(log);
    expect(bytes(capped!.states)).toBeLessThanOrEqual(COMPOSITE_LOG_STATE_BUDGET_BYTES);
  });

  it('stays bounded however large the input grows', () => {
    for (const n of [1_200, 5_000, 20_000]) {
      const capped = capCompositeLogStates(
        makeLog(Array.from({ length: n }, (_, i) => makeState(i + 1, 1))),
      );
      expect(bytes(capped!.states)).toBeLessThanOrEqual(COMPOSITE_LOG_STATE_BUDGET_BYTES);
    }
  });

  it('leaves a small profile completely untouched', () => {
    const log = makeLog([makeState(1, 3), makeState(2, 1)]);
    expect(capCompositeLogStates(log)).toEqual(log);
  });

  it('keeps the states most likely to be matched again', () => {
    // A rare deep state ranked below a frequently repeated opening state.
    const rare = makeState(40, 1);
    const common = makeState(1, 25);
    const capped = capCompositeLogStates(makeLog([rare, common]), 3_000);
    expect(capped!.states.map((s) => s.turn)).toEqual([1]);
  });

  it('preserves every field the diagnostics panel reads', () => {
    const log = makeLog(Array.from({ length: 1200 }, (_, i) => makeState(i + 1, 1)));
    const capped = capCompositeLogStates(log)!;
    expect(capped.generatedAt).toBe(log.generatedAt);
    expect(capped.sourceGameIds).toEqual(log.sourceGameIds);
    expect(capped.recentGameStyles).toEqual(log.recentGameStyles);
  });

  it('keeps each retained state structurally intact for the ghost bot', () => {
    const capped = capCompositeLogStates(
      makeLog(Array.from({ length: 1200 }, (_, i) => makeState(i + 1, 2))),
    )!;
    expect(capped.states.length).toBeGreaterThan(0);
    for (const state of capped.states) {
      // pickCompositeMove reads exactly these two fields.
      expect(typeof state.boardState).toBe('string');
      expect(Array.isArray(state.candidates)).toBe(true);
      expect(state.candidates.length).toBeGreaterThan(0);
    }
  });

  it('passes null through', () => {
    expect(capCompositeLogStates(null)).toBeNull();
  });

  it('never emits a partial state to stay under budget', () => {
    const capped = capCompositeLogStates(
      makeLog(Array.from({ length: 50 }, (_, i) => makeState(i + 1, 1))),
      5_000,
    )!;
    for (const state of capped.states) {
      expect(state.boardState.length).toBe(makeState(1, 1).boardState.length);
    }
  });
});
