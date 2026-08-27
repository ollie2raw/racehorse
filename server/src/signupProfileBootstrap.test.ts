import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The signup form collects a username and Supabase stores it on
 * auth.users.raw_user_meta_data. public.handle_new_user() is the only writer of
 * the profile row the UI later reads back, so if it ignores that metadata the
 * submitted username is silently replaced by the bootstrap placeholder and the
 * player is prompted to pick a handle they already chose.
 */
describe('signup profile bootstrap', () => {
  const files = [
    'supabase/schema.sql',
    'supabase/migrations/2026-08-26_signup_profile_username_from_metadata.sql',
  ];

  for (const file of files) {
    describe(file, () => {
      const sql = compactSql(readRepoFile(file));
      const trigger = sql.slice(sql.indexOf('function public.handle_new_user()'));

      it('persists the username submitted at signup', () => {
        expect(trigger).toContain("raw_user_meta_data ->> 'username'");
      });

      it('accepts the alternate preferred_username metadata key the client also sends', () => {
        expect(trigger).toContain("raw_user_meta_data ->> 'preferred_username'");
      });

      it('applies the same handle rules the signup form enforces', () => {
        expect(trigger).toContain('[a-z0-9_]{3,}');
      });

      it('never lets a taken or invalid handle abort the signup transaction', () => {
        expect(trigger).toContain('select 1 from public.profiles');
        expect(trigger).toContain("'user_' || left(replace(new.id::text, '-', ''), 8)");
      });

      it('does not hand out the reserved placeholder namespace as a real handle', () => {
        expect(trigger).toContain("like 'user\\_%'");
      });
    });
  }
});
