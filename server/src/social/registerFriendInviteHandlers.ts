import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { getRoomRoster } from '../multiplayer/roomSession';
import { recordOperationalFailure } from '../operationalTelemetry';
import {
  createDurableMultiplayerInvite,
  listPendingMultiplayerInvites,
  markMultiplayerInviteDelivered,
  resolveDurableMultiplayerInvite,
  type MultiplayerInviteRecord,
} from './multiplayerInviteStore';

type AckFn = (payload: unknown) => void;

type FriendInvitePayload = {
  toUserId?: string;
  fromUsername?: string;
  fromUserId?: string;
  roomCode?: string;
  inviteUrl?: string;
  inviteId?: string;
  matchSummary?: string;
};

type FriendInviteHandlerDeps = {
  normalizeUserId: (value: unknown) => string | null;
  normalizeUsername: (value: unknown) => string;
  isAuthenticatedUserId: (value: string | null | undefined) => boolean;
  createInvite?: typeof createDurableMultiplayerInvite;
  resolveInvite?: typeof resolveDurableMultiplayerInvite;
  markInviteDelivered?: typeof markMultiplayerInviteDelivered;
  durableInvitesEnabled?: boolean;
};

function emitLegacyInvite(
  io: Server,
  socketId: string,
  invite: {
    inviteId: string;
    inviterUsername: string;
    inviterUserId: string;
    roomCode: string;
    inviteUrl: string;
    matchSummary: string;
  },
): void {
  io.to(socketId).emit('friend:invited', {
    inviteId: invite.inviteId,
    fromUsername: invite.inviterUsername,
    fromUserId: invite.inviterUserId,
    roomCode: invite.roomCode,
    inviteUrl: invite.inviteUrl,
    matchSummary: invite.matchSummary,
  });
}

function emitInvite(io: Server, socketId: string, invite: MultiplayerInviteRecord): void {
  io.to(socketId).emit('friend:invited', {
    inviteId: invite.inviteId,
    fromUsername: invite.inviterUsername,
    fromUserId: invite.senderUserId,
    roomCode: invite.roomCode,
    inviteUrl: invite.inviteUrl,
    matchSummary: invite.matchSummary,
    expiresAt: invite.expiresAt,
  });
}

export async function deliverPendingMultiplayerInvites(
  io: Server,
  socket: Socket,
  recipientUserId: string,
  stores: {
    listPending?: typeof listPendingMultiplayerInvites;
    markDelivered?: typeof markMultiplayerInviteDelivered;
  } = {},
): Promise<number> {
  const listPending = stores.listPending ?? listPendingMultiplayerInvites;
  const markDelivered = stores.markDelivered ?? markMultiplayerInviteDelivered;
  const pending = await listPending(recipientUserId);
  for (const invite of pending) {
    emitInvite(io, socket.id, invite);
    void markDelivered(invite.inviteId).catch((error) => {
      recordOperationalFailure('multiplayer.invite_delivery_mark', error, {
        inviteId: invite.inviteId,
        recipientUserId,
      });
    });
  }
  return pending.length;
}

