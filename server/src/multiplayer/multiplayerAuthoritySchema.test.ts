import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multiplayer durable authority migration', () => {
  it('commits snapshot and receipt in one database function', async () => {
    const sql = await readFile(
      path.resolve(__dirname, '../../../supabase/migrations/2026-08-02_multiplayer_live_room_authority.sql'),
      'utf8',
    );
    const functionStart = sql.indexOf('create or replace function public.commit_room_live_session_command');
    expect(functionStart).toBeGreaterThan(-1);
    const body = sql.slice(functionStart);
    expect(body).toContain('for update');
    expect(body).toContain('authority_revision = next_revision');
    expect(body).toContain('insert into public.room_live_session_command_receipts');
    expect(body.indexOf('authority_revision = next_revision')).toBeLessThan(
      body.lastIndexOf('insert into public.room_live_session_command_receipts'),
    );
  });

  it('binds request IDs to semantic digests and durably records stale revisions', async () => {
    const sql = await readFile(
      path.resolve(__dirname, '../../../supabase/migrations/2026-08-02_multiplayer_live_room_authority.sql'),
      'utf8',
    );
    const preflightStart = sql.indexOf('create or replace function public.assert_room_live_session_revision');
    const commitStart = sql.indexOf('create or replace function public.commit_room_live_session_snapshot');
    const preflightBody = sql.slice(preflightStart, commitStart);

    expect(preflightBody).toContain("receipt.request_digest <> p_request_digest");
    expect(preflightBody).toContain("'request_id_conflict'");
    expect(preflightBody).toContain("if live_room.authority_revision <> p_expected_revision");
    expect(preflightBody).toContain('insert into public.room_live_session_command_receipts');
    expect(preflightBody).toContain("'rejected', 'stale_revision'");
    expect(sql).toContain('primary key (room_code, actor_seat_id, request_id)');
  });
});
