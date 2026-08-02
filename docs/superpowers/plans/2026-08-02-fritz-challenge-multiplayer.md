# Fritz Challenge Multi-Participant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Fritz Challenge from 1v1 into an anytime shared Daily Fritz–style BO3 for creator + up to 4 others, with anti-scout creator start gating and a live finishers leaderboard.

**Architecture:** Keep one challenge seed and shared `fritz_challenge_hands`; replace single `opponent_user_id` roster with `fritz_challenge_participants` (max 5). Each user gets one attempt; match play continues to reuse Daily Fritz verifier rails via `challenge_code`. Parent challenge must not complete when the first player finishes.

**Tech Stack:** TypeScript, Express, Supabase SQL/RPC (service role), React client, Vitest, Playwright e2e, existing `client/src/fritzChallenge/*` + `server/src/fritzChallenge*` WIP.

## Global Constraints

- Roster: creator + max **4 others** (5 total).
- Invitees may start immediately after join; creator may start only after **≥1 invitee** joined.
- Live leaderboard of **completed** attempts only (Daily Fritz–like ordering).
- Never expose challenge `seed` to clients.
- Never mark challenge `completed` solely because one attempt finished.
- v1 entry: Play vs Fritz CTA (rename to Challenge Friends); Solo hub card deferred to v1.1.
- Expiry default: **72 hours** from create.
- Joins remain open after anyone has started until seats full, expired, or cancelled.
- Auth required for create / join / start / play.
- Feature flag: `VITE_FRITZ_CHALLENGES_ENABLED` (dev default on).
- Spec: `docs/superpowers/specs/2026-08-02-fritz-challenge-multiplayer-design.md`.

## File Map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/2026-08-02_fritz_challenge_participants.sql` | Participants table, backfill, RPC replace (join/start/record-game) |
| `supabase/fritz_challenges.sql` | Keep canonical schema in sync with migration for fresh installs / schema tests |
| `server/src/fritzChallenge.ts` | Domain constants (`MAX_PARTICIPANTS = 5`), view helpers |
| `server/src/http/stores/fritzChallengeStore.ts` | Supabase store: participants, capacity join, start gate, leaderboard query |
| `server/src/http/routes/fritzChallenges.ts` | API view: participants, can_join, can_start, leaderboard |
| `client/src/fritzChallenge/api.ts` | Client types + endpoints |
| `client/src/fritzChallenge/FritzChallengeRoom.tsx` | Roster, share, live board, start gating UI |
| `client/src/fritzChallenge/FritzChallengeDialog.tsx` | Copy rename Challenge Friends |
| `client/src/bot/PlayVsFritz.tsx` | CTA label |
| `client/src/App.tsx` / `AppRoutes.tsx` | Ensure challenge back → room; flag wiring landed |
| `client/e2e/fritz-challenge-multi.spec.ts` | Create → join → start gate → complete board |

---

### Task 1: Schema — participants table + backfill

**Files:**
- Create: `supabase/migrations/2026-08-02_fritz_challenge_participants.sql`
- Modify: `supabase/fritz_challenges.sql` (mirror table + RLS)
- Test: `server/src/dbIdempotencySchema.test.ts`

**Interfaces:**
- Produces: table `public.fritz_challenge_participants` with `(challenge_id, user_id)` unique, `role in ('creator','invitee')`, RLS deny-all for authenticated

- [ ] **Step 1: Write failing schema test**

Add to `server/src/dbIdempotencySchema.test.ts`:

```ts
it('ships Fritz Challenge multi-participant roster', () => {
  const sql = compactSql(readRepoFile(
    'supabase/migrations/2026-08-02_fritz_challenge_participants.sql',
  ));
  expect(sql).toContain('create table if not exists public.fritz_challenge_participants');
  expect(sql).toContain("role text not null check (role in ('creator', 'invitee'))");
  expect(sql).toContain('unique (challenge_id, user_id)');
  expect(sql).toContain('max_participants int not null default 5');
  expect(sql).toContain('join_fritz_challenge_participant');
  expect(sql).toContain('invitee_required_before_creator_start');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- src/dbIdempotencySchema.test.ts -t "multi-participant"`
Expected: FAIL (migration file missing)

- [ ] **Step 3: Write migration SQL**

Create `supabase/migrations/2026-08-02_fritz_challenge_participants.sql` that:

