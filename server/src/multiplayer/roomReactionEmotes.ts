/**
 * The only reactions a player can send to an opponent during a match.
 *
 * Fixed application content, not user input: there is no free-text chat, and
 * `room:emote:send` relays nothing that is not exactly one of these strings
 * (App Store Guideline 1.2 — no unmoderated user-generated text between
 * strangers). The client renders the same six from
 * `client/src/multiplayer/roomReactionEmotes.ts`; a drift test keeps them equal.
 */
export const ROOM_REACTION_EMOTES = ['👍', '😂', '😮', '❤️', '😡', '🎉'] as const;

export type RoomReactionEmote = (typeof ROOM_REACTION_EMOTES)[number];

const ALLOWED = new Set<string>(ROOM_REACTION_EMOTES);

/** Exact membership only — no trimming, no normalization, no substring match. */
export function isRoomReactionEmote(value: unknown): value is RoomReactionEmote {
  return typeof value === 'string' && ALLOWED.has(value);
}
