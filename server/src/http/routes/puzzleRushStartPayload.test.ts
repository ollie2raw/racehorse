/**
 * The run-start payload is the one place a leak would be fatal: shipping
 * `best_possible_score` lets a client derive optimal play without solving
 * anything, which is the entire difficulty of the mode.
 *
 * `puzzleRush.test.ts` pins the shape `selectRunPuzzles` returns; this pins
 * that the route ships exactly that and adds nothing of its own.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectRunPuzzles } from '../../puzzleRush/difficulty';
import type { PuzzlePoolEntry } from '../../puzzleRush/types';

const routeSource = readFileSync(resolve(__dirname, 'puzzleRush.ts'), 'utf8');

function startHandlerSource(): string {
  const start = routeSource.indexOf("app.post('/api/puzzle-rush/start'");
  const end = routeSource.indexOf("app.post('/api/puzzle-rush/report'");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routeSource.slice(start, end);
}

describe('run-start payload', () => {
  it('never mentions the best possible score anywhere in the start handler', () => {
    const handler = startHandlerSource();
    expect(handler).not.toContain('bestPossibleScore');
    expect(handler).not.toContain('best_possible_score');
    expect(handler).not.toContain('difficultyScore');
  });

  it('ships exactly the selectRunPuzzles output, unmodified', () => {
    const handler = startHandlerSource();
    // A re-map or spread on the way to res.json is how a leak sneaks back in.
    expect(handler).toContain('const selection = selectRunPuzzles({ candidates });');
    expect(handler).toContain('const puzzles = selection.puzzles;');
    expect(handler).toContain('puzzles,');
    const maps = handler.match(/puzzles\.map\(.*/g) ?? [];
    // The only transform of `puzzles` is extracting ids for the play counter.
    expect(maps).toEqual(['puzzles.map((puzzle) => puzzle.puzzleId));']);
  });

  it('serializes without any best-score field, over a real pool entry', () => {
    const entry: PuzzlePoolEntry = {
      id: 'pool-secret',
      source: 'daily_puzzles',
      sourcePuzzleId: 'daily-1',
      startingBoard: { mainLine: [], leftEnd: 0, rightEnd: 0, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
      startingHand: [{ low: 1, high: 2 }],
      maxMoves: 1,
      puzzleType: 'one_turn_high_score',
      tier: 'quick_line',
      dealSize: 14,
      targetScore: 999,
      bestPossibleScore: 137,
      difficultyScore: 210,
      playCount: 4,
      enabled: true,
    };

    const wire = JSON.stringify(selectRunPuzzles({ candidates: [entry] }).puzzles);

    expect(wire).not.toContain('137');
    expect(wire).not.toContain('bestPossible');
    expect(wire).not.toContain('difficulty');
    expect(wire).not.toContain('playCount');
    // The safe fields the HUD does need are present.
    expect(wire).toContain('maxPoints');
    expect(wire).toContain('pool-secret');
  });
});
