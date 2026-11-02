import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';

const log = childLogger('guest-eligibility');

/**
 * Guests (Supabase anonymous sessions, profiles.is_guest) play and are recorded like anyone but are never ranked. These helpers keep them off every
 * leaderboard. They are TOLERANT of the column not existing yet: until supabase/migrations/2026-11-02_guest_play_g2b.sql is applied they filter nothing, so
 * the server can deploy before or after the SQL. A missing column is remembered for a minute so a board is not hit with a failing request every time.
 */

const MISSING_COLUMN_COOLDOWN_MS = 60_000;
const ID_CHUNK = 100;

let columnMissingUntil = 0;

/** Test seam: forget that the column was ever missing. */
export function resetGuestEligibilityForTests(): void {
  columnMissingUntil = 0;
}

function isMissingGuestColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /is_guest/.test(message) && /(42703|does not exist|could not find|schema cache)/i.test(message);
}

function noteMissingColumn(): void {
  if (columnMissingUntil <= Date.now()) {
    log.warn({ setting: 'profiles.is_guest' }, 'guest column not found; leaderboards are not excluding guests until the G2b SQL is applied');
  }
  columnMissingUntil = Date.now() + MISSING_COLUMN_COOLDOWN_MS;
}

function columnKnownMissing(): boolean {
  return columnMissingUntil > Date.now();
}

/** Of these user ids, which belong to guests. Empty when the column does not exist yet. Any other failure is thrown (a board must not quietly show guests). */
export async function fetchGuestUserIds(userIds: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  if (unique.length === 0 || columnKnownMissing()) return out;
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const clause = unique.slice(i, i + ID_CHUNK).map((id) => `"${id}"`).join(',');
    try {
      const rows = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/profiles?select=id&is_guest=eq.true&id=in.(${encodeURIComponent(clause)})`,
        { method: 'GET', circuitBreakable: true },
      );
      for (const row of rows) out.add(row.id);
    } catch (error) {
      if (isMissingGuestColumn(error)) {
        noteMissingColumn();
        return new Set();
      }
      throw error;
    }
  }
  return out;
}

/** Drop every item whose user is a guest. `getUserId` says which user an item belongs to. */
export async function removeGuests<T>(items: T[], getUserId: (item: T) => string | null | undefined): Promise<T[]> {
  if (items.length === 0) return items;
  const guests = await fetchGuestUserIds(items.map((item) => getUserId(item) ?? ''));
  if (guests.size === 0) return items;
  return items.filter((item) => !guests.has(getUserId(item) ?? ''));
}

/**
 * GET a /rest/v1/profiles query with guests excluded. `path` must already be a query on profiles. If the column is missing the same query runs without the
 * filter.
 */
export async function fetchProfilesExcludingGuests<T>(path: string): Promise<T> {
  if (!columnKnownMissing()) {
    try {
      return await supabaseFetch<T>(`${path}${path.includes('?') ? '&' : '?'}is_guest=eq.false`);
    } catch (error) {
      if (!isMissingGuestColumn(error)) throw error;
      noteMissingColumn();
    }
  }
  return supabaseFetch<T>(path);
}
