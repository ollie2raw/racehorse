import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('durable multiplayer invite schema', () => {
  it('defines pending deduplication, expiration, and recipient-bound resolution', async () => {
    const sql = await readFile(
      path.resolve(__dirname, '../../../supabase/migrations/2026-08-06_multiplayer_durable_invites.sql'),
      'utf8',
    );
    expect(sql).toContain('uq_multiplayer_invites_pending_pair_room');
    expect(sql).toContain("where status = 'pending'");
    expect(sql).toContain("status = 'expired'");
    expect(sql).toContain('recipient_user_id = p_recipient_user_id');
    expect(sql).toContain('pg_advisory_xact_lock');
  });
});
