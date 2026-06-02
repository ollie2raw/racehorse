# Ranked Games Idempotency Implementation Plan

Date: 2026-06-02  
Input: `docs/ranked-games-idempotency-discovery.md`  
Scope: implementation planning only. No DB columns, migration, gameplay change, rating math change, UI change, or historical-row modification.

## Goal

Prepare all future `ranked_games` insert paths to carry stable idempotency metadata once the DB migration adds:

- `source_type text null`
- `source_match_id text null`

The app changes should be designed so rating math remains unchanged. The only future behavior change should be that every new ranked row can identify the source match that produced it.

## Key Constraint

The live table does not currently expose `source_type` or `source_match_id`. App code must not start sending these fields until the migration is applied, or PostgREST will reject inserts with schema-cache/unknown-column errors.

Recommended sequencing:

1. Implement a typed payload builder and tests that can include source metadata.
2. Keep actual insert payloads unchanged until DB migration lands, or gate source fields behind a feature flag such as `RANKED_GAMES_SOURCE_COLUMNS_ENABLED=true`.
3. After migration, enable the flag and verify inserts include source metadata.
4. After cleanup/backfill, add the unique partial index.

## Proposed Source Model

Add a small internal type near ranked insert helpers:

```ts
type RankedGameSourceType =
  | 'live_room'
  | 'verified_single_player'
  | 'local_fritz_abandon'
  | 'scheduled_tournament';

interface RankedGameSource {
  sourceType: RankedGameSourceType;
  sourceMatchId: string;
}
```

Expected DB payload fields after migration:

```ts
{
  source_type: source.sourceType,
  source_match_id: source.sourceMatchId,
}
```

Naming recommendation:

- Use snake_case DB fields: `source_type`, `source_match_id`.
- Use camelCase TypeScript fields: `sourceType`, `sourceMatchId`.

## Exact Write Paths To Change

### 1. Live Room Game Over

File: `server/src/index.ts`  
Location: game-over ranking participant loop around the `supabaseFetch('/rest/v1/ranked_games')` insert.

Current insert payload:

```ts
{
  player_id: p.me.userId,
  opponent_id: opponentId,
  player_score: p.myScore,
  opponent_score: p.oppScore,
  game_type: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
  rating_before: profile.glicko_rating,
  rd_before: profile.glicko_rd,
  played_at: new Date().toISOString(),
}
```

Stable source id:

- `room.matchId`

Future payload after migration:

```ts
{
  player_id: p.me.userId,
  opponent_id: opponentId,
  player_score: p.myScore,
  opponent_score: p.oppScore,
  game_type: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
  rating_before: profile.glicko_rating,
  rd_before: profile.glicko_rd,
  played_at: now,
  source_type: 'live_room',
  source_match_id: room.matchId,
}
```

Notes:

- Use one shared `now` for both participant rows from the same game-over branch for cleaner auditability.
- For human-vs-human, both rows should share the same `source_match_id`; uniqueness must be `(player_id, source_match_id)`, not just `source_match_id`.
- Scheduled tournament rooms should not use this path for rated rows unless product intentionally makes tournaments rated later.

Tests needed:

- Unit-test a payload builder with two live-room participant payloads sharing `source_match_id` and having distinct `player_id`.
- Assert `source_type = 'live_room'`.
- Assert rating fields and scores are unchanged.

### 2. Verified Fritz/Ghost Completion

File: `server/src/ghost/service.ts`  
Function: `completeGhostGame`

Current insert payload:

```ts
{
  player_id: params.userId,
  opponent_id: fritzId,
  player_score: Math.round(params.finalScore),
  opponent_score: Math.round(params.opponentScore),
  game_type: 'fritz',
  played_at: now,
  rating_before: rankingProfile.glicko_rating,
  rd_before: rankingProfile.glicko_rd,
  rating_after: null,
}
```

Stable source id:

- `params.matchId`
- This is the verified single-player `match_id` from `verified_single_player_matches`.

Future payload after migration:

```ts
{
  player_id: params.userId,
  opponent_id: fritzId,
  player_score: Math.round(params.finalScore),
  opponent_score: Math.round(params.opponentScore),
  game_type: 'fritz',
  played_at: now,
  rating_before: rankingProfile.glicko_rating,
  rd_before: rankingProfile.glicko_rd,
  rating_after: null,
  source_type: 'verified_single_player',
  source_match_id: params.matchId,
}
```

Important edge:

- `params.matchId` is currently optional in the service type.
- For ranked-game idempotency, the ranked insert path should require a source id when `isFritz` and `isRatingEligible`.
- If `params.matchId` is missing after migration, either:
  - skip adding source fields and log a warning during transition, or
  - fail fast only after all callers are proven to pass verified match ids.

Recommended staged behavior:

- Stage 1: payload builder accepts optional source and can omit fields behind feature flag.
- Stage 2 after migration: require `params.matchId` for rated Fritz completion and return a clear error if missing.

Tests needed:

- Unit-test verified single-player payload includes `source_type = 'verified_single_player'`.
- Assert `source_match_id = matchId`.
- Assert non-rating-eligible completion does not insert ranked row, unchanged from current behavior.

### 3. Local Fritz Abandon

File: `server/src/index.ts`  
Function: `recordPendingFritzDisconnectLoss`

Current problem:

- The helper receives only `userId` and `fritzTier`.
- The callers know more context:
  - REST `/api/bot-matches/local/abandon` has `localMatchId`.
  - Stale cleanup has `row.room_code`, usually `local:{localMatchId}`.
  - Socket disconnect cleanup has `roomCode`, usually `local:{localMatchId}` for local Fritz.
- The source context is lost before the `ranked_games` insert.

Call sites to update:

- `server/src/index.ts` `/bot-matches/cleanup-stale`
- `server/src/index.ts` `/api/bot-matches/local/abandon`
- `server/src/index.ts` socket disconnect cleanup path

Recommended function signature:

```ts
async function recordPendingFritzDisconnectLoss(
  userId: string,
  fritzTier: unknown = 'elite',
  source?: {
    localMatchId?: string | null;
    roomCode?: string | null;
    verifiedMatchId?: string | null;
  },
)
```

Source id resolution:

1. If `source.verifiedMatchId` exists, use it.
2. Else if `source.localMatchId` exists, query `verified_single_player_matches` by `(user_id, local_match_id)` and use its `match_id` if found.
3. Else if `source.roomCode` starts with `local:`, parse `localMatchId` from it, then query verified match.
4. Else fallback to deterministic synthetic id:

```ts
`local:${localMatchId}:abandon`
```

Future payload after migration:

```ts
{
  player_id: userId,
  opponent_id: fritzId,
  player_score: 0,
  opponent_score: 60,
  game_type: gameType,
  rating_before: profile.glicko_rating,
  rd_before: profile.glicko_rd,
  played_at: now,
  source_type: 'local_fritz_abandon',
  source_match_id: resolvedVerifiedMatchId ?? `local:${localMatchId}:abandon`,
}
```

Open design choice:

- If the abandon is tied to a verified Fritz match, `source_type` could be `verified_single_player`.
- Recommendation: keep `source_type = 'local_fritz_abandon'` so a disconnect/forfeit loss can be distinguished from a normal completed Fritz match, while still using the verified match id as `source_match_id`.

Tests needed:

- `recordPendingFritzDisconnectLoss` payload builder uses verified `match_id` when provided.
- It resolves `localMatchId` from `roomCode = local:{localMatchId}`.
- It falls back to `local:{localMatchId}:abandon` if verified lookup is unavailable.
- Existing rating fields and 0-60 loss shape remain unchanged.

### 4. Other Ranked Reads/Writes

File: `server/src/ranking/periodService.ts`

Current behavior:

- Reads pending rows with `rating_after is null`.
- Patches processed rows by `id`.
- Does not insert ranked rows.

Implementation impact:

- Extend `RankedGame` interface with optional fields only:

```ts
source_type?: string | null;
source_match_id?: string | null;
```

- No rating math changes.
- No processing-order changes.

Tests needed:

- Existing `processRatingPeriod` tests should still pass with optional source fields present in mocked rows.

### 5. Tournament Matches

Current state:

- Scheduled tournament results persist to `scheduled_tournament_matches`.
- No direct `ranked_games` insert was found for scheduled tournament results.

Implementation impact:

- No change now.
- If tournaments become rated later:

```ts
source_type: 'scheduled_tournament',
source_match_id: scheduledTournamentMatchId,
```

Tests needed now:

- None, unless product intentionally makes tournaments rated.

## Shared Payload Builder Recommendation

To avoid three ad hoc insert shapes, add a small helper in a new focused file:

`server/src/ranking/rankedGamePayload.ts`

Suggested exports:

```ts
export type RankedGameSourceType =
  | 'live_room'
  | 'verified_single_player'
  | 'local_fritz_abandon'
  | 'scheduled_tournament';

export interface RankedGameInsertInput {
  playerId: string;
  opponentId: string;
  playerScore: number;
  opponentScore: number;
  gameType: string;
  ratingBefore: number;
  rdBefore: number;
  playedAt: string;
  ratingAfter?: number | null;
  source?: {
    sourceType: RankedGameSourceType;
    sourceMatchId: string;
  } | null;
}

export function buildRankedGameInsertPayload(input: RankedGameInsertInput): Record<string, unknown> {
  const payload = {
    player_id: input.playerId,
    opponent_id: input.opponentId,
    player_score: input.playerScore,
    opponent_score: input.opponentScore,
    game_type: input.gameType,
    played_at: input.playedAt,
    rating_before: input.ratingBefore,
    rd_before: input.rdBefore,
    ...(input.ratingAfter !== undefined ? { rating_after: input.ratingAfter } : {}),
  };

  if (!isRankedGameSourceColumnsEnabled()) return payload;
  if (!input.source?.sourceMatchId) return payload;
  return {
    ...payload,
    source_type: input.source.sourceType,
    source_match_id: input.source.sourceMatchId,
  };
}
```

