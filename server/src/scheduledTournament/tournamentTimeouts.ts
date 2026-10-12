import { childLogger } from '../logger';

const log = childLogger('tournament:timeouts');

/**
 * Tournament timing, in one place. UNTUNED launch defaults: real human match
 * duration has not been measured yet. Each is overridable by env var and read
 * on every call (so a restart picks up a change); a value that is missing,
 * non-numeric or outside its safe range falls back to the default with a
 * warning, never to something unsafe like 0.
 *
 *   TOURNAMENT_TURN_TIMEOUT_MS   45 000      per human turn (5 s .. 10 min)
 *   TOURNAMENT_MAX_MISSED_TURNS  3           consecutive timeouts before a forfeit (1 .. 20)
 *   TOURNAMENT_MATCH_CAP_MS      1 200 000   per match from started_at (1 min .. 6 h)
 */
export const TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT = 45_000;
export const TOURNAMENT_MAX_MISSED_TURNS_DEFAULT = 3;
export const TOURNAMENT_MATCH_CAP_MS_DEFAULT = 20 * 60_000;

const warned = new Set<string>();

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  if (!warned.has(`${name}=${raw}`)) {
    warned.add(`${name}=${raw}`);
    log.warn({ name, raw, min, max, fallback }, 'invalid tournament timing env value; using the default');
  }
  return fallback;
}

export function tournamentTurnTimeoutMs(): number {
  return readIntEnv('TOURNAMENT_TURN_TIMEOUT_MS', TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT, 5_000, 10 * 60_000);
}

export function tournamentMaxMissedTurns(): number {
  return readIntEnv('TOURNAMENT_MAX_MISSED_TURNS', TOURNAMENT_MAX_MISSED_TURNS_DEFAULT, 1, 20);
}

export function tournamentMatchCapMs(): number {
  return readIntEnv('TOURNAMENT_MATCH_CAP_MS', TOURNAMENT_MATCH_CAP_MS_DEFAULT, 60_000, 6 * 60 * 60_000);
}
