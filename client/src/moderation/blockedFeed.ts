/** Drops feed items authored by players the viewer has blocked. */
export function withoutBlockedPlayers<T extends { user_id: string }>(
  items: readonly T[],
  blockedUserIds: readonly string[] | null | undefined,
): T[] {
  if (!blockedUserIds || blockedUserIds.length === 0) return [...items];
  const blocked = new Set(blockedUserIds);
  return items.filter((item) => !blocked.has(item.user_id));
}
