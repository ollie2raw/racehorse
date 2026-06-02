# Ranked Games Idempotency Discovery

Date: 2026-06-02  
Scope: discovery only. No migration, gameplay change, rating math change, UI change, or historical-row modification.

## Executive Verdict

The live Supabase `ranked_games` table is reachable through PostgREST and currently exposes only the core rating-game columns. It does **not** expose any existing source/idempotency column such as `source_match_id`, `match_id`, `room_match_id`, `local_match_id`, `verified_match_id`, `source_type`, `metadata`, or `created_at`.

The table is therefore not ready for a safe uniqueness migration without first adding a nullable source-id column and backfilling it. A direct unique index cannot be added on an existing source column because no such column exists.

Live duplicate scan result:

- Total fetched rows: `260`
- Pending/unprocessed rows where `rating_after is null`: `0`
- Game type counts: `fritz = 189`, `fritz_elite = 45`, `multiplayer = 26`
- Same player/opponent/game_type/score/minute duplicate candidates: `1` group of `2`
- Same player/opponent/game_type/score/second duplicate candidates: `0`
- Unprocessed duplicate candidate groups: `0`

This suggests no current urgent unprocessed duplicate backlog, but there is at least one historical same-minute duplicate candidate that must be reviewed before any cleanup/backfill migration.

## Live Schema Discovery

Discovery method:

- Used Supabase PostgREST OpenAPI metadata and read-only `ranked_games` REST queries.
- No data was modified.
- Local `psql` was not available in the workspace.
- Full index/constraint/trigger/RLS introspection is not exposed by PostgREST, so the SQL inspection queries below still need to be run in Supabase SQL editor or via a database connection.

### Exposed Columns

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | `uuid` | Yes | Primary key, default `gen_random_uuid()`. |
| `player_id` | `uuid` | Yes | Rated player row owner. |
| `opponent_id` | `uuid` | Yes | Opponent player or Fritz system UUID. |
| `player_score` | `integer` | Yes | Score from player perspective. |
| `opponent_score` | `integer` | Yes | Score from opponent perspective. |
| `game_type` | `text` | Yes | Live values include `fritz`, `fritz_elite`, `multiplayer`. |
| `played_at` | `timestamptz` | Yes | Default `now()`. |
| `rating_before` | `double precision` | Yes | Player rating before processing. |
| `rd_before` | `double precision` | Yes | Player RD before processing. |
| `rating_after` | `double precision` | No | Null means pending rating processing. |
| `rd_after` | `double precision` | No | Filled after processing. |
| `delta` | `double precision` | No | Filled after processing. |

### Missing Idempotency Columns

These candidate columns are not present/exposed:

- `source_match_id`
- `external_match_id`
- `match_id`
- `room_match_id`
- `local_match_id`
- `verified_match_id`
- `source_type`
- `created_at`
- `metadata`

### Known Constraint From OpenAPI

PostgREST OpenAPI reports:

- `id` is primary key.

### Still Needs SQL Introspection

Run this in Supabase SQL editor for exact indexes, constraints, triggers, and RLS:

```sql
select
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'ranked_games'
order by c.ordinal_position;

select
  i.indexname,
  i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename = 'ranked_games'
order by i.indexname;

select
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ranked_games'
order by con.conname;

select
  tg.tgname,
  pg_get_triggerdef(tg.oid) as definition
from pg_trigger tg
join pg_class rel on rel.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ranked_games'
  and not tg.tgisinternal
order by tg.tgname;

select
  pol.polname,
  pol.polcmd,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
from pg_policy pol
join pg_class rel on rel.oid = pol.polrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ranked_games'
order by pol.polname;

select
  relrowsecurity,
  relforcerowsecurity
from pg_class rel
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ranked_games';
```

## Server Write Paths

### 1. Local Fritz Disconnect Loss

File: `server/src/index.ts`  
Function: `recordPendingFritzDisconnectLoss`

Write shape:

- Inserts one `ranked_games` row for the user.
- `player_score = 0`, `opponent_score = 60`.
- `game_type` comes from Fritz tier identity helper.
- Calls `processRatingPeriod(userId)` immediately after insert.

