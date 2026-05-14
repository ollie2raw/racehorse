# Social System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time presence, an activity feed, a global/friends leaderboard, public player profiles, and auto-derived rivals to Racehorse — all integrated with the existing Supabase + Socket.IO + stats stack.

**Architecture:** Two new Supabase tables (`player_presence`, `activity_feed`) are written server-side via the service key. A new Express router (`server/src/social/routes.ts`) exposes eight REST endpoints that the client calls with a JWT. Three new frontend screens (`LeaderboardScreen`, `PublicProfileScreen`, `ActivityFeedPanel`) are added alongside a redesigned `FriendsScreen` that shows in-game status, H2H records, and a live activity strip.

**Tech Stack:** TypeScript (server + client), Express Router, Socket.IO, Supabase (service-key REST), React 18, Vite, Vitest

**Design decisions baked in:**
- Friends: mutual (existing `friends` table, status `pending`/`accepted` — no schema change)
- Profile visibility: logged-in users only (`getAuthenticatedUserId` guard on all social routes)
- Rivals: auto-computed from last 90 days of `matches` (no new table)
- Activity feed items: show opponent username

---

## File Map

### New Server Files
| File | Purpose |
|------|---------|
| `server/src/social/presence.ts` | Upsert/read `player_presence` via service key |
| `server/src/social/activityWriter.ts` | Write rows to `activity_feed` table |
| `server/src/social/rivalService.ts` | Compute top-3 rivals from `matches` (no table) |
| `server/src/social/routes.ts` | Express Router: 8 REST endpoints |
| `server/src/social/presence.test.ts` | Unit tests (mock `supabaseFetch`) |
| `server/src/social/activityWriter.test.ts` | Unit tests (mock `supabaseFetch`) |
| `server/src/social/rivalService.test.ts` | Unit tests (pure function with inline data) |
| `server/sql/social/001_player_presence.sql` | DDL for player_presence table |
| `server/sql/social/002_activity_feed.sql` | DDL for activity_feed table |

### Modified Server Files
| File | Change |
|------|--------|
| `server/src/index.ts` | Import + register social router; add `upsertPresence` calls on socket connect/disconnect/game-start; add `writeMatchActivity` call after `appendMatch` (line ~4468); add `writeDailyFritzActivity` in `/api/daily-fritz/complete`; add `writePuzzleActivity` in `/api/daily-puzzle/complete` |

### New Client Files
| File | Purpose |
|------|---------|
| `client/src/social/socialApi.ts` | Fetch wrappers for all 8 social endpoints |
| `client/src/social/LeaderboardScreen.tsx` | Global / Friends leaderboard with filter tabs |
| `client/src/social/leaderboard.css` | Styles for LeaderboardScreen |
| `client/src/social/PublicProfileScreen.tsx` | Profile hero + stats + H2H + recent matches |
| `client/src/social/publicProfile.css` | Styles for PublicProfileScreen |
| `client/src/social/ActivityFeedPanel.tsx` | Chronological friend activity strip |
| `client/src/social/activityFeed.css` | Styles for ActivityFeedPanel |

### Modified Client Files
| File | Change |
|------|--------|
| `client/src/types.ts` | Add `'leaderboard' \| 'publicProfile'` to `AppMode` |
| `client/src/App.tsx` | Add `profileUsername` state; add render blocks for `leaderboard` and `publicProfile` modes |
| `client/src/components/GlobalNav.tsx` | Update Leaderboard tab to navigate to `'leaderboard'` mode |
| `client/src/friends/FriendsScreen.tsx` | Redesign: amber in-game dot, H2H record, View Profile link, ActivityFeedPanel strip |
| `client/src/friends/friendsScreen.css` | Redesign styles |

---

## Phase 1 — Database

### Task 1: player_presence SQL migration

**Files:**
- Create: `server/sql/social/001_player_presence.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- server/sql/social/001_player_presence.sql
-- Tracks real-time user status. Written exclusively by the server service role
-- via socket connect/disconnect events. Never written by the client.

CREATE TABLE IF NOT EXISTS player_presence (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL
                CHECK (status IN ('online', 'in_game', 'offline'))
                DEFAULT 'offline',
  current_mode TEXT,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_presence ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read any presence row (for friend list display).
CREATE POLICY "authenticated read presence"
  ON player_presence FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can upsert their own row as a fallback path.
CREATE POLICY "own presence insert"
  ON player_presence FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own presence update"
  ON player_presence FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());
-- NOTE: service_role bypasses RLS by default; no explicit service_role policy needed.
```

- [ ] **Step 2: Run in Supabase SQL editor and verify**

Paste the file contents into the Supabase dashboard → SQL Editor → Run.

Verify with:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'player_presence';
-- Expected: 1 row
```

---

### Task 2: activity_feed SQL migration

**Files:**
- Create: `server/sql/social/002_activity_feed.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- server/sql/social/002_activity_feed.sql
-- Immutable event log. Written exclusively by server endpoints/socket handlers
-- using the service key. Clients only read via REST endpoints.

CREATE TABLE IF NOT EXISTS activity_feed (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL
               CHECK (type IN ('win','loss','streak','tournament','puzzle','daily_fritz')),
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_user_created
  ON activity_feed (user_id, created_at DESC);

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all activity (needed for cross-friend feed queries).
CREATE POLICY "authenticated read activity"
  ON activity_feed FOR SELECT
  TO authenticated
  USING (true);
-- NOTE: service_role bypasses RLS by default; no INSERT policy for authenticated users
-- because clients never write activity rows directly.
```

- [ ] **Step 2: Run in Supabase SQL editor and verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'activity_feed';
-- Expected: 1 row
```

- [ ] **Step 3: Commit SQL files**

```bash
git add server/sql/social/
git commit -m "$(cat <<'EOF'
feat: add player_presence and activity_feed SQL migrations

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Backend

### Task 3: presence.ts — upsert and batch-read helpers

**Files:**
- Create: `server/src/social/presence.ts`
- Create: `server/src/social/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/social/presence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabaseFetch before importing presence.ts
vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import { upsertPresence, getPresenceBatch } from './presence';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset(); });

describe('upsertPresence', () => {
  it('calls supabaseFetch with merge-duplicates Prefer header', async () => {
    mockFetch.mockResolvedValue({});
    await upsertPresence('user-1', 'online');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(path).toBe('/rest/v1/player_presence');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Prefer']).toContain('merge-duplicates');
    const body = JSON.parse(init.body as string);
    expect(body.user_id).toBe('user-1');
    expect(body.status).toBe('online');
  });

  it('includes current_mode when provided', async () => {
    mockFetch.mockResolvedValue({});
    await upsertPresence('user-1', 'in_game', 'multiplayer');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.current_mode).toBe('multiplayer');
  });
});

describe('getPresenceBatch', () => {
  it('returns empty map for empty input', async () => {
    const result = await getPresenceBatch([]);
    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps user_id to status from fetched rows', async () => {
    mockFetch.mockResolvedValue([
      { user_id: 'u1', status: 'online', current_mode: null },
      { user_id: 'u2', status: 'in_game', current_mode: 'multiplayer' },
    ]);
    const result = await getPresenceBatch(['u1', 'u2']);
    expect(result.get('u1')).toEqual({ status: 'online', current_mode: null });
    expect(result.get('u2')).toEqual({ status: 'in_game', current_mode: 'multiplayer' });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run src/social/presence.test.ts 2>&1 | tail -15
# Expected: FAIL — Cannot find module './presence'
```

- [ ] **Step 3: Implement presence.ts**

```typescript
// server/src/social/presence.ts
import { supabaseFetch } from '../supabaseUtils';

export async function upsertPresence(
  userId: string,
  status: 'online' | 'in_game' | 'offline',
  currentMode?: string | null,
): Promise<void> {
  await supabaseFetch('/rest/v1/player_presence', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      status,
      current_mode: currentMode ?? null,
      last_seen: new Date().toISOString(),
    }),
  });
}

export async function getPresenceBatch(
  userIds: string[],
): Promise<Map<string, { status: string; current_mode: string | null }>> {
  if (!userIds.length) return new Map();
  const filter = userIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
  const rows = await supabaseFetch<
    Array<{ user_id: string; status: string; current_mode: string | null }>
  >(`/rest/v1/player_presence?or=(${filter})&select=user_id,status,current_mode`);
  const map = new Map<string, { status: string; current_mode: string | null }>();
  for (const row of rows) {
    map.set(row.user_id, { status: row.status, current_mode: row.current_mode });
  }
  return map;
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
cd server && npx vitest run src/social/presence.test.ts 2>&1 | tail -10
# Expected: 4 tests passed
```

---

### Task 4: activityWriter.ts — write activity_feed rows

**Files:**
- Create: `server/src/social/activityWriter.ts`
- Create: `server/src/social/activityWriter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/social/activityWriter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import {
  writeMatchActivity,
  writePuzzleActivity,
  writeDailyFritzActivity,
  writeTournamentActivity,
} from './activityWriter';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset().mockResolvedValue({}); });

