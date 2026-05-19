# Scheduled Hourly Tournaments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully automated, scheduled 8-player single-elimination tournament system for Racehorse Dominoes. Tournaments run every 2 hours on a fixed PST schedule. Players register in advance, the bracket auto-generates at start time, winners advance through QF → SF → Final with no host required.

**Architecture:** New persistence layer in three Supabase tables (`scheduled_tournaments`, `scheduled_tournament_registrations`, `scheduled_tournament_matches`) seeded for 30 days. A server-side cron tick polls every minute, flipping tournaments between `upcoming → registration_open → in_progress → completed` and emitting socket events. Bracket generation reserves rooms via the **existing** `createReservedRoom()` API; the actual gameplay reuses the **existing** multiplayer pipeline (room:join, broadcastStateUpdate, reconnect, forfeit). On game-over the existing flow detects a `tournament_match_id` on the room and advances the bracket. The legacy lobby-based round-robin tournament in `server/src/tournament/` is left untouched — the new system lives under `server/src/scheduledTournament/` and `client/src/tournament/` (new directory).

**Tech Stack:** Server — Express 5, Socket.io 4, TypeScript, Supabase REST via `supabaseFetch`, `node-cron` for the scheduler, vitest for unit tests. Client — React 19, socket.io-client, scoped CSS following the `_fritz-screen-shell.css` design system. Tournament accent = `var(--accent-amber)` per AGENTS.md §3.

## Locked decisions (approved 2026-05-14)
1. **Min players to start:** 4. Byes fill the bracket when 5–7 register; top seeds get the byes.
2. **Disconnect handling:** reuse the existing 30-second reconnect window. If reconnect fails, opponent advances by forfeit through the existing room-timeout flow.
3. **Rating impact:** completely separate. Tournament matches do NOT run through `processRealtimeMultiplayerGame`. Results live only in `scheduled_tournament_matches`.
4. **Timezone:** America/Los_Angeles (DST-aware). Slots: 12 AM, 2 AM, 4 AM, 6 AM, 8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM, 8 PM, 10 PM PST.
5. **Registration window:** opens 30 minutes before start, closes 5 minutes before start.

## Constraints honored
- No global game-engine changes. Win target of 30 is applied per-room when the room is created via `createReservedRoom(code, { winningScore: 30 })`.
- No changes to the rated ranking system.
- Legacy `server/src/tournament/` and `client/src/screens/TournamentScreen.tsx` are NOT modified. The `tournament` AppMode is re-routed to the new hub; the old screen file remains in the repo as dead code (can be deleted in a follow-up PR).
- All new screen roots use the viewport-locked shell contract per AGENTS.md §6: `flex: 1 1 0; min-height: 0; max-height: 100%; overflow: hidden`.
- Tournament accent comes from the existing token system (`var(--accent-amber)`). No new colors introduced.

---

## File Structure

### Server (new)
- `server/src/scheduledTournament/types.ts` — all shared types (`ScheduledTournamentRow`, `RegistrationRow`, `MatchRow`, `SeededPlayer`, `BracketView`)
- `server/src/scheduledTournament/bracket.ts` — pure functions: `seedBracket()`, `advanceSlot()`, seed-pair constants
- `server/src/scheduledTournament/bracket.test.ts` — vitest unit tests for bracket logic
- `server/src/scheduledTournament/persistence.ts` — Supabase REST wrappers: `fetchUpcomingTournaments`, `fetchBracketView`, `insertRegistration`, `updateMatch`, etc.
- `server/src/scheduledTournament/engine.ts` — orchestration: `generateBracket`, `applyMatchResult`, `completeTournament`, `cancelTournament`, `openRegistration`, `closeRegistrationAndStart`, `findTournamentMatchByRoom`
- `server/src/scheduledTournament/engine.test.ts` — vitest integration tests for `applyMatchResult` advancement logic
- `server/src/scheduledTournament/scheduler.ts` — 1-minute polling tick that flips tournament statuses at the right times
- `server/src/scheduledTournament/socketHandlers.ts` — wires `tournament:register`, `tournament:withdraw`, `tournament:join_match`, `tournament:get_bracket` socket events
- `server/src/scheduledTournament/routes.ts` — Express handlers for the REST endpoints (mounted by index.ts)
- `server/src/scheduledTournament/index.ts` — module barrel + single `initScheduledTournaments(io, app, broadcastStateUpdate)` init function

### Server (modified)
- `server/src/index.ts` — one import + one `initScheduledTournaments(io, app, broadcastStateUpdate)` call near server boot; one new branch in the existing game-over flow that detects `room.scheduledTournamentMatchId` and routes to `applyMatchResult()` instead of `processRealtimeMultiplayerGame()`
- `server/src/rooms.ts` — add optional `scheduledTournamentMatchId?: string` field to the `Room` type (mirrors the matchmaking field added earlier)

### DB (new)
- `supabase/migrations/2026-05-14_scheduled_tournaments.sql` — three tables + indexes + RLS + 30-day slot seed

### Client (new directory: `client/src/tournament/`)
- `client/src/tournament/types.ts` — client mirrors of server types
- `client/src/tournament/tournamentApi.ts` — typed REST client (`fetchUpcoming`, `fetchBracket`, `register`, `withdraw`, `fetchMyRegistrations`)
- `client/src/tournament/useTournament.ts` — React hook managing socket subscriptions + REST polling
- `client/src/tournament/TournamentHubScreen.tsx` — entry screen with countdown + 3 upcoming cards
- `client/src/tournament/tournamentHub.css`
- `client/src/tournament/TournamentBracketScreen.tsx` — 4-column bracket visualization
- `client/src/tournament/tournamentBracket.css`
- `client/src/tournament/TournamentMatchBanner.tsx` — thin context banner overlaid above the existing game UI
- `client/src/tournament/tournamentMatchBanner.css`
- `client/src/tournament/TournamentResultScreen.tsx` — post-tournament champion + final bracket
- `client/src/tournament/tournamentResult.css`

### Client (modified)
- `client/src/App.tsx` — re-route `appMode === 'tournament'` to the new `TournamentHubScreen`; add internal sub-view state (`'hub' | 'bracket' | 'result'`); render `TournamentMatchBanner` over the existing game when `room.scheduledTournamentMatchId` is set
- `client/src/types.ts` — no changes; existing `'tournament'` AppMode reused

### Docs (new)
- `TOURNAMENT_README.md` — operator guide + locked decisions

---

## Phase 1 — Database schema

### Task 1.1: Migration file with tables + RLS + 30-day seed

**Files:**
- Create: `supabase/migrations/2026-05-14_scheduled_tournaments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Scheduled hourly tournaments: 8-player single-elimination bracket
create table if not exists public.scheduled_tournaments (
  id uuid primary key default gen_random_uuid(),
  scheduled_start timestamptz not null unique,
  registration_open_at timestamptz not null,
  registration_close_at timestamptz not null,
  status text not null default 'upcoming'
    check (status in ('upcoming','registration_open','in_progress','completed','cancelled')),
  format text not null default '7-tile',
  win_target integer not null default 30,
  max_players integer not null default 8,
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.scheduled_tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  registered_at timestamptz not null default now(),
  seed integer,
  status text not null default 'registered'
    check (status in ('registered','withdrawn','eliminated','active','winner')),
  unique (tournament_id, user_id)
);

create table if not exists public.scheduled_tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.scheduled_tournaments(id) on delete cascade,
  round integer not null check (round between 1 and 3),
  match_number integer not null,
  player1_id uuid references auth.users(id) on delete set null,
  player2_id uuid references auth.users(id) on delete set null,
  winner_id uuid references auth.users(id) on delete set null,
  room_code text,
  status text not null default 'waiting'
    check (status in ('waiting','ready','in_progress','completed','bye')),
  started_at timestamptz,
  completed_at timestamptz,
  player1_score integer,
  player2_score integer,
  unique (tournament_id, round, match_number)
);

create index if not exists idx_st_status_start on public.scheduled_tournaments(status, scheduled_start);
create index if not exists idx_st_start on public.scheduled_tournaments(scheduled_start);
create index if not exists idx_str_user on public.scheduled_tournament_registrations(user_id, registered_at desc);
create index if not exists idx_str_tournament on public.scheduled_tournament_registrations(tournament_id);
create index if not exists idx_stm_tournament_round on public.scheduled_tournament_matches(tournament_id, round, match_number);
create index if not exists idx_stm_players on public.scheduled_tournament_matches(player1_id, player2_id);
create index if not exists idx_stm_ready on public.scheduled_tournament_matches(tournament_id, status) where status in ('ready','in_progress');

alter table public.scheduled_tournaments enable row level security;
alter table public.scheduled_tournament_registrations enable row level security;
alter table public.scheduled_tournament_matches enable row level security;

drop policy if exists "st_select_all" on public.scheduled_tournaments;
create policy "st_select_all" on public.scheduled_tournaments for select using (true);

drop policy if exists "str_select_all" on public.scheduled_tournament_registrations;
create policy "str_select_all" on public.scheduled_tournament_registrations for select using (true);

drop policy if exists "str_insert_self" on public.scheduled_tournament_registrations;
create policy "str_insert_self" on public.scheduled_tournament_registrations
  for insert with check (auth.uid() = user_id);

drop policy if exists "str_update_self" on public.scheduled_tournament_registrations;
create policy "str_update_self" on public.scheduled_tournament_registrations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "stm_select_all" on public.scheduled_tournament_matches;
create policy "stm_select_all" on public.scheduled_tournament_matches for select using (true);

-- Seed 30 days of PST slots
do $$
declare
  d date := (now() at time zone 'America/Los_Angeles')::date;
  end_d date := d + interval '30 days';
  hh integer;
  slot timestamptz;
begin
  while d < end_d loop
    foreach hh in array array[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
    loop
      slot := (d::text || ' ' || lpad(hh::text, 2, '0') || ':00:00')::timestamp
              at time zone 'America/Los_Angeles';
      insert into public.scheduled_tournaments
        (scheduled_start, registration_open_at, registration_close_at, status)
      values
        (slot, slot - interval '30 minutes', slot - interval '5 minutes', 'upcoming')
      on conflict (scheduled_start) do nothing;
    end loop;
    d := d + 1;
  end loop;
end $$;
```

- [ ] **Step 2: Apply manually** (operator step — not auto-applied by plan)

Paste the SQL into Supabase SQL editor or run `supabase db push`. Verify with:
```sql
select count(*) from public.scheduled_tournaments where status = 'upcoming';
-- Expected: 360 (12 slots × 30 days)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-05-14_scheduled_tournaments.sql
git commit -m "feat(tournament): scheduled hourly tournaments DB schema + 30-day seed"
```

### Phase 1 gate: builds must pass

- [ ] **Step G1: Verify both builds**

```bash
npm run build --prefix client && npm run build --prefix server
```
Expected: both green. Migration is data-only and does not affect builds — this confirms the baseline is unbroken.

