import { describe, expect, it } from 'vitest';
import {
  PROHIBITED_PROFANITY_TERMS,
  PROHIBITED_SLUR_TERMS,
  RESERVED_USERNAME_PREFIXES,
  RESERVED_USERNAMES,
  isUsernamePolicyDbError,
  usernamePolicyViolation,
} from './usernamePolicy';
// `?raw` rather than node:fs: the app project has no node types (see
// puzzleRush/dailyPuzzleIsRush.test.ts).
import migration from '../../../supabase/migrations/2026-10-12_username_policy.sql?raw';
import preflight from '../../../docs/ops/moderation-rollout/preflight.sql?raw';

/** The quoted strings of the n-th `array[ ... ]` literal inside username_policy_violation. */
function sqlArray(index: number): string[] {
  const body = migration.slice(
    migration.indexOf('function public.username_policy_violation'),
    migration.indexOf('comment on function public.username_policy_violation'),
  );
  const arrays = [...body.matchAll(/array\s*\[([\s\S]*?)\]/gi)].map((m) => m[1]);
  return [...arrays[index].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe('username policy — client mirrors the database exactly', () => {
  it('reserved names, prefixes, slurs and profanity match the migration', () => {
    expect(sqlArray(0)).toEqual([...RESERVED_USERNAMES]);
    expect(sqlArray(1)).toEqual([...RESERVED_USERNAME_PREFIXES]);
    expect(sqlArray(2)).toEqual([...PROHIBITED_SLUR_TERMS]);
    expect(sqlArray(3)).toEqual([...PROHIBITED_PROFANITY_TERMS]);
  });
});

describe('production preflight', () => {
  it('checks existing names with an exact copy of the migration policy (pg_temp)', () => {
    const body = (sql: string, schema: string) => {
      const start = sql.indexOf(`create or replace function ${schema}.username_policy_violation(candidate text)`);
      const end = sql.indexOf('$$;', start);
      expect(start).toBeGreaterThan(-1);
      return sql.slice(sql.indexOf('returns text', start), end);
    };
    expect(body(preflight, 'pg_temp')).toBe(body(migration, 'public'));
  });
});

describe('usernamePolicyViolation', () => {
  it('accepts ordinary handles, including existing-style and placeholder names', () => {
    for (const name of ['olly', 'domino_king', 'player_one', 'fritzfan', 'fritz_mueller', 'team_rocket', 'grape', 'scrape', 'raccoon', 'class_act', 'hancock', 'dickens', 'user_1a2b3c4d', 'abc']) {
      expect(usernamePolicyViolation(name), name).toBeNull();
    }
  });

  it('rejects reserved and impersonation names, case-insensitively', () => {
    for (const name of ['admin', 'ADMIN', 'Administrator', 'support', 'Support', 'racehorse', 'RaceHorse', 'racehorse_support', 'racehorse_help', 'fritz', 'FRITZ', 'fritz_bot', 'adminuser', 'moderator2', 'official_team', 'player', 'guest']) {
      expect(usernamePolicyViolation(name), name).toBe('reserved');
    }
  });

  it('rejects slurs (also split by underscores) and profanity', () => {
    for (const name of ['xnigger', 'n_i_g_g_e_r', 'big_faggot', 'retard99', 'fuckface', 'shithead', 'HITLER_fan']) {
      expect(usernamePolicyViolation(name), name).toBe('prohibited');
    }
  });

  it('keeps the existing syntax rule', () => {
    for (const name of ['ab', 'has space', 'dash-name', 'émile', '']) {
      expect(usernamePolicyViolation(name), name).toBe('syntax');
    }
  });

  it('recognizes the database rejection', () => {
    expect(isUsernamePolicyDbError('username_not_allowed')).toBe(true);
    expect(isUsernamePolicyDbError('duplicate key value violates unique constraint')).toBe(false);
  });
});
