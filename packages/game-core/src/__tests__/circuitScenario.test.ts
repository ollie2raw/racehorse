import { describe, expect, it } from 'vitest';
import {
  createCircuitPositionState,
  listLegalCircuitPlays,
  validateCircuitScenario,
  type CircuitSingleGateScenario,
} from '../circuitScenario';

function tile(low: number, high: number) {
  return { low, high };
}

function mainBoard(
  tiles: Array<{ low: number; high: number; orientation?: 'horizontal-normal' | 'horizontal-flipped' }>,
  leftEnd: number,
  rightEnd: number,
) {
  return {
    mainLine: tiles.map((t) => ({
      tile: tile(t.low, t.high),
      orientation: t.orientation ?? 'horizontal-normal',
    })),
    leftEnd,
    rightEnd,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [] as const,
  };
}

const classifications = {
  optimal: { tile: tile(0, 5), position: 'left' as const },
  strong: [{ tile: tile(4, 5), position: 'right' as const }],
  inaccurate: [] as const,
  blunder: [] as const,
};

const validScenario: CircuitSingleGateScenario = {
  schemaVersion: 2,
  kind: 'single_gate',
  id: 'circuit:test:scoring-15',
  certification: 'certified',
  difficulty: 1,
  categories: ['scoring'],
  title: 'Take the count',
  prompt: 'Score now.',
  explanation: {
    optimal:
      'Play [0|5] on the 0-end to make open ends sum to 15. The right-end [4|5] scores less and leaves a weaker reply set.',
    impact: '+15',
  },
  board: mainBoard(
    [
      { low: 0, high: 3 },
      { low: 3, high: 6 },
      { low: 4, high: 6, orientation: 'horizontal-flipped' },
    ],
    0,
    4,
  ),
  playerHand: [tile(0, 5), tile(1, 2), tile(4, 5)],
  moveClassifications: classifications,
  optimalMove: classifications.optimal,
  strongAlternatives: classifications.strong,
};

describe('circuitScenario validators (schema v2)', () => {
  it('accepts a legal certified single-gate scenario with full classifications', () => {
    const result = validateCircuitScenario(validScenario);
    expect(result.ok).toBe(true);
    const state = createCircuitPositionState(validScenario);
    const legal = listLegalCircuitPlays(state);
    expect(legal.some((m) => m.tile.low === 0 && m.tile.high === 5 && m.position === 'left')).toBe(true);
  });

  it('rejects unclassified legal moves', () => {
    const bad = {
      ...validScenario,
      id: 'circuit:test:unclassified',
      moveClassifications: {
        optimal: classifications.optimal,
        strong: [] as const,
        inaccurate: [] as const,
        blunder: [] as const,
      },
      strongAlternatives: [],
    };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'unclassified_legal_move')).toBe(true);
    }
  });

  it('rejects classified moves that are not legal', () => {
    const bad = {
      ...validScenario,
      id: 'circuit:test:illegal-expected',
      moveClassifications: {
        ...classifications,
        optimal: { tile: tile(0, 5), position: 'right' as const },
      },
      optimalMove: { tile: tile(0, 5), position: 'right' as const },
    };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'classified_not_legal')).toBe(true);
    }
  });

  it('rejects duplicate classifications', () => {
    const bad = {
      ...validScenario,
      id: 'circuit:test:dup-class',
      moveClassifications: {
        optimal: classifications.optimal,
        strong: [classifications.optimal],
        inaccurate: [] as const,
        blunder: [] as const,
      },
    };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'duplicate_classification')).toBe(true);
    }
  });

  it('rejects duplicate tiles across board and hand', () => {
    const bad = {
      ...validScenario,
      id: 'circuit:test:dup-tile',
      playerHand: [tile(0, 3), tile(1, 2)],
      moveClassifications: {
        optimal: { tile: tile(1, 2), position: 'left' as const },
        strong: [] as const,
        inaccurate: [] as const,
        blunder: [] as const,
      },
      optimalMove: { tile: tile(1, 2), position: 'left' as const },
      strongAlternatives: [],
    };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'duplicate_tile')).toBe(true);
    }
  });

  it('rejects stale schema versions', () => {
    const bad = { ...validScenario, schemaVersion: 99 as 2 };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'stale_schema')).toBe(true);
    }
  });

  it('rejects vague optimal explanations', () => {
    const bad = {
      ...validScenario,
      id: 'circuit:test:vague',
      explanation: { optimal: 'is the strongest move' },
    };
    const result = validateCircuitScenario(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'vague_explanation')).toBe(true);
    }
  });
});