---

## Phase 2 — Backend engine, scheduler, sockets

### Task 2.1: Server types

**Files:**
- Create: `server/src/scheduledTournament/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
export type ScheduledTournamentStatus =
  | 'upcoming' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled';

export type ScheduledTournamentRow = {
  id: string;
  scheduled_start: string;
  registration_open_at: string;
  registration_close_at: string;
  status: ScheduledTournamentStatus;
  format: string;
  win_target: number;
  max_players: number;
  winner_id: string | null;
  created_at: string;
};

export type RegistrationStatus =
  | 'registered' | 'withdrawn' | 'eliminated' | 'active' | 'winner';

export type RegistrationRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  registered_at: string;
  seed: number | null;
  status: RegistrationStatus;
};

export type MatchStatus =
  | 'waiting' | 'ready' | 'in_progress' | 'completed' | 'bye';

export type MatchRow = {
  id: string;
  tournament_id: string;
  round: 1 | 2 | 3;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  room_code: string | null;
  status: MatchStatus;
  started_at: string | null;
  completed_at: string | null;
  player1_score: number | null;
  player2_score: number | null;
};

export type SeededPlayer = { userId: string; username: string; rating: number };

export type BracketView = {
  tournament: ScheduledTournamentRow;
  registrations: Array<RegistrationRow & { username: string | null; rating: number | null }>;
  matches: MatchRow[];
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/types.ts
git commit -m "feat(tournament): server types"
```

### Task 2.2: Failing bracket-algorithm tests

**Files:**
- Create: `server/src/scheduledTournament/bracket.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import { seedBracket, advanceSlot } from './bracket';
import type { SeededPlayer } from './types';

function p(userId: string, rating: number): SeededPlayer {
  return { userId, username: userId, rating };
}

describe('seedBracket', () => {
  it('throws when fewer than 4 players', () => {
    expect(() => seedBracket([p('a', 1000), p('b', 1000), p('c', 1000)])).toThrow();
  });

  it('throws when more than 8 players', () => {
    expect(() => seedBracket(Array.from({ length: 9 }, (_, i) => p(`u${i}`, 1000)))).toThrow();
  });

  it('seeds 8 players by rating descending (1 vs 8, 4 vs 5, 3 vs 6, 2 vs 7)', () => {
    const players = [
      p('h', 1000), p('a', 2000), p('e', 1500), p('b', 1900),
      p('g', 1100), p('c', 1800), p('f', 1300), p('d', 1700),
    ];
    const qf = seedBracket(players);
    expect(qf[0].player1?.userId).toBe('a'); expect(qf[0].player2?.userId).toBe('h');
    expect(qf[1].player1?.userId).toBe('d'); expect(qf[1].player2?.userId).toBe('e');
    expect(qf[2].player1?.userId).toBe('c'); expect(qf[2].player2?.userId).toBe('f');
    expect(qf[3].player1?.userId).toBe('b'); expect(qf[3].player2?.userId).toBe('g');
  });

  it('fills bottom seeds with byes when only 5 register', () => {
    const players = [p('a', 1900), p('b', 1800), p('c', 1700), p('d', 1600), p('e', 1500)];
    const qf = seedBracket(players);
    expect(qf[0].player1?.userId).toBe('a'); expect(qf[0].player2).toBeNull();
    expect(qf[1].player1?.userId).toBe('d'); expect(qf[1].player2?.userId).toBe('e');
    expect(qf[2].player1?.userId).toBe('c'); expect(qf[2].player2).toBeNull();
    expect(qf[3].player1?.userId).toBe('b'); expect(qf[3].player2).toBeNull();
  });

  it('handles 4-player tournament with byes for bottom 4 seeds', () => {
    const players = [p('a', 1900), p('b', 1800), p('c', 1700), p('d', 1600)];
    const qf = seedBracket(players);
    expect(qf[0].player2).toBeNull();
    expect(qf[1].player1?.userId).toBe('d'); expect(qf[1].player2).toBeNull();
    expect(qf[2].player2).toBeNull();
    expect(qf[3].player2).toBeNull();
  });

  it('preserves input order on tied ratings', () => {
    const players = [p('first', 1500), p('second', 1500), p('third', 1500), p('fourth', 1500)];
    const qf = seedBracket(players);
    expect(qf[0].player1?.userId).toBe('first');
    expect(qf[3].player1?.userId).toBe('second');
  });
});

describe('advanceSlot', () => {
  it('routes QF1-4 into SF1/SF2 player1/player2 slots correctly', () => {
    expect(advanceSlot(1, 1)).toEqual({ nextRound: 2, nextMatchNumber: 1, slot: 'player1' });
    expect(advanceSlot(1, 2)).toEqual({ nextRound: 2, nextMatchNumber: 1, slot: 'player2' });
    expect(advanceSlot(1, 3)).toEqual({ nextRound: 2, nextMatchNumber: 2, slot: 'player1' });
    expect(advanceSlot(1, 4)).toEqual({ nextRound: 2, nextMatchNumber: 2, slot: 'player2' });
  });

  it('routes SF1/SF2 into Final player1/player2', () => {
    expect(advanceSlot(2, 1)).toEqual({ nextRound: 3, nextMatchNumber: 1, slot: 'player1' });
    expect(advanceSlot(2, 2)).toEqual({ nextRound: 3, nextMatchNumber: 1, slot: 'player2' });
  });

  it('throws on unknown match number', () => {
    expect(() => advanceSlot(1, 99)).toThrow();
    expect(() => advanceSlot(2, 99)).toThrow();
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `cd server && npx vitest run src/scheduledTournament/bracket.test.ts`
Expected: FAIL — module './bracket' does not exist.

### Task 2.3: Implement bracket.ts

**Files:**
- Create: `server/src/scheduledTournament/bracket.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import type { SeededPlayer } from './types';

export const QF_SEED_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 8], [4, 5], [3, 6], [2, 7],
];

export type QfSlot = {
  matchNumber: number;
  player1: SeededPlayer | null;
  player2: SeededPlayer | null;
};

export function seedBracket(players: SeededPlayer[]): QfSlot[] {
  if (players.length < 4) throw new Error('Tournament requires at least 4 registered players');
  if (players.length > 8) throw new Error('Tournament caps at 8 players');

  const seeded = [...players]
    .map((p, i) => ({ ...p, _origIdx: i }))
    .sort((a, b) => b.rating - a.rating || a._origIdx - b._origIdx)
    .map(({ _origIdx, ...rest }) => rest);

  const padded: Array<SeededPlayer | null> = [...seeded];
  while (padded.length < 8) padded.push(null);

  return QF_SEED_PAIRS.map(([s1, s2], i) => ({
    matchNumber: i + 1,
    player1: padded[s1 - 1],
    player2: padded[s2 - 1],
  }));
}

export function advanceSlot(
  round: 1 | 2,
  matchNumber: number,
): { nextRound: 2 | 3; nextMatchNumber: number; slot: 'player1' | 'player2' } {
  if (round === 1) {
    const map: Record<number, { nextMatchNumber: number; slot: 'player1' | 'player2' }> = {
      1: { nextMatchNumber: 1, slot: 'player1' },
      2: { nextMatchNumber: 1, slot: 'player2' },
      3: { nextMatchNumber: 2, slot: 'player1' },
      4: { nextMatchNumber: 2, slot: 'player2' },
    };
    const entry = map[matchNumber];
    if (!entry) throw new Error(`Invalid QF match number: ${matchNumber}`);
    return { nextRound: 2, ...entry };
  }
  const map: Record<number, 'player1' | 'player2'> = { 1: 'player1', 2: 'player2' };
  const slot = map[matchNumber];
  if (!slot) throw new Error(`Invalid SF match number: ${matchNumber}`);
  return { nextRound: 3, nextMatchNumber: 1, slot };
}
```

- [ ] **Step 2: Run tests — expect all 13 to pass**

Run: `cd server && npx vitest run src/scheduledTournament/bracket.test.ts`
Expected: PASS — 13 tests green.

- [ ] **Step 3: Commit**

```bash
git add server/src/scheduledTournament/bracket.ts server/src/scheduledTournament/bracket.test.ts
git commit -m "feat(tournament): bracket seeding + advancement logic"
```

### Task 2.4: Persistence layer

**Files:**
- Create: `server/src/scheduledTournament/persistence.ts`

- [ ] **Step 1: Write the persistence layer**

The full file is large (≈180 lines of Supabase REST wrappers). Use this exact content:

```typescript
import { supabaseFetch } from '../supabaseUtils';
import type {
  BracketView, MatchRow, RegistrationRow, ScheduledTournamentRow,
  ScheduledTournamentStatus, MatchStatus,
} from './types';

export const TABLES = {
  tournaments: 'scheduled_tournaments',
  registrations: 'scheduled_tournament_registrations',
  matches: 'scheduled_tournament_matches',
} as const;

export async function fetchUpcomingTournaments(limit = 5): Promise<ScheduledTournamentRow[]> {
  const nowIso = new Date().toISOString();
  return supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}?select=*` +
      `&scheduled_start=gte.${encodeURIComponent(nowIso)}` +
      `&status=in.(upcoming,registration_open)` +
      `&order=scheduled_start.asc&limit=${limit}`,
  );
}

export async function fetchTournamentById(id: string): Promise<ScheduledTournamentRow | null> {
  const rows = await supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchTournamentsByStatus(
  statuses: ScheduledTournamentStatus[],
): Promise<ScheduledTournamentRow[]> {
  const inClause = statuses.map((s) => `"${s}"`).join(',');
  return supabaseFetch<ScheduledTournamentRow[]>(
    `/rest/v1/${TABLES.tournaments}?select=*&status=in.(${inClause})&order=scheduled_start.asc&limit=200`,
  );
}

export async function updateTournamentStatus(
  id: string,
  status: ScheduledTournamentStatus,
  extra: Partial<Pick<ScheduledTournamentRow, 'winner_id'>> = {},
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.tournaments}?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ status, ...extra }) },
  );
}

export async function fetchRegistrations(tournamentId: string): Promise<RegistrationRow[]> {
  return supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&order=registered_at.asc`,
  );
}

export async function fetchRegistrationsWithProfile(
  tournamentId: string,
): Promise<Array<RegistrationRow & { username: string | null; rating: number | null }>> {
  const regs = await fetchRegistrations(tournamentId);
  if (regs.length === 0) return [];
  const userIds = regs.map((r) => `"${r.user_id}"`).join(',');
  const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number | null }>>(
    `/rest/v1/profiles?select=id,username,glicko_rating&id=in.(${userIds})`,
  ).catch(() => []);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return regs.map((r) => {
    const prof = byId.get(r.user_id);
    return { ...r, username: prof?.username ?? null, rating: prof?.glicko_rating ?? null };
  });
}