export function registerFriendInviteHandlers(
  io: Server,
  socket: Socket,
  socketsByUserId: Map<string, Set<string>>,
  deps: FriendInviteHandlerDeps,
): void {
  const createInvite = deps.createInvite ?? createDurableMultiplayerInvite;
  const resolveInvite = deps.resolveInvite ?? resolveDurableMultiplayerInvite;
  const markInviteDelivered = deps.markInviteDelivered ?? markMultiplayerInviteDelivered;
  const durableInvitesEnabled = deps.durableInvitesEnabled ?? false;

  socket.on('friend:invite', async (payload: FriendInvitePayload, cb?: AckFn) => {
    const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
    try {
      getRoom(roomCode);
    } catch {
      socket.emit('friend:invite:error', { ok: false, error: 'room_not_found' });
      cb?.({ ok: false, error: 'room_not_found' });
      return;
    }

    const inviterUserId = deps.normalizeUserId(socket.data?.userId);
    if (!deps.isAuthenticatedUserId(inviterUserId)) {
      cb?.({ ok: false, error: 'not_authenticated' });
      return;
    }

    const roster = getRoomRoster(roomCode);
    const isRoomMember = roster.some((player) => player.userId === inviterUserId);
    if (!isRoomMember) {
      cb?.({ ok: false, error: 'not_room_member' });
      return;
    }

    const toUserId = deps.normalizeUserId(payload?.toUserId);
    if (!toUserId) {
      cb?.({ ok: false, error: 'invalid_target' });
      return;
    }

    const inviteId = String(payload?.inviteId ?? `${Date.now()}-${roomCode}`).slice(0, 80);
    const matchSummary = String(payload?.matchSummary ?? '7-Tile · First to 60 · Untimed').slice(0, 120);
    const inviteUrl = String(payload?.inviteUrl ?? '');
    const inviterUsername = deps.normalizeUsername(socket.data?.username);

    if (!durableInvitesEnabled) {
      const targetSockets = socketsByUserId.get(toUserId);
      if (!targetSockets?.size) {
        cb?.({ ok: false, error: 'recipient_unreachable' });
        return;
      }
      for (const socketId of targetSockets) {
        emitLegacyInvite(io, socketId, {
          inviteId,
          inviterUsername,
          inviterUserId: inviterUserId!,
          roomCode,
          inviteUrl,
          matchSummary,
        });
      }
      cb?.({ ok: true, delivered: true, inviteId });
      return;
    }

    try {
      const invite = await createInvite({
        inviteId,
        senderUserId: inviterUserId!,
        recipientUserId: toUserId,
        roomCode,
        inviterUsername,
        inviteUrl,
        matchSummary,
      });
      const targetSockets = socketsByUserId.get(toUserId);
      for (const socketId of targetSockets ?? []) {
        emitInvite(io, socketId, invite);
      }
      const delivered = Boolean(targetSockets?.size);
      if (delivered) {
        void markInviteDelivered(invite.inviteId).catch((error) => {
          recordOperationalFailure('multiplayer.invite_delivery_mark', error, {
            inviteId: invite.inviteId,
            recipientUserId: toUserId,
          });
        });
      }
      cb?.({
        ok: true,
        delivered,
        durable: true,
        inviteId: invite.inviteId,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      recordOperationalFailure('multiplayer.invite_create', error, {
        roomCode,
        senderUserId: inviterUserId,
        recipientUserId: toUserId,
      });
      cb?.({ ok: false, error: 'invite_persistence_failed' });
    }
  });

  socket.on(
    'friend:invite:decline',
    async (payload: { toUserId?: string; roomCode?: string; inviteId?: string }, cb?: AckFn) => {
      if (!durableInvitesEnabled) {
        const toUserId = deps.normalizeUserId(payload?.toUserId);
        const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
        if (!toUserId || !roomCode) {
          cb?.({ ok: false, error: 'invalid_invite' });
          return;
        }
        for (const socketId of socketsByUserId.get(toUserId) ?? []) {
          io.to(socketId).emit('friend:invite:declined', {
            fromUsername: deps.normalizeUsername(socket.data?.username),
            roomCode,
          });
        }
        cb?.({ ok: true });
        return;
      }
      const recipientUserId = deps.normalizeUserId(socket.data?.userId);
      const inviteId = String(payload?.inviteId ?? '').trim().slice(0, 128);
      if (!deps.isAuthenticatedUserId(recipientUserId) || !inviteId) {
        cb?.({ ok: false, error: 'invalid_invite' });
        return;
      }
      let invite: MultiplayerInviteRecord | null;
      try {
        invite = await resolveInvite({
          inviteId,
          recipientUserId: recipientUserId!,
          status: 'declined',
        });
      } catch (error) {
        recordOperationalFailure('multiplayer.invite_decline', error, { inviteId, recipientUserId });
        cb?.({ ok: false, error: 'invite_persistence_failed' });
        return;
      }
      if (!invite) {
        cb?.({ ok: false, error: 'invite_expired_or_resolved' });
        return;
      }
      for (const socketId of socketsByUserId.get(invite.senderUserId) ?? []) {
        io.to(socketId).emit('friend:invite:declined', {
          inviteId: invite.inviteId,
          fromUsername: deps.normalizeUsername(socket.data?.username),
          roomCode: invite.roomCode,
        });
      }
      cb?.({ ok: true });
    },
  );

  socket.on('friend:invite:accept', async (payload: { inviteId?: string }, cb?: AckFn) => {
    if (!durableInvitesEnabled) {
      cb?.({ ok: true });
      return;
    }
    const recipientUserId = deps.normalizeUserId(socket.data?.userId);
    const inviteId = String(payload?.inviteId ?? '').trim().slice(0, 128);
    if (!deps.isAuthenticatedUserId(recipientUserId) || !inviteId) {
      cb?.({ ok: false, error: 'invalid_invite' });
      return;
    }
    let invite: MultiplayerInviteRecord | null;
    try {
      invite = await resolveInvite({
        inviteId,
        recipientUserId: recipientUserId!,
        status: 'accepted',
      });
    } catch (error) {
      recordOperationalFailure('multiplayer.invite_accept', error, { inviteId, recipientUserId });
      cb?.({ ok: false, error: 'invite_persistence_failed' });
      return;
    }
    cb?.(invite ? { ok: true } : { ok: false, error: 'invite_expired_or_resolved' });
  });
}
