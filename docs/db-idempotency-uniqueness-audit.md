# DB Idempotency And Uniqueness Audit

Date: 2026-06-02  
Sources: `docs/mass-production-readiness-audit.md`, `docs/p0-security-abuse-stabilization-plan.md`, `docs/daily-puzzle-server-validation-report.md`  
Scope: scoring/result duplicate prevention only. No UI changes, gameplay changes, broad route refactors, or blind production migrations.

## Executive Verdict

Racehorse has several important DB-level idempotency protections already documented in checked-in SQL:

- Daily Fritz: one attempt per `(run_date, user_id)`.
- Daily Puzzle Ladder: one attempt per `(puzzle_date, user_id)` and one slot result per `(attempt_id, slot_index)`.
- Ghost verified completions: one `ghost_games` row per `match_id`.
- Verified single-player sessions: primary key `match_id` and unique `(user_id, local_match_id)`.
- Scheduled tournaments: one bracket match per `(tournament_id, round, match_number)`.

The largest remaining duplicate-result risk is `ranked_games`. The repo contains multiple plain inserts into `ranked_games`, but no checked-in DDL defining an idempotency column or unique index for ranked result rows. Adding a migration blindly would be unsafe because the current production table shape and historical duplicates are unknown.

This pass added schema guard tests for the high-confidence existing constraints, but did not add risky migrations. The safest next step is a production schema/historical duplicate inventory, then a cleanup-first migration for `ranked_games`, public `matches`, and activity feed idempotency keys.

## Summary Matrix

| Flow | DB protection found | App-level idempotency | Duplicate risk | Migration safe now |
|---|---|---|---|---|
| Ranked multiplayer / `ranked_games` | No checked-in table DDL or unique idempotency key found. | Some game-over flow state reduces repeated finalize, but ranked inserts are plain POSTs. | High: duplicate inserts can create duplicate rating rows and double rating changes. | No. Need schema inventory and cleanup first. |
| Public match logs / `matches` | `id` primary key only in `supabase/schema.sql`; no unique `metadata->>roomMatchId` index. | `recordPublicOnlineMatch` checks existing `metadata->>roomMatchId` before insert; stats routes dedupe rows for display. | Medium: concurrent retry can pass pre-check and insert duplicates. | No. Need historical duplicate cleanup or expression unique index validation. |
| Daily Fritz attempts | Unique `(run_date, user_id)` index in `supabase/daily_fritz.sql`. | Completion hash/idempotent replay logic in route. `upsertDailyFritzAttempt` persists by `id`. | Low/medium: start races should be blocked by DB; completion replay protected by route. Route insert may still need graceful unique-conflict replay. | Existing constraint is safe; no new migration needed. |
| Daily Puzzle attempts | Unique `(puzzle_date, user_id)` in `supabase/daily_puzzle_ladder_v1.sql`. | Start replays existing attempt; complete is idempotent if already completed. | Low: DB protects duplicate attempts; route can still return an error on rare concurrent create conflict. | Existing constraint is safe; no new migration needed. |
| Daily Puzzle slot results | Unique `(attempt_id, slot_index)` in `supabase/daily_puzzle_ladder_v1.sql`. | Submit returns existing slot result before insert; server now validates/scored submitted line. | Low: DB prevents duplicate points; route can still return conflict/error under concurrent duplicate submit instead of replaying. | Existing constraint is safe; no new migration needed. |
| Tournament match results | Unique `(tournament_id, round, match_number)` in scheduled tournament migration. | `applyMatchResult` exits if match status is already `completed`; bracket generation skips existing matches. | Medium: non-atomic read-then-update can race in multi-worker deployment. | No. Need conditional update/RPC or DB lease before multi-instance. |
| Ghost verified completions | `ghost_games.match_id` unique in `supabase/ghost.sql`; `verified_single_player_matches.match_id` primary key; unique `(user_id, local_match_id)`. | Completion hash replay and verified match ownership checks. | Low: `ghost_games` upsert by `match_id` protects duplicate training rows when migration is applied. Fallback plain insert remains risky if migration absent. | Existing constraint is safe; verify applied in production. |
| Social activity duplicates | No uniqueness in `server/sql/social/002_activity_feed.sql`; immutable event log only. | Writes are fire-and-forget. Some completion routes call only on first completion, but retries can write duplicate feed rows. | Medium for feed spam; low for leaderboards because feed is not scoring source. | No. Need idempotency key column or metadata expression index after cleanup. |