Feature flag:

```ts
function isRankedGameSourceColumnsEnabled(): boolean {
  return process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED === 'true';
}
```

Why use a flag:

- The live DB does not have the columns yet.
- Tests can prove source metadata construction before migration.
- Production can deploy app code before DB migration safely with the flag off.
- After DB migration, enable the flag and verify payloads.

## Tests To Add In Implementation Pass

Targeted tests only; no full route integration required.

### `server/src/ranking/rankedGamePayload.test.ts`

Test cases:

- Builds current-compatible payload when feature flag is off.
- Includes `source_type` and `source_match_id` when feature flag is on.
- Preserves `rating_after: null` when passed for verified Fritz/Ghost completion.
- Does not mutate score/rating fields.

### Live Room Payload Test

Option A: helper-only test with representative input.

Expected:

```ts
source_type: 'live_room'
source_match_id: 'room-match-id'
```

### Verified Single-Player Payload Test

Expected:

```ts
source_type: 'verified_single_player'
source_match_id: verifiedMatchId
rating_after: null
```

### Local Fritz Abandon Source Resolution Test

If source resolution helper is extracted:

`server/src/ranking/rankedGameSource.test.ts`

Test cases:

- Provided `verifiedMatchId` wins.
- `localMatchId` produces verified-match lookup key.
- `roomCode = local:abc` extracts `abc`.
- Fallback is `local:abc:abandon`.

### Regression Tests

Existing tests to keep green:

- `server/src/ranking/fritzRating.test.ts`
- tournament/game-over tests that exercise live ranked insertion mocks, if any
- ghost completion tests, if route-level mocks exist later

## Expected Migration-Ready Payloads

### Live Human Row

```json
{
  "player_id": "player-a",
  "opponent_id": "player-b",
  "player_score": 61,
  "opponent_score": 42,
  "game_type": "multiplayer",
  "rating_before": 812.4,
  "rd_before": 180.1,
  "played_at": "2026-06-02T00:00:00.000Z",
  "source_type": "live_room",
  "source_match_id": "room-match-uuid"
}
```

### Verified Fritz Row

```json
{
  "player_id": "player-a",
  "opponent_id": "fritz-tier-uuid",
  "player_score": 61,
  "opponent_score": 42,
  "game_type": "fritz",
  "rating_before": 812.4,
  "rd_before": 180.1,
  "rating_after": null,
  "played_at": "2026-06-02T00:00:00.000Z",
  "source_type": "verified_single_player",
  "source_match_id": "verified-match-uuid"
}
```

### Local Fritz Abandon Row

```json
{
  "player_id": "player-a",
  "opponent_id": "fritz-tier-uuid",
  "player_score": 0,
  "opponent_score": 60,
  "game_type": "fritz",
  "rating_before": 812.4,
  "rd_before": 180.1,
  "played_at": "2026-06-02T00:00:00.000Z",
  "source_type": "local_fritz_abandon",
  "source_match_id": "verified-match-uuid-or-local:localMatchId:abandon"
}
```

## Future Implementation Order

1. Add `rankedGamePayload.ts` with feature-flagged source fields.
2. Add payload-builder tests.
3. Update `completeGhostGame` ranked insert to use the builder with `verified_single_player` source.
4. Update live room ranked inserts to use the builder with `live_room` source.
5. Update `recordPendingFritzDisconnectLoss` signature and call sites to pass/resolve local source metadata.
6. Keep `RANKED_GAMES_SOURCE_COLUMNS_ENABLED=false` until DB migration is complete.
7. After DB migration adds nullable columns, enable flag in staging and confirm new rows include source fields.
8. Run duplicate scan and cleanup/backfill.
9. Add unique partial index on `(player_id, source_match_id) where source_match_id is not null`.

## Non-Goals

- Do not change Glicko/Ghost rating calculations.
- Do not change when rating processing runs.
- Do not dedupe historical rows in app code.
- Do not add source fields to DB before migration.
- Do not make tournaments rated in this pass.

## Recommended Next Prompt

```text
Proceed with a ranked_games payload-source prep implementation.

Do not add DB columns or migrations. Add a feature-flagged rankedGamePayload helper and tests. Wire existing ranked_games insert paths through it while keeping source fields disabled unless RANKED_GAMES_SOURCE_COLUMNS_ENABLED=true. Do not change rating math or gameplay.
```
