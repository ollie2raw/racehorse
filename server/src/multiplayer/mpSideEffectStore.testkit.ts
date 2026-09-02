/**
 * In-memory port of the three durable sinks touched by the game-over
 * side-effect sequence — `public.matches`, `public.activity_feed`,
 * `public.matchmaking_matches` — plus the `data/matches.jsonl` file.
 *
 * It is a *faithful* stand-in for what the two 2026-09-01 MP-G4 migrations add
 * to prod (HARDENING_PLAN.md §2.4.4):
 *   - matches_room_match_id_uidx    — partial unique on (metadata->>'roomMatchId')
 *   - activity_feed_dedupe_key_uidx — partial unique on (dedupe_key)
 *   - recordMatchEnd's conditional PATCH `?status=eq.in_progress`
 * so the harness can run the REAL helpers (`appendMatch`,
 * `recordPublicOnlineMatch`, `writeMatchActivity`, `recordMatchEnd`) against it
 * and prove MP-INV-15 without a database. Analogous to System 1's
 * `inMemoryMatchRpc.testkit.ts`.
 */

type Json = Record<string, unknown>;

function roomMatchIdOf(row: Json): string | null {
  const md = row.metadata as Json | undefined;
  const v = md?.roomMatchId;
  return typeof v === 'string' && v ? v : null;
}

class MpSideEffectStore {
  matches: Json[] = [];
  activityFeed: Json[] = [];
  matchmakingMatches = new Map<string, Json>();
  private jsonl = '';

  reset(): void {
    this.matches = [];
    this.activityFeed = [];
    this.matchmakingMatches = new Map();
    this.jsonl = '';
  }

  seedMatchmakingMatch(id: string, status = 'in_progress'): void {
    this.matchmakingMatches.set(id, { id, status, winner_id: null });
  }

  get jsonlLines(): Json[] {
    return this.jsonl
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Json);
  }

  /** Drop-in for `supabaseFetch` (mock `../supabaseUtils`). */
  supabaseFetch = async (
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<unknown> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefer = init?.headers?.Prefer ?? '';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const [route, query = ''] = path.replace('/rest/v1/', '').split('?');

    // ---- public.matches (recordPublicOnlineMatch) ----
    if (route === 'matches') {
      if (method === 'GET') {
        const m = /metadata->>roomMatchId=eq\.([^&]+)/.exec(query);
        const key = m ? decodeURIComponent(m[1]) : null;
        const hit = this.matches.find((r) => roomMatchIdOf(r) === key);
        return hit ? [{ id: hit.id }] : [];
      }
      if (method === 'POST') {
        const row = { id: `matches-${this.matches.length + 1}`, ...(body as Json) };
        const key = roomMatchIdOf(row);
        const dup = key != null && this.matches.some((r) => roomMatchIdOf(r) === key);
        // matches_room_match_id_uidx + Prefer: resolution=ignore-duplicates
        if (dup && prefer.includes('resolution=ignore-duplicates')) return null;
        if (dup) throw new Error('duplicate key value violates unique constraint "matches_room_match_id_uidx"');
        this.matches.push(row);
        return null;
      }
    }

    // ---- public.activity_feed (writeMatchActivity / writeForfeitActivity) ----
    if (route === 'activity_feed' && method === 'POST') {
      const row = body as Json;
      const key = typeof row.dedupe_key === 'string' && row.dedupe_key ? row.dedupe_key : null;
      const dup = key != null && this.activityFeed.some((r) => r.dedupe_key === key);
      // activity_feed_dedupe_key_uidx + Prefer: resolution=ignore-duplicates
      if (dup && prefer.includes('resolution=ignore-duplicates')) return null;
      if (dup) throw new Error('duplicate key value violates unique constraint "activity_feed_dedupe_key_uidx"');
      this.activityFeed.push({ ...row });
      return null;
    }

    // ---- public.matchmaking_matches (recordMatchEnd — conditional PATCH) ----
    if (route === 'matchmaking_matches' && method === 'PATCH') {
      const idM = /id=eq\.([^&]+)/.exec(query);
      const id = idM ? decodeURIComponent(idM[1]) : null;
      const requiresInProgress = /(^|&)status=eq\.in_progress(&|$)/.test(query);
      const current = id ? this.matchmakingMatches.get(id) : undefined;
      if (!id || !current) return null;
      // The migration's fix: the write only lands while the row is in_progress.
      if (requiresInProgress && current.status !== 'in_progress') return null;
      this.matchmakingMatches.set(id, { ...current, ...(body as Json) });
      return null;
    }

    // ---- everything else the persist path pokes at (profiles, fixtures) ----
    return [];
  };

  /** Drop-in for `node:fs` default export (mock `node:fs`). */
  fs = {
    promises: {
      mkdir: async () => undefined,
      appendFile: async (_p: string, data: string) => {
        this.jsonl += data;
      },
      readFile: async () => {
        if (!this.jsonl) throw new Error('ENOENT');
        return this.jsonl;
      },
    },
  };
}

/** Module singleton so `vi.mock` factories can bind to it via dynamic import. */
export const mpTestStore = new MpSideEffectStore();
export const resetMpTestStore = (): void => mpTestStore.reset();
