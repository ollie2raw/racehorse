/**
 * What the player sees when their opponent's connection drops. Ordinary rooms
 * wait a reconnect grace (`graceMs`). Tournament rooms have no grace: the
 * server's turn clock keeps running (`policy: 'turn_clock'`), so there is no
 * reconnect deadline to show — and a disconnect alone never forfeits.
 */
export function opponentDisconnectCopy(payload: { graceMs?: number | null; policy?: string }): string {
  if (payload.policy === 'turn_clock' || payload.graceMs === null) {
    return 'Opponent disconnected. The match continues on the turn clock.';
  }
  const seconds = Math.max(1, Math.round((payload.graceMs ?? 30_000) / 1000));
  return `Opponent disconnected. Waiting up to ${seconds}s…`;
}