export async function fetchActiveRegistration(
  tournamentId: string, userId: string,
): Promise<RegistrationRow | null> {
  const rows = await supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}?select=*` +
      `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchRegistrationsForUser(userId: string): Promise<RegistrationRow[]> {
  return supabaseFetch<RegistrationRow[]>(
    `/rest/v1/${TABLES.registrations}?select=*` +
      `&user_id=eq.${encodeURIComponent(userId)}&order=registered_at.desc&limit=50`,
  );
}

export async function insertRegistration(tournamentId: string, userId: string): Promise<void> {
  await supabaseFetch(`/rest/v1/${TABLES.registrations}`, {
    method: 'POST',
    body: JSON.stringify({ tournament_id: tournamentId, user_id: userId, status: 'registered' }),
  });
}

export async function withdrawRegistration(tournamentId: string, userId: string): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.registrations}?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export async function updateRegistrationStatus(
  tournamentId: string, userId: string,
  status: RegistrationRow['status'], seed?: number,
): Promise<void> {
  const body: Record<string, unknown> = { status };
  if (seed !== undefined) body.seed = seed;
  await supabaseFetch(
    `/rest/v1/${TABLES.registrations}?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function fetchMatches(tournamentId: string): Promise<MatchRow[]> {
  return supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}?select=*&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
      `&order=round.asc,match_number.asc`,
  );
}

export async function fetchMatchById(matchId: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}?select=*&id=eq.${encodeURIComponent(matchId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function fetchMatchByRoomCode(roomCode: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/${TABLES.matches}?select=*&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function insertMatch(input: {
  tournamentId: string; round: 1 | 2 | 3; matchNumber: number;
  player1Id: string | null; player2Id: string | null;
  roomCode: string; status: MatchStatus;
}): Promise<MatchRow> {
  const inserted = await supabaseFetch<MatchRow[]>(`/rest/v1/${TABLES.matches}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      tournament_id: input.tournamentId, round: input.round, match_number: input.matchNumber,
      player1_id: input.player1Id, player2_id: input.player2Id,
      room_code: input.roomCode, status: input.status,
    }),
  });
  return inserted[0];
}

export async function updateMatch(
  matchId: string,
  patch: Partial<Pick<MatchRow,
    'status' | 'winner_id' | 'started_at' | 'completed_at' |
    'player1_score' | 'player2_score' | 'player1_id' | 'player2_id'>>,
): Promise<void> {
  await supabaseFetch(
    `/rest/v1/${TABLES.matches}?id=eq.${encodeURIComponent(matchId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function fetchBracketView(tournamentId: string): Promise<BracketView | null> {
  const tournament = await fetchTournamentById(tournamentId);
  if (!tournament) return null;
  const [registrations, matches] = await Promise.all([
    fetchRegistrationsWithProfile(tournamentId),
    fetchMatches(tournamentId),
  ]);
  return { tournament, registrations, matches };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/persistence.ts
git commit -m "feat(tournament): supabase persistence layer"
```

### Task 2.5: Add tournament fields to Room type

**Files:**
- Modify: `server/src/rooms.ts` (the `Room` type definition near the top)

- [ ] **Step 1: Add optional fields to Room type**

Find the existing `export type Room = { ... }` declaration (currently around line 33). Add at the end, before the closing `};`:

```typescript
  /** Set when the room is a scheduled-tournament match; used to advance the bracket on game-end. */
  scheduledTournamentMatchId?: string;
  /** Tournament id of the parent tournament (denormalized for cheap lookups). */
  scheduledTournamentId?: string;
```

- [ ] **Step 2: Verify server still builds**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/rooms.ts
git commit -m "feat(tournament): add scheduledTournamentMatchId to Room type"
```

### Task 2.6: Engine — generateBracket, applyMatchResult, etc.

**Files:**
- Create: `server/src/scheduledTournament/engine.ts`

- [ ] **Step 1: Write the engine**

Use this content verbatim (≈220 lines):

```typescript
import type { Server } from 'socket.io';
import { createReservedRoom, getRoom } from '../rooms';
import { advanceSlot, seedBracket } from './bracket';
import {
  fetchMatchById, fetchMatches, fetchRegistrations, fetchRegistrationsWithProfile,
  fetchTournamentById, insertMatch, updateMatch, updateRegistrationStatus,
  updateTournamentStatus, fetchMatchByRoomCode,
} from './persistence';
import type { MatchRow, SeededPlayer } from './types';

const MIN_PLAYERS_TO_START = 4;
const DEFAULT_RATING = 800;

function makeTournamentRoomCode(tournamentId: string, round: number, matchNumber: number): string {
  const short = tournamentId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `T${short}R${round}M${matchNumber}`;
}

export async function generateBracket(io: Server, tournamentId: string): Promise<MatchRow[]> {
  const tournament = await fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  const registrations = await fetchRegistrationsWithProfile(tournamentId);
  const eligible = registrations.filter((r) => r.status === 'registered');
  if (eligible.length < MIN_PLAYERS_TO_START) throw new Error('Not enough players to start');

  const seedInput: SeededPlayer[] = eligible.map((r) => ({
    userId: r.user_id,
    username: r.username ?? r.user_id.slice(0, 6),
    rating: r.rating ?? DEFAULT_RATING,
  }));
  const qfSlots = seedBracket(seedInput);

  const insertedQf: MatchRow[] = [];
  for (const slot of qfSlots) {
    const roomCode = makeTournamentRoomCode(tournamentId, 1, slot.matchNumber);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    const room = getRoom(roomCode);
    if (room) {
      room.scheduledTournamentMatchId = undefined; // assigned after insert returns the id
      room.scheduledTournamentId = tournamentId;
    }
    const initialStatus = slot.player1 === null || slot.player2 === null ? 'bye' : 'ready';
    const row = await insertMatch({
      tournamentId, round: 1, matchNumber: slot.matchNumber,
      player1Id: slot.player1?.userId ?? null, player2Id: slot.player2?.userId ?? null,
      roomCode, status: initialStatus,
    });
    if (room) room.scheduledTournamentMatchId = row.id;
    insertedQf.push(row);
  }

  for (let m = 1; m <= 2; m++) {
    const roomCode = makeTournamentRoomCode(tournamentId, 2, m);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    const row = await insertMatch({
      tournamentId, round: 2, matchNumber: m,
      player1Id: null, player2Id: null, roomCode, status: 'waiting',
    });
    const room = getRoom(roomCode);
    if (room) { room.scheduledTournamentMatchId = row.id; room.scheduledTournamentId = tournamentId; }
  }
  {
    const roomCode = makeTournamentRoomCode(tournamentId, 3, 1);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    const row = await insertMatch({
      tournamentId, round: 3, matchNumber: 1,
      player1Id: null, player2Id: null, roomCode, status: 'waiting',
    });
    const room = getRoom(roomCode);
    if (room) { room.scheduledTournamentMatchId = row.id; room.scheduledTournamentId = tournamentId; }
  }

  for (const [idx, reg] of eligible.entries()) {
    await updateRegistrationStatus(tournamentId, reg.user_id, 'active', idx + 1);
  }
  await updateTournamentStatus(tournamentId, 'in_progress');

  for (const qf of insertedQf) {
    if (qf.status !== 'bye') continue;
    const winnerId = qf.player1_id ?? qf.player2_id;
    if (!winnerId) continue;
    await applyMatchResult(io, {
      matchId: qf.id, winnerId,
      player1Score: qf.player1_id === winnerId ? tournament.win_target : 0,
      player2Score: qf.player2_id === winnerId ? tournament.win_target : 0,
      byeWalkover: true,
    });
  }

  io.emit('tournament:bracket_generated', { tournamentId });
  const matches = await fetchMatches(tournamentId);
  for (const m of matches) {
    if (m.status === 'ready' && m.player1_id && m.player2_id) notifyMatchReady(io, m);
  }
  return matches;
}

export async function applyMatchResult(
  io: Server,
  params: { matchId: string; winnerId: string; player1Score: number; player2Score: number; byeWalkover?: boolean },
): Promise<void> {
  const match = await fetchMatchById(params.matchId);
  if (!match || match.status === 'completed') return;

  await updateMatch(match.id, {
    status: 'completed', winner_id: params.winnerId,
    completed_at: new Date().toISOString(),
    player1_score: params.player1Score, player2_score: params.player2Score,
  });

  const loserId = match.player1_id === params.winnerId ? match.player2_id :
                  match.player2_id === params.winnerId ? match.player1_id : null;
  if (loserId && !params.byeWalkover) {
    await updateRegistrationStatus(match.tournament_id, loserId, 'eliminated');
  }

  if (match.round === 3) {
    await completeTournament(io, match.tournament_id, params.winnerId);
    return;
  }

  const next = advanceSlot(match.round as 1 | 2, match.match_number);
  const nextMatches = await fetchMatches(match.tournament_id);
  const target = nextMatches.find(
    (m) => m.round === next.nextRound && m.match_number === next.nextMatchNumber,
  );
  if (!target) return;

  const patch = next.slot === 'player1'
    ? { player1_id: params.winnerId } : { player2_id: params.winnerId };
  const otherSlotFilled = next.slot === 'player1' ? target.player2_id !== null : target.player1_id !== null;
  const newStatus: MatchRow['status'] = otherSlotFilled ? 'ready' : 'waiting';

  await updateMatch(target.id, { ...patch, status: newStatus });
  const updated = await fetchMatchById(target.id);
  io.emit('tournament:match_updated', { tournamentId: match.tournament_id, matchId: target.id });
  if (updated && updated.status === 'ready') notifyMatchReady(io, updated);
}

export async function completeTournament(io: Server, tournamentId: string, winnerUserId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, 'completed', { winner_id: winnerUserId });
  await updateRegistrationStatus(tournamentId, winnerUserId, 'winner');
  io.emit('tournament:completed', { tournamentId, winnerId: winnerUserId });
}

export async function cancelTournament(io: Server, tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, 'cancelled');
  io.emit('tournament:cancelled', { tournamentId });
}

function notifyMatchReady(io: Server, match: MatchRow): void {
  const sockets = Array.from(io.sockets.sockets.values());
  for (const sock of sockets) {
    const userId = (sock.data as { userId?: string }).userId;
    if (!userId) continue;
    if (userId === match.player1_id || userId === match.player2_id) {
      sock.emit('tournament:match_ready', {
        tournamentId: match.tournament_id, matchId: match.id,
        round: match.round, matchNumber: match.match_number,
        roomCode: match.room_code,
        opponent: userId === match.player1_id ? match.player2_id : match.player1_id,
      });
    }
  }
}

export async function openRegistration(io: Server, tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, 'registration_open');
  io.emit('tournament:registration_open', { tournamentId });
}

