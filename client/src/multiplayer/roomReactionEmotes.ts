/**
 * The six preset match reactions — the only thing a player can send an
 * opponent during a match. There is no free-text chat (App Store Guideline
 * 1.2). The server relays nothing outside this list
 * (`server/src/multiplayer/roomReactionEmotes.ts`; a server test keeps the two
 * lists equal).
 */
export const ROOM_REACTION_EMOTES = ['👍', '😂', '😮', '❤️', '😡', '🎉'] as const;

export type RoomReactionEmote = (typeof ROOM_REACTION_EMOTES)[number];