Stable source id availability:

- `localMatchId` is available in `/api/bot-matches/local/abandon`.
- Pending row has `room_code = local:{localMatchId}`.
- The current `recordPendingFritzDisconnectLoss` function receives only `userId` and `fritzTier`, so it loses `localMatchId`/room context before inserting.

Future source key:

- `source_type = 'local_fritz_abandon'`
- `source_match_id = verified_single_player_matches.match_id` if found from `(user_id, local_match_id)`, otherwise `local:{localMatchId}:abandon`

Risk:

- Duplicate abandon/retry can insert duplicate disconnect-loss rows if the pending row is not atomically consumed first.

### 2. Live Multiplayer / Private / Quick Match Game Over

File: `server/src/index.ts`  
Location: game-over branch around ranked participant loop.

Write shape:

- Inserts one `ranked_games` row per rated participant.
- For human vs human, writes two rows with `game_type = 'multiplayer'`.
- For human vs Fritz room, writes one human row with `game_type = 'fritz'`.
- Calls `processRealtimeMultiplayerGame` for human-vs-human when both inserted rows exist.

Stable source id availability:

- `room.matchId` is available in the same game-over block.
- `room.code` is also available but not globally stable across rematches as strongly as `room.matchId`.
- Tournament metadata can exist on the room config, but scheduled tournaments are intended to route through tournament result handling rather than rated multiplayer.

Future source key:

- `source_type = 'live_room'`
- `source_match_id = room.matchId`

Risk:

- Repeated game-over finalization can insert duplicate rows for the same participant and same room match.
- Duplicate pending rows with `rating_after is null` would be processed as separate games.

### 3. Verified Fritz / Ghost Completion

File: `server/src/ghost/service.ts`  
Function: `completeGhostGame`

Write shape:

- Inserts one `ranked_games` row only when the completed single-player match is rating-eligible.
- Uses `game_type = 'fritz'`.
- Calls `processRatingPeriod(userId)` after insert.

Stable source id availability:

- `params.matchId` is passed into `completeGhostGame`.
- `/api/ghost/complete` requires a verified match and passes `matchId`.
- `verified_single_player_matches.match_id` is the strongest future source id.

Future source key:

- `source_type = 'verified_single_player'`
- `source_match_id = params.matchId`

Risk:

- The verified completion flow is idempotent at the verified-match level, but the ranked insert itself has no DB uniqueness key.
- If a completion race reaches `completeGhostGame` twice before verified-match status is persisted, duplicate ranked rows are possible.

### 4. Rating Processing

File: `server/src/ranking/periodService.ts`

Write behavior:

- Does not create `ranked_games` rows.
- Reads pending rows where `rating_after is null`.
- Patches each processed `ranked_games` row by `id` with `rating_after`, `rd_after`, and `delta`.
- Updates `profiles.ranked_games_played`.
- Inserts `rating_periods` rows.

Stable source id availability:

- None beyond `ranked_games.id`.

Risk:

- If duplicate pending rows exist, rating processing treats each as an independent game.

### 5. Tournaments

Scheduled tournament game-over code routes results into `scheduled_tournament_matches`, not `ranked_games`, in the current audited paths. No direct scheduled tournament `ranked_games` insert was found.

Future stance:

- If tournaments ever become rated, use `source_type = 'scheduled_tournament'` and `source_match_id = scheduled_tournament_matches.id`.

## Duplicate Scan Queries

The local read-only scan already ran an equivalent client-side aggregation and found one same-minute historical candidate and zero unprocessed candidates. Run these SQL queries in Supabase before any migration:

```sql
-- Same player/opponent/type/score in the same minute.
select
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('minute', played_at) as minute_bucket,
  count(*) as row_count,
  count(*) filter (where rating_after is null) as pending_count,
  array_agg(id order by played_at, id) as ranked_game_ids
from public.ranked_games
group by
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('minute', played_at)
having count(*) > 1
order by row_count desc, minute_bucket desc;

-- Stricter same-second duplicate candidates.
select
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('second', played_at) as second_bucket,
  count(*) as row_count,
  count(*) filter (where rating_after is null) as pending_count,
  array_agg(id order by played_at, id) as ranked_game_ids
from public.ranked_games
group by
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('second', played_at)
having count(*) > 1
order by row_count desc, second_bucket desc;

-- Unprocessed duplicate candidates.
select
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('minute', played_at) as minute_bucket,
  count(*) as pending_count,
  array_agg(id order by played_at, id) as ranked_game_ids
from public.ranked_games
where rating_after is null
group by
  player_id,
  opponent_id,
  game_type,
  player_score,
  opponent_score,
  date_trunc('minute', played_at)
having count(*) > 1
order by pending_count desc, minute_bucket desc;
```

If a source id column is added later, run:

```sql
select
  player_id,
  source_match_id,
  count(*) as row_count,
  array_agg(id order by played_at, id) as ranked_game_ids
from public.ranked_games
where source_match_id is not null
group by player_id, source_match_id
having count(*) > 1
order by row_count desc;
```

## Safest Future Migration Design

### Columns

Add nullable columns first:

```sql
alter table public.ranked_games
  add column if not exists source_type text null,
  add column if not exists source_match_id text null;
```

Recommended `source_type` values:

- `live_room`
- `verified_single_player`
- `local_fritz_abandon`
- `scheduled_tournament` if tournaments ever become rated
- `legacy_unknown` only for manually reviewed backfills

### Unique Partial Index

After cleanup/backfill proves safe:

```sql
create unique index concurrently if not exists ranked_games_player_source_match_uidx
  on public.ranked_games (player_id, source_match_id)
  where source_match_id is not null;
```

Use `(player_id, source_match_id)` rather than only `source_match_id` because a legitimate human-vs-human match should create one row per player for the same match id.

### Backfill Strategy

Recommended staged approach:

1. Do not backfill all historical rows automatically.
2. Backfill only rows that can be tied to a verified source with high confidence.
3. For future live room writes, set `source_type = 'live_room'` and `source_match_id = room.matchId`.
4. For future verified Fritz/Ghost writes, set `source_type = 'verified_single_player'` and `source_match_id = matchId`.
5. For future local abandon loss writes, pass `localMatchId` into the insert helper and resolve the verified match id where possible.
6. Leave ambiguous historical rows with null `source_match_id`; the partial unique index will not affect them.

### Cleanup Strategy

Before creating the unique index:

1. Run the duplicate scan queries above.
2. Inspect the one current same-minute candidate manually.
3. Confirm no unprocessed duplicates exist immediately before migration.
4. For any duplicate source-id group after backfill, decide one of:
   - keep earliest and mark/delete later rows before index creation,
   - keep both with null `source_match_id` if they cannot be proven duplicate,
   - create a separate `voided_ranked_games`/audit process if rating history has already consumed them.

### Rollback Plan

If migration causes issues:

```sql
drop index concurrently if exists ranked_games_player_source_match_uidx;

alter table public.ranked_games
  drop column if exists source_match_id,
  drop column if exists source_type;
```

If app code has already started writing source IDs, prefer dropping only the unique index first and keeping the columns for investigation.

## Migration Gate

Do not implement the migration until all are true:

- Full SQL introspection confirms no existing hidden source-id/index strategy.
- Duplicate scan is clean or reviewed.
- App write paths are patched to populate `source_type` and `source_match_id`.
- Insert paths use `on_conflict` or unique-conflict replay once the unique partial index exists.
- Rating tests cover duplicate source id behavior without changing rating math.

## Recommended Next Prompt

```text
Proceed with ranked_games idempotency implementation planning.

Do not run a migration yet. Design the exact app changes needed to populate source_type/source_match_id in all ranked_games write paths, including live room game-over, verified Fritz/Ghost completion, and local Fritz abandon. Add tests around payload construction only. Then prepare a separate cleanup-first SQL migration draft gated on the duplicate scan.
```
