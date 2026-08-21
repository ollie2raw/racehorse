import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAILY_PUZZLE_SLOT_COUNT, MAX_DAILY_PUZZLE_SLOT_COUNT } from './dailyPuzzle';

function readRepoFile(path: string): string {
  return readFileSync(resolve(__dirname, '..', '..', path), 'utf8');
}

/**
 * The published ladder is three slots again, but the database bound stays at
 * five: production rows from the August five-slot days still exist, so the
 * documented rollback's own precondition ("no row has puzzles_completed > 3")
 * does not hold. These tests pin that deliberate split.
 */
describe('Daily Puzzle slot-index schema bound', () => {
  it('keeps the database bound wider than the published ladder', () => {
    expect(DAILY_PUZZLE_SLOT_COUNT).toBe(3);
    expect(MAX_DAILY_PUZZLE_SLOT_COUNT).toBe(5);
    expect(MAX_DAILY_PUZZLE_SLOT_COUNT).toBeGreaterThan(DAILY_PUZZLE_SLOT_COUNT);
  });

  it('leaves completed puzzle progress bounded at five in the database', () => {
    const sql = readRepoFile(
      'supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql',
    );

    expect(sql).toContain('drop constraint if exists daily_puzzle_attempts_puzzles_completed_check');
    expect(sql).toContain('add constraint daily_puzzle_attempts_puzzles_completed_check');
    expect(sql).toMatch(/check\s*\(puzzles_completed\s+between\s+0\s+and\s+5\)/i);
  });

  it('keeps the guarded three-slot rollback documented but unapplied', () => {
    const sql = readRepoFile(
      'supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql',
    );

    expect(sql).toContain('only after verifying no row has puzzles_completed > 3');
    expect(sql).toMatch(/check\s*\(puzzles_completed\s+between\s+0\s+and\s+3\)/i);
  });
});
