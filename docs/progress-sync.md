# Journey progress that follows the account

Journey progress used to live only in the browser (`localStorage`, `rh_journey_progress_v1`), so a second device, a cleared cache or a new phone started the trail from nothing. A signed-in player's progress now also lives on the server and follows them. Off until the owner turns it on.

## What is synced, and what is not

Synced, because each of it only ever grows: the **completed stages** of each chapter, the **earliest time the chapter was completed**, and whether the **finish was celebrated**. Plus Chapter One's **layout number**, which decides whose stage ids count (below).

Not synced, because they are per-device conveniences: the last-visited stage and the active chapter. The attempt log (`rh_journey_attempts_v1`) and the pending-completion obligations stay local too: they are this device's history and its unfinished business.

**Learn has nothing to sync.** The old Learn lesson progress store was removed with the Learn v1 player (roadmap, 2026-11-01), and what remains in `client/src/learning/` is a coaching profile (concept scores, streaks), not a set of completed lessons. That folder is protected, so it was left alone. The server side is built per scope (`player_progress.scope`), so when Learn gets a completed-lessons store it is a second scope, not a second table.

## The merge rule (why two devices cannot lose anything)

Every write is a **union**. The server never replaces what it holds with what a device sent; it merges them, and so does the client. For one chapter:

- equal layouts: union the completed stages, keep the earliest completion time, OR the celebrated flag;
- different layouts: the higher layout replaces the lower one wholesale. Chapter One's stage ids were reused when its layout changed (`JOURNEY_CHAPTER_ONE_LAYOUT_VERSION`, `journeyStorage.ts`), so a copy recorded against an older layout names different stages and must not be mixed in.

The rule is commutative, associative and idempotent, so devices converge whatever order they sync in, and a stale device (or a replayed request) can never take a stage away.

It exists twice because the server cannot import client code: `mergeJourneyProgress` in `server/src/playerProgress.ts` and `mergeSynced` in `client/src/journey/journeyProgressSync.ts`. Both test files run the **same five vectors**, so they cannot drift apart unnoticed. If you change one, change both and the vectors.

On the client, a stored copy is also skipped when it was recorded against a **newer** layout than the running build understands (an older app on one device, a newer one on another), and a stage id the build does not define is dropped, exactly as a load already does.

## Guests, accounts, and what stays as it was

- **Guests keep localStorage only.** Signed-out visitors and anonymous (guest) users never call the server. Nothing about their behaviour changed.
- Signing in does **not** import guest progress. That was already the rule (`journeyStorage.ts`: "isolation, not merging") and is unchanged: a signed-in account's namespace starts from its own local data and the server's copy.
- There is no player-facing way to reset Journey progress (`resetJourneyProgress` is only reachable from the hook, and nothing calls it). Under sync a reset would be undone by the next pull, since progress never shrinks; if a reset is ever added it needs to be a server-side delete.

## When it runs (client)

`useJourneyProgressSync` is mounted once in `App.tsx`, next to `useJourneyStorageScope`, which points the local store at the signed-in user's namespace during render. The hook is tiny on purpose: the sync itself (`journeyProgressSyncRuntime.ts`, which needs the chapter definitions) is loaded on demand, only for a signed-in non-guest player, so it adds nothing to the main bundle (the bundle baseline grew 6.6 kB total, almost all of it that lazy chunk). Progress made before it arrives is not lost: its first step is a pull that merges and sends back what the server lacks.

- **On sign-in:** GET what the server holds, merge it into this browser, and send back anything this browser has that the server lacks.
- **After a local save:** a debounced (2 s) POST of the synced view. The answer is merged back in, in case another device added stages meanwhile. Applying what the server sent does not trigger another push.
- **When the tab is hidden:** push now. **When it returns after a minute or more:** pull again, so a second device's progress appears without a reload. Screens showing progress refresh through `onJourneyProgressApplied`.
- **Offline:** a failed request changes nothing locally and is retried (5 s, doubling to 5 min, and immediately when the network returns). The player never sees it.
- **Account switch:** the controller checks that the local store still points at the account it was made for before it reads or writes anything, so a late answer for the previous account is dropped, not applied to the next.

## The server

- `GET /api/progress/journey` returns `{ enabled, progress | null }`. `POST /api/progress/journey` with `{ progress }` unions it into what is stored and returns the union. Route file: `server/src/http/routes/progressSyncRoute.ts`; logic and table access: `server/src/playerProgress.ts`. Owner only (the verified user id is the only key), `Cache-Control: private, no-store`, rate limited.
- **Off unless `PROGRESS_SYNC_ENABLED` is exactly `true`.** Off, or with the table missing, both routes answer `200 { enabled: false }` and the client goes quiet for the session. So the code is safe to ship before the SQL is applied, and an older server (no route, 404) is treated the same way.
- Concurrent writers are handled with optimistic concurrency on a `revision` column: the loser of the update re-reads and merges again, so nothing either device sent is lost. After four lost races it fails with a 500 and the client retries later.
- The server stores any well-formed id (it does not know the chapter definitions); the client drops ids it does not recognise on the way back in. A player can only write their own progress and Journey has no leaderboard or reward, so there is nothing to gain by forging it. Limits: 12 chapters, 200 stages each, ids `[A-Za-z0-9_.:-]{1,80}`, 20 kB of JSON per row.

## What the owner has to do

1. Apply `supabase/migrations/2026-11-02_player_progress.sql` in the Supabase SQL editor. Additive and idempotent (safe to run twice); nothing is backfilled. It creates `public.player_progress` with RLS on and every client operation denied (only the server's service role reads and writes it), and rows cascade with the account.
2. Set `PROGRESS_SYNC_ENABLED=true` on Render (after step 1).
3. Check it from two browsers signed in as the same account: complete a stage in one, reload the other (or return to its tab after a minute).

Rollback: unset the flag. The table can be dropped (`drop table if exists public.player_progress;`, nothing depends on it).

## Verified

The migration was run on a scratch Postgres 16: applies twice cleanly, the constraints refuse a bad scope / an oversize document / a zero revision / a duplicate / an orphan, a client role reads and writes nothing under RLS, of two writers holding the same revision exactly one wins, and the row goes when the account does.