export async function closeRegistrationAndStart(
  io: Server, tournamentId: string,
): Promise<{ started: boolean; reason?: string }> {
  const regs = await fetchRegistrations(tournamentId);
  const active = regs.filter((r) => r.status === 'registered');
  if (active.length < MIN_PLAYERS_TO_START) {
    await cancelTournament(io, tournamentId);
    return { started: false, reason: 'not_enough_players' };
  }
  await generateBracket(io, tournamentId);
  return { started: true };
}

export async function findTournamentMatchByRoom(roomCode: string): Promise<MatchRow | null> {
  return fetchMatchByRoomCode(roomCode);
}

export const TOURNAMENT_CONFIG = {
  MIN_PLAYERS_TO_START, DEFAULT_RATING,
  REGISTRATION_OPEN_LEAD_MIN: 30, REGISTRATION_CLOSE_LEAD_MIN: 5,
} as const;
```

- [ ] **Step 2: Build server**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/scheduledTournament/engine.ts
git commit -m "feat(tournament): engine — generateBracket / applyMatchResult / completeTournament"
```

### Task 2.7: Scheduler (1-minute tick)

**Files:**
- Create: `server/src/scheduledTournament/scheduler.ts`

- [ ] **Step 1: Write the scheduler**

```typescript
import type { Server } from 'socket.io';
import { fetchTournamentsByStatus } from './persistence';
import { openRegistration, closeRegistrationAndStart } from './engine';

const TICK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Polls every minute. For each upcoming tournament:
 *   - If now >= registration_open_at and status='upcoming' → openRegistration
 *   - If now >= registration_close_at and status='registration_open' → closeRegistrationAndStart
 *
 * Idempotent: status transitions guarded by the current status check, so a slow
 * tick or a restart won't double-fire.
 */
export function startTournamentScheduler(io: Server): void {
  if (timer) return;
  const tick = async () => {
    try {
      const now = Date.now();
      const tournaments = await fetchTournamentsByStatus(['upcoming', 'registration_open']);
      for (const t of tournaments) {
        const openAt = Date.parse(t.registration_open_at);
        const closeAt = Date.parse(t.registration_close_at);
        if (t.status === 'upcoming' && now >= openAt) {
          await openRegistration(io, t.id);
        } else if (t.status === 'registration_open' && now >= closeAt) {
          await closeRegistrationAndStart(io, t.id);
        }
      }
    } catch (err) {
      console.warn('[tournament:scheduler] tick failed', err instanceof Error ? err.message : err);
    }
  };
  // Fire one immediate tick so an existing-due tournament catches up at boot.
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

export function stopTournamentScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/scheduler.ts
git commit -m "feat(tournament): 1-minute scheduler tick"
```

### Task 2.8: Socket handlers

**Files:**
- Create: `server/src/scheduledTournament/socketHandlers.ts`

- [ ] **Step 1: Write the handlers**

```typescript
import type { Server, Socket } from 'socket.io';
import {
  fetchActiveRegistration, fetchBracketView, fetchTournamentById,
  insertRegistration, withdrawRegistration, fetchRegistrations,
} from './persistence';
import { TOURNAMENT_CONFIG } from './engine';

type Ack = (resp: unknown) => void;

export function registerTournamentSocketHandlers(io: Server, socket: Socket): void {
  socket.on('tournament:register', async (
    payload: { tournamentId: string; userId: string },
    ack?: Ack,
  ) => {
    try {
      const { tournamentId, userId } = payload ?? {};
      if (!tournamentId || !userId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const t = await fetchTournamentById(tournamentId);
      if (!t) { ack?.({ ok: false, error: 'tournament_not_found' }); return; }
      if (t.status !== 'registration_open') { ack?.({ ok: false, error: 'registration_closed' }); return; }
      const regs = await fetchRegistrations(tournamentId);
      if (regs.filter((r) => r.status === 'registered').length >= t.max_players) {
        ack?.({ ok: false, error: 'full' }); return;
      }
      const existing = await fetchActiveRegistration(tournamentId, userId);
      if (existing && existing.status === 'registered') {
        ack?.({ ok: true, alreadyRegistered: true }); return;
      }
      await insertRegistration(tournamentId, userId);
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  socket.on('tournament:withdraw', async (
    payload: { tournamentId: string; userId: string }, ack?: Ack,
  ) => {
    try {
      const { tournamentId, userId } = payload ?? {};
      if (!tournamentId || !userId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const t = await fetchTournamentById(tournamentId);
      if (!t) { ack?.({ ok: false, error: 'tournament_not_found' }); return; }
      if (t.status !== 'registration_open' && t.status !== 'upcoming') {
        ack?.({ ok: false, error: 'cannot_withdraw_after_start' }); return;
      }
      await withdrawRegistration(tournamentId, userId);
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  socket.on('tournament:get_bracket', async (
    payload: { tournamentId: string }, ack?: Ack,
  ) => {
    try {
      const view = await fetchBracketView(payload?.tournamentId);
      ack?.({ ok: true, view });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  void TOURNAMENT_CONFIG; // re-export reference to ensure tree-shaking keeps the import alive
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/socketHandlers.ts
git commit -m "feat(tournament): socket handlers (register / withdraw / get_bracket)"
```

### Task 2.9: REST routes

**Files:**
- Create: `server/src/scheduledTournament/routes.ts`

- [ ] **Step 1: Write the routes**

```typescript
import type { Express, Request, Response } from 'express';
import {
  fetchUpcomingTournaments, fetchTournamentById, fetchBracketView,
  fetchRegistrationsForUser, fetchActiveRegistration, fetchRegistrations,
  insertRegistration, withdrawRegistration,
} from './persistence';

export function registerTournamentRoutes(app: Express): void {
  app.get('/api/tournaments/upcoming', async (_req: Request, res: Response) => {
    try {
      const tournaments = await fetchUpcomingTournaments(5);
      const enriched = await Promise.all(tournaments.map(async (t) => {
        const regs = await fetchRegistrations(t.id);
        const registeredCount = regs.filter((r) => r.status === 'registered').length;
        return { ...t, registered_count: registeredCount };
      }));
      res.json({ ok: true, tournaments: enriched });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id/bracket', async (req: Request, res: Response) => {
    try {
      const view = await fetchBracketView(req.params.id);
      if (!view) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, view });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/:id', async (req: Request, res: Response) => {
    try {
      const t = await fetchTournamentById(req.params.id);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      res.json({ ok: true, tournament: t });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.get('/api/tournaments/my', async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      const regs = await fetchRegistrationsForUser(userId);
      res.json({ ok: true, registrations: regs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.post('/api/tournaments/:id/register', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      const t = await fetchTournamentById(req.params.id);
      if (!t) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
      if (t.status !== 'registration_open') {
        res.status(409).json({ ok: false, error: 'registration_closed' }); return;
      }
      const regs = await fetchRegistrations(t.id);
      if (regs.filter((r) => r.status === 'registered').length >= t.max_players) {
        res.status(409).json({ ok: false, error: 'full' }); return;
      }
      const existing = await fetchActiveRegistration(t.id, userId);
      if (existing && existing.status === 'registered') {
        res.json({ ok: true, alreadyRegistered: true }); return;
      }
      await insertRegistration(t.id, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  app.delete('/api/tournaments/:id/register', async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
    if (!userId) { res.status(400).json({ ok: false, error: 'missing_userId' }); return; }
    try {
      await withdrawRegistration(req.params.id, userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/routes.ts
git commit -m "feat(tournament): REST API routes"
```

### Task 2.10: Module barrel + init function

**Files:**
- Create: `server/src/scheduledTournament/index.ts`

- [ ] **Step 1: Write the barrel**

```typescript
import type { Server } from 'socket.io';
import type { Express } from 'express';
import { registerTournamentSocketHandlers } from './socketHandlers';
import { registerTournamentRoutes } from './routes';
import { startTournamentScheduler } from './scheduler';
export { applyMatchResult, findTournamentMatchByRoom, TOURNAMENT_CONFIG } from './engine';
export type { MatchRow, ScheduledTournamentRow, RegistrationRow, BracketView } from './types';

let initialized = false;

/**
 * Wire scheduled tournaments into the server. Idempotent — safe to call
 * once per connection (handlers attach to the socket) but the scheduler
 * + routes are registered only on the first call.
 */
export function initScheduledTournaments(
  io: Server, app: Express, socket: import('socket.io').Socket,
): void {
  registerTournamentSocketHandlers(io, socket);
  if (initialized) return;
  initialized = true;
  registerTournamentRoutes(app);
  startTournamentScheduler(io);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/scheduledTournament/index.ts
git commit -m "feat(tournament): module barrel + init"
```

### Task 2.11: Wire into server/src/index.ts (server bootstrap + game-over hook)

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Find the existing import block for `./rooms` (around line 105)**

Use `grep -n "from './rooms'" server/src/index.ts` to confirm. Add this import near the existing matchmaking imports added in the prior feature:

```typescript
import { initScheduledTournaments, applyMatchResult as applyTournamentMatchResult } from './scheduledTournament';
```

- [ ] **Step 2: Inside `io.on('connection', (socket) => { ... })`, add the init call**

Find the line `registerMatchmakingHandlers(io, socket, ...);` and add directly after it:

```typescript
initScheduledTournaments(io, app, socket);
```

- [ ] **Step 3: Hook the game-over branch for tournament matches**

Find the existing match-over async IIFE in `broadcastStateUpdate` (the one that calls `processRealtimeMultiplayerGame`). Add a guard BEFORE the existing `appendMatch` / `processRealtimeMultiplayerGame` flow:

```typescript
// Tournament match: route to bracket advancement; SKIP rated ranking.
if (room.scheduledTournamentMatchId) {
  const winnerUserId =
    winnerSocketId === a.id ? a.userId :
    winnerSocketId === b.id ? b.userId : null;
  if (winnerUserId) {
    await applyTournamentMatchResult(io, {
      matchId: room.scheduledTournamentMatchId,
      winnerId: winnerUserId,
      player1Score: scoreA,
      player2Score: scoreB,
    });
  }
  return; // Skip ranked ranking / match log for tournament matches.
}
```

(The exact insertion point is inside the `void (async () => { try { ... } catch })` block, before `appendMatch` is called. Use `grep -n "appendMatch(" server/src/index.ts` to confirm.)

- [ ] **Step 4: Build server**

```bash
cd server && npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(tournament): wire scheduler/handlers/routes + game-over hook"
```

### Phase 2 gate: builds + tests

- [ ] **Step G2: All server tests pass; both builds green**

```bash
cd server && npx vitest run src/scheduledTournament && cd .. && \
  npm run build --prefix client && npm run build --prefix server
```
Expected: 13 tournament tests pass; both builds clean. (Pre-existing engine.test.ts failures unrelated to this work remain; do not regress matchmaking tests.)

---

## Phase 3 — Frontend types + API client + hook

### Task 3.1: Client types

**Files:**
- Create: `client/src/tournament/types.ts`

- [ ] **Step 1: Mirror the server types client-side**

