# Tournament v2 preflight: production drift audit and fixes

Phase 0, items 1 and 2. **Nothing here has been run against production.** The
only production access used to write this was read-only (PostgREST schema
listing and `GET` row counts with the service key, 2026-10-04 ~21:00 UTC).

The SQL pieces are in `docs/ops/tournament-v2-preflight/`. Each file is one
paste into the Supabase SQL editor and does one thing. They were tested on a
local Postgres 16 built to match production's state (every tournament
migration **except** 08-31, with the 09-29 v2 bracket function), including a
second run of every piece, and a bye routed through the 09-29 bracket function
into the newly added `complete_tournament_match`.

---

## 1. Drift audit

### 1.1 What I could check without the catalog output (done)

Method: PostgREST's OpenAPI document (every table, column and callable function
the service role sees) compared with what all 68 files in
`supabase/migrations/` declare, plus targeted read-only queries.

**Tournament objects**

| Object | Migrations say | Production | Verdict |
|---|---|---|---|
| `scheduled_tournaments` columns (11, incl. `cancel_reason`) | present | all present; `winner_id` is `text` | OK |
| `scheduled_tournament_matches` columns (22, incl. dispatch fields, `bot_tier`; ids `text`) | present | all present | OK |
| `scheduled_tournament_registrations` columns (7) | present | all present | OK |
| `register_for_tournament`, `withdraw_from_tournament` (09-29) | present | present | OK |
| `generate_tournament_bracket(uuid, jsonb, jsonb, text)` | v2 from 09-29 | present; **v1 and v2 share the signature**, so the API can't tell them apart | check D3 |
| `complete_tournament_match` (08-31) | present | **missing** | **apply piece B** |
| `promote_tournament_match` (08-31) | present | **missing** | **apply piece C** |
| `_tournament_is_bot`, `_tournament_advance_target`, `_tournament_canonical_scores` (08-31) | present | not in the API (expected either way: EXECUTE is revoked) | apply piece A, then D1 |
| `seed_future_tournaments` | 05-17 version: registration closes **T−2 min** | **every one of the 1,403 future rows closes at T−5 min, opens at T−30** | **drift**: prod runs the 05-14/05-16 body. Irrelevant to v2 (Phase 1 drops the function) but it is one more "merged, never applied" instance |
| `ensure_tournament_seed_window` | present | present | OK (dropped in Phase 1) |

**Non-tournament drift found on the way (not fixed here; out of tournament scope):**

| Table | Declared in | Production | Referenced by |
|---|---|---|---|
| `matchmaking_matches` | `2026-05-13_matchmaking.sql` | **missing** (PGRST205) | `server/src/matchmaking/persistence.ts`, `roomShellHydration.ts`, `rooms.ts` |
| `player_presence` | `2026-05-18_social_greenfield_baseline.sql` | **missing** | `server/src/social/presenceRegistry.ts`, `social/routes.ts` |
| `rivals` | same | **missing** | social routes / client identity model |

Every other table and column declared in a migration exists, and no dropped
table lingers. Functions missing from the API listing apart from the
tournament ones are all trigger functions (PostgREST never lists those):
`handle_new_user`, `project_*_outbox_event`, `protect_*`, `prevent_*`,
`fritz_challenge_*_is_immutable`. Their presence is a catalog check (§1.2).

Recommendation: open a separate ticket for the three missing tables. Matchmaking
writes into a table that doesn't exist, and that silently degrades; it is not
on the tournament path.

### 1.2 What still needs your catalog output

PostgREST can't see constraints, indexes, policies, grants, triggers or cron.
When you send the catalog query output I'll diff it against this list and
finish the audit:

- **Check constraints:** `scheduled_tournaments.status`
  (`upcoming, registration_open, in_progress, completed, cancelled`);
  matches `status` (`waiting, ready, in_progress, completed, bye`), `round
  between 1 and 3`, `winner_source in (game_over, no_show, forfeit)`,
  `bot_tier in (standard, elite, master)`; registrations `status`
  (`registered, withdrawn, eliminated, active, winner`).
- **Uniques:** `scheduled_tournaments(scheduled_start)`,
  `registrations(tournament_id, user_id)`, `matches(tournament_id, round, match_number)`.
- **Foreign keys:** registrations → tournaments (cascade) and → `auth.users`
  (cascade); matches → tournaments (cascade); **no** FK on any match player id
  or `scheduled_tournaments.winner_id` (dropped by `zz_bot_fill`).
- **Indexes:** `idx_st_status_start`, `idx_st_start`, `idx_str_user`,
  `idx_str_tournament`, `idx_str_user_completed`, `idx_stm_tournament_round`,
  `idx_stm_players`, `idx_stm_ready`, `idx_stm_ready_deadline`.
- **RLS:** enabled on all three tables; policies only `st_select_all`,
  `str_select_all`, `stm_select_all`; no client INSERT/UPDATE/DELETE grants on
  registrations (08-30 lockdown, verified 2026-08-31).
- **Functions:** `prosecdef` and `proconfig` for the RPCs, and `prosrc` of
  `generate_tournament_bracket` (must be v2) and `seed_future_tournaments`
  (expected drift: T−5).
- **Triggers** for the trigger functions listed in §1.1.
- **pg_cron:** piece F1.

---

## 2. Apply the 08-31 functions (pieces A–D)

`generate_tournament_bracket` is **not** in any piece: applying 08-31 as
written would replace the 09-29 v2 with v1 (same signature). The pieces are
the file's own text, cut by line range, plus their own grants.

