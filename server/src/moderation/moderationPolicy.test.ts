import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES, REPORT_SOURCES } from './moderationPolicy';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('report vocabulary drift', () => {
  it('client, server and database CHECK constraints agree', () => {
    const client = read('../../../client/src/moderation/moderationTypes.ts');
    const sql = read('../../../supabase/migrations/2026-10-12_user_reports_and_blocks.sql');

    const clientCategories = [...client.matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(clientCategories).toEqual([...REPORT_CATEGORIES]);

    const sqlList = (column: string) =>
      [...(sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`))?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlList('category')).toEqual([...REPORT_CATEGORIES]);
    expect(sqlList('source')).toEqual([...REPORT_SOURCES]);
  });
});