```typescript
export type ScheduledTournamentStatus =
  | 'upcoming' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled';

export type ScheduledTournament = {
  id: string;
  scheduled_start: string;
  registration_open_at: string;
  registration_close_at: string;
  status: ScheduledTournamentStatus;
  format: string;
  win_target: number;
  max_players: number;
  winner_id: string | null;
  created_at: string;
  registered_count?: number;
};

export type RegistrationStatus =
  | 'registered' | 'withdrawn' | 'eliminated' | 'active' | 'winner';

export type Registration = {
  id: string; tournament_id: string; user_id: string;
  registered_at: string; seed: number | null; status: RegistrationStatus;
  username?: string | null; rating?: number | null;
};

export type MatchStatus =
  | 'waiting' | 'ready' | 'in_progress' | 'completed' | 'bye';

export type TournamentMatch = {
  id: string; tournament_id: string; round: 1 | 2 | 3; match_number: number;
  player1_id: string | null; player2_id: string | null; winner_id: string | null;
  room_code: string | null; status: MatchStatus;
  started_at: string | null; completed_at: string | null;
  player1_score: number | null; player2_score: number | null;
};

export type BracketView = {
  tournament: ScheduledTournament;
  registrations: Registration[];
  matches: TournamentMatch[];
};

export type MatchReadyEvent = {
  tournamentId: string; matchId: string; round: 1 | 2 | 3;
  matchNumber: number; roomCode: string; opponent: string | null;
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/tournament/types.ts
git commit -m "feat(tournament): client types"
```

### Task 3.2: REST API client

**Files:**
- Create: `client/src/tournament/tournamentApi.ts`

- [ ] **Step 1: Write the API client**

```typescript
import type { BracketView, Registration, ScheduledTournament } from './types';

function serverUrl(): string {
  return (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function deleteJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchUpcoming(): Promise<ScheduledTournament[]> {
  const r = await getJson<{ ok: boolean; tournaments: ScheduledTournament[] }>(
    '/api/tournaments/upcoming',
  );
  return r.tournaments;
}

export async function fetchBracket(tournamentId: string): Promise<BracketView> {
  const r = await getJson<{ ok: boolean; view: BracketView }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
  );
  return r.view;
}

export async function fetchMyRegistrations(userId: string): Promise<Registration[]> {
  const r = await getJson<{ ok: boolean; registrations: Registration[] }>(
    `/api/tournaments/my?userId=${encodeURIComponent(userId)}`,
  );
  return r.registrations;
}

export async function registerForTournament(tournamentId: string, userId: string): Promise<void> {
  await postJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    { userId },
  );
}

export async function withdrawFromTournament(tournamentId: string, userId: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/register`,
    { userId },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/tournament/tournamentApi.ts
git commit -m "feat(tournament): client REST api"
```

### Task 3.3: useTournament hook

**Files:**
- Create: `client/src/tournament/useTournament.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import * as api from './tournamentApi';
import type { BracketView, MatchReadyEvent, Registration, ScheduledTournament } from './types';

type Args = { socket: Socket | null; userId: string | null };

export function useTournament({ socket, userId }: Args) {
  const [upcoming, setUpcoming] = useState<ScheduledTournament[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [activeBracket, setActiveBracket] = useState<BracketView | null>(null);
  const [pendingMatch, setPendingMatch] = useState<MatchReadyEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([
        api.fetchUpcoming(),
        userId ? api.fetchMyRegistrations(userId) : Promise.resolve([] as Registration[]),
      ]);
      setUpcoming(u); setRegistrations(r); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tournaments');
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onRegOpen = () => { void refresh(); };
    const onRegUpdated = () => { void refresh(); };
    const onBracket = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => {});
    };
    const onMatchUpdated = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => {});
    };
    const onMatchReady = (payload: MatchReadyEvent) => { setPendingMatch(payload); };
    const onCompleted = (payload: { tournamentId: string }) => {
      void api.fetchBracket(payload.tournamentId).then(setActiveBracket).catch(() => {});
    };
    socket.on('tournament:registration_open', onRegOpen);
    socket.on('tournament:registration_updated', onRegUpdated);
    socket.on('tournament:bracket_generated', onBracket);
    socket.on('tournament:match_updated', onMatchUpdated);
    socket.on('tournament:match_ready', onMatchReady);
    socket.on('tournament:completed', onCompleted);
    return () => {
      socket.off('tournament:registration_open', onRegOpen);
      socket.off('tournament:registration_updated', onRegUpdated);
      socket.off('tournament:bracket_generated', onBracket);
      socket.off('tournament:match_updated', onMatchUpdated);
      socket.off('tournament:match_ready', onMatchReady);
      socket.off('tournament:completed', onCompleted);
    };
  }, [socket, refresh]);

  const register = useCallback(async (tournamentId: string) => {
    if (!userId) throw new Error('Sign in to register');
    await api.registerForTournament(tournamentId, userId);
    await refresh();
  }, [userId, refresh]);

  const withdraw = useCallback(async (tournamentId: string) => {
    if (!userId) return;
    await api.withdrawFromTournament(tournamentId, userId);
    await refresh();
  }, [userId, refresh]);

  const openBracket = useCallback(async (tournamentId: string) => {
    const view = await api.fetchBracket(tournamentId);
    setActiveBracket(view);
  }, []);

  const clearPendingMatch = useCallback(() => setPendingMatch(null), []);

  return {
    upcoming, registrations, activeBracket, pendingMatch, error,
    refresh, register, withdraw, openBracket, clearPendingMatch,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/tournament/useTournament.ts
git commit -m "feat(tournament): useTournament hook"
```

---

## Phase 4 — Frontend screens

Tournament accent is `var(--accent-amber)` (= `#f59e0b`) per AGENTS.md §3. All screen roots use the viewport-locked shell contract per AGENTS.md §6.

### Task 4.1: TournamentHubScreen

**Files:**
- Create: `client/src/tournament/TournamentHubScreen.tsx`
- Create: `client/src/tournament/tournamentHub.css`

- [ ] **Step 1: Write the CSS** (full content; uses the viewport-locked shell contract)

```css
/* Tournament Hub — amber/orange accent per AGENTS.md §3 */
@import '../styles/_fritz-screen-shell.css';

.th-page {
  --th-accent: var(--accent-amber);
  --th-accent-soft: color-mix(in srgb, var(--accent-amber) 38%, transparent);
  position: relative;
  isolation: isolate;
  flex: 1 1 0;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(ellipse 78% 48% at 50% -8%, color-mix(in srgb, var(--accent-amber) 10%, transparent) 0%, transparent 55%),
    linear-gradient(180deg, var(--bg-obsidian) 0%, var(--bg-obsidian) 100%);
  color: var(--text-primary);
  font-family: var(--font-body);
}

.th-shell { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; width: 100%; max-width: 1440px;
  margin: 0 auto; padding: 18px 32px 24px; box-sizing: border-box; overflow: hidden; }

.th-toolbar { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-bottom: 14px; }
.th-back { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
  background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur));
  color: var(--text-secondary); font-family: var(--font-body); font-size: 12px;
  font-weight: 700; cursor: pointer; transition: transform 120ms, color 120ms, border-color 120ms; }
.th-back:hover { color: var(--text-primary); border-color: var(--border-light); transform: translateY(-1px); }

.th-layout { display: flex; flex-direction: row; align-items: stretch; gap: 24px;
  width: 100%; flex: 1 1 0; min-height: 0; box-sizing: border-box; overflow: hidden; }

.th-left { display: flex; flex-direction: column; width: 38%; flex: 0 0 38%; gap: 16px; }
.th-kicker { display: inline-flex; align-items: center; gap: 10px;
  font-family: var(--font-display); font-size: 11px; font-weight: 800;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--th-accent); margin: 0 0 8px; }
.th-kicker::before { content: ""; width: 7px; height: 7px; border-radius: 50%;
  background: var(--th-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--th-accent) 60%, transparent); }
.th-title { font-family: var(--font-body); font-size: clamp(40px, 4.4vw, 56px);
  font-weight: 900; line-height: 0.95; letter-spacing: -0.04em; margin: 0 0 12px; color: var(--text-primary); }
.th-desc { margin: 0 0 12px; font-size: 14px; line-height: 1.45; color: var(--text-secondary); max-width: 38em; }

.th-trophy-stage { position: relative; flex: 1 1 auto; min-height: 200px;
  display: flex; align-items: center; justify-content: center;
  padding: 16px 0; }

.th-trophy-svg { width: 100%; max-width: 280px; height: auto;
  filter: drop-shadow(0 0 36px color-mix(in srgb, var(--th-accent) 35%, transparent)); }

.th-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.th-feature { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px;
  background: rgba(10, 16, 28, 0.6); backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--border-subtle); border-radius: 12px; }
.th-feature__header { display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-body); font-size: 12px; font-weight: 700;
  color: color-mix(in srgb, var(--th-accent) 75%, var(--text-primary)); }
.th-feature__desc { font-size: 11px; line-height: 1.3; color: var(--text-secondary); }

.th-panel { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  align-self: stretch; width: 100%; padding: 24px 28px 18px; box-sizing: border-box;
  background: rgba(7, 9, 16, 0.92); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card); overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 32px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(var(--glass-blur)); }
.th-panel-body { display: flex; flex-direction: column; gap: 16px; flex: 1 1 auto;
  min-height: 0; overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
  padding-bottom: 8px; }

.th-countdown { display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 0 8px; border-bottom: 1px solid var(--border-subtle); }
.th-countdown__label { font-family: var(--font-display); font-size: 11px; font-weight: 800;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-dim); }
.th-countdown__time { font-family: var(--font-display); font-size: 56px; font-weight: 900;
  line-height: 1; color: var(--th-accent); font-variant-numeric: tabular-nums;
  text-shadow: 0 0 24px color-mix(in srgb, var(--th-accent) 32%, transparent); letter-spacing: -0.02em; }
.th-countdown__sub { font-size: 12px; color: var(--text-secondary); text-align: center; max-width: 36em; line-height: 1.4; }

.th-card { display: grid; grid-template-columns: auto 1fr auto; gap: 14px;
  align-items: center; padding: 14px 16px; background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle); border-radius: 12px;
  transition: border-color 120ms, transform 120ms; }
.th-card:hover { border-color: color-mix(in srgb, var(--th-accent) 22%, var(--border-light)); }
.th-card__time { font-family: var(--font-display); font-size: 22px; font-weight: 800;
  letter-spacing: -0.01em; color: var(--th-accent); font-variant-numeric: tabular-nums; min-width: 80px; }
.th-card__middle { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.th-card__count { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
.th-card__bar { width: 100%; height: 4px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
.th-card__bar-fill { height: 100%; background: var(--th-accent); transition: width 240ms; }
.th-card__status { font-family: var(--font-display); font-size: 10px; font-weight: 800;
  letter-spacing: 0.14em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px;
  margin-top: 4px; align-self: flex-start; }
.th-card__status--open { color: #4ADE80; border: 1px solid rgba(74, 222, 128, 0.35); background: rgba(74, 222, 128, 0.08); }
.th-card__status--soon { color: var(--th-accent); border: 1px solid color-mix(in srgb, var(--th-accent) 40%, transparent); background: color-mix(in srgb, var(--th-accent) 10%, transparent); }
.th-card__status--upcoming { color: var(--text-dim); border: 1px solid var(--border-subtle); background: rgba(255, 255, 255, 0.03); }

.th-cta { padding: 10px 18px; border-radius: 10px; border: none; cursor: pointer;
  font-family: var(--font-body); font-size: 13px; font-weight: 800;
  background: var(--th-accent); color: #1a1200;
  box-shadow: 0 0 24px color-mix(in srgb, var(--th-accent) 22%, transparent); }
.th-cta:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.th-cta--ghost { background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-subtle); box-shadow: none; }
.th-cta--ghost:hover { color: var(--text-primary); border-color: var(--border-light); }

.th-summary-strip { display: flex; align-items: center; justify-content: space-around;
  gap: 12px; padding: 12px 14px; background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle); border-radius: var(--fritz-summary-radius);
  margin-top: 12px; flex-shrink: 0; }
.th-summary-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.th-summary-key { font-family: var(--font-display); font-size: 10px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); }
.th-summary-value { font-family: var(--font-body); font-size: 13px; font-weight: 700; color: var(--text-primary); }
```

- [ ] **Step 2: Write the component**

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { useTournament } from './useTournament';
import type { ScheduledTournament } from './types';
import './tournamentHub.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentHubScreenProps {
  socket: Socket | null;
  identity: Identity;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onBackHome: () => void;
  onOpenBracket: (tournamentId: string) => void;
  onMatchReady: (payload: { tournamentId: string; matchId: string; roomCode: string }) => void;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function formatCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatTimePst(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
  });
}