These functions are still needed before v2 exists: production's
`generate_tournament_bracket` v2 already calls `complete_tournament_match` for
byes, so as of today any bracket with a bye would fail. Phase 1 replaces
`complete_tournament_match` with a v2 (`create or replace`, a new migration),
so applying these now makes production match the migrations Phase 1 builds
on.

Tournaments are off, so nothing calls these functions until you turn them on.

| Step | File | Writes? | Then run | Expect |
|---|---|---|---|---|
| 0 | `D-verify.sql` | no | — | D3 `ok_is_v2 = t`. D4 errors with `function public.complete_tournament_match(...) does not exist` (that's the drift) |
| 1 | `A-helpers.sql` | creates 3 internal functions | D1 | 3 helper rows present |
| 2 | `B-complete-tournament-match.sql` | creates 1 function, grants | D1, D2 | row present, `security_definer = t`, `config = {search_path=public, pg_temp}`; D2: anon f, authenticated f, service_role t |
| 3 | `C-promote-tournament-match.sql` | creates 1 function, grants | D1, D2 | same |
| 4 | `D-verify.sql` (whole file) | no | — | D1: 8 rows, all `ok = t`, **one row per name**. D2: all `ok = t`. D3: `t`. D4: two `NOTICE: ok … reachable`. D5: `hard_fail_count: 0` |

If D1 ever shows two rows for one name, an old overload exists: stop and send
me the output.

Rollback, if ever needed (functions only; no data is touched):

```sql
drop function if exists public.promote_tournament_match(uuid, text, timestamptz, timestamptz, text, timestamptz, text);
drop function if exists public.complete_tournament_match(uuid, text, text, text, integer, integer, text, text, boolean, text);
drop function if exists public._tournament_canonical_scores(text, text, text, text, integer, integer, integer);
drop function if exists public._tournament_advance_target(integer, integer);
drop function if exists public._tournament_is_bot(text);
```

After step 4, from a terminal, PostgREST should list both RPCs (read-only):

```sh
curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  | python3 -c "import json,sys; print(sorted(p for p in json.load(sys.stdin)['paths'] if 'tournament' in p))"
```

Expect `/rpc/complete_tournament_match` and `/rpc/promote_tournament_match` in
the list. If they're missing, the schema cache hasn't reloaded yet: pieces B and
C end with `notify pgrst, 'reload schema'`; wait a minute and retry.

---

## 3. Retire the v1 events and stale rows

State on 2026-10-04 (read-only counts; your figure was 1,424 earlier):

| What | Count |
|---|---|
| `upcoming` events (one every 30 min through 2026-11-01 PT) | 1,402 |
| `registration_open` events (one, start 2026-10-04 01:30 UTC, long past) | 1 |
| …of those, with any registration or match | **0** |
| `cancelled` / `completed` events | 6,773 / 13 |
| non-terminal matches (20 waiting, 2 ready, 6 in_progress), all in cancelled events | 28 |
| `registered` / `active` registrations, all in cancelled events (May–June and 09-30) | 4 / 15 |

**Proposal:**

1. **E1** `E1-preview-retire.sql` (read-only): confirm the numbers.
2. **E2** `E2-delete-v1-slots.sql`: **delete** the 1,403 unstarted v1 slots.
   They're generated rows with no children; deleting keeps them out of every
   list query and frees their `scheduled_start` values. The statement aborts
   (and rolls back) if any unstarted event has a registration or match, so it
   cannot remove anything with history. A cancel-instead alternative is in the
   file as a comment. Re-run E1 after: the first two columns should be 0.
   Timing: any time. Nothing re-creates them while tournaments are off, as long
   as F1 confirms there's no active cron job. **Don't turn on
   `TOURNAMENTS_ENABLED` with the current (v1) server after E2**: its boot seeds
   1,440 rows again.
3. **E3** (stale children of cancelled events): not runnable yet. Matches have
   no `void` status and registrations no `cancelled`, and writing `completed` /
   `withdrawn` would misstate what happened. The statement ships inside the
   Phase 1 schema migration as a backfill, once those statuses exist. Until
   then the rows are inert (v2's one-registration rule only counts
   registrations in live events).

## 4. pg_cron

**Evidence that there's no active seeding job:** production's slots were last
inserted at 2026-10-03 08:07 UTC (48 rows), and before that at 10-02 12:39,
10-01 07:00 and 09-30 13:00. Those times are irregular, matching server boots and
the server's 6-hourly top-up, not a `0 3 * * *` job. The future-slot count is
under the 1,440 threshold, so a live daily job would have topped it up at
03:00 UTC on 10-04, and nothing was inserted. Either pg_cron isn't installed
or the job is inactive or absent.

Confirm with **F1** `F1-pg-cron-check.sql` (read-only; works with or without
pg_cron). Only if it prints `seed-tournaments-daily … active=true`, run **F2**
`F2-pg-cron-deactivate.sql` (reversible; undo line in the file).

---

## 5. Does production have what the v2 engine needs?

| Needed by v2 | In production? |
|---|---|
| The three tournament tables and every v1 column | yes |
| `profiles.glicko_rating` (seeding; default 1500, not null) | yes |
| `room_live_sessions`, `room_match_logs`, `room_command_receipts`, `mp_authority_events` (room durability for tournament matches) | yes |
| `activity_feed` (champion post) | yes |
| `complete_tournament_match`, `promote_tournament_match` | **no, until pieces B and C** |
| `assert_security_posture()` | yes (used by D5) |
| v2 columns, statuses and RPCs | no; Phase 1 migrations (design §8) |
| `pg_net` (for the optional database-side wake call, design §6.4) | unknown; the catalog output will show `pg_extension` |