## Detailed Audit

### 1. Ranked Multiplayer / `ranked_games`

Current uniqueness assumptions:

- Each rated game writes one `ranked_games` row per rated participant.
- Pending rows are processed by `processRatingPeriod` where `rating_after is null`.
- Live multiplayer writes two rows, one per player, then calls `processRealtimeMultiplayerGame`.
- Fritz/Ghost/local flows write one row for the player and call `processRatingPeriod`.

Existing DB constraints/indexes:

- No checked-in `create table public.ranked_games` DDL was found.
- No checked-in unique index on `match_id`, `external_match_id`, `room_match_id`, or `(player_id, match id)` was found.

Existing application-level idempotency:

- Per-room game-over logic and room state reduce duplicate finalization.
- Rating processing marks rows with `rating_after`, but this is processing-state idempotency, not insert idempotency.

Duplicate risks:

- Repeated game-over finalization can insert duplicate `ranked_games` rows.
- Duplicate rows with `rating_after is null` can be processed as separate games and change rating twice.
- Multiplayer inserts do not include a stable idempotency key such as `room.matchId`.
- Fritz disconnect loss and Ghost/Fritz completion ranked inserts do not include a stable idempotency key in the visible payload.

Recommended constraint:

- Add `external_match_id text null` or `source_match_id text null`.
- Add `source text not null default 'unknown'` if needed.
- Add unique index after cleanup:

```sql
create unique index concurrently if not exists ranked_games_player_source_match_uidx
  on public.ranked_games (player_id, source_match_id)
  where source_match_id is not null;
```

Cleanup required first:

- Query duplicate candidates by player/opponent/score/game_type/time buckets.
- Backfill `source_match_id` for rows that can be linked to `room.matchId`, `verified_single_player_matches.match_id`, or local match id.
- Decide whether historical duplicate rows should be deleted, marked void, or excluded from rating history.

Migration safety: not safe immediately because authoritative table shape and historical duplicates are unknown.

### 2. Public Match Logs / `matches`

Current uniqueness assumptions:

- Public online match rows are intended to be unique by `metadata.roomMatchId`.
- `recordPublicOnlineMatch` checks for existing `metadata->>roomMatchId` before inserting.
- Stats/social read paths call `dedupeMatchRows` to hide duplicate display rows.

Existing DB constraints/indexes:

- `supabase/schema.sql` defines `matches.id` primary key.
- No unique expression index exists for `metadata->>roomMatchId`.

Duplicate risks:

- Two concurrent inserts can both pass the pre-check.
- If metadata shape changes or `roomMatchId` is absent, duplicates fall back to display-only dedupe.

Recommended constraint:

```sql
create unique index concurrently if not exists matches_room_match_id_uidx
  on public.matches ((metadata->>'roomMatchId'))
  where metadata ? 'roomMatchId';
```

Cleanup required first:

- Find duplicate `metadata->>'roomMatchId'` groups.
- Keep earliest row and remove or mark later duplicates.

Migration safety: not safe blindly; safe after duplicate scan.

### 3. Daily Fritz

Current uniqueness assumptions:

- One Daily Fritz attempt per user per run date.
- A completion hash makes duplicate completion replay idempotent.
- Attempts are persisted by primary key after creation.

Existing DB constraints/indexes:

- `supabase/daily_fritz.sql` has unique index `idx_daily_fritz_attempts_run_user` on `(run_date, user_id)`.
- `daily_fritz_runs.run_date` is primary key.

Existing application-level idempotency:

- `getDailyFritzAttempt` replays an existing attempt.
- `upsertDailyFritzAttempt` uses `on_conflict=id`.
- Completion checks existing completed status and completion hash.

