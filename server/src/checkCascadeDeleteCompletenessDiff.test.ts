import { describe, expect, it } from 'vitest';
import {
  diffCascadeDeleteManifest,
  type CascadeAllowlist,
  type LiveConstraintRow,
} from '../scripts/checkCascadeDeleteCompleteness';

/**
 * Guardrail #6 (ENGINEERING_GUARDRAILS.md) — proves the diff logic actually
 * catches the SA-6 class of drift (an ownership FK to profiles/auth.users that
 * doesn't cascade, so DELETE /api/account 500s for every affected user), not
 * just that the script runs without error.
 */

function fk(over: Partial<LiveConstraintRow>): LiveConstraintRow {
  return {
    schemaname: 'public',
    tablename: 't',
    constraint_name: 't_user_id_fkey',
    column_names: ['user_id'],
    referenced_table: 'auth.users',
    referenced_columns: ['id'],
    confdeltype: 'c',
    ...over,
  };
}

const emptyAllowlist: CascadeAllowlist = { exceptions: [] };

describe('diffCascadeDeleteManifest', () => {
  it('is clean when every FK targeting profiles/auth.users cascades', () => {
    const live: LiveConstraintRow[] = [
      fk({ tablename: 'ghost_profiles' }),
      fk({ tablename: 'ranked_games', column_names: ['player_id'], constraint_name: 'ranked_games_player_id_fkey' }),
      fk({ tablename: 'daily_fritz_attempts' }),
    ];

    const result = diffCascadeDeleteManifest(live, emptyAllowlist);
    expect(result.findings).toEqual([]);
    expect(result.cascading).toHaveLength(3);
    expect(result.allowedExceptions).toEqual([]);
  });

  it('FAILS on the exact SA-6 shape — an ownership FK that should cascade but does not, and is not allow-listed', () => {
    const live: LiveConstraintRow[] = [
      fk({ tablename: 'ghost_profiles' }),
      // bot_match_pending's user_id FK: `foreign key (user_id) references
      // profiles(id)` with no ON DELETE action → confdeltype 'a' (NO ACTION),
      // which blocks the delete exactly like RESTRICT. Verified against pg16:
      // a bare FK clause yields 'a', not 'r'.
      fk({
        tablename: 'bot_match_pending',
        constraint_name: 'bot_match_pending_user_id_fkey',
        referenced_table: 'public.profiles',
        confdeltype: 'a',
      }),
    ];

    const result = diffCascadeDeleteManifest(live, emptyAllowlist);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      table: 'bot_match_pending',
      columns: ['user_id'],
      kind: 'missing_cascade',
    });
    expect(result.findings[0]!.detail).toContain('NO ACTION');
    expect(result.findings[0]!.detail).toContain('CASCADE');
  });

  it('also FAILS on the explicit RESTRICT variant', () => {
    const live = [fk({ tablename: 'bot_match_pending', referenced_table: 'public.profiles', confdeltype: 'r' })];
    const result = diffCascadeDeleteManifest(live, emptyAllowlist);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe('missing_cascade');
    expect(result.findings[0]!.detail).toContain('RESTRICT');
  });

  it('does NOT fail an allow-listed exception whose live action matches the recorded one', () => {
    const live: LiveConstraintRow[] = [
      fk({
        tablename: 'matches',
        column_names: ['winner_user_id'],
        constraint_name: 'matches_winner_user_id_fkey',
        confdeltype: 'n',
      }),
      fk({
        tablename: 'matches',
        column_names: ['loser_user_id'],
        constraint_name: 'matches_loser_user_id_fkey',
        confdeltype: 'n',
      }),
      fk({ tablename: 'ghost_profiles' }),
    ];
    const allowlist: CascadeAllowlist = {
      exceptions: [
        { table: 'matches', columns: ['winner_user_id'], confdeltype: 'n', reason: 'historical result record' },
        { table: 'matches', columns: ['loser_user_id'], confdeltype: 'n', reason: 'historical result record' },
      ],
    };

    const result = diffCascadeDeleteManifest(live, allowlist);
    expect(result.findings).toEqual([]);
    expect(result.allowedExceptions).toEqual(['matches(loser_user_id)', 'matches(winner_user_id)']);
    expect(result.cascading).toEqual(['ghost_profiles(user_id)']);
  });

  it('FAILS when an allow-listed FK\'s live action drifted from what the allow-list records (SET NULL → RESTRICT)', () => {
    const live = [
      fk({ tablename: 'matches', column_names: ['winner_user_id'], confdeltype: 'r' }),
    ];
    const allowlist: CascadeAllowlist = {
      exceptions: [
        { table: 'matches', columns: ['winner_user_id'], confdeltype: 'n', reason: 'historical result record' },
      ],
    };

    const result = diffCascadeDeleteManifest(live, allowlist);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ table: 'matches', kind: 'wrong_action' });
    expect(result.findings[0]!.detail).toContain('SET NULL');
    expect(result.findings[0]!.detail).toContain('RESTRICT');
  });

  it('FAILS on a stale allow-list entry that matches no live FK (constraint dropped or renamed columns)', () => {
    const live = [fk({ tablename: 'ghost_profiles' })];
    const allowlist: CascadeAllowlist = {
      exceptions: [
        { table: 'matches', columns: ['winner_user_id'], confdeltype: 'n', reason: 'historical result record' },
      ],
    };

    const result = diffCascadeDeleteManifest(live, allowlist);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      table: 'matches',
      columns: ['winner_user_id'],
      kind: 'stale_allowlist_entry',
    });
  });

  it('matches allow-list entries by (table, columns) regardless of column order', () => {
    const live = [
      fk({
        tablename: 'weird_composite',
        column_names: ['b_id', 'a_id'],
        confdeltype: 'n',
      }),
    ];
    const allowlist: CascadeAllowlist = {
      exceptions: [
        { table: 'weird_composite', columns: ['a_id', 'b_id'], confdeltype: 'n', reason: 'test' },
      ],
    };
    expect(diffCascadeDeleteManifest(live, allowlist).findings).toEqual([]);
  });
});
