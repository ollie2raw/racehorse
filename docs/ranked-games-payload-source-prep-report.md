# Ranked Games Payload Source Prep Report

Date: 2026-06-02  
Scope: payload-source prep only. No DB columns, migrations, production flag enablement, rating math changes, gameplay changes, or UI changes.

## Summary

`ranked_games` insert paths are now prepared to include future idempotency metadata while remaining compatible with today's live DB by default.

The new payload helper supports:

- `source_type`
- `source_match_id`

Those fields are included only when:

```text
RANKED_GAMES_SOURCE_COLUMNS_ENABLED=true
```

With the flag unset or false, payloads preserve the current `ranked_games` DB shape exactly.

## Implemented

### Helper

Added `server/src/ranking/rankedGamePayload.ts`:

- `buildRankedGameInsertPayload(input)`
- `isRankedGameSourceColumnsEnabled()`
- `RankedGameSourceType`
- `RankedGameSource`
- `RankedGameInsertInput`
- `RankedGameInsertPayload`

### Wired Insert Paths

Live room game-over:

- File: `server/src/index.ts`
- Future source: `source_type = 'live_room'`
- Future source id: `source_match_id = room.matchId`
- Current flag-off behavior: unchanged payload shape.

Verified Fritz/Ghost completion:

- File: `server/src/ghost/service.ts`
- Future source: `source_type = 'verified_single_player'`
- Future source id: `source_match_id = params.matchId`
- Current flag-off behavior: unchanged payload shape, including `rating_after: null`.

Local Fritz abandon:

- File: `server/src/index.ts`
- Future source: `source_type = 'local_fritz_abandon'`
- Future source id resolution:
  - explicit verified match id if supplied
  - verified match id resolved from `(userId, localMatchId)` when available
  - fallback `local:{localMatchId}:abandon`
- Current flag-off behavior: unchanged payload shape and no extra verified-match lookup.

### Call Sites Updated

Updated source context passing for:

- `/api/bot-matches/local/abandon`
- `/bot-matches/cleanup-stale`
- socket disconnect pending Fritz cleanup
- live room game-over ranked insert
- verified Fritz/Ghost completion ranked insert

## Tests Added

Added `server/src/ranking/rankedGamePayload.test.ts`:

- Flag off returns the current DB payload shape exactly.
- Flag on includes `source_type` and `source_match_id`.
- `rating_after: null` is preserved.
- Score/rating fields are unchanged when source metadata is enabled.

## Deferred

Still not done, intentionally:

- No `ranked_games` DB columns added.
- No unique partial index added.
- No source-field production flag enabled.
- No historical duplicate cleanup or backfill.
- No rating math changes.

## Migration Readiness

After the DB migration adds nullable `source_type` and `source_match_id`, staging can enable:

```text
RANKED_GAMES_SOURCE_COLUMNS_ENABLED=true
```

Then verify new rows include source metadata before adding the unique partial index:

```sql
create unique index concurrently if not exists ranked_games_player_source_match_uidx
  on public.ranked_games (player_id, source_match_id)
  where source_match_id is not null;
```

Do not add that index until duplicate scans and backfill review are complete.