1. `alter table public.fritz_challenges add column if not exists max_participants int not null default 5 check (max_participants = 5);`
2. Creates `fritz_challenge_participants` with PK or unique `(challenge_id, user_id)`, `role`, `joined_at`, FK cascade, RLS deny-all policy like other challenge tables.
3. Backfill:

```sql
insert into public.fritz_challenge_participants (challenge_id, user_id, role, joined_at)
select id, creator_user_id, 'creator', created_at from public.fritz_challenges
on conflict (challenge_id, user_id) do nothing;

insert into public.fritz_challenge_participants (challenge_id, user_id, role, joined_at)
select id, opponent_user_id, 'invitee', coalesce(completed_at, created_at)
from public.fritz_challenges
where opponent_user_id is not null
on conflict (challenge_id, user_id) do nothing;
```

4. Do **not** drop `opponent_user_id` yet (legacy mirror optional later).

Mirror the table definition into `supabase/fritz_challenges.sql` for greenfield.

- [ ] **Step 4: Run schema test to verify it passes**

Run: `npm test --prefix server -- src/dbIdempotencySchema.test.ts -t "multi-participant"`
Expected: PASS (after Step 5 RPCs exist — if test asserts RPC names, include stub RPC creates in this migration or split assertion; prefer include RPC creates in Task 2 and keep this test only on table columns until Task 2, OR implement RPCs in same migration file across Task 1–2).

**Plan note:** Put **table + backfill** in Task 1 migration file; Task 2 **appends/replaces RPCs** in the same migration file before commit of Task 1+2 together if needed. Prefer one migration commit after Task 2.

- [ ] **Step 5: Commit after Task 2** (see Task 2 Step 5) — do not commit a half migration that schema tests require RPCs for.

---

### Task 2: SQL RPCs — join capacity, creator start gate, stop first-finisher completion

**Files:**
- Modify: `supabase/migrations/2026-08-02_fritz_challenge_participants.sql`
- Modify: `supabase/fritz_challenges.sql` (replace functions)
- Test: `server/src/dbIdempotencySchema.test.ts` (complete assertions from Task 1)

**Interfaces:**
- Produces:
  - `join_fritz_challenge_participant(p_challenge_id uuid, p_user_id uuid)` → participant row / status
  - `start_fritz_challenge_attempt` updated: if `p_user_id = creator` and no invitee participant → `raise exception 'invitee_required_before_creator_start'`
  - `record_fritz_challenge_game`: **remove** the block that sets `fritz_challenges.status = 'completed'` when `p_completed`

- [ ] **Step 1: Write failing unit expectation in store/route tests for error code**

In `server/src/http/stores/fritzChallengeStore.test.ts` (or routes test), add:

```ts
it('maps invitee_required_before_creator_start to FritzChallengeError', async () => {
  // mock supabaseFetch to return 400 with message invitee_required_before_creator_start
  await expect(startOrResumeFritzChallengeAttempt('chal', 'creator'))
    .rejects.toMatchObject({ code: 'invitee_required_before_creator_start' });
});
```

(Adjust to actual thrown shape used by store.)

- [ ] **Step 2: Run test — expect fail**

Run: `npm test --prefix server -- src/http/stores/fritzChallengeStore.test.ts -t "invitee_required"`
Expected: FAIL until store maps the code (Task 3) / RPC exists.

- [ ] **Step 3: Implement RPC SQL**

**Join** (replace `claim_fritz_challenge_opponent` or add new and point store at new):

```sql
create or replace function public.join_fritz_challenge_participant(
  p_challenge_id uuid,
  p_user_id uuid
) returns table (
  challenge_id uuid,
  user_id uuid,
  role text,
  challenge_status text,
  participant_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.fritz_challenges%rowtype;
  cnt int;
begin
  select * into c from public.fritz_challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge_not_found'; end if;
  if c.status not in ('open', 'active') then raise exception 'challenge_not_joinable'; end if;
  if c.expires_at <= now() then raise exception 'challenge_expired'; end if;
  if p_user_id = c.creator_user_id then raise exception 'creator_cannot_join_as_invitee'; end if;

  select count(*) into cnt from public.fritz_challenge_participants where challenge_id = p_challenge_id;
  if exists (
    select 1 from public.fritz_challenge_participants
    where challenge_id = p_challenge_id and user_id = p_user_id
  ) then
    -- idempotent re-join
    null;
  elsif cnt >= c.max_participants then
    raise exception 'challenge_full';
  else
    insert into public.fritz_challenge_participants (challenge_id, user_id, role)
    values (p_challenge_id, p_user_id, 'invitee');
    -- optional: keep legacy mirror
    update public.fritz_challenges
      set opponent_user_id = coalesce(opponent_user_id, p_user_id),
          status = case when status = 'open' then 'active' else status end
      where id = p_challenge_id;
  end if;

  return query
    select p_challenge_id, p_user_id, 'invitee'::text, c.status,
      (select count(*)::int from public.fritz_challenge_participants where challenge_id = p_challenge_id);
end;
$$;
```

