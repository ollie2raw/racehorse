/**
 * Phase 3 item 3.4: composite index for "find active match for user" query.
 * Source-level guardrail confirming the migration and its partial-index clause exist.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/2026-08-12_bot_match_active_lookup_index.sql'),
  'utf8',
).replace(/\s+/g, ' ').toLowerCase();

describe('bot_match_pending active-lookup composite index (item 3.4)', () => {
  it('creates a partial index filtered to resolved = false', () => {
    expect(migration).toContain('where resolved = false');
  });

  it('covers user_id, room_code, and resolved columns', () => {
    expect(migration).toContain('user_id, room_code, resolved');
  });

  it('uses create index if not exists (idempotent)', () => {
    expect(migration).toContain('create index if not exists');
  });

  it('targets the bot_match_pending table', () => {
    expect(migration).toContain('on public.bot_match_pending');
  });
});