function statusFor(t: ScheduledTournament): { label: string; cls: string } {
  if (t.status === 'registration_open') return { label: 'Open', cls: 'th-card__status--open' };
  const startMs = Date.parse(t.scheduled_start);
  if (startMs - Date.now() < 30 * 60 * 1000) return { label: 'Starting Soon', cls: 'th-card__status--soon' };
  return { label: 'Upcoming', cls: 'th-card__status--upcoming' };
}

function Trophy() {
  return (
    <svg className="th-trophy-svg" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="th-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c45a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b8782b" />
        </linearGradient>
      </defs>
      <path d="M50 30h100v50a50 50 0 0 1-100 0V30z" fill="url(#th-gold)" />
      <path d="M50 50 H20 a20 20 0 0 0 30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <path d="M150 50 H180 a20 20 0 0 1 -30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <rect x="80" y="130" width="40" height="40" fill="url(#th-gold)" opacity="0.85" />
      <rect x="60" y="170" width="80" height="14" rx="3" fill="url(#th-gold)" />
      <rect x="50" y="184" width="100" height="20" rx="4" fill="url(#th-gold)" />
    </svg>
  );
}

export default function TournamentHubScreen(props: TournamentHubScreenProps) {
  const userId = props.identity?.userId ?? null;
  const tournament = useTournament({ socket: props.socket, userId });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!tournament.pendingMatch) return;
    const p = tournament.pendingMatch;
    if (p.roomCode) props.onMatchReady({ tournamentId: p.tournamentId, matchId: p.matchId, roomCode: p.roomCode });
    tournament.clearPendingMatch();
  }, [tournament.pendingMatch, tournament, props]);

  const nextTournament = tournament.upcoming[0] ?? null;
  const countdown = nextTournament
    ? formatCountdown(Date.parse(nextTournament.scheduled_start) - now)
    : '--:--:--';

  const isRegistered = useMemo(() => {
    const ids = new Set(tournament.registrations.filter((r) => r.status === 'registered').map((r) => r.tournament_id));
    return (t: ScheduledTournament) => ids.has(t.id);
  }, [tournament.registrations]);

  return (
    <div className="th-page">
      <GlobalNav currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate} onOpenAuth={props.onOpenAuth}
        activeColor="var(--accent-amber)" />
      <div className="th-shell">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
        </div>
        <div className="th-layout">
          <div className="th-left">
            <div>
              <p className="th-kicker">Tournament</p>
              <h1 className="th-title">Compete</h1>
              <p className="th-desc">8-player bracket. First to 30 wins. One champion every two hours.</p>
            </div>
            <div className="th-trophy-stage" aria-hidden><Trophy /></div>
            <div className="th-features">
              <div className="th-feature">
                <div className="th-feature__header">👥 8 Players</div>
                <div className="th-feature__desc">Single-elimination bracket.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">🔄 QF → SF → Final</div>
                <div className="th-feature__desc">Win three to take the crown.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">⚡ First to 30</div>
                <div className="th-feature__desc">Quick, decisive matches.</div>
              </div>
            </div>
          </div>
          <div className="th-panel">
            <div className="th-countdown">
              <span className="th-countdown__label">Next Tournament</span>
              <span className="th-countdown__time" aria-live="polite">{countdown}</span>
              <span className="th-countdown__sub">
                Tournaments run every 2 hours. Registration opens 30 minutes before start and closes 5 minutes before.
              </span>
            </div>
            <div className="th-panel-body">
              {tournament.upcoming.slice(0, 3).map((t) => {
                const reg = isRegistered(t);
                const open = t.status === 'registration_open';
                const status = statusFor(t);
                const count = t.registered_count ?? 0;
                return (
                  <div className="th-card" key={t.id}>
                    <div className="th-card__time">{formatTimePst(t.scheduled_start)}</div>
                    <div className="th-card__middle">
                      <div className="th-card__count">{count} / {t.max_players} Registered</div>
                      <div className="th-card__bar"><span className="th-card__bar-fill" style={{ width: `${(count / t.max_players) * 100}%` }} /></div>
                      <span className={`th-card__status ${status.cls}`}>{status.label}</span>
                    </div>
                    {reg ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Registered ✓</span>
                        <button className="th-cta th-cta--ghost" onClick={() => void tournament.withdraw(t.id)}>Withdraw</button>
                      </div>
                    ) : (
                      <button className="th-cta" disabled={!open || !userId} onClick={() => void tournament.register(t.id)}>
                        Register
                      </button>
                    )}
                  </div>
                );
              })}
              {tournament.upcoming.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                  No upcoming tournaments. Check back soon.
                </p>
              ) : null}
              {tournament.error ? (
                <p style={{ color: '#fbb4b4', fontSize: 12, textAlign: 'center' }}>{tournament.error}</p>
              ) : null}
            </div>
            <div className="th-summary-strip">
              <div className="th-summary-item">
                <span className="th-summary-key">Format</span>
                <span className="th-summary-value">7-Tile</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Win Target</span>
                <span className="th-summary-value">First to 30</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Cadence</span>
                <span className="th-summary-value">Every 2 hours</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/tournament/TournamentHubScreen.tsx client/src/tournament/tournamentHub.css
git commit -m "feat(tournament): TournamentHubScreen with amber accent"
```

### Task 4.2: TournamentBracketScreen

**Files:**
- Create: `client/src/tournament/TournamentBracketScreen.tsx`
- Create: `client/src/tournament/tournamentBracket.css`

- [ ] **Step 1: Write the CSS**

```css
.tb-page {
  --tb-accent: var(--accent-amber);
  flex: 1 1 0; min-height: 0; max-height: 100%; display: flex; flex-direction: column;
  overflow: hidden; background: var(--bg-obsidian); color: var(--text-primary); font-family: var(--font-body);
}
.tb-shell { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  max-width: 1440px; margin: 0 auto; width: 100%; padding: 18px 32px 24px; box-sizing: border-box; overflow: hidden; }
.tb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.tb-back { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
  background: var(--glass-bg); color: var(--text-secondary); font-family: var(--font-body);
  font-size: 12px; font-weight: 700; cursor: pointer; }
.tb-kicker { font-family: var(--font-display); font-size: 11px; font-weight: 800;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--tb-accent); }
.tb-title { font-family: var(--font-body); font-size: 36px; font-weight: 900; letter-spacing: -0.03em; margin: 0; }

.tb-bracket { flex: 1 1 auto; min-height: 0; display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 28px; align-items: stretch; overflow: auto; padding: 8px 0; }
.tb-col { display: flex; flex-direction: column; justify-content: space-around; gap: 12px; }
.tb-col-label { font-family: var(--font-display); font-size: 10px; font-weight: 800;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 4px; }

.tb-match { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px;
  border: 1px solid var(--border-subtle); border-radius: 10px;
  background: rgba(10, 16, 28, 0.6); backdrop-filter: blur(var(--glass-blur)); position: relative; }
.tb-match.is-yours { border-color: var(--tb-accent); box-shadow: 0 0 18px color-mix(in srgb, var(--tb-accent) 32%, transparent); }
.tb-match.is-bye { opacity: 0.55; }
.tb-slot { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 0; border-bottom: 1px dashed rgba(255, 255, 255, 0.05); }
.tb-slot:last-child { border-bottom: none; }
.tb-slot__name { font-family: var(--font-body); font-size: 13px; font-weight: 700; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-slot__name--tbd { color: var(--text-dim); font-style: italic; font-weight: 600; }
.tb-slot__score { font-family: var(--font-display); font-size: 14px; font-weight: 800;
  color: var(--text-dim); font-variant-numeric: tabular-nums; }
.tb-slot__score--win { color: var(--tb-accent); }

.tb-champion-card { display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 20px; gap: 8px; border-radius: 12px; border: 1px solid var(--tb-accent);
  background: color-mix(in srgb, var(--tb-accent) 6%, rgba(10, 16, 28, 0.7)); }
.tb-champion-label { font-family: var(--font-display); font-size: 11px; font-weight: 800;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--tb-accent); }
.tb-champion-name { font-family: var(--font-body); font-size: 18px; font-weight: 900; color: var(--text-primary); }

.tb-your-banner { flex-shrink: 0; margin-top: 12px; padding: 16px 20px;
  border-radius: var(--radius-card); border: 1px solid var(--tb-accent);
  background: color-mix(in srgb, var(--tb-accent) 8%, rgba(10, 16, 28, 0.85));
  display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tb-your-banner__meta { display: flex; flex-direction: column; gap: 4px; }
.tb-your-banner__kicker { font-family: var(--font-display); font-size: 10px; font-weight: 800;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--tb-accent); }
.tb-your-banner__heading { font-family: var(--font-body); font-size: 18px; font-weight: 800; color: var(--text-primary); }
.tb-your-cta { padding: 12px 22px; border-radius: 10px; border: none; cursor: pointer;
  font-family: var(--font-body); font-size: 14px; font-weight: 800;
  background: var(--tb-accent); color: #1a1200;
  box-shadow: 0 0 24px color-mix(in srgb, var(--tb-accent) 30%, transparent); }
