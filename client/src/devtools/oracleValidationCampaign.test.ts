import { describe, expect, it } from 'vitest';
import { compareMasterScores, d1Result, moveDivergence, sampleStats } from './oracleValidationCampaign.ts';
import type { GameResult } from './oracleVsFritzHeadToHead.ts';

function game(index: number, score: number, winnerPolicy: GameResult['winnerPolicy'] = 'draw'): GameResult {
  return { gameIndex: index, seed: 'fixed', fritzSeat: 'bot', seatAssignment: { bot: 'fritz-master', you: 'oracle-top-move' },
    winnerPolicy, finalScore: { 'fritz-master': score, 'oracle-top-move': 100 }, handCount: 1,
    decisionCount: 1, decisions: [], finalStateDigest: 'terminal',
    replayTrace: [{ decisionIndex: 1, stateDigest: `position-${index}`, actor: 'bot', action: { kind: 'pass' }, masterConsulted: true, publicEvidenceCount: 0 }] };
}

describe('F1 experiment decision rules', () => {
  it('uses the baseline between-seed SEM without post-result tuning', () => {
    expect(sampleStats([0, 2]).standardError).toBe(1);
    expect(compareMasterScores([game(0, 0), game(1, 2)], [game(0, 1), game(1, 3)]).passed).toBe(true);
    expect(compareMasterScores([game(0, 0), game(1, 2)], [game(0, 2), game(1, 4)]).passed).toBe(false);
    expect(() => compareMasterScores([game(0, 0)], [game(1, 0)])).toThrow(/identical ordered seeds/);
  });

  it('counts same-position move differences and exposes unmatched downstream positions', () => {
    const first = [game(0, 0), game(1, 0)];
    const second = structuredClone(first);
    second[0] = { ...second[0], replayTrace: [{ ...second[0].replayTrace[0], action: { kind: 'draw' } }] };
    second[1] = { ...second[1], replayTrace: [{ ...second[1].replayTrace[0], stateDigest: 'diverged-path' }] };
    expect(moveDivergence(first, second)).toMatchObject({ comparable: 1, different: 1, divergenceRate: 1, unmatchedFirst: 1, unmatchedSecond: 1 });
  });

  it('applies D1 to win-rate difference with draws contributing zero', () => {
    expect(d1Result([game(0, 0, 'oracle-top-move'), game(1, 0, 'fritz-master')]).branch).toBe('indistinguishable');
    expect(d1Result(Array.from({ length: 40 }, (_, index) => game(index, 0, 'oracle-top-move'))).branch).toBe('oracle-stronger-search-authoritative');
    expect(d1Result(Array.from({ length: 40 }, (_, index) => game(index, 0, 'fritz-master'))).branch).toBe('fritz-stronger-block-F2-prose');
    expect(d1Result([game(0, 0)]).winRateDifference.mean).toBe(0);
  });
});
