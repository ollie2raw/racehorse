import { supabaseFetch } from '../supabaseUtils';

export const MULTIPLAYER_INVITE_TTL_MS = 5 * 60_000;

export type MultiplayerInviteRecord = {
  inviteId: string;
  senderUserId: string;
  recipientUserId: string;
  roomCode: string;
  inviterUsername: string;
  inviteUrl: string;
  matchSummary: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  resolvedAt: string | null;
};

type InviteRow = {
  invite_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  room_code: string;
  inviter_username: string;
  invite_url: string;
  match_summary: string;
  status: MultiplayerInviteRecord['status'];
  created_at: string;
  expires_at: string;
  delivered_at: string | null;
  resolved_at: string | null;
};

function fromRow(row: InviteRow): MultiplayerInviteRecord {
  return {
    inviteId: row.invite_id,
    senderUserId: row.sender_user_id,
    recipientUserId: row.recipient_user_id,
    roomCode: row.room_code,
    inviterUsername: row.inviter_username,
    inviteUrl: row.invite_url,
    matchSummary: row.match_summary,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deliveredAt: row.delivered_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createDurableMultiplayerInvite(params: {
  inviteId: string;
  senderUserId: string;
  recipientUserId: string;
  roomCode: string;
  inviterUsername: string;
  inviteUrl: string;
  matchSummary: string;
  expiresAt?: string;
}): Promise<MultiplayerInviteRecord> {
  const expiresAt = params.expiresAt ?? new Date(Date.now() + MULTIPLAYER_INVITE_TTL_MS).toISOString();
  const rows = await supabaseFetch<InviteRow[]>('/rest/v1/rpc/create_multiplayer_invite', {
    method: 'POST',
    body: JSON.stringify({
      p_invite_id: params.inviteId,
      p_sender_user_id: params.senderUserId,
      p_recipient_user_id: params.recipientUserId,
      p_room_code: params.roomCode,
      p_inviter_username: params.inviterUsername,
      p_invite_url: params.inviteUrl,
      p_match_summary: params.matchSummary,
      p_expires_at: expiresAt,
    }),
  });
  if (!rows[0]) throw new Error('multiplayer_invite_create_empty_response');
  return fromRow(rows[0]);
}

export async function listPendingMultiplayerInvites(
  recipientUserId: string,
): Promise<MultiplayerInviteRecord[]> {
  const rows = await supabaseFetch<InviteRow[]>(
    `/rest/v1/multiplayer_invites?recipient_user_id=eq.${encodeURIComponent(recipientUserId)}` +
      `&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      '&order=created_at.asc&select=*',
    { method: 'GET' },
  );
  return rows.map(fromRow);
}

export async function markMultiplayerInviteDelivered(inviteId: string): Promise<void> {
  await supabaseFetch(
    `/rest/v1/multiplayer_invites?invite_id=eq.${encodeURIComponent(inviteId)}&status=eq.pending`,
    { method: 'PATCH', body: JSON.stringify({ delivered_at: new Date().toISOString() }) },
  );
}

export async function resolveDurableMultiplayerInvite(params: {
  inviteId: string;
  recipientUserId: string;
  status: 'accepted' | 'declined';
}): Promise<MultiplayerInviteRecord | null> {
  const rows = await supabaseFetch<InviteRow[]>('/rest/v1/rpc/resolve_multiplayer_invite', {
    method: 'POST',
    body: JSON.stringify({
      p_invite_id: params.inviteId,
      p_recipient_user_id: params.recipientUserId,
      p_status: params.status,
    }),
  });
  return rows[0] ? fromRow(rows[0]) : null;
}
