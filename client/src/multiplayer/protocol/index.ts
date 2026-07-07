/**
 * Public multiplayer transport protocol API.
 * Import from here for socket payloads and room identity.
 */
export type {
  RoomEventMeta,
  StateUpdatePayload,
  RoomRecoveryState,
  RoomIdentity,
  RoomPlayer,
  RoomChatEvent,
  RoomEmoteEvent,
} from './roomProtocol';

export { normalizeRoomPlayers } from './roomProtocol';