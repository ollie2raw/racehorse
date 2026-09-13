// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ReviewKnownMissingPipEvidence } from '@racehorse/game-core/review';
import {
  adaptLegacyOpponentMissingEvidence,
  adaptPassOnEndBatches,
  toReviewKnownMissingPipEvidence,
  type LiveMissingPipObservation,
} from './missingPipEvidenceAdapter.ts';

describe('toReviewKnownMissingPipEvidence', () => {
  it('expands one observation into one V2 row per open-end pip (fixture corpus shape)', () => {
    const observations: LiveMissingPipObservation[] = [
      {
        actorId: 'you',
        reason: 'passed_on_open_end',
        observedHandNumber: 2,
        observedSequence: 11,
        openEnds: [3, 6],
      },
    ];

    expect(toReviewKnownMissingPipEvidence(observations)).toEqual([
      {
        opponentId: 'you',
        pip: 3,
        reason: 'passed_on_open_end',
        observedHandNumber: 2,
        observedSequence: 11,
        openEnds: [3, 6],
      },
      {
        opponentId: 'you',
        pip: 6,
        reason: 'passed_on_open_end',
        observedHandNumber: 2,
        observedSequence: 11,
        openEnds: [3, 6],
      },
    ] satisfies ReviewKnownMissingPipEvidence[]);
  });

  it('labels draw-past observations as drew_past_open_end', () => {
    const rows = toReviewKnownMissingPipEvidence([
      {
        actorId: 'bot',
        reason: 'drew_past_open_end',
        observedHandNumber: 1,
        observedSequence: 4,
        openEnds: [0],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('drew_past_open_end');
    expect(rows[0]?.opponentId).toBe('bot');
  });

  it('dedupes identical (actor, pip, reason, hand, sequence) rows and skips empty openEnds', () => {
    const observations: LiveMissingPipObservation[] = [
      {
        actorId: 'you',
        reason: 'passed_on_open_end',
        observedHandNumber: 3,
        observedSequence: 20,
        openEnds: [5, 5, 2],
      },
      {
        actorId: 'you',
        reason: 'passed_on_open_end',
        observedHandNumber: 3,
        observedSequence: 20,
        openEnds: [5, 2],
      },
      {
        actorId: 'bot',
        reason: 'drew_past_open_end',
        observedHandNumber: 3,
        observedSequence: 21,
        openEnds: [],
      },
    ];

    const rows = toReviewKnownMissingPipEvidence(observations);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.pip).sort()).toEqual([2, 5]);
  });

  it('preserves both actors when observations cover player and opponent', () => {
    const rows = toReviewKnownMissingPipEvidence([
      {
        actorId: 'you',
        reason: 'passed_on_open_end',
        observedHandNumber: 1,
        observedSequence: 2,
        openEnds: [4],
      },
      {
        actorId: 'bot',
        reason: 'drew_past_open_end',
        observedHandNumber: 1,
        observedSequence: 3,
        openEnds: [4],
      },
    ]);
    expect(new Set(rows.map((r) => r.opponentId))).toEqual(new Set(['you', 'bot']));
  });
});

describe('adaptLegacyOpponentMissingEvidence', () => {
  it('round-trips Fritz opponentMissingEvidence rows into V2 drew_past evidence', () => {
    // Live botEngine records one row per open-end pip at draw-start, sharing hand+turnIndex.
    const legacy = [
      { pip: 3, handNumber: 2, turnIndex: 9 },
      { pip: 6, handNumber: 2, turnIndex: 9 },
      { pip: 1, handNumber: 3, turnIndex: 14 },
    ];

    const rows = adaptLegacyOpponentMissingEvidence({
      opponentId: 'you',
      evidence: legacy,
    });

    expect(rows).toEqual([
      {
        opponentId: 'you',
        pip: 3,
        reason: 'drew_past_open_end',
        observedHandNumber: 2,
        observedSequence: 9,
        openEnds: [3, 6],
      },
      {
        opponentId: 'you',
        pip: 6,
        reason: 'drew_past_open_end',
        observedHandNumber: 2,
        observedSequence: 9,
        openEnds: [3, 6],
      },
      {
        opponentId: 'you',
        pip: 1,
        reason: 'drew_past_open_end',
        observedHandNumber: 3,
        observedSequence: 14,
        openEnds: [1],
      },
    ] satisfies ReviewKnownMissingPipEvidence[]);
  });

  it('returns [] for empty legacy evidence', () => {
    expect(
      adaptLegacyOpponentMissingEvidence({ opponentId: 'bot', evidence: [] }),
    ).toEqual([]);
  });
});

describe('adaptPassOnEndBatches', () => {
  it('maps pass-on-end batches into V2 passed_on_open_end evidence', () => {
    const rows = adaptPassOnEndBatches([
      {
        actorId: 'you',
        openEnds: [2, 5],
        observedHandNumber: 4,
        observedSequence: 30,
      },
    ]);
    expect(rows).toEqual([
      {
        opponentId: 'you',
        pip: 2,
        reason: 'passed_on_open_end',
        observedHandNumber: 4,
        observedSequence: 30,
        openEnds: [2, 5],
      },
      {
        opponentId: 'you',
        pip: 5,
        reason: 'passed_on_open_end',
        observedHandNumber: 4,
        observedSequence: 30,
        openEnds: [2, 5],
      },
    ] satisfies ReviewKnownMissingPipEvidence[]);
  });
});
