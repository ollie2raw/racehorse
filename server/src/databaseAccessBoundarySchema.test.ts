import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hardeningMigration = '2026-08-11_authoritative_ranking_and_bot_pending.sql';
const migrationsDirectory = path.resolve(__dirname, '../../supabase/migrations');

function migrationSql(): string {
  return fs
    .readFileSync(
      path.resolve(
        __dirname,
        `../../supabase/migrations/${hardeningMigration}`,
      ),
      'utf8',
    )
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function laterMigrationStatements(): string[] {
  return fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql') && name > hardeningMigration)
    .flatMap((name) =>
      fs
        .readFileSync(path.join(migrationsDirectory, name), 'utf8')
        .replace(/--.*$/gm, '')
        .toLowerCase()
        .split(';')
        .map((statement) => statement.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
}

describe('authoritative database access boundaries', () => {
  it('denies browser roles all ranking-table and pending-match access', () => {
    const sql = migrationSql();
    for (const table of ['ranked_games', 'rating_periods', 'bot_match_pending']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`${table}_no_client_access`);
      expect(sql).toContain(
        `revoke all privileges on table public.${table} from public, anon, authenticated`,
      );
      expect(sql).toContain(`grant all privileges on table public.${table} to service_role`);
    }
  });

  it('restricts direct profile writes to identity fields', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'revoke all privileges on table public.profiles from public, anon, authenticated',
    );
    expect(sql).toContain('grant select on table public.profiles to authenticated');
    expect(sql).toContain('grant update (username) on table public.profiles to authenticated');
    expect(sql).not.toContain('grant insert (');
    expect(sql).not.toContain('grant update (glicko_rating');
  });

  it('makes the security-definer Glicko commit RPC service-role only', () => {
    const sql = migrationSql();
    expect(sql).toContain('revoke execute on function public.commit_glicko_game_update(');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });

  it('rejects later migrations that reopen authoritative data to browser roles', () => {
    const statements = laterMigrationStatements();
    const serverOnlyTables = ['ranked_games', 'rating_periods', 'bot_match_pending'];

    for (const statement of statements) {
      for (const table of serverOnlyTables) {
        expect(statement).not.toMatch(
          new RegExp(`alter table (?:public\\.)?${table} disable row level security`),
        );
        if (statement.startsWith('grant ') && statement.includes(`public.${table}`)) {
          expect(statement).not.toMatch(/\bto\s+(?:public|anon|authenticated)\b/);
        }
      }

      if (statement.startsWith('grant ') && statement.includes('public.profiles')) {
        expect(statement).not.toMatch(
          /grant (?:all privileges|insert|update).*\bto\s+(?:public|anon|authenticated)\b/,
        );
        expect(statement).not.toMatch(
          /grant (?:insert|update)\s*\([^)]*(?:glicko_|ranked_games_played|peak_rating|provisional)[^)]*\)/,
        );
      }

      if (
        statement.startsWith('grant execute') &&
        statement.includes('public.commit_glicko_game_update')
      ) {
        expect(statement).not.toMatch(/\bto\s+(?:public|anon|authenticated)\b/);
      }
    }
  });
});
