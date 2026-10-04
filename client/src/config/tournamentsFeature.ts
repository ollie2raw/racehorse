/**
 * Live tournaments are switched off until there is real demand (2026-10-03:
 * 2 accounts ever registered, no completed event since 2026-07-09). Every
 * tournament entry point checks this; the code stays in place.
 *
 * On only when VITE_ENABLE_TOURNAMENTS is exactly "true" (build-time). The
 * server has its own switch, TOURNAMENTS_ENABLED; turn both on together.
 */
export function parseTournamentsFlag(value: unknown): boolean {
  return value === 'true';
}

export function isTournamentsEnabled(value: unknown = import.meta.env.VITE_ENABLE_TOURNAMENTS): boolean {
  return parseTournamentsFlag(value);
}
