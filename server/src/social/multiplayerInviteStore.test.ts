import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';
import {
  createDurableMultiplayerInvite,
  listPendingMultiplayerInvites,
  resolveDurableMultiplayerInvite,
} from './multiplayerInviteStore';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

const row = {
  invite_id: 'invite-1',
  sender_user_id: '11111111-1111-4111-8111-111111111111',
  recipient_user_id: '22222222-2222-4222-8222-222222222222',
  room_code: 'ROOM1',
  inviter_username: 'Alice',
  invite_url: 'https://example.com/ROOM1',
  match_summary: '7-Tile · First to 60 · Untimed',
  status: 'pending' as const,
  created_at: '2026-08-06T00:00:00.000Z',
  expires_at: '2026-08-06T00:05:00.000Z',
  delivered_at: null,
  resolved_at: null,
};

describe('multiplayerInviteStore', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('reuses the database-returned pending invite on duplicate creation', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([row]);
    const params = {
      inviteId: 'new-client-id',
      senderUserId: row.sender_user_id,
      recipientUserId: row.recipient_user_id,
      roomCode: row.room_code,
      inviterUsername: row.inviter_username,
      inviteUrl: row.invite_url,
      matchSummary: row.match_summary,
      expiresAt: row.expires_at,
    };

    const first = await createDurableMultiplayerInvite(params);
    const duplicate = await createDurableMultiplayerInvite(params);

    expect(first.inviteId).toBe('invite-1');
    expect(duplicate.inviteId).toBe('invite-1');
    expect(supabaseFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(supabaseFetch).mock.calls[0]?.[0]).toBe('/rest/v1/rpc/create_multiplayer_invite');
  });

  it('loads pending invitations for reconnect delivery', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([row]);
    const pending = await listPendingMultiplayerInvites(row.recipient_user_id);
    expect(pending).toEqual([
      expect.objectContaining({ inviteId: 'invite-1', recipientUserId: row.recipient_user_id }),
    ]);
    expect(vi.mocked(supabaseFetch).mock.calls[0]?.[0]).toContain('status=eq.pending');
  });

  it('rejects an expired or already-resolved invite when the RPC returns no row', async () => {
    vi.mocked(supabaseFetch).mockResolvedValueOnce([]);
    await expect(
      resolveDurableMultiplayerInvite({
        inviteId: 'expired-invite',
        recipientUserId: row.recipient_user_id,
        status: 'accepted',
      }),
    ).resolves.toBeNull();
  });
});
