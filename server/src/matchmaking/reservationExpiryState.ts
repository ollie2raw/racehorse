// Synchronous per-room exclusion while terminal persistence is uncertain.
// The reservation stays recoverable until the terminal write is acknowledged.
export const expiringReservations = new Set<string>();
export function assertReservationNotExpiring(code: string): void {
  if (expiringReservations.has(code.trim().toUpperCase())) throw new Error('match_reservation_closing');
}