Grant execute to `service_role` only.

**Start gate** — inside `start_fritz_challenge_attempt`, after loading challenge:

```sql
if p_user_id = current_challenge.creator_user_id then
  if not exists (
    select 1 from public.fritz_challenge_participants
    where challenge_id = p_challenge_id and role = 'invitee'
  ) then
    raise exception 'invitee_required_before_creator_start';
  end if;
end if;

-- allow start if participant
if not exists (
  select 1 from public.fritz_challenge_participants
  where challenge_id = p_challenge_id and user_id = p_user_id
) then
  raise exception 'not_a_participant';
end if;
```

Remove old opponent-only membership checks that block non-opponent invitees.

**Record game** — delete:

```sql
if p_completed then
  update public.fritz_challenges
    set status = 'completed', completed_at = now()
  where id = ...;
end if;
```

Optionally set challenge `status = 'active'` if still `open` when first attempt starts.

- [ ] **Step 4: Run schema test**

Run: `npm test --prefix server -- src/dbIdempotencySchema.test.ts -t "Fritz Challenge"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-08-02_fritz_challenge_participants.sql supabase/fritz_challenges.sql server/src/dbIdempotencySchema.test.ts
git commit -m "feat(challenge): multi-participant schema and start/join RPCs"
```

---

### Task 3: Server store + domain types

**Files:**
- Modify: `server/src/fritzChallenge.ts`
- Modify: `server/src/http/stores/fritzChallengeStore.ts`
- Modify: `server/src/http/stores/fritzChallengeStore.test.ts`

**Interfaces:**
- Produces:
  - `export const FRITZ_CHALLENGE_MAX_PARTICIPANTS = 5`
  - `listFritzChallengeParticipants(challengeId): Promise<Participant[]>`
  - `joinFritzChallengeParticipant(challengeId, userId)` (calls new RPC)
  - `listFritzChallengeLeaderboard(challengeId)` → completed attempts + usernames
  - `GeneratedFritzChallenge` includes `participants` (no seed in API mapper)

- [ ] **Step 1: Failing tests for capacity and creator gate mapping**

```ts
it('rejects join when challenge is full (5/5)', async () => {
  // mock count/RPC challenge_full
});

it('startOrResume maps invitee_required_before_creator_start', async () => {
  // as in Task 2
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npm test --prefix server -- src/http/stores/fritzChallengeStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement store methods**

- `createFritzChallenge`: after insert challenge, insert creator participant (RPC or direct service insert matching create path).
- Replace `claimFritzChallengeOpponent` usage with `joinFritzChallengeParticipant`.
- `getFritzChallengeByCode`: also load participants + completed attempts for leaderboard.
- Leaderboard sort (TypeScript), mirror DF intent:

```ts
function sortChallengeLeaderboard(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore; // set games won
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return a.completedAt.localeCompare(b.completedAt);
  });
}
```

(Wire skunk rank later if `result` has skunk fields — reuse `getDailyFritzSkunkWinRank` when available.)

- [ ] **Step 4: Run store tests — expect pass**

Run: `npm test --prefix server -- src/http/stores/fritzChallengeStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/fritzChallenge.ts server/src/http/stores/fritzChallengeStore.ts server/src/http/stores/fritzChallengeStore.test.ts
git commit -m "feat(challenge): store participants join and leaderboard queries"
```

---

### Task 4: HTTP API view — can_join / can_start / leaderboard

**Files:**
- Modify: `server/src/http/routes/fritzChallenges.ts`
- Modify: `server/src/http/routes/fritzChallenges.test.ts`

**Interfaces:**
- Produces API challenge object:

```ts
type FritzChallengeApiView = {
  id: string;
  share_code: string;
  status: FritzChallengeStatus;
  fritz_tier: string;
  deal_size: 7 | 14;
  winning_score: number;
  max_participants: 5;
  participant_count: number;
  participants: Array<{
    user_id: string;
    username: string | null;
    role: 'creator' | 'invitee';
    attempt_status: 'none' | 'started' | 'completed' | 'abandoned';
  }>;
  leaderboard: Array<{
    rank: number;
    user_id: string;
    username: string | null;
    final_score: number;
    opponent_score: number;
    point_diff: number;
    completed_at: string;
  }>;
  viewer_role: 'creator' | 'invitee' | null;
  can_join: boolean;
  can_start: boolean;
  creator_start_blocked_reason: 'waiting_for_invitee' | null;
  created_at: string;
  expires_at: string;
};
```

- [ ] **Step 1: Failing route tests**

```ts
it('GET view sets can_start false for creator with no invitees', () => {
  const view = toFritzChallengeApiView(challengeWithOnlyCreator, creatorId);
  expect(view.can_start).toBe(false);
  expect(view.creator_start_blocked_reason).toBe('waiting_for_invitee');
});

