import type { Server, Socket } from 'socket.io';
import type { Room } from '../rooms';
import { isSpectatorModeEnabled } from './spectatorFeature';
import { publishMultiplayerSpectatorSnapshot, registerSpectatorHandlers } from './spectatorRegistry';

type PublicRosterEntry = { id: string; username: string; userId: string | null };

export function publishMultiplayerSpectatorSnapshotIfEnabled(
  io: Server,
  room: Room,
  getRoster: () => PublicRosterEntry[],
): void {
  if (!isSpectatorModeEnabled()) return;
  publishMultiplayerSpectatorSnapshot(io, room, getRoster());
}

export function registerSpectatorHandlersIfEnabled(io: Server, socket: Socket): void {
  if (!isSpectatorModeEnabled()) return;
  registerSpectatorHandlers(io, socket);
}