describe('writeMatchActivity', () => {
  it('writes two rows when both users are authenticated', async () => {
    await writeMatchActivity({
      winnerUserId: 'w1', loserUserId: 'l1',
      winnerUsername: 'alice', loserUsername: 'bob',
      mode: 'online', winnerScore: 30, loserScore: 12,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const bodies = mockFetch.mock.calls.map(([, init]: [string, { body: string }]) =>
      JSON.parse(init.body));
    expect(bodies.find((b: { type: string }) => b.type === 'win').metadata.opponent_username).toBe('bob');
    expect(bodies.find((b: { type: string }) => b.type === 'loss').metadata.opponent_username).toBe('alice');
  });

  it('writes only winner row when loser has no userId', async () => {
    await writeMatchActivity({
      winnerUserId: 'w1', loserUserId: null,
      winnerUsername: 'alice', loserUsername: 'guest',
      mode: 'online', winnerScore: 30, loserScore: 12,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.type).toBe('win');
  });
});

describe('writePuzzleActivity', () => {
  it('writes a puzzle row', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 450, streak: 4 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.type).toBe('puzzle');
  });

  it('also writes a streak row on milestone (7)', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 400, streak: 7 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const types = mockFetch.mock.calls.map(([, init]: [string, { body: string }]) =>
      JSON.parse(init.body).type);
    expect(types).toContain('streak');
  });

  it('does not write a streak row on non-milestone (5)', async () => {
    await writePuzzleActivity({ userId: 'u1', score: 300, streak: 5 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && npx vitest run src/social/activityWriter.test.ts 2>&1 | tail -10
# Expected: FAIL — Cannot find module './activityWriter'
```

- [ ] **Step 3: Implement activityWriter.ts**

```typescript
// server/src/social/activityWriter.ts
import { supabaseFetch } from '../supabaseUtils';

type ActivityType = 'win' | 'loss' | 'streak' | 'tournament' | 'puzzle' | 'daily_fritz';

async function writeActivity(
  userId: string,
  type: ActivityType,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseFetch('/rest/v1/activity_feed', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, type, metadata }),
    });
  } catch (err) {
    // Non-critical: log but never throw so callers don't fail.
    console.warn('[activityWriter] write failed', err instanceof Error ? err.message : err);
  }
}

export async function writeMatchActivity(params: {
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerUsername: string;
  loserUsername: string;
  mode: string;
  winnerScore: number | null;
  loserScore: number | null;
}): Promise<void> {
  const { winnerUserId, loserUserId, winnerUsername, loserUsername, mode, winnerScore, loserScore } = params;
  const writes: Promise<void>[] = [];
  if (winnerUserId) {
    writes.push(writeActivity(winnerUserId, 'win', {
      opponent_username: loserUsername, mode, score: winnerScore, opponent_score: loserScore,
    }));
  }
  if (loserUserId) {
    writes.push(writeActivity(loserUserId, 'loss', {
      opponent_username: winnerUsername, mode, score: loserScore, opponent_score: winnerScore,
    }));
  }
  await Promise.all(writes);
}

export async function writePuzzleActivity(params: {
  userId: string;
  score: number | null;
  streak: number;
}): Promise<void> {
  const { userId, score, streak } = params;
  await writeActivity(userId, 'puzzle', { score, streak });
  if ([3, 7, 14, 30].includes(streak)) {
    await writeActivity(userId, 'streak', { streak, source: 'puzzle' });
  }
}

export async function writeDailyFritzActivity(params: {
  userId: string;
  finalScore: number | null;
  won: boolean;
}): Promise<void> {
  await writeActivity(params.userId, 'daily_fritz', {
    score: params.finalScore,
    result: params.won ? 'win' : 'loss',
  });
}

export async function writeTournamentActivity(params: {
  userId: string;
  placement: string;
  tournamentId: string;
}): Promise<void> {
  await writeActivity(params.userId, 'tournament', {
    placement: params.placement,
    tournament_id: params.tournamentId,
  });
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
cd server && npx vitest run src/social/activityWriter.test.ts 2>&1 | tail -10
# Expected: 6 tests passed
```

---

### Task 5: rivalService.ts — auto-derive top-3 rivals

**Files:**
- Create: `server/src/social/rivalService.ts`
- Create: `server/src/social/rivalService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/social/rivalService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset(); });

describe('getAutoRivals', () => {
  it('returns empty array when no matches', async () => {
    mockFetch.mockResolvedValueOnce([]); // matches
    const result = await getAutoRivals('u1');
    expect(result).toEqual([]);
  });

  it('returns top-3 opponents sorted by game count', async () => {
    // 3 games vs opp-a, 2 vs opp-b, 1 vs opp-c
    mockFetch.mockResolvedValueOnce([
      { winner_user_id: 'u1', loser_user_id: 'opp-a' },
      { winner_user_id: 'opp-a', loser_user_id: 'u1' },
      { winner_user_id: 'u1', loser_user_id: 'opp-a' },
      { winner_user_id: 'u1', loser_user_id: 'opp-b' },
      { winner_user_id: 'opp-b', loser_user_id: 'u1' },
      { winner_user_id: 'u1', loser_user_id: 'opp-c' },
    ]);
    // profiles fetch
    mockFetch.mockResolvedValueOnce([
      { id: 'opp-a', username: 'alice', glicko_rating: 1300 },
      { id: 'opp-b', username: 'bob', glicko_rating: 1100 },
      { id: 'opp-c', username: 'carol', glicko_rating: 900 },
    ]);
    const result = await getAutoRivals('u1');
    expect(result).toHaveLength(3);
    expect(result[0].userId).toBe('opp-a');
    expect(result[0].gamesPlayed).toBe(3);
    expect(result[0].winsAgainst).toBe(2);
    expect(result[0].lossesAgainst).toBe(1);
    expect(result[0].username).toBe('alice');
  });

  it('caps result at 3 even with more opponents', async () => {
    const matches = ['a','b','c','d'].map((id) => ({ winner_user_id: 'u1', loser_user_id: `opp-${id}` }));
    mockFetch.mockResolvedValueOnce(matches);
    mockFetch.mockResolvedValueOnce(
      ['a','b','c','d'].map((id) => ({ id: `opp-${id}`, username: id, glicko_rating: 1000 })),
    );
    const result = await getAutoRivals('u1');
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && npx vitest run src/social/rivalService.test.ts 2>&1 | tail -10
# Expected: FAIL — Cannot find module './rivalService'
```

- [ ] **Step 3: Implement rivalService.ts**

```typescript
// server/src/social/rivalService.ts
import { supabaseFetch } from '../supabaseUtils';

export interface RivalEntry {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
}

export async function getAutoRivals(userId: string): Promise<RivalEntry[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const enc = encodeURIComponent(userId);

  const matches = await supabaseFetch<Array<{
    winner_user_id: string | null;
    loser_user_id: string | null;
  }>>(
    `/rest/v1/matches` +
    `?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
    `&created_at=gte.${encodeURIComponent(since)}` +
    `&mode=eq.online` +
    `&select=winner_user_id,loser_user_id`,
  );

  const tally = new Map<string, { wins: number; losses: number }>();
  for (const m of matches) {
    const opponentId = m.winner_user_id === userId ? m.loser_user_id : m.winner_user_id;
    if (!opponentId || opponentId === userId) continue;
    const existing = tally.get(opponentId) ?? { wins: 0, losses: 0 };
    if (m.winner_user_id === userId) existing.wins += 1;
    else existing.losses += 1;
    tally.set(opponentId, existing);
  }

  const sorted = [...tally.entries()]
    .map(([id, rec]) => ({ id, games: rec.wins + rec.losses, ...rec }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);

  if (!sorted.length) return [];

  const idFilter = sorted.map((s) => `id.eq.${encodeURIComponent(s.id)}`).join(',');
  const profiles = await supabaseFetch<
    Array<{ id: string; username: string; glicko_rating: number | null }>
  >(`/rest/v1/profiles?or=(${idFilter})&select=id,username,glicko_rating`);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  return sorted.map((s) => {
    const profile = profileMap.get(s.id);
    return {
      userId: s.id,
      username: profile?.username ?? 'player',
      gamesPlayed: s.games,
      winsAgainst: s.wins,
      lossesAgainst: s.losses,
      rating: profile?.glicko_rating != null ? Number(profile.glicko_rating) : null,
    };
  });
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
cd server && npx vitest run src/social/rivalService.test.ts 2>&1 | tail -10
# Expected: 3 tests passed
```

---

### Task 6: social routes.ts — REST endpoints

**Files:**
- Create: `server/src/social/routes.ts`

No unit tests for route handlers (they require full Express+Supabase integration). Build verification serves as the check.

- [ ] **Step 1: Create routes.ts**

```typescript
// server/src/social/routes.ts
import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';
import { getPresenceBatch } from './presence';

// Inline helper — mirrors the one in index.ts without importing it.
async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/auth/v1/user`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: process.env.SUPABASE_SERVICE_KEY ?? '',
        },
      } as RequestInit,
    );
    const userId = (rows as unknown as { id?: string })?.id ?? null;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return userId;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

async function getFriendIds(userId: string): Promise<string[]> {
  const enc = encodeURIComponent(userId);
  const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
    `/rest/v1/friends` +
    `?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
    `&status=eq.accepted` +
    `&select=user_id,friend_user_id`,
  );
  return rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id));
}

export const socialRouter = Router();

// GET /api/social/feed
// Returns last 50 activity rows for the authenticated user + their friends,
// augmented with the actor's username.
socialRouter.get('/feed', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; type: string; metadata: Record<string, unknown>; created_at: string;
    }>>(
      `/rest/v1/activity_feed?or=(${inFilter})&order=created_at.desc&limit=50&select=id,user_id,type,metadata,created_at`,
    );

    // Fetch usernames for all unique user_ids in the feed
    const feedUserIds = [...new Set(rows.map((r) => r.user_id))];
    const profileFilter = feedUserIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = profileFilter
      ? await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
        )
      : [];
    const usernameMap = new Map(profiles.map((p) => [p.id, p.username]));

    res.json({
      ok: true,
      feed: rows.map((r) => ({
        ...r,
        username: usernameMap.get(r.user_id) ?? 'player',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Feed unavailable.' });
  }
});

// GET /api/social/leaderboard/friends
// Returns the authenticated user + friends sorted by glicko_rating.
socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number; ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?or=(${inFilter})&order=glicko_rating.desc&select=id,username,glicko_rating,ranked_games_played,provisional`,
    );
    res.json({
      ok: true,
      leaderboard: profiles.map((p, index) => ({
        userId: p.id,
        username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        ranked_games_played: Number(p.ranked_games_played ?? 0),
        provisional: Boolean(p.provisional),
        rank_in_friends: index + 1,
        is_self: p.id === userId,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
});

// GET /api/social/rivals
// Returns auto-derived top-3 rivals for the authenticated user.
socialRouter.get('/rivals', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const rivals = await getAutoRivals(userId);
    res.json({ ok: true, rivals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rivals unavailable.' });
  }
});

// GET /api/profile/:username
// Returns full profile + recent matches + friendship status. Auth required.
socialRouter.get('/profile/:username', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const username = typeof req.params.username === 'string'
    ? req.params.username.trim().replace(/^@/, '')
    : '';
  if (!username) { res.status(400).json({ error: 'username is required.' }); return; }
  try {
    const profileRows = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number; peak_rating: number;
      provisional: boolean; ranked_games_played: number;
    }>>(`/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}&limit=1&select=id,username,glicko_rating,peak_rating,provisional,ranked_games_played`);
    const profile = profileRows?.[0];
    if (!profile) { res.status(404).json({ error: 'Player not found.' }); return; }
    const targetId = profile.id;

    // Global rank
    const allRanked = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&select=id`,
    );
    const rankIndex = allRanked.findIndex((p) => p.id === targetId);
    const globalRank = rankIndex >= 0 ? rankIndex + 1 : null;

    // Win/loss record from matches table
    const enc = encodeURIComponent(targetId);
    const matchRows = await supabaseFetch<Array<{
      winner_user_id: string | null; loser_user_id: string | null; created_at: string;
    }>>(
      `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})&mode=eq.online&select=winner_user_id,loser_user_id,created_at`,
    );
    const wins = matchRows.filter((m) => m.winner_user_id === targetId).length;
    const losses = matchRows.filter((m) => m.loser_user_id === targetId).length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

    // Recent 10 matches with opponent username
    const recentRows = await supabaseFetch<Array<{
      winner_user_id: string | null; loser_user_id: string | null;
      winner_score?: number | null; loser_score?: number | null;
      mode: string; created_at: string;
    }>>(
      `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
      `&order=created_at.desc&limit=10&select=winner_user_id,loser_user_id,winner_score,loser_score,mode,created_at`,
    );
    const opponentIds = [...new Set(
      recentRows
        .map((m) => (m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id))
        .filter((id): id is string => Boolean(id)),
    )];
    const oppProfileMap = new Map<string, string>();
    if (opponentIds.length) {
      const oppFilter = opponentIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const oppProfiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${oppFilter})&select=id,username`,
      );
      for (const p of oppProfiles) oppProfileMap.set(p.id, p.username);
    }
    const recentMatches = recentRows.map((m) => {
      const won = m.winner_user_id === targetId;
      const opponentId = won ? m.loser_user_id : m.winner_user_id;
      return {
        opponent_username: opponentId ? (oppProfileMap.get(opponentId) ?? 'guest') : 'guest',
        result: won ? 'win' : 'loss',
        score: won ? m.winner_score : m.loser_score,
        opponent_score: won ? m.loser_score : m.winner_score,
        mode: m.mode,
        played_at: m.created_at,
      };
    });

    // Friendship status
    const friendRows = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends` +
      `?or=(and(user_id.eq.${encodeURIComponent(requestorId)},friend_user_id.eq.${enc}),and(user_id.eq.${enc},friend_user_id.eq.${encodeURIComponent(requestorId)}))` +
      `&select=id,status&limit=1`,
    );
    const friendRow = friendRows?.[0];
    const isFriend = friendRow?.status === 'accepted';
    const hasPendingRequest = friendRow?.status === 'pending';

    // Presence
    const presenceMap = await getPresenceBatch([targetId]);
    const presence = presenceMap.get(targetId) ?? { status: 'offline', current_mode: null };

    res.json({
      ok: true,
      userId: targetId,
      username: profile.username,
      glicko_rating: Number(profile.glicko_rating ?? 800),
      peak_rating: Number(profile.peak_rating ?? profile.glicko_rating ?? 800),
      provisional: Boolean(profile.provisional),
      ranked_games_played: Number(profile.ranked_games_played ?? 0),
      global_rank: globalRank,
      wins,
      losses,
      win_rate: winRate,
      is_self: targetId === requestorId,
      is_friend: isFriend,
      has_pending_request: hasPendingRequest,
      presence,
      recent_matches: recentMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Profile unavailable.' });
  }
});
```

- [ ] **Step 2: Server TypeScript-compiles cleanly**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
# Expected: no errors
```

---

### Task 7: Wire social routes + presence socket hooks into index.ts

**Files:**
- Modify: `server/src/index.ts`

There are four insertion points. Read the file carefully before each edit.

- [ ] **Step 1: Import social modules at the top of index.ts**

Find the import block (around line 30–100) and add after the last social-adjacent import:

```typescript
import { socialRouter } from './social/routes';
import { upsertPresence } from './social/presence';
import { writeMatchActivity, writePuzzleActivity, writeDailyFritzActivity } from './social/activityWriter';
```

- [ ] **Step 2: Register the social router**

Find the line `app.get('/health', ...` and add before it:

```typescript
// Social system REST endpoints
app.use('/api/social', socialRouter);
// Public profile by username (convenience alias without /social prefix)
app.use('/api/profile', socialRouter);
```

Wait — that's wrong: the `/api/profile/:username` route is defined on `socialRouter` with path `/profile/:username`. Using `app.use('/api/profile', socialRouter)` would match `/api/profile/:username` but map it to `/:username` inside the router — that's correct. However, the route in routes.ts defines it as `/profile/:username`. So mounting at `/api/profile` and defining it at `/profile/:username` would result in `/api/profile/profile/:username`. Fix: define the profile route in routes.ts with path `/:username` instead of `/profile/:username`.

Correct approach — update `routes.ts` profile route path from `/profile/:username` to `/:username`:

In `server/src/social/routes.ts`, change:
```typescript
// BEFORE:
socialRouter.get('/profile/:username', async (req, res) => {
// AFTER:
socialRouter.get('/:username', async (req, res) => {
```

Then register:
```typescript
app.use('/api/social', socialRouter);
app.use('/api/profile', socialRouter);
```

- [ ] **Step 3: Add presence upsert on socket `presence:identify`**

Find the existing `socket.on('presence:identify', ...)` handler (around line 4837). It currently only registers the userId in `socketsByUserId`. Add upsert call inside the success branch:

```typescript
// Inside the success branch of socket.on('presence:identify', ...):
// Add after: socketsByUserId.set(userId, existing);
void upsertPresence(userId, 'online').catch(() => {});
```

- [ ] **Step 4: Add presence offline on socket disconnect**

Find `socket.on('disconnect', ...)` (around line 5831). At the start of the handler, after `removeSocketPresence()` is called, add:

```typescript
// After: removeSocketPresence();
const disconnectingUserId = normalizeUserId(socket.data?.userId);
if (disconnectingUserId) {
  void upsertPresence(disconnectingUserId, 'offline').catch(() => {});
}
```

- [ ] **Step 5: Add writeMatchActivity after appendMatch (line ~4468)**

Find `await appendMatch({...})` and add immediately after the closing `});` of that call:

```typescript
// After the appendMatch call
void writeMatchActivity({
  winnerUserId: winnerSocketId === a.id ? (a.userId ?? null) : (b.userId ?? null),
  loserUserId: winnerSocketId === a.id ? (b.userId ?? null) : (a.userId ?? null),
  winnerUsername: winnerSocketId === a.id ? a.username : b.username,
  loserUsername: winnerSocketId === a.id ? b.username : a.username,
  mode: 'online',
  winnerScore: winnerSocketId === a.id ? scoreA : scoreB,
  loserScore: winnerSocketId === a.id ? scoreB : scoreA,
}).catch(() => {});
```

- [ ] **Step 6: Add writePuzzleActivity in /api/daily-puzzle/complete**

Find the `res.json({ ok: true, runDate: saved.puzzleDate, ... })` in `/api/daily-puzzle/complete` (around line 3078). Before that `res.json` call, add:

```typescript
// After: const leaderboardRank = ...
if (!replayed) {
  const puzzleStreak = saved.result?.final?.puzzlesCompleted ?? 0;
  void writePuzzleActivity({
    userId: authenticatedUserId,
    score: saved.totalScore ?? null,
    streak: puzzleStreak,
  }).catch(() => {});
}
```

- [ ] **Step 7: Add writeDailyFritzActivity in /api/daily-fritz/complete**

Find the `res.json({ ok: true, rank, ... })` in `/api/daily-fritz/complete` (around line 3766). Before that `res.json` call, add:

```typescript
// After: const rank = ...
const isReplayed = Boolean(req.body?.replayed);
if (!isReplayed) {
  void writeDailyFritzActivity({
    userId: authenticatedUserId,
    finalScore: finalScore ?? null,
    won: won,
  }).catch(() => {});
}
```

- [ ] **Step 8: Verify server builds and all 38 tests still pass**

```bash
npm run build --prefix server 2>&1 | tail -5
# Expected: no TypeScript errors, exit 0

cd server && npx vitest run src/scheduledTournament src/matchmaking src/social 2>&1 | tail -15
# Expected: ≥ 38+13 tests passed (38 existing + 13 new social tests)
```

- [ ] **Step 9: Commit**

```bash
git add server/src/social/ server/src/index.ts server/sql/social/
git commit -m "$(cat <<'EOF'
feat: social system backend — presence, activity feed, rivals, REST endpoints

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Frontend

### Task 8: socialApi.ts — REST clients for social endpoints

**Files:**
- Create: `client/src/social/socialApi.ts`

- [ ] **Step 1: Create socialApi.ts**

```typescript
// client/src/social/socialApi.ts
import { supabase } from '../lib/supabase';

const BASE = (() => {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
  if (configured) return configured.replace(/\/$/, '');
  return '';
})();

async function getAuthToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function socialFetch<T>(path: string): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  user_id: string;
  username: string;
  type: 'win' | 'loss' | 'streak' | 'tournament' | 'puzzle' | 'daily_fritz';
  metadata: {
    opponent_username?: string;
    mode?: string;
    score?: number | null;
    opponent_score?: number | null;
    streak?: number;
    placement?: string;
    result?: 'win' | 'loss';
  };
  created_at: string;
}

export interface FriendsLeaderboardEntry {
  userId: string;
  username: string;
  glicko_rating: number;
  ranked_games_played: number;
  provisional: boolean;
  rank_in_friends: number;
  is_self: boolean;
}

export interface RivalEntry {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
}

export interface PublicProfile {
  userId: string;
  username: string;
  glicko_rating: number;
  peak_rating: number;
  provisional: boolean;
  ranked_games_played: number;
  global_rank: number | null;
  wins: number;
  losses: number;
  win_rate: number;
  is_self: boolean;
  is_friend: boolean;
  has_pending_request: boolean;
  presence: { status: string; current_mode: string | null };
  recent_matches: Array<{
    opponent_username: string;
    result: 'win' | 'loss';
    score: number | null;
    opponent_score: number | null;
    mode: string;
    played_at: string;
  }>;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchActivityFeed(): Promise<{ feed: FeedItem[]; error: string | null }> {
  try {
    const data = await socialFetch<{ ok: boolean; feed: FeedItem[] }>('/api/social/feed');
    return { feed: data.feed, error: null };
  } catch (err) {
    return { feed: [], error: err instanceof Error ? err.message : 'Feed unavailable.' };
  }
}

export async function fetchFriendsLeaderboard(): Promise<{
  leaderboard: FriendsLeaderboardEntry[]; error: string | null;
}> {
  try {
    const data = await socialFetch<{ ok: boolean; leaderboard: FriendsLeaderboardEntry[] }>(
      '/api/social/leaderboard/friends',
    );
    return { leaderboard: data.leaderboard, error: null };
  } catch (err) {
    return { leaderboard: [], error: err instanceof Error ? err.message : 'Leaderboard unavailable.' };
  }
}

export async function fetchGlobalLeaderboard(limit = 50): Promise<{
  leaderboard: Array<{
    userId: string; username: string; glicko_rating: number;
    ranked_games_played: number; provisional: boolean;
  }>;
  error: string | null;
}> {
  try {
    const data = await socialFetch<{ ok: boolean; leaderboard: unknown[] }>(
      `/api/ranking/leaderboard?limit=${limit}`,
    );
    return {
      leaderboard: (data.leaderboard as Array<{
        userId: string; username: string; glicko_rating: number;
        ranked_games_played: number; provisional: boolean;
      }>),
      error: null,
    };
  } catch (err) {
    return { leaderboard: [], error: err instanceof Error ? err.message : 'Leaderboard unavailable.' };
  }
}

export async function fetchRivals(): Promise<{ rivals: RivalEntry[]; error: string | null }> {
  try {
    const data = await socialFetch<{ ok: boolean; rivals: RivalEntry[] }>('/api/social/rivals');
    return { rivals: data.rivals, error: null };
  } catch (err) {
    return { rivals: [], error: err instanceof Error ? err.message : 'Rivals unavailable.' };
  }
}

export async function fetchPublicProfile(
  username: string,
): Promise<{ profile: PublicProfile | null; error: string | null }> {
  try {
    const data = await socialFetch<{ ok: boolean } & PublicProfile>(
      `/api/profile/${encodeURIComponent(username.replace(/^@/, ''))}`,
    );
    return { profile: data, error: null };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : 'Profile unavailable.' };
  }
}
```

- [ ] **Step 2: Verify client TypeScript compiles**

```bash
npm run build --prefix client 2>&1 | grep -E "error|Error|warning" | head -20
# Expected: no TypeScript errors for socialApi.ts
```

---

### Task 9: LeaderboardScreen.tsx — Global / Friends leaderboard

**Files:**
- Create: `client/src/social/LeaderboardScreen.tsx`
- Create: `client/src/social/leaderboard.css`

- [ ] **Step 1: Create leaderboard.css**

```css
/* client/src/social/leaderboard.css */
.lb-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  background: var(--bg-obsidian);
  font-family: var(--font-body);
}

.lb-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  height: 60px;
  border-bottom: 1px solid var(--border-subtle);
}