it('GET view sets can_start true for invitee', () => {
  const view = toFritzChallengeApiView(challengeWithInvitee, inviteeId);
  expect(view.can_start).toBe(true);
});

it('POST start returns 409 invitee_required_before_creator_start for lone creator', async () => {
  // supertest or handler harness
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test --prefix server -- src/http/routes/fritzChallenges.test.ts -t "can_start"`
Expected: FAIL

- [ ] **Step 3: Implement `toFritzChallengeApiView` + join/start handlers**

Logic:

```ts
const inviteeCount = participants.filter((p) => p.role === 'invitee').length;
const isParticipant = participants.some((p) => p.user_id === viewerUserId);
const isCreator = viewerUserId === challenge.creatorUserId;
const can_join = Boolean(viewerUserId)
  && !isParticipant
  && participants.length < challenge.maxParticipants
  && status in ['open','active'];
const can_start = Boolean(viewerUserId) && isParticipant && (
  !isCreator || inviteeCount >= 1
);
```

Wire `POST /join` to new store method. Map SQL errors to HTTP 409 with `code`.

- [ ] **Step 4: Run route tests — pass**

Run: `npm test --prefix server -- src/http/routes/fritzChallenges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/http/routes/fritzChallenges.ts server/src/http/routes/fritzChallenges.test.ts
git commit -m "feat(challenge): API roster, start gates, and live leaderboard"
```

---

### Task 5: Client API types + room UI

**Files:**
- Modify: `client/src/fritzChallenge/api.ts`
- Modify: `client/src/fritzChallenge/FritzChallengeRoom.tsx`
- Modify: `client/src/fritzChallenge/FritzChallengeRoom.test.tsx`
- Modify: `client/src/fritzChallenge/fritzChallenge.css`
- Modify: `client/src/fritzChallenge/FritzChallengeDialog.tsx`
- Modify: `client/src/bot/PlayVsFritz.tsx`

**Interfaces:**
- Consumes: Task 4 API view fields
- Produces: Room UI showing seats 1–5, share, live board, gated Start

- [ ] **Step 1: Failing room tests**

```ts
it('shows waiting copy and disables Start for creator without invitees', () => {
  render(<FritzChallengeRoom code="ABCD2345" ... />);
  // mock getFritzChallenge → can_start false, creator_start_blocked_reason waiting_for_invitee
  expect(screen.getByText(/Waiting for a friend to join/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Start/i })).toBeDisabled();
});

it('renders leaderboard rows when present', () => {
  // mock leaderboard with one finisher
  expect(screen.getByText(/Finish your set to take the board|1/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test --prefix client -- src/fritzChallenge/FritzChallengeRoom.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update types + room**

- Extend `FritzChallengeView` with participants, leaderboard, can_join, can_start, etc.
- Replace `has_opponent` UI with seat list `participant_count / max_participants`.
- Creator blocked: show “Waiting for a friend to join before you can start”.
- Full: “Challenge is full (5/5).”
- Empty board: “Finish your set to take the board.”
- Poll GET every ~8s (keep existing poll).
- Rename CTA/dialog strings from “Challenge a Friend” → “Challenge Friends”.

- [ ] **Step 4: Run client unit tests — pass**

Run: `npm test --prefix client -- src/fritzChallenge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/fritzChallenge client/src/bot/PlayVsFritz.tsx
git commit -m "feat(challenge): multi-seat room UI and live board"
```

---

### Task 6: Match lifecycle polish — back to room

**Files:**
- Modify: `client/src/App.tsx` (challenge package complete → hash room)
- Modify: `client/src/AppRoutes.tsx` (BotMatch `onBack` when challengePackage → challenge room)
- Test: extend existing client challenge link tests or App route behavior test if present

**Interfaces:**
- Consumes: `challenge_code` on package
- Produces: after set complete / back, navigate `#/fritz/challenge/{code}`

- [ ] **Step 1: Failing test for back target**

If no harness exists, add a small pure helper:

```ts
// client/src/fritzChallenge/fritzChallengeNavigation.ts
export function challengeRoomHash(code: string): string {
  return `#/fritz/challenge/${normalizeFritzChallengeShareCode(code)}`;
}
```

```ts
expect(challengeRoomHash('abcd2345')).toBe('#/fritz/challenge/ABCD2345');
```

Wire App/AppRoutes to use it for challenge exits.

- [ ] **Step 2–4: Implement + test + commit**

```bash
git commit -m "fix(challenge): return players to challenge room after match"
```

---

### Task 7: Land feature flag + server registration hygiene

**Files:**
- Modify: `client/.env.example` — document `VITE_FRITZ_CHALLENGES_ENABLED`
- Ensure `server/src/index.ts` registers `registerFritzChallengeRoutes` on the branch that ships
- Ensure WIP challenge modules are committed together (not left untracked)

- [ ] **Step 1:** Add env example line
- [ ] **Step 2:** Verify `npm run build --prefix server` and `npm run build --prefix client`
- [ ] **Step 3: Commit**

```bash
git commit -m "chore(challenge): document flag and ensure routes registered"
```

---

### Task 8: Playwright smoke — create / join / gate / board

**Files:**
- Create: `client/e2e/fritz-challenge-multi.spec.ts`

**Interfaces:**
- Consumes: local e2e server with challenge flag on + schema applied

- [ ] **Step 1: Write e2e**

```ts
test('creator cannot start until invitee joins; board lists finisher', async ({ browser }) => {
  // creator context: create challenge, assert Start disabled / waiting copy
  // invitee context: open share URL, Join, Start (may stub match if full BO3 too heavy)
  // minimal: after join, creator refresh shows can start
});
```

If full BO3 e2e is too heavy for v1, split:
1. API-level integration test for join/start/record completion leaderboard (preferred in server tests)
2. Playwright only for room gate + join UI

- [ ] **Step 2: Run e2e or server integration**

Run: `npm test --prefix server -- src/http/routes/fritzChallenges.test.ts`  
and/or Playwright project as configured.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(challenge): multi-participant join and start-gate coverage"
```

---

### Task 9: Apply SQL to environments + manual QA

**Files:** none (ops)

- [ ] **Step 1:** Run `2026-08-02_fritz_challenge_participants.sql` in Supabase SQL editor (staging then prod)
- [ ] **Step 2:** Manual QA checklist:
  1. Create challenge as user A — Start blocked
  2. User B joins via link — B can Start; A can Start
  3. Users C–E join until 5/5 — F rejected full
  4. B finishes set — appears on room leaderboard; challenge still joinable/active for others
  5. A finishes — second leaderboard row; order matches set score / margin / time
- [ ] **Step 3:** Note results in PR description

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| 5 seats (creator + 4) | 1–2, 4–5 |
| Anti-scout creator start | 2–5 |
| Invitee start after join | 2–5 |
| Live leaderboard | 3–5, 8–9 |
| No complete-on-first-finisher | 2 |
| Seed never exposed | 4 (view mapper) |
| DF-style BO3 reuse | existing path + Task 6 |
| PVF entry rename | 5 |
| Solo hub v1.1 deferred | Global constraints |
| 72h expiry | create path in store (set `expires_at = now + 72h` if not already) — verify in Task 3 |
| Flag + ship | 7 |
| E2E / QA | 8–9 |

## Placeholder scan

No TBD steps; open Solo hub deferred explicitly.

## Type consistency

- API uses `invitee` role (not `opponent`) going forward; legacy `viewer_role: 'opponent'` may map to `invitee` during transition.
- Error code string: `invitee_required_before_creator_start` everywhere.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-02-fritz-challenge-multiplayer.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with checkpoints  

Which approach?