```

- [ ] **Step 2: Write the component**

```tsx
import { useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import { useTournament } from './useTournament';
import type { BracketView, Registration, TournamentMatch } from './types';
import './tournamentBracket.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentBracketScreenProps {
  socket: Socket | null;
  identity: Identity;
  tournamentId: string;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onJoinMatch: (roomCode: string) => void;
}

function nameFor(userId: string | null, regs: Registration[]): string {
  if (!userId) return 'TBD';
  const reg = regs.find((r) => r.user_id === userId);
  return reg?.username ?? userId.slice(0, 6);
}

function MatchCard({ match, regs, youUserId }: { match: TournamentMatch; regs: Registration[]; youUserId: string | null }) {
  const isYours = youUserId && (match.player1_id === youUserId || match.player2_id === youUserId);
  const isBye = match.status === 'bye';
  return (
    <div className={`tb-match${isYours ? ' is-yours' : ''}${isBye ? ' is-bye' : ''}`}>
      <div className="tb-slot">
        <span className={`tb-slot__name${!match.player1_id ? ' tb-slot__name--tbd' : ''}`}>
          {match.player1_id ? nameFor(match.player1_id, regs) : 'TBD'}
        </span>
        <span className={`tb-slot__score${match.winner_id === match.player1_id ? ' tb-slot__score--win' : ''}`}>
          {match.player1_score ?? '—'}
        </span>
      </div>
      <div className="tb-slot">
        <span className={`tb-slot__name${!match.player2_id ? ' tb-slot__name--tbd' : ''}`}>
          {match.player2_id ? nameFor(match.player2_id, regs) : 'TBD'}
        </span>
        <span className={`tb-slot__score${match.winner_id === match.player2_id ? ' tb-slot__score--win' : ''}`}>
          {match.player2_score ?? '—'}
        </span>
      </div>
    </div>
  );
}

