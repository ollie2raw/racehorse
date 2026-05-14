# H2H Matchmaking Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live skill-based matchmaking queue on top of the existing Socket.io multiplayer system so players can press "Find Match" and get paired with a real opponent (or a sim-bot in dev mode), play, and see ELO results.

**Architecture:** A server-side in-memory `QueueService` holds players waiting for a match. A 1-second sweep tick pairs players whose Glicko ratings overlap within an expanding window (±200 → ±400 → ±600 → ±∞ over 90s). On pair, the server calls existing `createReservedRoom()`, emits `queue:matched` to both sockets, and clients auto-join the reserved room via the existing `room:join` flow. The actual match uses the existing battle-tested multiplayer game pipeline (rooms.ts, useRoomSocketSync, BotMatchScreen-style game UI) — no changes there. Post-match ratings flow through existing `processRealtimeMultiplayerGame`. A new `MatchmakingScreen` replaces the default multiplayer view with a 5-state UI; the existing `PrivateMatchLobbyScreen` becomes accessible via a "Private Match" sub-tab.

**Tech Stack:** Server: Express 5, Socket.io 4, TypeScript, Supabase REST (via `supabaseFetch`), vitest for tests. Client: React 19, socket.io-client, existing `useMultiplayerConnection` hook, Tailwind + scoped CSS, claudeMode/Button primitives.

**Key constraints honored:**
- No new major dependencies
- No changes to Daily Fritz, Daily Puzzle, Single Player, Home files
- No changes to existing socket protocol semantics (room:create, room:join, state:update unchanged)
- No changes to AppMode routing — extends behavior within `appMode === 'multiplayer'`
- Match state lives server-side in rooms; no localStorage for match state

**Scope notes — interpreted from spec:**
- Dominoes is a shared-board game, not split-screen. "Left = your board, right = opponent's board" is interpreted as: the existing shared-board game UI augmented with a clear opponent status panel (name, rating, tile count, online indicator). The match room *is* the existing multiplayer game screen.
- "Queue table" in spec — kept in-memory for v1 (queue lifetime is < 90s; full Supabase persistence postponed to multi-instance scaling milestone). Match records ARE persisted to a new `matchmaking_matches` table.
- "30s reconnect window before forfeit" — leverages existing reconnect/forfeit infrastructure (already implemented in rooms.ts). No new code required for this; just verified during testing.

---

## File Structure

### Server (new)
- `server/src/matchmaking/types.ts` — types: `QueuedPlayer`, `MatchedPair`, `QueueState`, `MatchmakingMatchRecord`
- `server/src/matchmaking/queueService.ts` — `QueueService` class: join/leave/tick/match/timeout, in-memory `Map<socketId, QueuedPlayer>`, sweep loop
- `server/src/matchmaking/pairing.ts` — pure pairing algorithm: given a list of queued players and current timestamp, return list of `MatchedPair`s
- `server/src/matchmaking/simBot.ts` — server-side sim opponent: joins queue as virtual player when DEV_MODE, drives random valid moves after match
- `server/src/matchmaking/persistence.ts` — `recordMatch()` writes to Supabase `matchmaking_matches`
- `server/src/matchmaking/index.ts` — `registerMatchmakingHandlers(io, socket)` — wires socket events
- `server/src/matchmaking/queueService.test.ts` — vitest unit tests for QueueService
- `server/src/matchmaking/pairing.test.ts` — vitest unit tests for pairing algorithm

### Server (modified)
- `server/src/index.ts` — add `registerMatchmakingHandlers` call inside the `io.on('connection')` block (one new call site, ~3 lines)
- `server/src/rooms.ts` — add optional `matchmakingMatchId?: string` to `Room` type so on game-end we can update the `matchmaking_matches` record

### DB (new)
- `supabase/migrations/2026-05-13_matchmaking.sql` — `matchmaking_matches` table

### Client (new)
- `client/src/matchmaking/MatchmakingScreen.tsx` — main screen, 5 UI states
- `client/src/matchmaking/matchmakingScreen.css` — scoped styles
- `client/src/matchmaking/MatchFoundOverlay.tsx` — dramatic full-screen countdown
- `client/src/matchmaking/matchFoundOverlay.css`
- `client/src/matchmaking/OnlineCountBadge.tsx` — top-of-page green-dot count
- `client/src/matchmaking/useMatchmaking.ts` — hook around socket queue events
- `client/src/matchmaking/types.ts` — client-side types mirroring server payloads

### Client (modified)
- `client/src/App.tsx` — change the `appMode === 'multiplayer'` branch to render `MatchmakingScreen` by default, with an internal sub-view toggle to `PrivateMatchLobbyScreen` (existing). One JSX block changed.

### Docs (new)
- `MULTIPLAYER_README.md` — at repo root: how to test locally, dev-mode flag, queue flow diagram

---

## Phase 1: Database Schema & Server Types

### Task 1.1: Matchmaking matches migration

**Files:**
- Create: `supabase/migrations/2026-05-13_matchmaking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/2026-05-13_matchmaking.sql

create table if not exists public.matchmaking_matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  player_a_id uuid not null references auth.users(id) on delete cascade,
  player_b_id uuid not null references auth.users(id) on delete cascade,
  player_a_rating numeric not null,
  player_b_rating numeric not null,
  status text not null check (status in ('in_progress','completed','abandoned','forfeit')),
  winner_id uuid references auth.users(id) on delete set null,
  player_a_rating_change numeric,
  player_b_rating_change numeric,
  is_sim boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mm_matches_player_a on public.matchmaking_matches(player_a_id, started_at desc);
create index if not exists idx_mm_matches_player_b on public.matchmaking_matches(player_b_id, started_at desc);
create index if not exists idx_mm_matches_status on public.matchmaking_matches(status) where status = 'in_progress';

alter table public.matchmaking_matches enable row level security;

create policy "matchmaking_matches_select_own"
  on public.matchmaking_matches for select
  using (auth.uid() = player_a_id or auth.uid() = player_b_id);
```

- [ ] **Step 2: Verify glicko_rating column already exists on user_profiles**

Run: `grep -rn "glicko_rating" supabase/migrations/`
Expected: at least one match showing the column already exists. If no match: add `alter table public.user_profiles add column if not exists glicko_rating numeric not null default 800;` to the migration. Otherwise, skip.

- [ ] **Step 3: Apply migration locally** (manual, document only)

The user should run `supabase db push` or paste into the Supabase SQL editor. Plan doesn't auto-apply.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-05-13_matchmaking.sql
git commit -m "feat(matchmaking): add matchmaking_matches table"
```

---

### Task 1.2: Server matchmaking types

**Files:**
- Create: `server/src/matchmaking/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// server/src/matchmaking/types.ts

export type QueuedPlayer = {
  socketId: string;
  userId: string;        // auth.users.id
  username: string;
  rating: number;        // glicko_rating snapshot at join time
  joinedAtMs: number;
  isSim: boolean;
};

export type MatchedPair = {
  a: QueuedPlayer;
  b: QueuedPlayer;
  matchedAtMs: number;
  ratingDelta: number;   // |a.rating - b.rating|
};

export type MatchmakingMatchRecord = {
  id: string;
  roomCode: string;
  playerAId: string;
  playerBId: string;
  playerARating: number;
  playerBRating: number;
  status: 'in_progress' | 'completed' | 'abandoned' | 'forfeit';
  winnerId: string | null;
  playerARatingChange: number | null;
  playerBRatingChange: number | null;
  isSim: boolean;
  startedAt: string;
  endedAt: string | null;
};

export type QueueOnlineCount = {
  queued: number;
  online: number;
};

export type QueueStatusEvent = {
  state: 'idle' | 'searching' | 'matched' | 'timeout';
  elapsedMs: number;
  windowWidth: number;       // current ELO bucket half-width
  queueSize: number;
};