Duplicate risks:

- Rare concurrent start can hit the unique index and return an error unless the route catches/replays.
- Completion is route-idempotent, but DB does not separately enforce one completion hash per run/user beyond the attempt uniqueness.

Recommended next small hardening:

- Catch unique-conflict on `createDailyFritzAttempt`, then fetch and return the existing attempt.
- Optionally add a production verification query that confirms the unique index exists.

Migration safety: no new migration needed.

### 4. Daily Puzzle Attempts, Slot Results, Complete

Current uniqueness assumptions:

- One attempt per user per puzzle date.
- One slot result per attempt per slot.
- Complete only finalizes after three slot results.
- New slot result scores are server-validated as of `docs/daily-puzzle-server-validation-report.md`.

Existing DB constraints/indexes:

- `daily_puzzle_attempts_puzzle_date_user_id_key unique (puzzle_date, user_id)`.
- `daily_puzzle_slot_results_attempt_slot_key unique (attempt_id, slot_index)`.
- Leaderboard indexes on attempts and slot results.

Existing application-level idempotency:

- Start returns existing attempt.
- Submit returns existing slot result before inserting.
- Complete returns idempotent replay if already completed.
- Slot order and set-version binding are enforced in application code.

Duplicate risks:

- Concurrent duplicate submit can produce a DB unique conflict. This prevents double points, but may not produce a graceful replay response.
- Concurrent complete can race on an attempt snapshot. Current persistence writes deterministic completed state, but an atomic conditional update would be stronger.

Recommended next small hardening:

- Catch unique-conflict on `createDailyPuzzleSlotResult`, fetch existing slot result, and return it.
- Consider an RPC/conditional update for final completion: update only where `status = 'started'`.

Migration safety: no new migration needed.

### 5. Tournament Match Results / Bracket Advancement

Current uniqueness assumptions:

- One match row per tournament bracket slot.
- A match only advances once.
- Final match completion completes the tournament once.

Existing DB constraints/indexes:

- `scheduled_tournament_matches` has `unique (tournament_id, round, match_number)`.
- `scheduled_tournament_registrations` has `unique (tournament_id, user_id)`.
- `scheduled_tournaments.scheduled_start` is unique.

Existing application-level idempotency:

- `generateBracket` returns existing matches if already generated.
- `dispatchScheduledStartMatches` skips terminal/active matches.
- `applyMatchResult` returns immediately if the fetched match status is `completed`.
- Tests cover bracket idempotency and replay behavior.

Duplicate risks:

- In a multi-instance deployment, two workers can fetch a non-completed match and both apply advancement before either sees the other's update.
- Tournament completion activity can duplicate if final completion races.

Recommended constraint/RPC:

- Keep bracket-slot uniqueness.
- Add a DB function or conditional update path that completes only if `status != 'completed'`, returning whether it actually won the race.
- Only advance bracket or write activity when that conditional update returns a changed row.

Migration safety: no new unique migration needed; needs route/persistence architecture work.

### 6. Ghost Verified Completions

Current uniqueness assumptions:

- One verified match session per `match_id`.
- One local verified session per `(user_id, local_match_id)`.
- One `ghost_games` training row per verified `match_id`.

Existing DB constraints/indexes:

- `verified_single_player_matches.match_id` primary key.
- `idx_verified_single_player_matches_user_local` unique `(user_id, local_match_id)`.
- `ghost_games_match_id_unique unique (match_id)`.

Existing application-level idempotency:

- Start uses `verified_single_player_matches?on_conflict=match_id`.
- Completion requires the verified match and checks completion hash.
- `completeGhostGame` upserts `ghost_games` by `match_id` and uses `xmax` to detect whether the game is new.

Duplicate risks:

- If production lacks `ghost_games.match_id`, service falls back to plain insert.
- Ranked game inserts from Ghost/Fritz completion still lack a visible ranked idempotency key.

Recommended hardening:

- Verify `ghost.sql` is applied in production.
- Remove or alert on the plain-insert fallback once migration rollout is confirmed.
- Include verified `match_id` in ranked game idempotency migration.

Migration safety: existing migration safe; production verification required.

### 7. Social Activity Duplicates

Current uniqueness assumptions:

- `activity_feed` is an immutable event log.
- Duplicate feed rows do not drive scoring leaderboards.

Existing DB constraints/indexes:

- `activity_feed.id` primary key.
- Index on `(user_id, created_at desc)`.
- No idempotency key.

Existing application-level idempotency:

- Some callers only write after non-replayed completion.
- Writes are non-critical and fire-and-forget.

Duplicate risks:

- Duplicate completion or retry can write duplicate activity rows.
- Tournament placement activity can duplicate if final completion races.

Recommended constraint:

- Add nullable `idempotency_key text`.
- Add unique `(user_id, type, idempotency_key)` where key is not null.
- Use keys such as `daily-puzzle:{date}`, `daily-fritz:{runDate}:game:{n}`, `tournament:{id}:placement:{placement}`, `match:{roomMatchId}:win|loss`.

Cleanup required first:

- Identify duplicate activity rows with same user/type/metadata date or tournament id.

Migration safety: not safe blindly; requires a metadata/key backfill plan.

## What Was Implemented Now

No production DB migration was added in this pass. That is intentional: the highest-risk missing constraint is `ranked_games`, and the repo does not contain the authoritative table DDL or historical duplicate state needed to migrate safely.

Implemented now:

- Added `server/src/dbIdempotencySchema.test.ts`.
- The test guards checked-in SQL for:
  - Daily Puzzle attempt uniqueness.
  - Daily Puzzle slot-result uniqueness.
  - Daily Fritz attempt uniqueness.
  - Ghost `match_id` uniqueness.
  - Verified single-player primary/local uniqueness.
  - Scheduled tournament bracket-slot uniqueness.

## Deferred Pending Cleanup

Highest priority deferred items:

1. `ranked_games` idempotency column/index.
2. Public `matches` unique expression index on `metadata->>'roomMatchId'`.
3. Activity feed idempotency key.
4. Atomic tournament match completion update/RPC.
5. Graceful unique-conflict replay for Daily Puzzle slot submit and Daily Fritz attempt start.

## Production Duplicate Scan Checklist

Run these before adding new uniqueness constraints:

```sql
-- Daily Puzzle should return zero rows.
select puzzle_date, user_id, count(*)
from public.daily_puzzle_attempts
group by puzzle_date, user_id
having count(*) > 1;

select attempt_id, slot_index, count(*)
from public.daily_puzzle_slot_results
group by attempt_id, slot_index
having count(*) > 1;

-- Daily Fritz should return zero rows.
select run_date, user_id, count(*)
from public.daily_fritz_attempts
group by run_date, user_id
having count(*) > 1;

-- Ghost should return zero rows when match_id is present.
select match_id, count(*)
from public.ghost_games
where match_id is not null
group by match_id
having count(*) > 1;

-- Public matches: candidates for cleanup before unique expression index.
select metadata->>'roomMatchId' as room_match_id, count(*)
from public.matches
where metadata ? 'roomMatchId'
group by metadata->>'roomMatchId'
having count(*) > 1;

-- Ranked games: adapt once final schema is confirmed.
select player_id, opponent_id, game_type, player_score, opponent_score, date_trunc('minute', played_at) as minute_bucket, count(*)
from public.ranked_games
group by player_id, opponent_id, game_type, player_score, opponent_score, date_trunc('minute', played_at)
having count(*) > 1;
```

## Recommended Next Prompt

```text
Proceed with a ranked_games idempotency schema discovery and cleanup plan.

Do not change gameplay or UI. First inspect the live Supabase ranked_games table definition and historical duplicate candidates. Then propose a migration that adds a nullable source_match_id/idempotency key, backfills safe rows from room.matchId / verified match ids where possible, excludes or resolves duplicate historical rows, and adds a unique partial index on (player_id, source_match_id). Implement only after the duplicate scan is clean.
```
