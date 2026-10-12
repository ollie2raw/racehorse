# Moderation migrations — production rollout

Owner-run. Nothing here has been applied to production. Both migrations are
applied and tested on the dev project.

| Order | Migration | What it adds |
|---|---|---|
| 1 | `supabase/migrations/2026-10-12_username_policy.sql` | `username_policy_violation()`, the `profiles_username_policy` trigger, and the policy check in `handle_new_user()` |
| 2 | `supabase/migrations/2026-10-12_user_reports_and_blocks.sql` | `user_reports`, `user_blocks` (RLS on, no policies, no client grants, cascade from `auth.users`), and the `friends_refuse_blocked_pair` trigger |

No other migration is part of this rollout.

## Order: database first, code second

1. Apply both migrations while the current production server and client
   (`71f313ce`) keep serving.
2. Verify the database (`verify.sql`, then `smoke.sql`).
3. Merge and deploy the code (`fix/app-store-launch-foundations`).

**Why the database must go first.** The new server fails *closed*: if it can't
read `user_blocks`, it refuses new friend requests, friend invites, Quick Match
joins for signed-in players, and new private-room seats with a generic
"unavailable" answer. Deployed before the tables exist, it would refuse those
for every signed-in player. With the tables in place first, the new server
starts against a complete schema.

**Why the old code is unaffected by the migrations (checked on dev).**

| Old (`71f313ce`) path | Effect of the migrations |
|---|---|
| Signup (client → Supabase Auth → `handle_new_user`) | Unchanged for allowed handles. A reserved/offensive handle now gets the `user_…` placeholder, and the existing "choose a username" prompt appears, exactly as for a taken handle |
| Rename (client PATCHes its own `profiles` row under RLS) | Allowed names unchanged. A denied name is refused by the trigger (the old client shows the raw `username_not_allowed` message; the new client shows readable copy) |
| Rating updates (`commit_glicko_game_update` RPC) and every other profile write | Untouched: the trigger fires only when `username` is set or changed |
| Existing usernames | Never modified. Names that would fail the new policy keep working; preflight P3 lists them for review |
| Friend requests (client inserts into `friends` under RLS) | Unchanged: the new trigger only refuses rows between a blocked pair, and no blocks can exist until the new code ships (no client grants, no old route writes them) |
| Existing friendships | Untouched (the trigger checks inserts and acceptances only) |
| Account deletion (`DELETE /api/account` → auth user delete) | Unchanged; the new tables cascade from `auth.users` (Guardrail #6 holds) |
| RPCs / views | None depend on the new objects; nothing existing is dropped or altered except `handle_new_user()` (same body plus one condition) |

## Blocking semantics (for reviewers and operators)

**New interaction → fail closed. Restoring an existing authorised game →
always allowed.** If block state can't be read, a new interaction is refused
with a generic answer that reveals neither a block nor the failure:

| Interaction | Blocked | Block state unreadable |
|---|---|---|
| Friend request (client → `friends`, or `/api/social/friends/request`) | DB trigger refuses: "You can’t send a friend request to this player." | The trigger runs inside the insert, so it can't be skipped; the server route answers 503 "Friend requests are unavailable right now" |
| Friend invite (`friend:invite`) | `recipient_unreachable` (same as an offline friend) | `invite_unavailable`; nothing delivered |
| Quick Match | Never paired (blocks read at `queue:join`) | Join refused with `queue_unavailable` ("Try again in a moment"); player not queued, so no loop |
| New private-room seat | "Room not found." (same as a wrong code), including rooms restored after a restart | Same refusal |
| Global activity feed (signed in) | Blocked players' items hidden | Feed shows its error/retry state instead of unfiltered activity |
| Reclaiming a seat you already hold (reconnect, resync, second tab) | Allowed, no lookup | Allowed |

Tournament bracket assignments are not covered yet: see the hard gate in
`../tournament-launch/README.md`.

## Procedure

1. **Preflight** — run `preflight.sql` (read-only). Keep the output:
   - P1 all null / 0 (nothing exists yet), P2 all true.
   - P3: names that would fail the new policy (informational; nothing changes them).
   - P0 timestamp and P4 fingerprint: needed by V2.
2. **Apply** — in the SQL editor, run migration 1, then migration 2, each as
   its own run. Both are idempotent (`create … if not exists`,
   `create or replace`, `drop trigger if exists`).
3. **Verify** — run `verify.sql` (read-only) with P0's timestamp pasted into
   V2. Expected:
   - V1 all true; V2 fingerprint equals P4; V3 `reserved / prohibited / null / syntax`.
   - V4 two rows, RLS on, 0 policies; V5 no rows.
   - V6: constraints `user_reports_category_check`, `_not_self`,
     `_once_per_category`, `_pkey`, `_source_check`, two FKs;
     `user_blocks_not_self`, `_pkey`, two FKs. Indexes: `user_blocks_blocked_idx`,
     `user_blocks_pkey`, `user_reports_once_per_category`, `user_reports_pkey`,
     `user_reports_reported_created_idx`, `user_reports_reporter_created_idx`.
   - V7 four FKs to `auth.users`, `confdeltype = c`; V8 all false;
     V9 `hard_fail_count = 0`; V10 equals P5.
4. **Smoke** — run `smoke.sql`. It writes throwaway rows inside a transaction
   and rolls back; expect `moderation smoke passed (rolling back)`.
5. **Deploy the code** once 1–4 pass.

## Rollback

Before the code deploy, the migrations can be reverted by dropping the
`friends_refuse_blocked_pair` and `profiles_username_policy` triggers, the new
functions and the two tables, and restoring `handle_new_user()` from
`2026-08-26_signup_profile_username_from_metadata.sql`. After the new code is
live, keep the tables: the server refuses new social interactions without them.