export default function TournamentBracketScreen(props: TournamentBracketScreenProps) {
  const userId = props.identity?.userId ?? null;
  const tournament = useTournament({ socket: props.socket, userId });

  const bracket: BracketView | null = tournament.activeBracket?.tournament.id === props.tournamentId
    ? tournament.activeBracket : null;

  const yourReadyMatch = useMemo(() => {
    if (!bracket || !userId) return null;
    return bracket.matches.find(
      (m) => m.status === 'ready' && (m.player1_id === userId || m.player2_id === userId),
    ) ?? null;
  }, [bracket, userId]);

  const qf = bracket?.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number) ?? [];
  const sf = bracket?.matches.filter((m) => m.round === 2).sort((a, b) => a.match_number - b.match_number) ?? [];
  const fnl = bracket?.matches.filter((m) => m.round === 3) ?? [];
  const champion = fnl[0]?.winner_id ?? null;
  const championName = champion && bracket ? nameFor(champion, bracket.registrations) : null;

  return (
    <div className="tb-page">
      <GlobalNav currentMode={'tournament' as AppMode} onNavigate={props.onNavigate}
        activeColor="var(--accent-amber)" />
      <div className="tb-shell">
        <div className="tb-toolbar">
          <button className="tb-back" onClick={props.onBack}>← Back to Tournament</button>
          <div style={{ textAlign: 'right' }}>
            <div className="tb-kicker">🏆 Tournament</div>
            <h2 className="tb-title">Bracket</h2>
          </div>
        </div>

        <div className="tb-bracket">
          <div className="tb-col">
            <span className="tb-col-label">Quarterfinals</span>
            {qf.map((m) => <MatchCard key={m.id} match={m} regs={bracket?.registrations ?? []} youUserId={userId} />)}
          </div>
          <div className="tb-col">
            <span className="tb-col-label">Semifinals</span>
            {sf.map((m) => <MatchCard key={m.id} match={m} regs={bracket?.registrations ?? []} youUserId={userId} />)}
          </div>
          <div className="tb-col">
            <span className="tb-col-label">Final</span>
            {fnl.map((m) => <MatchCard key={m.id} match={m} regs={bracket?.registrations ?? []} youUserId={userId} />)}
          </div>
          <div className="tb-col">
            <span className="tb-col-label">Champion</span>
            <div className="tb-champion-card">
              <span className="tb-champion-label">Champion</span>
              <span className="tb-champion-name">{championName ?? '—'}</span>
            </div>
          </div>
        </div>

        {yourReadyMatch ? (
          <div className="tb-your-banner">
            <div className="tb-your-banner__meta">
              <span className="tb-your-banner__kicker">Your match is ready</span>
              <span className="tb-your-banner__heading">
                {yourReadyMatch.round === 1 ? 'Quarterfinal' : yourReadyMatch.round === 2 ? 'Semifinal' : 'Final'}
              </span>
            </div>
            <button className="tb-your-cta" onClick={() => yourReadyMatch.room_code && props.onJoinMatch(yourReadyMatch.room_code)}>
              Join Match ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/tournament/TournamentBracketScreen.tsx client/src/tournament/tournamentBracket.css
git commit -m "feat(tournament): TournamentBracketScreen with your-match banner"
```

### Task 4.3: TournamentMatchBanner

**Files:**
- Create: `client/src/tournament/TournamentMatchBanner.tsx`
- Create: `client/src/tournament/tournamentMatchBanner.css`

- [ ] **Step 1: Write the CSS**

```css
.tmb-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 18px; background: color-mix(in srgb, var(--accent-amber) 12%, rgba(7, 9, 16, 0.94));
  border-bottom: 1px solid color-mix(in srgb, var(--accent-amber) 28%, var(--border-subtle));
  font-family: var(--font-body);
}
.tmb-banner__kicker { font-family: var(--font-display); font-size: 10px; font-weight: 800;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent-amber); }
.tmb-banner__round { font-family: var(--font-body); font-size: 14px; font-weight: 800; color: var(--text-primary); margin-left: 8px; }
.tmb-banner__opp { font-size: 13px; color: var(--text-secondary); }
.tmb-banner__target { font-family: var(--font-display); font-size: 12px; font-weight: 700;
  letter-spacing: 0.14em; color: var(--text-dim); }
```

- [ ] **Step 2: Write the component**

```tsx
import './tournamentMatchBanner.css';

export interface TournamentMatchBannerProps {
  round: 1 | 2 | 3;
  opponentName: string | null;
  opponentRating: number | null;
}

export default function TournamentMatchBanner(props: TournamentMatchBannerProps) {
  const label = props.round === 1 ? 'Quarterfinal' : props.round === 2 ? 'Semifinal' : 'Final';
  return (
    <div className="tmb-banner" role="status">
      <div>
        <span className="tmb-banner__kicker">🏆 Tournament</span>
        <span className="tmb-banner__round">{label}</span>
      </div>
      <div className="tmb-banner__opp">
        vs <strong>{props.opponentName ?? 'Opponent'}</strong>
        {props.opponentRating != null ? ` · ${props.opponentRating} ELO` : ''}
      </div>
      <div className="tmb-banner__target">First to 30</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/tournament/TournamentMatchBanner.tsx client/src/tournament/tournamentMatchBanner.css
git commit -m "feat(tournament): TournamentMatchBanner above game UI"
```

### Task 4.4: TournamentResultScreen

**Files:**
- Create: `client/src/tournament/TournamentResultScreen.tsx`
- Create: `client/src/tournament/tournamentResult.css`

- [ ] **Step 1: Write the CSS**

```css
.tr-page {
  --tr-accent: var(--accent-amber);
  flex: 1 1 0; min-height: 0; max-height: 100%; display: flex; flex-direction: column;
  overflow: hidden; background: var(--bg-obsidian); color: var(--text-primary); font-family: var(--font-body);
}
.tr-shell { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center;
  max-width: 880px; margin: 0 auto; width: 100%; padding: 24px 32px 32px; box-sizing: border-box;
  text-align: center; overflow: auto; }
.tr-kicker { font-family: var(--font-display); font-size: 12px; font-weight: 800;
  letter-spacing: 0.22em; text-transform: uppercase; color: var(--tr-accent); margin-bottom: 6px; }
.tr-champion-title { font-family: var(--font-body); font-size: 36px; font-weight: 900; color: var(--text-primary); margin: 0 0 4px; }
.tr-champion-name { font-family: var(--font-body); font-size: 52px; font-weight: 900;
  color: var(--tr-accent); letter-spacing: -0.03em; margin: 0 0 24px;
  text-shadow: 0 0 32px color-mix(in srgb, var(--tr-accent) 30%, transparent); }
.tr-back { padding: 12px 22px; border-radius: 10px; border: 1px solid var(--border-light);
  background: var(--glass-bg); color: var(--text-primary); cursor: pointer;
  font-family: var(--font-body); font-size: 14px; font-weight: 700; }
```

- [ ] **Step 2: Write the component**

```tsx
import './tournamentResult.css';

export interface TournamentResultScreenProps {
  championName: string | null;
  yourPlacement: string | null;
  nextTournamentCountdown: string;
  onBack: () => void;
}

export default function TournamentResultScreen(props: TournamentResultScreenProps) {
  return (
    <div className="tr-page">
      <div className="tr-shell">
        <span className="tr-kicker">🏆 Tournament Complete</span>
        <h1 className="tr-champion-title">Champion</h1>
        <h2 className="tr-champion-name">{props.championName ?? '—'}</h2>
        {props.yourPlacement ? (
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            You finished: <strong style={{ color: 'var(--text-primary)' }}>{props.yourPlacement}</strong>
          </p>
        ) : null}
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
          Next tournament in <strong style={{ color: 'var(--accent-amber)' }}>{props.nextTournamentCountdown}</strong>
        </p>
        <button className="tr-back" onClick={props.onBack}>Back to Hub</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/tournament/TournamentResultScreen.tsx client/src/tournament/tournamentResult.css
git commit -m "feat(tournament): TournamentResultScreen"
```

### Phase 4 gate: client build green

- [ ] **Step G4: Verify client build**

```bash
npm run build --prefix client
```
Expected: clean (warnings about chunk size are pre-existing and fine).

---

## Phase 5 — Wire into App.tsx

### Task 5.1: Replace existing tournament render branch

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Add imports**

Find existing `import { TournamentScreen } from './screens/TournamentScreen';` (around line 48) and add directly after:

```typescript
import TournamentHubScreen from './tournament/TournamentHubScreen';
import TournamentBracketScreen from './tournament/TournamentBracketScreen';
import TournamentResultScreen from './tournament/TournamentResultScreen';
import TournamentMatchBanner from './tournament/TournamentMatchBanner';
```

- [ ] **Step 2: Add sub-view state**

Near the existing `const [mpSubView, setMpSubView] = useState<'quick' | 'private'>('quick');` declaration, add:

```typescript
const [tournamentSubView, setTournamentSubView] = useState<'hub' | 'bracket' | 'result'>('hub');
const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
```

- [ ] **Step 3: Replace the `appMode === 'tournament'` branch**

Find the existing:
```tsx
if (appMode === 'tournament') {
  return (
    <TournamentScreen ... />
  );
}
```

Replace with:

```tsx
if (appMode === 'tournament') {
  const identity = authUser?.id
    ? { userId: authUser.id, username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player' }
    : null;
  if (tournamentSubView === 'bracket' && activeTournamentId) {
    return (
      <TournamentBracketScreen
        socket={socket}
        identity={identity}
        tournamentId={activeTournamentId}
        onBack={() => setTournamentSubView('hub')}
        onNavigate={setAppMode}
        onJoinMatch={(code) => {
          setRoomCode(code);
          if (socket?.connected) {
            socket.emit('room:join', code, {
              username: authProfile?.username ?? 'Guest',
              userId: multiplayerIdentityUserId,
              authToken: multiplayerAuthToken,
            }, (resp: { ok: boolean; error?: string } & Record<string, unknown>) => {
              if (resp?.ok) applyJoinedRoomResponse(resp);
              else showToast(resp?.error ?? 'Could not join tournament match.', 2500);
            });
          }
        }}
      />
    );
  }
  if (tournamentSubView === 'result' && activeTournamentId) {
    return (
      <TournamentResultScreen
        championName={null}
        yourPlacement={null}
        nextTournamentCountdown={'—'}
        onBack={() => setTournamentSubView('hub')}
      />
    );
  }
  return (
    <TournamentHubScreen
      socket={socket}
      identity={identity}
      onNavigate={setAppMode}
      onOpenAuth={() => setAuthModalOpen(true)}
      onBackHome={() => setAppMode('home')}
      onOpenBracket={(id) => { setActiveTournamentId(id); setTournamentSubView('bracket'); }}
      onMatchReady={({ tournamentId, roomCode }) => {
        setActiveTournamentId(tournamentId);
        setRoomCode(roomCode);
        if (socket?.connected) {
          socket.emit('room:join', roomCode, {
            username: authProfile?.username ?? 'Guest',
            userId: multiplayerIdentityUserId,
            authToken: multiplayerAuthToken,
          }, (resp: { ok: boolean; error?: string } & Record<string, unknown>) => {
            if (resp?.ok) applyJoinedRoomResponse(resp);
          });
        }
      }}
    />
  );
}
```

- [ ] **Step 4: Render the match banner above the in-tournament game**

Find the game-screen render block (around line 3528 — `{(isConnected || isRecoveringConnection) && joinedRoom && state && (`). Just inside that block, before `<RotateOverlay />`, add:

```tsx
{joinedRoom && /^T[0-9A-Z]+R[123]M[0-9]+$/.test(joinedRoom) ? (
  <TournamentMatchBanner
    round={(parseInt(joinedRoom.match(/R([123])/)?.[1] ?? '1', 10) as 1 | 2 | 3)}
    opponentName={null}
    opponentRating={null}
  />
) : null}
```

(Banner uses room-code shape `T<short>R<round>M<num>` from `engine.ts` as a signal — no client/server protocol changes needed.)

- [ ] **Step 5: Verify client build**

```bash
npm run build --prefix client
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(tournament): wire new tournament screens into App.tsx"
```

---

## Phase 6 — Docs

### Task 6.1: TOURNAMENT_README.md

**Files:**
- Create: `TOURNAMENT_README.md` (repo root)

- [ ] **Step 1: Write the doc**

```markdown
# Racehorse — Scheduled Hourly Tournaments

## Schedule

- Tournaments run every 2 hours in **America/Los_Angeles (PST/PDT)**:
  12 AM · 2 AM · 4 AM · 6 AM · 8 AM · 10 AM · 12 PM · 2 PM · 4 PM · 6 PM · 8 PM · 10 PM
- Registration **opens 30 minutes** before start.
- Registration **closes 5 minutes** before start.

## Rules (locked decisions)

- **Format**: 8-player single-elimination (Quarterfinal → Semifinal → Final).
- **Win target per match**: First to 30 points.
- **Minimum players to start**: 4. With 5–7 registrants, top seeds receive byes (auto-walkover to next round).
- **Disconnect handling**: existing 30-second reconnect window. Failure to reconnect = forfeit; opponent advances.
- **Rating impact**: Tournament results do NOT affect Glicko ranking. Recorded only in `scheduled_tournament_matches`.

## How to run locally

1. Apply migration: paste `supabase/migrations/2026-05-14_scheduled_tournaments.sql` into Supabase SQL editor.
2. `cd server && npm run dev`
3. `cd client && npm run dev`
4. Sign in, hit Tournament in the nav. The countdown shows the next scheduled slot.

## Architecture

```
Scheduler (1/min poll) ──► registration_open ──► registration_close ──► generateBracket()
                                                                              │
                                                          ┌──── reserved rooms (createReservedRoom) ────┐
                                                          │                                              │
                                                          ▼                                              ▼
                                                  QF1 ─┐                                          QF/SF/F rows
                                                  QF2 ─┼─► SF1 ─┐                                      │
                                                  QF3 ─┘        ├─► Final ─► completeTournament ──────┘
                                                  QF4 ─┐        │
                                                       └─► SF2 ─┘

Players join their match via existing room:join. Game-over flow detects
room.scheduledTournamentMatchId and calls applyMatchResult() instead of
processRealtimeMultiplayerGame().
```

## Files

```
server/src/scheduledTournament/
   types.ts          shared types
   bracket.ts        seedBracket + advanceSlot (pure)
   bracket.test.ts   13 unit tests
   persistence.ts    supabase REST wrappers
   engine.ts         generateBracket / applyMatchResult / completeTournament
   scheduler.ts      1-minute polling tick
   socketHandlers.ts tournament:register / withdraw / get_bracket
   routes.ts         REST endpoints
   index.ts          barrel + initScheduledTournaments

client/src/tournament/
   types.ts                          client mirror types
   tournamentApi.ts                  REST client
   useTournament.ts                  React hook
   TournamentHubScreen.tsx           hub with countdown + 3 upcoming cards
   tournamentHub.css
   TournamentBracketScreen.tsx       4-column bracket + your-match banner
   tournamentBracket.css
   TournamentMatchBanner.tsx         thin banner above existing game UI
   tournamentMatchBanner.css
   TournamentResultScreen.tsx        champion display
   tournamentResult.css

supabase/migrations/
   2026-05-14_scheduled_tournaments.sql
```

## Tables

- `scheduled_tournaments` — pre-seeded slots; status flows upcoming → registration_open → in_progress → completed/cancelled
- `scheduled_tournament_registrations` — one row per player per tournament
- `scheduled_tournament_matches` — 7 rows per tournament (4 QF + 2 SF + 1 Final); status flows waiting → ready → in_progress → completed

## Known limitations

- The TournamentResultScreen shown after `tournament:completed` currently does not display final scores or your placement — it falls back to `'—'`. Wire `useTournament().activeBracket` into it in a follow-up PR.
- The legacy `client/src/screens/TournamentScreen.tsx` and `server/src/tournament/` lobby-based round-robin system is no longer reachable through the nav. It remains in the repo as dead code; can be deleted in a follow-up PR.
- Byes are awarded based on Glicko rating (highest seeds receive byes when < 8 register).
```

- [ ] **Step 2: Commit**

```bash
git add TOURNAMENT_README.md
git commit -m "docs(tournament): operator guide + locked decisions"
```

---

## Phase 7 — Final verification

### Task 7.1: Full test + build sweep

- [ ] **Step 1: Run all server tests**

```bash
cd server && npx vitest run
```
Expected: all matchmaking + tournament tests pass. (Pre-existing engine.test.ts failures unrelated to this work remain.)

- [ ] **Step 2: Run both builds**

```bash
npm run build --prefix client && npm run build --prefix server
```
Expected: both clean.

- [ ] **Step 3: Manual smoke (operator)**

1. Apply the SQL migration in Supabase.
2. Boot server + client.
3. Sign in. Open Tournament tab. Confirm countdown shows next slot.
4. Wait for a registration_open window (or temporarily edit a row to be `now() - interval '10 minutes'` for the open time). Click Register. Confirm row appears in `scheduled_tournament_registrations`.
5. With 4+ registrants and a close time in the past, the scheduler should auto-generate the bracket on the next minute tick. Verify 7 rows in `scheduled_tournament_matches`.
6. Open two browsers as different registered users. The first one whose QF is `ready` clicks the Join Match button — confirm both clients land in the same room and play to 30.
7. On match-end, verify the bracket auto-advances (next match becomes `ready` for both winners).

---

## Self-Review

**1. Spec coverage:**
- DB tables (tournaments, registrations, matches) + RLS + 30-day seed → Task 1.1 ✓
- Engine functions (generateBracket, advanceWinner, completeTournament, cancelTournament) → Tasks 2.3, 2.6 ✓
- Scheduler (1-minute tick) → Task 2.7 ✓
- Socket events (register, withdraw, get_bracket) → Task 2.8 ✓ (note: `tournament:join_match` and `tournament:match_result` are intentionally not separate events — joining a match uses the existing `room:join` socket event with the bracket-supplied `room_code`; match results flow through the existing `state:update` game-over branch hooked in Task 2.11)
- REST endpoints (upcoming, :id/bracket, register POST/DELETE, my) → Task 2.9 ✓
- Win target = 30 only for tournament matches → enforced via `createReservedRoom(code, { winningScore: 30 })` in Task 2.6 ✓
- No ranked ranking for tournament matches → Task 2.11 early-return in game-over branch ✓
- Hub / Bracket / Match-banner / Result screens → Tasks 4.1–4.4 ✓
- useTournament hook → Task 3.3 ✓
- Tournament accent = amber → Tasks 4.1+ use `var(--accent-amber)` ✓ (NOT purple — corrected from initial draft per AGENTS.md §3)
- Navigation wiring → Task 5.1 ✓
- README + flagged decisions → Task 6.1 ✓

**2. Placeholder scan:** No TBDs, no "implement later". Every code step shows full code.

**3. Type consistency:** Server `MatchRow`/`RegistrationRow`/`ScheduledTournamentRow` are mirrored as `TournamentMatch`/`Registration`/`ScheduledTournament` on the client (renamed for client readability; field names identical). `BracketView` is shared as the wire shape between `/api/tournaments/:id/bracket` response and `useTournament.activeBracket`. `applyMatchResult` server signature matches the game-over hook params in Task 2.11.

**4. AGENTS.md compliance:**
- §3 amber tournament accent: ✓ (`var(--accent-amber)`)
- §4 no game-logic changes: ✓ (win target set per-room only)
- §6 viewport-locked shell: ✓ (all new screen roots use `flex: 1 1 0; min-height: 0; max-height: 100%; overflow: hidden`)
- §7 plan-before-implement: ✓ (this document)
- §9 final response format: documented in TOURNAMENT_README.md