.lb-brand {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-primary);
}

.lb-hero {
  flex-shrink: 0;
  padding: 28px 32px 0;
}

.lb-eyebrow {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--accent-blue);
  text-transform: uppercase;
  margin: 0 0 6px;
}

.lb-title {
  font-family: var(--font-display);
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-primary);
  margin: 0 0 20px;
}

.lb-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 0;
}

.lb-tab {
  padding: 8px 18px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-premium),
              background var(--duration-fast) var(--ease-premium);
}

.lb-tab--active {
  background: var(--glass-bg);
  color: var(--accent-blue);
  border-color: var(--border-light);
}

.lb-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0 32px 32px;
  background: var(--glass-bg);
  border-top: 1px solid var(--border-light);
}

.lb-table {
  width: 100%;
  border-collapse: collapse;
}

.lb-table-head th {
  padding: 14px 12px;
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--text-dim);
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
  text-transform: uppercase;
}

.lb-row {
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-premium);
}

.lb-row:hover { background: rgba(255, 255, 255, 0.03); }

.lb-row--self {
  background: rgba(14, 165, 233, 0.06);
  box-shadow: inset 3px 0 0 var(--accent-blue);
}

.lb-row--gold   { box-shadow: inset 3px 0 0 var(--tier-elite); }
.lb-row--silver { box-shadow: inset 3px 0 0 #b0b8c8; }
.lb-row--bronze { box-shadow: inset 3px 0 0 #c97c3a; }

.lb-row td {
  padding: 14px 12px;
  font-size: 14px;
  color: var(--text-primary);
  vertical-align: middle;
}

.lb-rank {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 800;
  width: 52px;
}

.lb-rank--gold   { color: var(--tier-elite); }
.lb-rank--silver { color: #b0b8c8; }
.lb-rank--bronze { color: #c97c3a; }

.lb-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.lb-username {
  font-weight: 600;
  font-size: 15px;
}

.lb-rating {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  color: var(--accent-blue);
}

.lb-provisional {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: 4px;
}

.lb-games {
  color: var(--text-dim);
  font-size: 13px;
}

.lb-empty {
  text-align: center;
  padding: 48px 0;
  color: var(--text-dim);
  font-size: 14px;
}
```

- [ ] **Step 2: Create LeaderboardScreen.tsx**

```tsx
// client/src/social/LeaderboardScreen.tsx
import { useCallback, useEffect, useState } from 'react';
import type { AppMode } from '../types';
import {
  fetchGlobalLeaderboard,
  fetchFriendsLeaderboard,
  type FriendsLeaderboardEntry,
} from './socialApi';
import './leaderboard.css';

type Tab = 'global' | 'friends';

interface LeaderboardScreenProps {
  onClose: () => void;
  onNavigate: (mode: AppMode) => void;
  onViewProfile: (username: string) => void;
  isLoggedIn: boolean;
}

type GlobalRow = {
  userId: string; username: string; glicko_rating: number;
  ranked_games_played: number; provisional: boolean;
};

export default function LeaderboardScreen({
  onClose,
  onNavigate: _onNavigate,
  onViewProfile,
  isLoggedIn,
}: LeaderboardScreenProps) {
  const [tab, setTab] = useState<Tab>('global');
  const [globalRows, setGlobalRows] = useState<GlobalRow[]>([]);
  const [friendRows, setFriendRows] = useState<FriendsLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGlobal = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { leaderboard, error: err } = await fetchGlobalLeaderboard(100);
    setLoading(false);
    if (err) { setError(err); return; }
    setGlobalRows(leaderboard);
  }, []);

  const loadFriends = useCallback(async () => {
    if (!isLoggedIn) { setError('Sign in to see friends leaderboard.'); return; }
    setLoading(true);
    setError(null);
    const { leaderboard, error: err } = await fetchFriendsLeaderboard();
    setLoading(false);
    if (err) { setError(err); return; }
    setFriendRows(leaderboard);
  }, [isLoggedIn]);

  useEffect(() => {
    if (tab === 'global') void loadGlobal();
    else void loadFriends();
  }, [tab, loadGlobal, loadFriends]);

  const rankClass = (rank: number) =>
    rank === 1 ? 'lb-rank--gold' : rank === 2 ? 'lb-rank--silver' : rank === 3 ? 'lb-rank--bronze' : '';
  const rowClass = (rank: number, isSelf = false) => {
    if (isSelf) return 'lb-row lb-row--self';
    if (rank === 1) return 'lb-row lb-row--gold';
    if (rank === 2) return 'lb-row lb-row--silver';
    if (rank === 3) return 'lb-row lb-row--bronze';
    return 'lb-row';
  };

  const initials = (name: string) =>
    name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '').join('') || name.slice(0, 2).toUpperCase();

  return (
    <div className="lb-page">
      <header className="lb-topbar">
        <div className="lb-brand">RACEHORSE</div>
        <button type="button" className="rh-back-button" onClick={onClose}>
          <span aria-hidden="true">←</span> Back to Home
        </button>
      </header>

      <div className="lb-hero">
        <p className="lb-eyebrow">Rankings</p>
        <h1 className="lb-title">Leaderboard</h1>
        <div className="lb-tabs">
          {(['global', 'friends'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`lb-tab${tab === t ? ' lb-tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-body">
        {loading && <p className="lb-empty">Loading…</p>}
        {!loading && error && <p className="lb-empty">{error}</p>}
        {!loading && !error && (
          <table className="lb-table" aria-label="Leaderboard">
            <thead className="lb-table-head">
              <tr>
                <th>#</th>
                <th></th>
                <th>Player</th>
                <th>Rating</th>
                <th>Games</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'global' && globalRows.length === 0 && (
                <tr><td colSpan={5} className="lb-empty">No ranked players yet.</td></tr>
              )}
              {tab === 'global' && globalRows.map((row, idx) => {
                const rank = idx + 1;
                return (
                  <tr
                    key={row.userId}
                    className={rowClass(rank)}
                    onClick={() => onViewProfile(row.username)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onViewProfile(row.username)}
                  >
                    <td><span className={`lb-rank ${rankClass(rank)}`}>{rank}</span></td>
                    <td><div className="lb-avatar">{initials(row.username)}</div></td>
                    <td><span className="lb-username">@{row.username}</span></td>
                    <td>
                      <span className="lb-rating">{Math.round(row.glicko_rating).toLocaleString()}</span>
                      {row.provisional && <span className="lb-provisional">?</span>}
                    </td>
                    <td><span className="lb-games">{row.ranked_games_played}</span></td>
                  </tr>
                );
              })}
              {tab === 'friends' && friendRows.length === 0 && (
                <tr><td colSpan={5} className="lb-empty">Add friends to see them here.</td></tr>
              )}
              {tab === 'friends' && friendRows.map((row) => (
                <tr
                  key={row.userId}
                  className={rowClass(row.rank_in_friends, row.is_self)}
                  onClick={() => !row.is_self && onViewProfile(row.username)}
                  role={row.is_self ? undefined : 'button'}
                  tabIndex={row.is_self ? undefined : 0}
                  onKeyDown={(e) => !row.is_self && e.key === 'Enter' && onViewProfile(row.username)}
                >
                  <td><span className={`lb-rank ${rankClass(row.rank_in_friends)}`}>{row.rank_in_friends}</span></td>
                  <td><div className="lb-avatar">{initials(row.username)}</div></td>
                  <td>
                    <span className="lb-username">
                      @{row.username}{row.is_self ? ' (you)' : ''}
                    </span>
                  </td>
                  <td>
                    <span className="lb-rating">{Math.round(row.glicko_rating).toLocaleString()}</span>
                    {row.provisional && <span className="lb-provisional">?</span>}
                  </td>
                  <td><span className="lb-games">{row.ranked_games_played}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Client builds cleanly**

```bash
npm run build --prefix client 2>&1 | grep -E "^.*error TS" | head -10
# Expected: no TypeScript errors
```

---

### Task 10: PublicProfileScreen.tsx

**Files:**
- Create: `client/src/social/PublicProfileScreen.tsx`
- Create: `client/src/social/publicProfile.css`

- [ ] **Step 1: Create publicProfile.css**

```css
/* client/src/social/publicProfile.css */
.pp-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
  background: var(--bg-obsidian);
  font-family: var(--font-body);
}

.pp-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  height: 60px;
  border-bottom: 1px solid var(--border-subtle);
}

.pp-brand {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-primary);
}

.pp-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Hero */
.pp-hero {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--border-light);
  border-radius: var(--radius-card);
  padding: 32px;
  display: flex;
  align-items: flex-start;
  gap: 28px;
}

.pp-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(14, 165, 233, 0.12);
  border: 2px solid var(--accent-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: var(--accent-blue);
  flex-shrink: 0;
}

.pp-hero-info { flex: 1; min-width: 0; }
.pp-username {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.pp-meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.pp-rating {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--accent-blue);
}

.pp-rank {
  font-size: 13px;
  color: var(--text-secondary);
}

.pp-peak {
  font-size: 12px;
  color: var(--text-dim);
}

.pp-presence {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.pp-presence-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pp-presence-dot--online  { background: var(--tier-rookie); box-shadow: 0 0 8px var(--tier-rookie); }
.pp-presence-dot--in_game { background: var(--accent-amber); box-shadow: 0 0 8px var(--accent-amber); }
.pp-presence-dot--offline { background: var(--text-dim); }

.pp-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* Sparkline */
.pp-sparkline-section {
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 20px 24px;
}
.pp-section-label {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin: 0 0 12px;
}
.pp-sparkline {
  width: 100%;
  height: 60px;
  overflow: visible;
}
.pp-sparkline-line {
  fill: none;
  stroke: var(--accent-blue);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pp-sparkline-area {
  fill: url(#sparkGradient);
}

/* Stats grid */
.pp-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.pp-stat-card {
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px 18px;
}
.pp-stat-label {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin: 0 0 4px;
}
.pp-stat-value {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* Recent matches */
.pp-matches-section {
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 20px 24px;
}
.pp-match-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 14px;
}
.pp-match-row:last-child { border-bottom: none; }

.pp-match-result {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
}
.pp-match-result--win  { background: rgba(52,211,153,0.15); color: var(--accent-green); }
.pp-match-result--loss { background: rgba(239,68,68,0.12);  color: var(--accent-red); }

.pp-match-opponent { flex: 1; color: var(--text-primary); }
.pp-match-opponent-name { font-weight: 600; }
.pp-match-score { color: var(--text-secondary); font-family: var(--font-display); font-size: 15px; }
.pp-match-date  { color: var(--text-dim); font-size: 12px; flex-shrink: 0; }

.pp-loading, .pp-error { text-align: center; padding: 60px 0; color: var(--text-dim); }
```

- [ ] **Step 2: Create PublicProfileScreen.tsx**

```tsx
// client/src/social/PublicProfileScreen.tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchPublicProfile, type PublicProfile } from './socialApi';
import { fetchRatingHistory } from '../ranking/api';
import './publicProfile.css';

interface Props {
  username: string;
  onClose: () => void;
  onViewProfile: (username: string) => void;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - Date.parse(isoDate);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Sparkline({ userId }: { userId: string }) {
  const [points, setPoints] = useState<{ rating: number }[]>([]);
  useEffect(() => {
    fetchRatingHistory(userId).then(({ data }) => {
      if (data?.games) setPoints(data.games.slice(-30).map((g) => ({ rating: g.rating_after })));
    }).catch(() => {});
  }, [userId]);

  const path = useMemo(() => {
    if (points.length < 2) return { d: '', area: '' };
    const W = 400; const H = 60;
    const ratings = points.map((p) => p.rating);
    const min = Math.min(...ratings);
    const max = Math.max(...ratings);
    const range = max - min || 1;
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (r: number) => H - ((r - min) / range) * (H - 4) - 2;
    const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`);
    const d = `M${coords.join(' L')}`;
    const area = `${d} L${W},${H} L0,${H} Z`;
    return { d, area };
  }, [points]);

  if (points.length < 2) return null;
  return (
    <div className="pp-sparkline-section">
      <p className="pp-section-label">Rating History (last 30 games)</p>
      <svg className="pp-sparkline" viewBox="0 0 400 60" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="pp-sparkline-area" d={path.area} />
        <path className="pp-sparkline-line" d={path.d} />
      </svg>
    </div>
  );
}

export default function PublicProfileScreen({ username, onClose, onViewProfile: _onViewProfile }: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchPublicProfile(username)
      .then(({ profile: p, error: e }) => {
        setLoading(false);
        if (e) { setError(e); return; }
        setProfile(p);
      })
      .catch(() => { setLoading(false); setError('Unable to load profile.'); });
  }, [username]);

  const initials = (name: string) =>
    name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '').join('') || name.slice(0, 2).toUpperCase();

  const presenceLabel = (status: string) =>
    status === 'online' ? 'Online' : status === 'in_game' ? 'In Game' : 'Offline';

  return (
    <div className="pp-page">
      <header className="pp-topbar">
        <div className="pp-brand">RACEHORSE</div>
        <button type="button" className="rh-back-button" onClick={onClose}>
          <span aria-hidden="true">←</span> Back
        </button>
      </header>

      <div className="pp-body">
        {loading && <p className="pp-loading">Loading profile…</p>}
        {!loading && error && <p className="pp-error">{error}</p>}
        {!loading && profile && (
          <>
            {/* Hero */}
            <div className="pp-hero">
              <div className="pp-avatar">{initials(profile.username)}</div>
              <div className="pp-hero-info">
                <h1 className="pp-username">@{profile.username}</h1>
                <div className="pp-meta-row">
                  <span className="pp-rating">{Math.round(profile.glicko_rating).toLocaleString()}</span>
                  {profile.global_rank && (
                    <span className="pp-rank">#{profile.global_rank} globally</span>
                  )}
                  <span className="pp-peak">Peak: {Math.round(profile.peak_rating).toLocaleString()}</span>
                  <span className="pp-presence">
                    <span className={`pp-presence-dot pp-presence-dot--${profile.presence.status}`} />
                    {presenceLabel(profile.presence.status)}
                  </span>
                </div>
                <div className="pp-actions">
                  {!profile.is_self && !profile.is_friend && !profile.has_pending_request && (
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                      Add Friend — use the Friends screen
                    </span>
                  )}
                  {!profile.is_self && profile.is_friend && (
                    <span style={{ fontSize: 13, color: 'var(--accent-green)' }}>✓ Friends</span>
                  )}
                  {!profile.is_self && profile.has_pending_request && (
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Request pending</span>
                  )}
                </div>
              </div>
            </div>

            {/* Rating sparkline */}
            <Sparkline userId={profile.userId} />

            {/* Stats grid */}
            <div className="pp-stats-grid">
              {[
                { label: 'Win Rate',  value: `${profile.win_rate}%` },
                { label: 'Games',     value: String(profile.wins + profile.losses) },
                { label: 'Record',    value: `${profile.wins}–${profile.losses}` },
                { label: 'Ranked',    value: String(profile.ranked_games_played) },
                { label: 'Provisional', value: profile.provisional ? 'Yes' : 'No' },
                { label: 'Peak Rating', value: Math.round(profile.peak_rating).toLocaleString() },
              ].map((stat) => (
                <div key={stat.label} className="pp-stat-card">
                  <p className="pp-stat-label">{stat.label}</p>
                  <p className="pp-stat-value">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Recent matches */}
            {profile.recent_matches.length > 0 && (
              <div className="pp-matches-section">
                <p className="pp-section-label">Recent Matches</p>
                {profile.recent_matches.map((m, i) => (
                  <div key={i} className="pp-match-row">
                    <span className={`pp-match-result pp-match-result--${m.result}`}>
                      {m.result}
                    </span>
                    <span className="pp-match-opponent">
                      <span className="pp-match-opponent-name">vs @{m.opponent_username}</span>
                    </span>
                    <span className="pp-match-score">
                      {m.score ?? '—'}–{m.opponent_score ?? '—'}
                    </span>
                    <span className="pp-match-date">{formatRelativeTime(m.played_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build --prefix client 2>&1 | grep -E "^.*error TS" | head -10
# Expected: no errors
```

---

### Task 11: ActivityFeedPanel.tsx

**Files:**
- Create: `client/src/social/ActivityFeedPanel.tsx`
- Create: `client/src/social/activityFeed.css`

- [ ] **Step 1: Create activityFeed.css**

```css
/* client/src/social/activityFeed.css */
.af-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.af-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.af-label {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin: 0;
}

.af-filters {
  display: flex;
  gap: 4px;
}

.af-filter-btn {
  padding: 3px 10px;
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-premium),
              border-color var(--duration-fast) var(--ease-premium);
  text-transform: uppercase;
}

.af-filter-btn--active {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
}

.af-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.af-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: transparent;
  transition: background var(--duration-fast) var(--ease-premium);
}

.af-item:hover { background: rgba(255,255,255,0.03); }

.af-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 1px;
}

.af-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.af-actor { font-weight: 600; color: var(--text-primary); }
.af-win   { color: var(--accent-green); }
.af-loss  { color: var(--accent-red); }
.af-streak { color: var(--tier-elite); }
.af-tournament { color: var(--tier-master); }
.af-puzzle { color: var(--accent-blue); }
.af-fritz  { color: var(--tier-elite); }

.af-time {
  font-size: 11px;
  color: var(--text-dim);
  flex-shrink: 0;
  margin-top: 2px;
}

.af-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--text-dim);
  font-size: 13px;
}
```

- [ ] **Step 2: Create ActivityFeedPanel.tsx**

```tsx
// client/src/social/ActivityFeedPanel.tsx
import { useCallback, useEffect, useState } from 'react';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import './activityFeed.css';

type FilterKey = 'all' | 'wins' | 'streaks' | 'tournaments';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'wins', label: 'Wins' },
  { key: 'streaks', label: 'Streaks' },
  { key: 'tournaments', label: 'Tourn.' },
];

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - Date.parse(isoDate);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function itemMatchesFilter(item: FeedItem, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'wins') return item.type === 'win';
  if (filter === 'streaks') return item.type === 'streak';
  if (filter === 'tournaments') return item.type === 'tournament';
  return true;
}

function renderItemText(item: FeedItem): React.ReactNode {
  const actor = <span className="af-actor">@{item.username}</span>;
  const opp = item.metadata.opponent_username;
  const mode = item.metadata.mode;

  if (item.type === 'win') {
    return (
      <>{actor} <span className="af-win">won</span>
        {opp ? <> vs <span className="af-actor">@{opp}</span></> : null}
        {mode ? <> · {mode}</> : null}</>
    );
  }
  if (item.type === 'loss') {
    return (
      <>{actor} <span className="af-loss">lost</span>
        {opp ? <> vs <span className="af-actor">@{opp}</span></> : null}
        {mode ? <> · {mode}</> : null}</>
    );
  }
  if (item.type === 'streak') {
    return (
      <>{actor} hit a <span className="af-streak">{item.metadata.streak}-day streak</span></>
    );
  }
  if (item.type === 'tournament') {
    return (
      <>{actor} finished <span className="af-tournament">{item.metadata.placement}</span> in a tournament</>
    );
  }
  if (item.type === 'puzzle') {
    return (
      <>{actor} <span className="af-puzzle">completed</span> the Daily Puzzle
        {item.metadata.score != null ? ` · ${item.metadata.score}pts` : ''}</>
    );
  }
  if (item.type === 'daily_fritz') {
    return (
      <>{actor} <span className="af-fritz">{item.metadata.result === 'win' ? 'beat' : 'lost to'}</span> Fritz
        {item.metadata.score != null ? ` · ${item.metadata.score}pts` : ''}</>
    );
  }
  return <>{actor} played</>;
}

interface Props {
  isLoggedIn: boolean;
}

export default function ActivityFeedPanel({ isLoggedIn }: Props) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    const { feed: items, error: err } = await fetchActivityFeed();
    setLoading(false);
    if (err) { setError(err); return; }
    setFeed(items);
  }, [isLoggedIn]);

  useEffect(() => { void load(); }, [load]);

  const filtered = feed.filter((item) => itemMatchesFilter(item, filter));

  const initials = (name: string) =>
    name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '').join('') || name.slice(0, 2).toUpperCase();

  return (
    <div className="af-panel">
      <div className="af-header">
        <p className="af-label">Activity</p>
        <div className="af-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`af-filter-btn${filter === f.key ? ' af-filter-btn--active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="af-list">
        {!isLoggedIn && (
          <p className="af-empty">Sign in to see activity.</p>
        )}
        {isLoggedIn && loading && <p className="af-empty">Loading…</p>}
        {isLoggedIn && !loading && error && <p className="af-empty">{error}</p>}
        {isLoggedIn && !loading && !error && filtered.length === 0 && (
          <p className="af-empty">
            {feed.length === 0
              ? 'Add friends to see their activity here.'
              : 'No activity for this filter.'}
          </p>
        )}
        {isLoggedIn && !loading && filtered.map((item) => (
          <div key={item.id} className="af-item">
            <div className="af-avatar">{initials(item.username)}</div>
            <span className="af-text">{renderItemText(item)}</span>
            <span className="af-time">{formatRelativeTime(item.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
npm run build --prefix client 2>&1 | grep -E "^.*error TS" | head -10
# Expected: no errors
```

---

### Task 12: FriendsScreen redesign

**Files:**
- Modify: `client/src/friends/FriendsScreen.tsx`
- Modify: `client/src/friends/friendsScreen.css`

The existing FriendsScreen shows left hero + right control pane. The redesign adds:
1. Amber dot for `in_game` presence status (from `player_presence` table via REST endpoint)
2. H2H record displayed in the selected-friend right panel (replacing StatsScreen)
3. "View Profile" button on each friend row
4. ActivityFeedPanel strip below the friends list

- [ ] **Step 1: Read the current FriendsScreen.tsx and friendsScreen.css before editing**

The current presence is polled via socket `presence:online` which returns a boolean (online/offline). The redesign extends this to three states by also calling `GET /api/social/friends` which returns presence with `status` from `player_presence`.

Add a new API call to `socialApi.ts` for friends-with-presence:

In `client/src/social/socialApi.ts`, add:

```typescript
export interface FriendWithPresence {
  id: string;          // row id in friends table
  userId: string;
  username: string;
  presence_status: 'online' | 'in_game' | 'offline';
  current_mode: string | null;
}

export async function fetchFriendsWithPresence(): Promise<{
  friends: FriendWithPresence[];
  error: string | null;
}> {
  try {
    const data = await socialFetch<{ ok: boolean; friends: FriendWithPresence[] }>(
      '/api/social/friends/with-presence',
    );
    return { friends: data.friends, error: null };
  } catch (err) {
    return { friends: [], error: err instanceof Error ? err.message : 'Friends unavailable.' };
  }
}
```

Add the `/api/social/friends/with-presence` endpoint to `server/src/social/routes.ts`:

```typescript
// GET /api/social/friends/with-presence
socialRouter.get('/friends/with-presence', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    if (!friendIds.length) { res.json({ ok: true, friends: [] }); return; }
    const enc = encodeURIComponent(userId);
    const idFilter = friendIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');

    // Fetch friend_user_id rows to get the actual friends table row id
    const rows = await supabaseFetch<Array<{ id: string; user_id: string; friend_user_id: string }>>(
      `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})&status=eq.accepted&select=id,user_id,friend_user_id`,
    );

    const profileFilter = friendIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
    );
    const profileMap = new Map(profiles.map((p) => [p.id, p.username]));

    const presenceMap = await getPresenceBatch(friendIds);

    const friends = friendIds.map((fId) => {
      const row = rows.find((r) => r.user_id === fId || r.friend_user_id === fId);
      const presence = presenceMap.get(fId) ?? { status: 'offline', current_mode: null };
      return {
        id: row?.id ?? fId,
        userId: fId,
        username: profileMap.get(fId) ?? 'player',
        presence_status: presence.status as 'online' | 'in_game' | 'offline',
        current_mode: presence.current_mode,
      };
    });

    res.json({ ok: true, friends });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Friends unavailable.' });
  }
});
```

- [ ] **Step 2: Update FriendsScreen.tsx**

The key changes are minimal — modify the existing presence dot to handle three states, add a "View Profile" button, and embed `ActivityFeedPanel` below the friends list.

In `FriendsScreen.tsx`, update the import to add `ActivityFeedPanel` and `onViewProfile` prop:

```tsx
// Add to imports:
import ActivityFeedPanel from '../social/ActivityFeedPanel';

// Add to FriendsScreenProps:
onViewProfile?: (username: string) => void;
```

Change the presence dot from a boolean to a three-state color:

```tsx
// Replace the existing presence dot style (the inline style with background/boxShadow):
// BEFORE:
style={{
  background: friend.online ? '#00e676' : 'rgba(255,255,255,0.18)',
  boxShadow: friend.online ? '0 0 8px #00e67688' : 'none',
}}

// AFTER — use friend.presenceStatus if available, fall back to friend.online:
style={{
  background:
    friend.presenceStatus === 'in_game' ? 'var(--accent-amber)'
    : friend.online ? 'var(--tier-rookie)'
    : 'rgba(255,255,255,0.18)',
  boxShadow:
    friend.presenceStatus === 'in_game' ? '0 0 8px rgba(245,158,11,0.6)'
    : friend.online ? '0 0 8px rgba(74,222,128,0.5)'
    : 'none',
}}
```

Update the `FriendRecord` type in `friendsApi.ts` to add `presenceStatus?`:

```typescript
// In friendsApi.ts, extend FriendRecord:
export type FriendRecord = {
  id: string;
  username: string;
  userId: string;
  online: boolean;
  presenceStatus?: 'online' | 'in_game' | 'offline';
};
```

After the existing friends list `</div>`, add the activity feed:

```tsx
{/* Activity feed */}
<div style={{ marginTop: 24 }}>
  <ActivityFeedPanel isLoggedIn={Boolean(user)} />
</div>
```

Add the "View Profile" button alongside "Stats":

```tsx
// In the friends row actions, after the Stats button:
{onViewProfile && (
  <button
    type="button"
    className="friends-page-action-btn"
    onClick={() => onViewProfile(friend.username)}
  >
    Profile
  </button>
)}
```

- [ ] **Step 3: Server rebuild to include new route**

```bash
npm run build --prefix server 2>&1 | tail -5
# Expected: clean build
```

- [ ] **Step 4: Client build passes**

```bash
npm run build --prefix client 2>&1 | grep -E "^.*error TS" | head -10
# Expected: no errors
```

---

### Task 13: App.tsx routing + GlobalNav + types wiring

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/GlobalNav.tsx`

- [ ] **Step 1: Add new AppModes to types.ts**

In `client/src/types.ts`, find the `AppMode` type (line 81) and add two modes:

```typescript
// BEFORE:
  | 'tournament';
// AFTER:
  | 'tournament'
  | 'leaderboard'
  | 'publicProfile';
```

- [ ] **Step 2: Add state and render blocks in App.tsx**

Find the tournament mode declarations (around line 791 where `activeTournamentId` is declared) and add after them:

```typescript
const [profileUsername, setProfileUsername] = useState<string | null>(null);
```

In the import section, add:

```typescript
import LeaderboardScreen from './social/LeaderboardScreen';
import PublicProfileScreen from './social/PublicProfileScreen';
```

Find the `if (appMode === 'tournament')` block. After the closing `}` of the tournament block (or before the final default render), add:

```typescript
if (appMode === 'leaderboard') {
  return (
    <div className={appRootClassName}>
      <LeaderboardScreen
        onClose={() => setAppMode('home')}
        onNavigate={setAppMode}
        onViewProfile={(username) => {
          setProfileUsername(username);
          setAppMode('publicProfile');
        }}
        isLoggedIn={Boolean(authUser)}
      />
    </div>
  );
}

if (appMode === 'publicProfile' && profileUsername) {
  return (
    <div className={appRootClassName}>
      <PublicProfileScreen
        username={profileUsername}
        onClose={() => setAppMode('leaderboard')}
        onViewProfile={(username) => setProfileUsername(username)}
      />
    </div>
  );
}
```

Find all places in App.tsx where `FriendsScreen` is rendered (search for `<FriendsScreen`) and add the `onViewProfile` prop:

```tsx
// Add prop to existing FriendsScreen usage:
onViewProfile={(username) => {
  setProfileUsername(username);
  setAppMode('publicProfile');
}}
```

- [ ] **Step 3: Update GlobalNav to navigate to 'leaderboard' mode**

In `GlobalNav.tsx`, find the `TABS` array entry:

```typescript
// BEFORE:
{ label: 'Leaderboard', mode: 'stats', activeModes: ['stats'] },
// AFTER:
{ label: 'Leaderboard', mode: 'leaderboard', activeModes: ['leaderboard', 'publicProfile'] },
```

- [ ] **Step 4: Final build verification — both client and server**

```bash
npm run build --prefix client 2>&1 | tail -8
# Expected: ✓ built in N.NNs — no errors

npm run build --prefix server 2>&1 | tail -3
# Expected: no TypeScript errors

cd server && npx vitest run src/scheduledTournament src/matchmaking src/social 2>&1 | tail -8
# Expected: all tests passed
```

- [ ] **Step 5: Commit everything**

```bash
git add client/src/social/ client/src/friends/ client/src/types.ts client/src/App.tsx client/src/components/GlobalNav.tsx server/src/social/ server/src/index.ts
git commit -m "$(cat <<'EOF'
feat: social system — leaderboard, public profiles, activity feed, presence, rivals

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

### Spec coverage
| Requirement | Task |
|-------------|------|
| player_presence table | Task 1 |
| activity_feed table | Task 2 |
| Presence: on connect → online | Task 7 (Step 3) |
| Presence: on disconnect → offline | Task 7 (Step 4) |
| Activity writer: match win/loss | Task 7 (Step 5) |
| Activity writer: daily puzzle | Task 7 (Step 6) |
| Activity writer: daily fritz | Task 7 (Step 7) |
| Activity writer: streak milestone | Task 4 (writePuzzleActivity) |
| GET /api/social/feed | Task 6 |
| GET /api/social/leaderboard/friends | Task 6 |
| GET /api/social/rivals | Task 6 |
| GET /api/profile/:username | Task 6 |
| FriendsScreen: 3-state presence dots | Task 12 |
| FriendsScreen: activity feed strip | Task 12 |
| FriendsScreen: View Profile button | Task 12 |
| LeaderboardScreen: Global tab | Task 9 |
| LeaderboardScreen: Friends tab | Task 9 |
| PublicProfileScreen: hero + rating + rank | Task 10 |
| PublicProfileScreen: sparkline | Task 10 |
| PublicProfileScreen: stats grid | Task 10 |
| PublicProfileScreen: recent matches | Task 10 |
| PublicProfileScreen: relationship buttons | Task 10 |
| ActivityFeedPanel: feed items with opponent | Task 11 |
| ActivityFeedPanel: filter tabs | Task 11 |
| ActivityFeedPanel: empty state | Task 11 |
| App routing for leaderboard + publicProfile | Task 13 |
| GlobalNav Leaderboard tab updated | Task 13 |
| Both builds pass | Tasks 7, 9, 10, 11, 12, 13 |
| Existing 38 tests still pass | Task 7 (Step 8) |

**Gaps identified:**
- Tournament activity writer not wired to tournament engine. Scope-limited: the tournament engine (`engine.ts`) is a significant change; tournament results can be added in a follow-up. `writeTournamentActivity` is implemented and exported but not called yet.
- Presence: `in_game` update on game start is not included because hooking into every game-start socket path would require changes to 5+ locations across the socket handler. The `in_game` status will only show for players who are detected as in_game via the socket `socketsByUserId` map check — this is a known gap to address post-launch.

### Type consistency verified
- `FriendRecord.presenceStatus` is optional so existing code paths that never set it continue to work
- `AppMode` is used in `types.ts` and the `FriendsScreenProps.onViewProfile` takes `string`, not `AppMode`
- `socialRouter.get('/:username')` (the profile route) uses `req.params.username`, which is correct for a sub-router mounted at `/api/profile`
