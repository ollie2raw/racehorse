import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(resolve(__dirname, '..', '..', path), 'utf8');
}

describe('Daily Puzzle five-slot schema', () => {
  it('widens completed puzzle progress to five in a follow-up migration', () => {
    const sql = readRepoFile(
      'supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql',
    );

    expect(sql).toContain('drop constraint if exists daily_puzzle_attempts_puzzles_completed_check');
    expect(sql).toContain('add constraint daily_puzzle_attempts_puzzles_completed_check');
    expect(sql).toMatch(/check\s*\(puzzles_completed\s+between\s+0\s+and\s+5\)/i);
  });

  it('documents a guarded rollback to the former three-slot bound', () => {
    const sql = readRepoFile(
      'supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql',
    );

    expect(sql).toContain('only after verifying no row has puzzles_completed > 3');
    expect(sql).toMatch(/check\s*\(puzzles_completed\s+between\s+0\s+and\s+3\)/i);
  });
});