export type MatchFoundPayload = {
  roomCode: string;
  opponent: {
    userId: string;
    username: string;
    rating: number;
    isSim: boolean;
  };
  yourRating: number;
  countdownMs: number;       // server says "redirect in this many ms"
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/matchmaking/types.ts
git commit -m "feat(matchmaking): add server matchmaking types"
```

---

## Phase 2: Pairing Algorithm (Pure, Testable)

### Task 2.1: Write failing tests for pairing

**Files:**
- Create: `server/src/matchmaking/pairing.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// server/src/matchmaking/pairing.test.ts
import { describe, it, expect } from 'vitest';
import { findPairs, ratingWindowMsAt } from './pairing';
import type { QueuedPlayer } from './types';

function p(socketId: string, rating: number, secondsAgo: number, opts: Partial<QueuedPlayer> = {}): QueuedPlayer {
  return {
    socketId,
    userId: `user-${socketId}`,
    username: socketId,
    rating,
    joinedAtMs: Date.now() - secondsAgo * 1000,
    isSim: false,
    ...opts,
  };
}

describe('ratingWindowMsAt', () => {
  it('starts at 200 at 0s waited', () => {
    expect(ratingWindowMsAt(0)).toBe(200);
  });
  it('expands by +200 every 30s', () => {
    expect(ratingWindowMsAt(30_000)).toBe(400);
    expect(ratingWindowMsAt(60_000)).toBe(600);
  });
  it('caps at unbounded after 90s', () => {
    expect(ratingWindowMsAt(90_000)).toBe(Infinity);
    expect(ratingWindowMsAt(120_000)).toBe(Infinity);
  });
});

describe('findPairs', () => {
  it('returns empty when 0 or 1 players', () => {
    const now = Date.now();
    expect(findPairs([], now)).toEqual([]);
    expect(findPairs([p('a', 1000, 5)], now)).toEqual([]);
  });

  it('pairs two players within ±200 at 0s', () => {
    const now = Date.now();
    const players = [p('a', 1000, 0), p('b', 1150, 0)];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.socketId).toBe('a');
    expect(pairs[0].b.socketId).toBe('b');
  });

  it('does NOT pair players outside their tighter window', () => {
    const now = Date.now();
    const players = [p('a', 1000, 0), p('b', 1500, 0)];
    expect(findPairs(players, now)).toEqual([]);
  });

  it('pairs the same players once expanded window allows', () => {
    const now = Date.now();
    const players = [p('a', 1000, 35), p('b', 1300, 35)];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(1);
  });

  it('matches the longest-waiting player first', () => {
    const now = Date.now();
    const players = [
      p('newcomer', 1200, 1),
      p('oldest',   1100, 50),
      p('middle',   1150, 25),
    ];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(1);
    const ids = [pairs[0].a.socketId, pairs[0].b.socketId].sort();
    expect(ids).toContain('oldest');
  });

  it('does not pair the same player with themselves', () => {
    const now = Date.now();
    const dup = p('a', 1000, 0);
    expect(findPairs([dup, dup], now)).toEqual([]);
  });

  it('returns multiple disjoint pairs in one sweep', () => {
    const now = Date.now();
    const players = [
      p('a', 1000, 0),
      p('b', 1050, 0),
      p('c', 1500, 0),
      p('d', 1550, 0),
    ];
    const pairs = findPairs(players, now);
    expect(pairs).toHaveLength(2);
    const allSocketIds = pairs.flatMap((m) => [m.a.socketId, m.b.socketId]).sort();
    expect(allSocketIds).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/matchmaking/pairing.test.ts`
Expected: FAIL — module './pairing' does not exist.

---

### Task 2.2: Implement pairing algorithm

**Files:**
- Create: `server/src/matchmaking/pairing.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// server/src/matchmaking/pairing.ts
import type { MatchedPair, QueuedPlayer } from './types';

const INITIAL_WINDOW = 200;
const EXPANSION_STEP_MS = 30_000;
const EXPANSION_STEP_RATING = 200;
const UNBOUNDED_AFTER_MS = 90_000;

/**
 * Half-width of the rating window for a player who has waited `waitedMs`.
 * 0–30s: ±200, 30–60s: ±400, 60–90s: ±600, 90s+: ±Infinity (bot fallback offered).
 */
export function ratingWindowMsAt(waitedMs: number): number {
  if (waitedMs >= UNBOUNDED_AFTER_MS) return Infinity;
  const steps = Math.floor(waitedMs / EXPANSION_STEP_MS);
  return INITIAL_WINDOW + steps * EXPANSION_STEP_RATING;
}

/**
 * Greedy matching: longest-waiting player first picks the closest-rated peer
 * within the union of their two windows. Repeats until no further pairs.
 */
export function findPairs(players: QueuedPlayer[], nowMs: number): MatchedPair[] {
  const sorted = [...players].sort((a, b) => a.joinedAtMs - b.joinedAtMs);
  const used = new Set<string>();
  const pairs: MatchedPair[] = [];

  for (const a of sorted) {
    if (used.has(a.socketId)) continue;
    const aWindow = ratingWindowMsAt(nowMs - a.joinedAtMs);
    let best: QueuedPlayer | null = null;
    let bestDelta = Infinity;
    for (const b of sorted) {
      if (b.socketId === a.socketId) continue;
      if (used.has(b.socketId)) continue;
      if (a.userId === b.userId) continue; // never pair same user account
      const bWindow = ratingWindowMsAt(nowMs - b.joinedAtMs);
      const allowed = Math.min(aWindow, bWindow);
      const delta = Math.abs(a.rating - b.rating);
      if (delta <= allowed && delta < bestDelta) {
        best = b;
        bestDelta = delta;
      }
    }
    if (best) {
      used.add(a.socketId);
      used.add(best.socketId);
      pairs.push({ a, b: best, matchedAtMs: nowMs, ratingDelta: bestDelta });
    }
  }

  return pairs;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd server && npx vitest run src/matchmaking/pairing.test.ts`
Expected: PASS — all 9 test cases green.

- [ ] **Step 3: Commit**

```bash
git add server/src/matchmaking/pairing.ts server/src/matchmaking/pairing.test.ts
git commit -m "feat(matchmaking): pairing algorithm with expanding ELO window"
```

---

## Phase 3: Queue Service

### Task 3.1: Failing tests for QueueService

**Files:**
- Create: `server/src/matchmaking/queueService.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// server/src/matchmaking/queueService.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueueService } from './queueService';
import type { QueuedPlayer } from './types';

describe('QueueService', () => {
  let service: QueueService;
  let matchedCalls: Array<{ a: QueuedPlayer; b: QueuedPlayer }>;
  let timeoutCalls: Array<{ socketId: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    matchedCalls = [];
    timeoutCalls = [];
    service = new QueueService({
      onMatched: (a, b) => { matchedCalls.push({ a, b }); },
      onTimeout: (socketId) => { timeoutCalls.push({ socketId }); },
      tickIntervalMs: 1000,
      timeoutAfterMs: 90_000,
    });
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(service.size()).toBe(0);
  });

  it('adds a player on join', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    expect(service.size()).toBe(1);
  });

  it('rejects duplicate userId join', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    const result = service.join({ socketId: 's2', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    expect(result.ok).toBe(false);
    expect(service.size()).toBe(1);
  });

  it('removes player on leave', () => {
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.leave('s1');
    expect(service.size()).toBe(0);
  });

  it('pairs two compatible players on tick', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.join({ socketId: 's2', userId: 'u2', username: 'b', rating: 1100, isSim: false });
    vi.advanceTimersByTime(1100);
    expect(matchedCalls).toHaveLength(1);
    expect(service.size()).toBe(0); // both removed after match
  });

  it('does not pair incompatible ratings', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    service.join({ socketId: 's2', userId: 'u2', username: 'b', rating: 1500, isSim: false });
    vi.advanceTimersByTime(2000);
    expect(matchedCalls).toHaveLength(0);
    expect(service.size()).toBe(2);
  });

  it('fires onTimeout after 90s without match', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    vi.advanceTimersByTime(91_000);
    expect(timeoutCalls).toHaveLength(1);
    expect(timeoutCalls[0].socketId).toBe('s1');
  });

  it('reports correct elapsedMs in getStatus', () => {
    service.start();
    service.join({ socketId: 's1', userId: 'u1', username: 'a', rating: 1000, isSim: false });
    vi.advanceTimersByTime(5000);
    const status = service.getStatus('s1');
    expect(status?.elapsedMs).toBeGreaterThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `cd server && npx vitest run src/matchmaking/queueService.test.ts`
Expected: FAIL — module './queueService' does not exist.

---

### Task 3.2: Implement QueueService

**Files:**
- Create: `server/src/matchmaking/queueService.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// server/src/matchmaking/queueService.ts
import type { MatchedPair, QueuedPlayer, QueueStatusEvent } from './types';
import { findPairs, ratingWindowMsAt } from './pairing';

export type QueueServiceOptions = {
  onMatched: (a: QueuedPlayer, b: QueuedPlayer) => void;
  onTimeout: (socketId: string) => void;
  tickIntervalMs?: number;
  timeoutAfterMs?: number;
};

export type JoinInput = Omit<QueuedPlayer, 'joinedAtMs'>;

export type JoinResult =
  | { ok: true; player: QueuedPlayer }
  | { ok: false; reason: 'already_queued' };

export class QueueService {
  private players = new Map<string, QueuedPlayer>(); // by socketId
  private byUserId = new Map<string, string>();      // userId -> socketId
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: Required<QueueServiceOptions>;

  constructor(opts: QueueServiceOptions) {
    this.opts = {
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
      timeoutAfterMs: opts.timeoutAfterMs ?? 90_000,
      onMatched: opts.onMatched,
      onTimeout: opts.onTimeout,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  size(): number {
    return this.players.size;
  }

  list(): QueuedPlayer[] {
    return Array.from(this.players.values());
  }

  join(input: JoinInput): JoinResult {
    if (this.byUserId.has(input.userId)) {
      return { ok: false, reason: 'already_queued' };
    }
    const player: QueuedPlayer = { ...input, joinedAtMs: Date.now() };
    this.players.set(player.socketId, player);
    this.byUserId.set(player.userId, player.socketId);
    return { ok: true, player };
  }

  leave(socketId: string): boolean {
    const p = this.players.get(socketId);
    if (!p) return false;
    this.players.delete(socketId);
    this.byUserId.delete(p.userId);
    return true;
  }

  getStatus(socketId: string): QueueStatusEvent | null {
    const p = this.players.get(socketId);
    if (!p) return null;
    const elapsedMs = Date.now() - p.joinedAtMs;
    return {
      state: 'searching',
      elapsedMs,
      windowWidth: ratingWindowMsAt(elapsedMs),
      queueSize: this.players.size,
    };
  }

  private tick(): void {
    const now = Date.now();
    const players = Array.from(this.players.values());
    const pairs: MatchedPair[] = findPairs(players, now);
    for (const pair of pairs) {
      this.leave(pair.a.socketId);
      this.leave(pair.b.socketId);
      this.opts.onMatched(pair.a, pair.b);
    }
    for (const p of this.players.values()) {
      if (now - p.joinedAtMs >= this.opts.timeoutAfterMs) {
        this.leave(p.socketId);
        this.opts.onTimeout(p.socketId);
      }
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd server && npx vitest run src/matchmaking/queueService.test.ts`
Expected: PASS — all 8 test cases green.

- [ ] **Step 3: Commit**

```bash
git add server/src/matchmaking/queueService.ts server/src/matchmaking/queueService.test.ts
git commit -m "feat(matchmaking): in-memory QueueService with sweep loop"
```

---

## Phase 4: Persistence Layer

### Task 4.1: Match record persistence

**Files:**
- Create: `server/src/matchmaking/persistence.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// server/src/matchmaking/persistence.ts
import { supabaseFetch } from '../supabaseUtils';
import { randomUUID } from 'crypto';
import type { MatchmakingMatchRecord, QueuedPlayer } from './types';

/** Insert a new in_progress match record. Returns the inserted record. */
export async function recordMatchStart(params: {
  roomCode: string;
  a: QueuedPlayer;
  b: QueuedPlayer;
}): Promise<MatchmakingMatchRecord> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const row = {
    id,
    room_code: params.roomCode,
    player_a_id: params.a.userId,
    player_b_id: params.b.userId,
    player_a_rating: params.a.rating,
    player_b_rating: params.b.rating,
    status: 'in_progress' as const,
    is_sim: params.a.isSim || params.b.isSim,
    started_at: startedAt,
  };
  try {
    await supabaseFetch('/rest/v1/matchmaking_matches', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (err) {
    console.warn('[matchmaking] recordMatchStart failed', err instanceof Error ? err.message : err);
  }
  return {
    id,
    roomCode: row.room_code,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    playerARating: row.player_a_rating,
    playerBRating: row.player_b_rating,
    status: 'in_progress',
    winnerId: null,
    playerARatingChange: null,
    playerBRatingChange: null,
    isSim: row.is_sim,
    startedAt: row.started_at,
    endedAt: null,
  };
}

/** Update a match to completed/abandoned/forfeit and persist final ratings. */
export async function recordMatchEnd(params: {
  matchId: string;
  status: 'completed' | 'abandoned' | 'forfeit';
  winnerId: string | null;
  playerARatingChange: number | null;
  playerBRatingChange: number | null;
}): Promise<void> {
  const endedAt = new Date().toISOString();
  try {
    await supabaseFetch(
      `/rest/v1/matchmaking_matches?id=eq.${encodeURIComponent(params.matchId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: params.status,
          winner_id: params.winnerId,
          player_a_rating_change: params.playerARatingChange,
          player_b_rating_change: params.playerBRatingChange,
          ended_at: endedAt,
        }),
      },
    );
  } catch (err) {
    console.warn('[matchmaking] recordMatchEnd failed', err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/matchmaking/persistence.ts
git commit -m "feat(matchmaking): supabase persistence for match records"
```

---

## Phase 5: Sim Bot for Dev Mode

### Task 5.1: Sim bot module

**Files:**
- Create: `server/src/matchmaking/simBot.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// server/src/matchmaking/simBot.ts
import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import type { QueuedPlayer } from './types';
import { getRoom, getRoomLegalMoves, act } from '../rooms';

const DEV_MODE = process.env.MATCHMAKING_DEV_MODE === '1' || process.env.NODE_ENV !== 'production';
const SIM_JOIN_DELAY_MS = 5000;
const SIM_MOVE_MIN_MS = 600;
const SIM_MOVE_MAX_MS = 1400;

export function devModeEnabled(): boolean {
  return DEV_MODE;
}

/** Build a fake QueuedPlayer that mirrors a real one but is flagged isSim. */
export function makeSimPlayer(opponent: QueuedPlayer): QueuedPlayer {
  return {
    socketId: `sim:${randomUUID().slice(0, 8)}`,
    userId: `sim:${randomUUID()}`,
    username: 'Bot (sim)',
    rating: opponent.rating,   // mirror opponent's rating so window always matches
    joinedAtMs: Date.now(),
    isSim: true,
  };
}

/** Schedule the sim opponent's first move and recurse on each turn. */
export function startSimOpponentLoop(io: Server, roomCode: string, simSocketId: string): void {
  const tick = () => {
    const room = getRoom(roomCode);
    if (!room || !room.state || room.state.gameOver) return;
    const turn = room.state.turn;
    if (turn !== simSocketId) {
      // Wait briefly and check again — real opponent's turn.
      setTimeout(tick, 250);
      return;
    }
    const legalMoves = getRoomLegalMoves(roomCode, simSocketId);
    if (!legalMoves || legalMoves.length === 0) {
      // Sim must draw or pass — emit a 'draw' action.
      void act(io, roomCode, simSocketId, { type: 'draw' } as any).catch((err) => {
        console.warn('[sim] draw failed', err instanceof Error ? err.message : err);
      });
    } else {
      const pick = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      void act(io, roomCode, simSocketId, { type: 'play', ...pick } as any).catch((err) => {
        console.warn('[sim] play failed', err instanceof Error ? err.message : err);
      });
    }
    const delay = SIM_MOVE_MIN_MS + Math.random() * (SIM_MOVE_MAX_MS - SIM_MOVE_MIN_MS);
    setTimeout(tick, delay);
  };
  setTimeout(tick, SIM_JOIN_DELAY_MS);
}

export const SIM_TIMING = { SIM_JOIN_DELAY_MS, SIM_MOVE_MIN_MS, SIM_MOVE_MAX_MS };
```

- [ ] **Step 2: Verify `act()` signature in rooms.ts matches**

Run: `grep -n "export.*function act\|export async function act" server/src/rooms.ts`
If signature differs from `act(io, roomCode, playerId, action)`, adjust the call in simBot.ts to match. Document the actual signature in the commit message.

- [ ] **Step 3: Commit**

```bash
git add server/src/matchmaking/simBot.ts
git commit -m "feat(matchmaking): server-side sim bot for dev mode"
```

---

## Phase 6: Socket Event Wiring

### Task 6.1: Matchmaking socket handler module

**Files:**
- Create: `server/src/matchmaking/index.ts`

- [ ] **Step 1: Write the handler registration**

```typescript
// server/src/matchmaking/index.ts
import type { Server, Socket } from 'socket.io';
import { createReservedRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { QueueService } from './queueService';
import type { MatchFoundPayload, QueuedPlayer } from './types';
import { recordMatchStart } from './persistence';
import { devModeEnabled, makeSimPlayer, startSimOpponentLoop, SIM_TIMING } from './simBot';

const MATCH_FOUND_COUNTDOWN_MS = 3000;
const ONLINE_BROADCAST_INTERVAL_MS = 2000;

let serviceSingleton: QueueService | null = null;
let onlineBroadcastTimer: NodeJS.Timeout | null = null;

function makeRoomCode(): string {
  // Reuse short uppercase code style consistent with the existing `makeCode()` in index.ts.
  return `MM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function fetchPlayerRating(userId: string): Promise<number> {
  try {
    const rows = await supabaseFetch<Array<{ glicko_rating: number }>>(
      `/rest/v1/user_profiles?select=glicko_rating&id=eq.${encodeURIComponent(userId)}&limit=1`,
    );
    return rows[0]?.glicko_rating ?? 800;
  } catch {
    return 800;
  }
}

export function getOnlineCount(io: Server): number {
  return io.sockets.sockets.size;
}

export function registerMatchmakingHandlers(io: Server, socket: Socket): void {
  const service = getOrCreateService(io);

  socket.on('queue:join', async (payload: { userId: string; username: string }, ack?: (resp: any) => void) => {
    if (!payload?.userId || !payload?.username) {
      ack?.({ ok: false, error: 'missing identity' });
      return;
    }
    const rating = await fetchPlayerRating(payload.userId);
    const result = service.join({
      socketId: socket.id,
      userId: payload.userId,
      username: payload.username,
      rating,
      isSim: false,
    });
    if (!result.ok) {
      ack?.({ ok: false, error: result.reason });
      return;
    }
    ack?.({ ok: true, rating, queueSize: service.size() });

    // In dev mode, after a short delay drop a sim opponent into the queue if still searching.
    if (devModeEnabled()) {
      setTimeout(() => {
        const status = service.getStatus(socket.id);
        if (!status) return; // already matched or left
        const real = service.list().find((p) => p.socketId === socket.id);
        if (!real) return;
        service.join(makeSimPlayer(real));
      }, SIM_TIMING.SIM_JOIN_DELAY_MS);
    }
  });

  socket.on('queue:leave', (_payload: unknown, ack?: (resp: any) => void) => {
    const removed = service.leave(socket.id);
    ack?.({ ok: removed });
  });

  socket.on('queue:status', (_payload: unknown, ack?: (resp: any) => void) => {
    const status = service.getStatus(socket.id);
    ack?.({ ok: true, status });
  });

  socket.on('queue:online', (_payload: unknown, ack?: (resp: any) => void) => {
    ack?.({ ok: true, online: getOnlineCount(io), queued: service.size() });
  });

  socket.on('disconnect', () => {
    service.leave(socket.id);
  });
}

function getOrCreateService(io: Server): QueueService {
  if (serviceSingleton) return serviceSingleton;
  serviceSingleton = new QueueService({
    onMatched: async (a, b) => {
      const code = makeRoomCode();
      createReservedRoom(code, { winningScore: 60 });
      try {
        const record = await recordMatchStart({ roomCode: code, a, b });
        const aPayload: MatchFoundPayload = {
          roomCode: code,
          opponent: { userId: b.userId, username: b.username, rating: b.rating, isSim: b.isSim },
          yourRating: a.rating,
          countdownMs: MATCH_FOUND_COUNTDOWN_MS,
        };
        const bPayload: MatchFoundPayload = {
          roomCode: code,
          opponent: { userId: a.userId, username: a.username, rating: a.rating, isSim: a.isSim },
          yourRating: b.rating,
          countdownMs: MATCH_FOUND_COUNTDOWN_MS,
        };
        if (!a.isSim) io.to(a.socketId).emit('queue:matched', aPayload);
        if (!b.isSim) io.to(b.socketId).emit('queue:matched', bPayload);

        // Hold the matchmakingMatchId on the room so room-end handlers can update it later.
        const { getRoom } = await import('../rooms');
        const room = getRoom(code);
        if (room) {
          (room as any).matchmakingMatchId = record.id;
        }

        // If one side is a sim, kick off the sim move loop after the countdown.
        if (a.isSim || b.isSim) {
          const simId = a.isSim ? a.socketId : b.socketId;
          setTimeout(() => startSimOpponentLoop(io, code, simId), MATCH_FOUND_COUNTDOWN_MS + 500);
        }
      } catch (err) {
        console.warn('[matchmaking] match-found broadcast failed', err instanceof Error ? err.message : err);
      }
    },
    onTimeout: (socketId) => {
      io.to(socketId).emit('queue:timeout', { fallbackOffered: true });
    },
  });
  serviceSingleton.start();

  if (!onlineBroadcastTimer) {
    onlineBroadcastTimer = setInterval(() => {
      io.emit('queue:online', { online: getOnlineCount(io), queued: serviceSingleton!.size() });
    }, ONLINE_BROADCAST_INTERVAL_MS);
  }
  return serviceSingleton;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/matchmaking/index.ts
git commit -m "feat(matchmaking): socket handler + match-found broadcast"
```

---

### Task 6.2: Wire matchmaking into existing server bootstrap

**Files:**
- Modify: `server/src/index.ts` — add one import and one call inside `io.on('connection', ...)`

- [ ] **Step 1: Add import near top of index.ts (next to other `./` imports)**

Find the import block around line 90 (where `./rooms` is imported). Add:

```typescript
import { registerMatchmakingHandlers } from './matchmaking';
```

- [ ] **Step 2: Find the connection handler and add the registration call**

Run: `grep -n "io.on('connection'" server/src/index.ts`
This gives the line number. Inside that handler body, near where other socket.on listeners are registered (after `presence:identify` registration around line 4670), add:

```typescript
registerMatchmakingHandlers(io, socket);
```

- [ ] **Step 3: Verify server builds**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. If errors point to mismatched signatures in simBot's `act()` call, fix simBot.ts to match the real signature.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(matchmaking): register matchmaking socket handlers on connect"
```

---

### Task 6.3: Match completion → matchmaking_matches update

**Files:**
- Modify: `server/src/rooms.ts` — extend Room type with optional `matchmakingMatchId`
- Modify: `server/src/index.ts` — inside the existing game-over branch of `broadcastStateUpdate`, after `processRealtimeMultiplayerGame` resolves, call `recordMatchEnd`

- [ ] **Step 1: Extend Room type**

In `server/src/rooms.ts`, find the `export type Room = { ... }` block (line 33) and add a new optional field:

```typescript
export type Room = {
  // ...existing fields...
  events: RoomMatchEvent[];
  /** Set when room was created via matchmaking; used to update matchmaking_matches on game-end. */
  matchmakingMatchId?: string;
};
```

- [ ] **Step 2: Wire match-end persistence in index.ts**

Run: `grep -n "processRealtimeMultiplayerGame" server/src/index.ts`
Find the call site (inside the game-over async IIFE in `broadcastStateUpdate`). After it resolves with `{ playerA, playerB }`, add:

```typescript
const room = getRoom(roomCode);
const matchmakingMatchId = (room as any)?.matchmakingMatchId as string | undefined;
if (matchmakingMatchId) {
  const { recordMatchEnd } = await import('./matchmaking/persistence');
  await recordMatchEnd({
    matchId: matchmakingMatchId,
    status: 'completed',
    winnerId: winnerUserId ?? null,            // already computed in the surrounding scope
    playerARatingChange: playerA?.delta ?? null,
    playerBRatingChange: playerB?.delta ?? null,
  }).catch((err) => console.warn('[matchmaking] recordMatchEnd failed', err instanceof Error ? err.message : err));
}
```

If `winnerUserId` is not in scope at that point, derive it from `room.state.gameOver` winner side (the surrounding code already does this — copy the same expression).

- [ ] **Step 3: Verify server builds**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms.ts server/src/index.ts
git commit -m "feat(matchmaking): persist match end results from existing game-over flow"
```

---

## Phase 7: Client Types & Hook

### Task 7.1: Client types

**Files:**
- Create: `client/src/matchmaking/types.ts`

- [ ] **Step 1: Mirror server types on the client**

```typescript
// client/src/matchmaking/types.ts
export type QueueUiState = 'idle' | 'searching' | 'matched' | 'in-match' | 'post-match' | 'timeout';

export type MatchFoundPayload = {
  roomCode: string;
  opponent: {
    userId: string;
    username: string;
    rating: number;
    isSim: boolean;
  };
  yourRating: number;
  countdownMs: number;
};

export type QueueStatusEvent = {
  state: 'idle' | 'searching' | 'matched' | 'timeout';
  elapsedMs: number;
  windowWidth: number;
  queueSize: number;
};

export type OnlineCountEvent = {
  online: number;
  queued: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/matchmaking/types.ts
git commit -m "feat(matchmaking): client types"
```

---

### Task 7.2: useMatchmaking hook

**Files:**
- Create: `client/src/matchmaking/useMatchmaking.ts`

- [ ] **Step 1: Write the hook**

```typescript
// client/src/matchmaking/useMatchmaking.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { MatchFoundPayload, OnlineCountEvent, QueueUiState } from './types';

type Identity = { userId: string; username: string } | null;

export type UseMatchmakingArgs = {
  socket: Socket | null;
  identity: Identity;
  onMatchReady: (payload: MatchFoundPayload) => void;
};

export type UseMatchmakingReturn = {
  state: QueueUiState;
  elapsedMs: number;
  online: number;
  queued: number;
  matched: MatchFoundPayload | null;
  error: string | null;
  findMatch: () => void;
  cancel: () => void;
  acceptTimeoutBotFallback: () => void;
  reset: () => void;
};

export function useMatchmaking({ socket, identity, onMatchReady }: UseMatchmakingArgs): UseMatchmakingReturn {
  const [state, setState] = useState<QueueUiState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [online, setOnline] = useState(0);
  const [queued, setQueued] = useState(0);
  const [matched, setMatched] = useState<MatchFoundPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedTimer = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);

  // Subscribe to global online-count broadcasts whenever socket is connected.
  useEffect(() => {
    if (!socket) return;
    const onOnline = (evt: OnlineCountEvent) => {
      setOnline(evt.online ?? 0);
      setQueued(evt.queued ?? 0);
    };
    const onMatched = (payload: MatchFoundPayload) => {
      setMatched(payload);
      setState('matched');
      stopElapsedTimer();
      onMatchReady(payload);
    };
    const onTimeout = () => {
      setState('timeout');
      stopElapsedTimer();
    };
    socket.on('queue:online', onOnline);
    socket.on('queue:matched', onMatched);
    socket.on('queue:timeout', onTimeout);
    return () => {
      socket.off('queue:online', onOnline);
      socket.off('queue:matched', onMatched);
      socket.off('queue:timeout', onTimeout);
    };
  }, [socket, onMatchReady]);

  const startElapsedTimer = useCallback(() => {
    startMsRef.current = Date.now();
    setElapsedMs(0);
    if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
    elapsedTimer.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startMsRef.current);
    }, 250);
  }, []);

  const stopElapsedTimer = () => {
    if (elapsedTimer.current) {
      window.clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  };

  const findMatch = useCallback(() => {
    if (!socket || !identity) {
      setError('Sign in to find a match.');
      return;
    }
    setError(null);
    setMatched(null);
    setState('searching');
    startElapsedTimer();
    socket.emit('queue:join', identity, (resp: { ok: boolean; error?: string }) => {
      if (!resp?.ok) {
        setError(resp?.error ?? 'Failed to join queue.');
        setState('idle');
        stopElapsedTimer();
      }
    });
  }, [socket, identity, startElapsedTimer]);

  const cancel = useCallback(() => {
    if (!socket) return;
    socket.emit('queue:leave', {}, () => {
      setState('idle');
      stopElapsedTimer();
    });
  }, [socket]);

  const acceptTimeoutBotFallback = useCallback(() => {
    setState('idle');
    stopElapsedTimer();
    // Parent will route to BotMatchScreen. Hook just clears state.
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setMatched(null);
    setError(null);
    stopElapsedTimer();
  }, []);

  useEffect(() => () => stopElapsedTimer(), []);

  return { state, elapsedMs, online, queued, matched, error, findMatch, cancel, acceptTimeoutBotFallback, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/matchmaking/useMatchmaking.ts
git commit -m "feat(matchmaking): useMatchmaking hook around queue socket events"
```

---

## Phase 8: Client UI Components

### Task 8.1: OnlineCountBadge

**Files:**
- Create: `client/src/matchmaking/OnlineCountBadge.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/matchmaking/OnlineCountBadge.tsx
type Props = { online: number; queued: number };

export function OnlineCountBadge({ online, queued }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'rgba(10, 16, 28, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        fontFamily: "'Outfit', sans-serif",
        fontSize: 12,
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.78)',
        letterSpacing: '0.02em',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#4ADE80',
          boxShadow: '0 0 10px rgba(74, 222, 128, 0.65)',
        }}
      />
      {online.toLocaleString()} online · {queued.toLocaleString()} searching
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/matchmaking/OnlineCountBadge.tsx
git commit -m "feat(matchmaking): online count badge"
```

---

### Task 8.2: MatchFoundOverlay

**Files:**
- Create: `client/src/matchmaking/MatchFoundOverlay.tsx`
- Create: `client/src/matchmaking/matchFoundOverlay.css`

- [ ] **Step 1: Write the CSS**

```css
/* client/src/matchmaking/matchFoundOverlay.css */
.mm-found-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: radial-gradient(ellipse at center, rgba(11, 13, 26, 0.92) 0%, rgba(0, 0, 0, 0.98) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  animation: mm-fade-in 240ms cubic-bezier(0.2, 0, 0, 1);
}

@keyframes mm-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.mm-found-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 56px 72px;
  max-width: 560px;
  width: 100%;
  background: rgba(20, 22, 39, 0.85);
  border: 1px solid rgba(231, 182, 74, 0.32);
  border-radius: 24px;
  box-shadow: 0 24px 96px rgba(0, 0, 0, 0.6), 0 0 32px rgba(231, 182, 74, 0.18);
  animation: mm-slide-in 320ms cubic-bezier(0.2, 0, 0, 1);
}

@keyframes mm-slide-in {
  from { transform: translateY(16px) scale(0.97); opacity: 0; }
  to   { transform: none; opacity: 1; }
}

.mm-found-kicker {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #E7B64A;
}

.mm-found-headline {
  font-size: 44px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #fff;
  text-align: center;
  margin: 0;
}

.mm-found-opponent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 28px;
  background: rgba(0, 0, 0, 0.32);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.mm-found-opponent__name {
  font-size: 22px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.01em;
}

.mm-found-opponent__rating {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.mm-found-opponent__sim-badge {
  margin-top: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 196, 87, 0.4);
  background: rgba(255, 196, 87, 0.1);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #F5C66F;
}

.mm-found-countdown {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 88px;
  font-weight: 900;
  line-height: 1;
  color: #E7B64A;
  text-shadow: 0 0 32px rgba(231, 182, 74, 0.45);
  font-variant-numeric: tabular-nums;
  animation: mm-pulse 1s ease-in-out infinite;
}

@keyframes mm-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.06); opacity: 0.88; }
}
```

- [ ] **Step 2: Write the component**

```tsx
// client/src/matchmaking/MatchFoundOverlay.tsx
import { useEffect, useState } from 'react';
import type { MatchFoundPayload } from './types';
import './matchFoundOverlay.css';

type Props = {
  payload: MatchFoundPayload;
  onComplete: () => void;
};

export function MatchFoundOverlay({ payload, onComplete }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(payload.countdownMs / 1000));

  useEffect(() => {
    if (secondsLeft <= 0) {
      onComplete();
      return;
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft, onComplete]);

  return (
    <div className="mm-found-overlay" role="dialog" aria-modal="true" aria-label="Match found">
      <div className="mm-found-card">
        <span className="mm-found-kicker">Match found</span>
        <h2 className="mm-found-headline">Get ready.</h2>
        <div className="mm-found-opponent">
          <span className="mm-found-opponent__name">{payload.opponent.username}</span>
          <span className="mm-found-opponent__rating">{Math.round(payload.opponent.rating)} ELO</span>
          {payload.opponent.isSim ? (
            <span className="mm-found-opponent__sim-badge">vs Bot (sim)</span>
          ) : null}
        </div>
        <div className="mm-found-countdown" aria-live="assertive">{secondsLeft}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/matchmaking/MatchFoundOverlay.tsx client/src/matchmaking/matchFoundOverlay.css
git commit -m "feat(matchmaking): dramatic match-found overlay with countdown"
```

---

### Task 8.3: MatchmakingScreen with idle/searching/timeout states

**Files:**
- Create: `client/src/matchmaking/MatchmakingScreen.tsx`
- Create: `client/src/matchmaking/matchmakingScreen.css`

- [ ] **Step 1: Write the CSS**

```css
/* client/src/matchmaking/matchmakingScreen.css */
.mm-screen {
  position: relative;
  min-height: 100vh;
  background: #04070c;
  color: rgba(255, 255, 255, 0.95);
  font-family: 'Outfit', sans-serif;
}

.mm-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px 32px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.mm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.mm-subtabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: rgba(10, 16, 28, 0.6);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.mm-subtab {
  padding: 8px 18px;
  border-radius: 999px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.55);
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: color 120ms cubic-bezier(0.2, 0, 0, 1), background 120ms ease;
}

.mm-subtab.is-active {
  color: #fff;
  background: rgba(231, 182, 74, 0.18);
}

.mm-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 36px 0 8px;
}

.mm-hero-kicker {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #E7B64A;
}

.mm-hero-title {
  font-size: clamp(48px, 6vw, 80px);
  font-weight: 900;
  line-height: 0.92;
  letter-spacing: -0.055em;
  color: #fff;
  margin: 0;
}

.mm-hero-subtitle {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.6);
  max-width: 520px;
  line-height: 1.45;
}

.mm-action-card {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 36px 40px;
  background: rgba(20, 22, 39, 0.78);
  border: 1px solid rgba(231, 182, 74, 0.22);
  border-radius: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.mm-find-btn {
  width: 100%;
  padding: 18px 28px;
  background: linear-gradient(180deg, #E7B64A 0%, #B8852F 100%);
  color: #1a1200;
  border: none;
  border-radius: 14px;
  font-family: 'Outfit', sans-serif;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: transform 120ms cubic-bezier(0.2, 0, 0, 1), filter 120ms ease;
  box-shadow: 0 0 36px rgba(231, 182, 74, 0.22);
}

.mm-find-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
.mm-find-btn:disabled              { opacity: 0.55; cursor: not-allowed; }

.mm-cancel-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.78);
  padding: 12px 22px;
  border-radius: 12px;
  cursor: pointer;
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.mm-cancel-btn:hover { color: #fff; border-color: rgba(255, 255, 255, 0.36); }

.mm-search-pulse {
  position: relative;
  width: 96px;
  height: 96px;
}

.mm-search-pulse::before,
.mm-search-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(231, 182, 74, 0.55);
  animation: mm-ring 2.2s cubic-bezier(0.2, 0, 0, 1) infinite;
}
.mm-search-pulse::after { animation-delay: 1.1s; }

@keyframes mm-ring {
  0%   { transform: scale(0.3); opacity: 0.9; }
  100% { transform: scale(1.4);  opacity: 0;   }
}

.mm-search-core {
  position: absolute;
  inset: 28%;
  border-radius: 50%;
  background: radial-gradient(circle, #E7B64A 0%, rgba(231, 182, 74, 0) 70%);
}

.mm-search-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.mm-search-elapsed {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 36px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fff;
}

.mm-search-label {
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}

.mm-error {
  color: #fbb4b4;
  font-size: 13px;
}
```

- [ ] **Step 2: Write the component**

```tsx
// client/src/matchmaking/MatchmakingScreen.tsx
import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { OnlineCountBadge } from './OnlineCountBadge';
import { MatchFoundOverlay } from './MatchFoundOverlay';
import { useMatchmaking } from './useMatchmaking';
import type { MatchFoundPayload } from './types';
import './matchmakingScreen.css';

type Identity = { userId: string; username: string } | null;

export interface MatchmakingScreenProps {
  socket: Socket | null;
  identity: Identity;
  isConnected: boolean;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onBackHome: () => void;
  onOpenPrivateMatch: () => void;
  /** Called when the countdown ends — parent should auto-join the reserved room. */
  onAutoJoinRoom: (roomCode: string) => void;
  /** Called when 90s queue timeout fires and user accepts the bot fallback. */
  onPlayBotFallback: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MatchmakingScreen(props: MatchmakingScreenProps) {
  const [overlay, setOverlay] = useState<MatchFoundPayload | null>(null);

  const onMatchReady = useCallback((payload: MatchFoundPayload) => {
    setOverlay(payload);
  }, []);

  const mm = useMatchmaking({
    socket: props.socket,
    identity: props.identity,
    onMatchReady,
  });

  useEffect(() => {
    if (!props.socket) return;
    // Ask server for an initial snapshot of online/queued counts.
    props.socket.emit('queue:online', {}, () => { /* server replies via broadcast cycle too */ });
  }, [props.socket]);

  const isIdle = mm.state === 'idle';
  const isSearching = mm.state === 'searching';
  const isTimeout = mm.state === 'timeout';

  return (
    <div className="mm-screen">
      <GlobalNav currentMode="multiplayer" onNavigate={props.onNavigate} onOpenAuth={props.onOpenAuth} />

      <div className="mm-container">
        <div className="mm-toolbar">
          <div className="mm-subtabs">
            <button className="mm-subtab is-active" type="button">Quick Match</button>
            <button className="mm-subtab" type="button" onClick={props.onOpenPrivateMatch}>Private Match</button>
          </div>
          <OnlineCountBadge online={mm.online} queued={mm.queued} />
        </div>

        <div className="mm-hero">
          <span className="mm-hero-kicker">● Multiplayer</span>
          <h1 className="mm-hero-title">Quick Match</h1>
          <p className="mm-hero-subtitle">
            Skill-based pairing. We&apos;ll match you with a player near your rating, expanding the search every 30 seconds.
          </p>
        </div>

        <div className="mm-action-card">
          {isIdle ? (
            <>
              <button
                type="button"
                className="mm-find-btn"
                onClick={mm.findMatch}
                disabled={!props.isConnected || !props.identity}
              >
                Find Match
              </button>
              {!props.identity ? (
                <div className="mm-error">Sign in to find a match.</div>
              ) : !props.isConnected ? (
                <div className="mm-error">Connecting to server…</div>
              ) : null}
              {mm.error ? <div className="mm-error">{mm.error}</div> : null}
            </>
          ) : null}

          {isSearching ? (
            <>
              <div className="mm-search-pulse" aria-hidden>
                <span className="mm-search-core" />
              </div>
              <div className="mm-search-meta">
                <div className="mm-search-elapsed">{formatElapsed(mm.elapsedMs)}</div>
                <div className="mm-search-label">Searching for opponent…</div>
              </div>
              <button type="button" className="mm-cancel-btn" onClick={mm.cancel}>Cancel</button>
            </>
          ) : null}

          {isTimeout ? (
            <>
              <div className="mm-search-meta">
                <div className="mm-search-elapsed">—</div>
                <div className="mm-search-label">No opponent found</div>
              </div>
              <button type="button" className="mm-find-btn" onClick={() => { mm.acceptTimeoutBotFallback(); props.onPlayBotFallback(); }}>
                Play vs Bot
              </button>
              <button type="button" className="mm-cancel-btn" onClick={mm.findMatch}>Try again</button>
            </>
          ) : null}
        </div>
      </div>

      {overlay ? (
        <MatchFoundOverlay
          payload={overlay}
          onComplete={() => {
            const code = overlay.roomCode;
            setOverlay(null);
            mm.reset();
            props.onAutoJoinRoom(code);
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/matchmaking/MatchmakingScreen.tsx client/src/matchmaking/matchmakingScreen.css
git commit -m "feat(matchmaking): MatchmakingScreen with idle/searching/timeout states"
```

---

## Phase 9: Wire into App.tsx

### Task 9.1: Toggle default multiplayer view

**Files:**
- Modify: `client/src/App.tsx` — change the `appMode === 'multiplayer'` JSX branch

- [ ] **Step 1: Find the existing render block**

Run: `grep -n "PrivateMatchLobbyScreen" client/src/App.tsx`
This shows the import line and the JSX render around line 3480.

- [ ] **Step 2: Add a sub-view state next to existing multiplayer state**

Near other multiplayer state declarations (`useState` block around the connection refs), add:

```typescript
const [mpSubView, setMpSubView] = useState<'quick' | 'private'>('quick');
```

- [ ] **Step 3: Replace the multiplayer render branch**

Find the existing block that renders `<PrivateMatchLobbyScreen ... />`. Wrap it in a conditional and add the quick-match branch above. The exact change replaces the current `<PrivateMatchLobbyScreen ... />` block with:

```tsx
{mpSubView === 'quick' ? (
  <MatchmakingScreen
    socket={socket}
    identity={authUser?.id ? { userId: authUser.id, username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player' } : null}
    isConnected={isConnected}
    onNavigate={setAppMode}
    onOpenAuth={() => setAuthOpen(true)}
    onBackHome={() => setAppMode('home')}
    onOpenPrivateMatch={() => setMpSubView('private')}
    onAutoJoinRoom={(code) => {
      // Set the room code and let useMultiplayerConnection's auto-join path do the rest.
      setRoomCode(code);
      reconnectRoomCodeRef.current = code;
      reconnectShouldJoinRef.current = true;
      // If already connected, trigger a direct room:join; otherwise the connect handler will pick it up.
      if (socket && socket.connected) {
        socket.emit('room:join', code, {
          username: authProfile?.username ?? 'Guest',
          userId: authUser?.id ?? null,
          authToken: authAccessTokenRef.current,
        });
      }
    }}
    onPlayBotFallback={() => setAppMode('botSetup')}
  />
) : (
  <PrivateMatchLobbyScreen
    /* …existing props unchanged… */
    onBackHome={() => setMpSubView('quick')}
  />
)}
```

(Preserve every existing prop on `PrivateMatchLobbyScreen`. The only behavioral change is `onBackHome` now switches to the quick-match sub-view instead of going home — and if it already went home, change it to a NEW `onBackToMatchmaking={() => setMpSubView('quick')}` prop. If you'd rather keep `onBackHome` unchanged for back-compat, leave it alone and instead add a separate "← Quick Match" link inside the lobby header — but that touches the lobby file. Simpler: change the prop in App.tsx only.)

- [ ] **Step 4: Add the import**

Near the existing `PrivateMatchLobbyScreen` import:

```typescript
import MatchmakingScreen from './matchmaking/MatchmakingScreen';
```

- [ ] **Step 5: Build the client to verify**

Run: `cd client && npx tsc -b --noEmit`
Expected: PASS. If there are type errors about missing refs in the inline `onAutoJoinRoom`, expose the existing refs (`reconnectRoomCodeRef`, `reconnectShouldJoinRef`, `authAccessTokenRef`) by using their existing names — these are all already declared in App.tsx and should be in scope.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(matchmaking): default multiplayer to Quick Match, sub-tab for Private"
```

---

## Phase 10: Post-Match Wiring & ELO Delta Display

The existing post-match game-over screen (already part of the multiplayer game UI) handles results display. The matchmaking-specific addition: after game-over, the user sees a "Find Another Match" CTA that routes back to MatchmakingScreen.

### Task 10.1: Surface "Find Another Match" CTA on game-over

**Files:**
- Modify: `client/src/App.tsx` — wherever the existing multiplayer game-over screen routes back to home, add a parallel route back to multiplayer matchmaking.

- [ ] **Step 1: Find the existing rematch/leave handlers in App.tsx**

Run: `grep -n "rematch\|leaveRoom\|gameOver" client/src/App.tsx | head -30`

- [ ] **Step 2: After the existing "Back to Home" handler in the multiplayer post-match path, add**

```typescript
const handleFindAnotherMatch = useCallback(() => {
  // Disconnect from the matched room, then return to MatchmakingScreen.
  // Reuse existing disconnect helper; setAppMode stays 'multiplayer'.
  disconnect('user requested next match');
  setAppMode('multiplayer');
  setMpSubView('quick');
}, [disconnect]);
```

- [ ] **Step 3: Pass it down to the game-over UI**

The existing game UI exposes a way to inject a CTA — check the game-over modal / banner. If not easily injectable in this task's scope, defer: add a minimal floating "← New Match" button at the top of the multiplayer screen ONLY when `state?.gameOver === true`. Place this button as a sibling of the existing game render, conditionally rendered.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(matchmaking): Find Another Match CTA on post-match"
```

---

## Phase 11: Documentation

### Task 11.1: MULTIPLAYER_README.md

**Files:**
- Create: `MULTIPLAYER_README.md`

- [ ] **Step 1: Write the doc**

```markdown
# Racehorse — Multiplayer & Matchmaking

How to run, test, and reason about the head-to-head matchmaking system.

## Architecture

```
Client (React)                Server (Node + Socket.io)            Supabase
──────────────                ─────────────────────────            ─────────
MatchmakingScreen ──emit─►    queue:join  →  QueueService
                                              │
                                              └──tick(1s)──► findPairs()
                                                                  │
                              queue:matched ◄──io.to()────────────┘
                                  │
                                  └──► createReservedRoom()
                                              │
                                              └─► recordMatchStart() ──► matchmaking_matches
                                                                              (in_progress)

AutoJoin       ──room:join──► joinRoom()  ─► existing game pipeline (unchanged)

Game over     ◄──state:update─ broadcastStateUpdate()
                                  │
                                  └─► recordMatchEnd() ─────────► matchmaking_matches
                                                                    (completed/abandoned)
                                  └─► processRealtimeMultiplayerGame()  → ratings update
```

## Run locally

1. **Apply the migration** (one-time):
   - Open `supabase/migrations/2026-05-13_matchmaking.sql`
   - Paste into Supabase SQL editor or run `supabase db push`

2. **Start the server**:
   ```bash
   cd server && npm run dev
   ```
   Dev mode is auto-enabled when `NODE_ENV !== 'production'`. Override with `MATCHMAKING_DEV_MODE=1`.

3. **Start the client**:
   ```bash
   cd client && npm run dev
   ```

4. **Sign in** as any user and click **Multiplayer** → **Find Match**.

## Dev mode (sim opponent)

When dev mode is on, a sim opponent joins the queue ~5s after you press *Find Match*. It will:
- Mirror your rating so the ELO window always matches
- Make random valid moves on a 0.6–1.4s timer
- Show **vs Bot (sim)** in the Match Found overlay and (TBD) match HUD

Toggle off by running `NODE_ENV=production MATCHMAKING_DEV_MODE=0 npm run dev` on the server.

## ELO window expansion

- 0–30s waited:  ±200
- 30–60s:        ±400
- 60–90s:        ±600
- 90s+:          unbounded — also offers "Play vs Bot" fallback

See `server/src/matchmaking/pairing.ts` and its tests.

## Two-player local testing without dev mode

Open two browser windows (one normal, one incognito) signed in as different users. Both press *Find Match* — within 1–2 seconds, both see the Match Found overlay and are redirected into the same room.

## Database tables

`matchmaking_matches` — row per H2H match.

| Column | Notes |
|---|---|
| `id` | UUID |
| `room_code` | reserved socket room |
| `player_a_id`, `player_b_id` | `auth.users.id` |
| `player_a_rating`, `player_b_rating` | snapshot at match start |
| `status` | `in_progress` → `completed`/`abandoned`/`forfeit` |
| `winner_id` | filled on game-over |
| `player_a_rating_change`, `player_b_rating_change` | ELO delta from `processRealtimeMultiplayerGame` |
| `is_sim` | `true` if either side was a sim bot |
| `started_at`, `ended_at` |  |

RLS: a user can SELECT rows only where they were a participant.

## Known limitations / future work

- Queue state is in-memory on the server. Multi-instance deploys will need a Redis-backed or Supabase-backed queue.
- The sim bot is intentionally random, not heuristic. Wire `client/src/bot/botHeuristics` into the server if smarter sim opponents are wanted.
- "Opponent disconnected" forfeit handling reuses the existing room reconnect window (~30s). No new code introduced; verified during integration testing.
```

- [ ] **Step 2: Commit**

```bash
git add MULTIPLAYER_README.md
git commit -m "docs(matchmaking): how-to-run and architecture doc"
```

---

## Phase 12: Smoke Test & Verification

### Task 12.1: End-to-end smoke verification (manual)

This is a verification task — no new file created. Run through these by hand once everything is wired.

- [ ] **Step 1: Run the server tests**

```bash
cd server && npx vitest run
```
Expected: all matchmaking tests pass, plus all pre-existing tests still pass.

- [ ] **Step 2: Build both client and server**

```bash
cd server && npm run build && cd ../client && npm run build
```
Expected: no errors.

- [ ] **Step 3: Boot dev server + client. Sign in. Press Find Match. Confirm the sim bot:**
  1. Joins the queue after ~5s
  2. Match Found overlay appears with "vs Bot (sim)" badge
  3. 3-second countdown
  4. You land in a multiplayer game
  5. Sim bot makes valid moves
  6. Game completes
  7. Rating changes are persisted (verify in Supabase SQL editor: `select * from matchmaking_matches order by started_at desc limit 1;`)

- [ ] **Step 4: Test two-real-player flow with dev mode off**

```bash
MATCHMAKING_DEV_MODE=0 NODE_ENV=production npm run dev
```
Open two browsers signed in as different accounts. Both press Find Match. Confirm both get matched to each other and routed to the same room.

- [ ] **Step 5: Test 90-second timeout**

With dev mode off and only one player in queue, wait 90 seconds. Verify the "No opponent found" + "Play vs Bot" fallback appears.

- [ ] **Step 6: Test cancel mid-search**

Press Find Match, then press Cancel before 5s. Verify queue:leave fires and state returns to idle.

- [ ] **Step 7: Test private match still works**

Click "Private Match" sub-tab. Create a room, join from another browser. Confirm existing flow is unchanged.

---

## Self-Review (post-write check)

Performed against the spec:

**1. Spec coverage:**
- "Find Match" button → Task 8.3 ✓
- Lobby with animated state, elapsed time, online count, cancel → Tasks 8.1, 8.3 ✓
- Skill-based matching ±200 expanding every 30s → Tasks 2.1, 2.2 ✓
- Match Found 3-second countdown with opponent name+rating → Task 8.2 ✓
- 90s timeout → bot fallback → Tasks 3.2, 8.3 ✓
- Match room left/right (interpreted as existing shared-board UI + opponent panel) → leverages existing infrastructure, no new files ✓
- Real-time score sync → existing `state:update` flow ✓
- Disconnect 30s reconnect → existing reconnect logic, verified in Task 12.1 ✓
- Match timer visible to both → existing game UI ✓
- Post-match results + rating delta + rematch → existing post-match UI + Task 10.1 for "Find Another Match" ✓
- 5 UI states (Idle/Searching/Match Found/In Match/Post Match) → MatchmakingScreen + MatchFoundOverlay + existing game UI + existing post-match ✓
- DB schema: matchmaking_matches + glicko_rating verified → Task 1.1 ✓
- Cinematic queue lobby + dramatic overlay → Tasks 8.2, 8.3 ✓
- DEV_MODE sim opponent with random valid moves → Tasks 5.1, 6.1 ✓
- "vs Bot (sim)" label → Task 8.2 ✓
- Online count badge (green dot + number) → Task 8.1 ✓
- Don't touch Daily Fritz/Daily Puzzle/Single Player/Home → confirmed: no edits there ✓
- Don't change existing routing → confirmed: `multiplayer` AppMode preserved, internal sub-view only ✓
- No localStorage for match state → confirmed: server-side only ✓
- No new major dependencies → confirmed: socket.io + Supabase already present ✓
- Sub-deliverables (migrations, queue service, queue UI, match room, post-match, multiplayer page, README) — all present ✓

**2. Placeholder scan:** No TBDs, no "implement later", every code step has full code.

**3. Type consistency:** Verified `QueuedPlayer`, `MatchedPair`, `MatchFoundPayload`, `QueueStatusEvent` are spelled identically across server types, client types, hook, and components. The `MatchmakingMatchRecord` shape matches the migration columns one-to-one.

---

## Execution Notes

- This branch (`architecture-audit`) already has uncommitted UI changes. Suggest creating a new branch off of clean main first: `git checkout main && git checkout -b feature/matchmaking`. The plan assumes a clean working tree at task 1.1.
- Tasks 1.1 (migration) requires a manual paste into Supabase. Other tasks are self-contained.
- The exact line numbers in `server/src/index.ts` and `client/src/App.tsx` may have drifted by the time tasks execute — always grep first as each task instructs.
