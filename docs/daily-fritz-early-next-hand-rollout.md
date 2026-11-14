# Daily Fritz: early next-hand request. Rollout, watch queries, rollback, test-account check

PR #508. When a Daily Fritz hand ends, the client now asks the server for the next hand as soon as the hand-end reveal
appears (about 2 s after the hand ends), not when the reveal closes (about 5 s later). The server advances the run when
that request verifies, so the reveal closing no longer waits on the network.

## Rollback: one line

`client/src/modules/match/hand-lifecycle/handLifecycleRules.ts`:

```ts
export const DAILY_FRITZ_EARLY_NEXT_HAND_ENABLED = true;   // set to false and ship
```

With `false` the client requests the next hand when the reveal ends, exactly as before this PR (a test pins that: no
request while the reveal is up, one request, with the same body, at the end of the window). Nothing else depends on it.
A plain `git revert` of the PR also works; the constant is the smaller change.

## Why it is watched: what an unverifiable hand costs

The server does not refuse a `next-hand` whose evidence fails to verify. Any verifier code except
`missing_hand_start_progress` advances the run as **unverified**: `verification_status: 'rejected'`, sticky, and the run
is off the leaderboard. A request with no transcript does the same. The early request therefore only goes out when the
hand is over in the state the screen holds, the official journal is present and the transcript builds; otherwise advance
sends it as before. If the guards are wrong, this is where it shows: more unverified advances.

The server already records every such advance, so no server change is needed:

* log line (error level): `[daily-fritz] advancing without verification receipt — run is now unranked`, with `attemptId`,
  `gameNumber`, `handIndex`, `verifierCode`
* `daily_fritz_events` row: `event_type = 'verification_failed'`, `payload->>'outcome' = 'advance_unverified'`
* metric `verification_bypassed` (by verifier code)

## Before / after queries (Supabase SQL editor, service role)

Pick the deploy time as `:deploy` (for example `'2026-11-15 18:00+00'`) and compare equal windows either side of it.

**1. Unverified advances per day, as a share of hands advanced.** The number to compare.

```sql
select date_trunc('day', created_at)::date as day,
       count(*) filter (where event_type = 'hand_verified')                              as hands_verified,
       count(*) filter (where event_type = 'verification_failed'
                          and payload->>'outcome' = 'advance_unverified')                as hands_unverified,
       count(distinct attempt_id) filter (where event_type = 'verification_failed'
                          and payload->>'outcome' = 'advance_unverified')                as attempts_affected,
       round(100.0 * count(*) filter (where event_type = 'verification_failed'
                          and payload->>'outcome' = 'advance_unverified')
             / nullif(count(*) filter (where event_type in ('hand_verified')
                          or (event_type = 'verification_failed'
                              and payload->>'outcome' = 'advance_unverified')), 0), 2) as pct_unverified
from public.daily_fritz_events
where created_at >= now() - interval '21 days'
group by 1
order by 1;
```

**2. Which codes.** `incomplete_transcript` rising after the deploy is the signature of this change going wrong.

```sql
select (created_at >= :deploy) as after_deploy, verifier_code, count(*) as n
from public.daily_fritz_events
where event_type = 'verification_failed'
  and payload->>'outcome' = 'advance_unverified'
  and created_at >= (:deploy::timestamptz - interval '7 days')
group by 1, 2
order by 1, 3 desc;
```

**3. Attempts that ended rejected / unverified, by day.** Rejected can also come from other paths, so read it next to 1.

```sql
select run_date,
       count(*) filter (where status = 'completed')                                              as completed,
       count(*) filter (where status = 'completed' and result->>'verification_status' = 'verified') as completed_verified,
       count(*) filter (where result->>'verification_status' = 'rejected')                        as rejected_any_status,
       count(*) filter (where status = 'completed' and result->>'verification_status' = 'rejected') as completed_rejected
from public.daily_fritz_attempts
where run_date >= current_date - 21
group by 1
order by 1;
```

**4. Early requests that replayed.** A rise means requests are being repeated (reload during the reveal is the normal
cause, and it is harmless): `select date_trunc('day', created_at)::date, count(*) from public.daily_fritz_events
where event_type = 'next_hand_replayed' and created_at >= now() - interval '21 days' group by 1 order by 1;`

Roll back if query 1's `pct_unverified` or query 2's `incomplete_transcript` count is clearly above the pre-deploy
baseline on a comparable day. Compare weekdays with weekdays.

## Test-account check: a Daily attempt reaches the leaderboard

A Daily attempt is unique per `(run_date, user_id)`: **a test account gets one attempt per day**, and a run that has been
marked rejected can never be promoted back. Use a signed-in (not guest) account that has not played today's Daily, and
do not touch the app with it beforehand. Never share the password in chat or a ticket.

1. In a fresh browser profile, open the deployed site and sign in with the test account.
2. Open DevTools, Network tab, filter `daily-fritz`. Keep it open (preserve log on).
3. Home, Daily Fritz, "Play Today's Set". The `start` response should be 200. Note `attempt_id` in it.
4. Play the first hand to its end and leave the hand-over reveal up. Within about a second of the reveal appearing a
   `next-hand` request must appear in the Network tab (before the reveal closes), and it must answer 200 with
   `"unverified": false` and `"replayed": false`. The reveal then closes by itself about 5 s after it appeared.
   * `"unverified": true`, or a 4xx, means stop: roll back and see the queries above.
5. Optional, 30 seconds: while a later reveal is up, reload the page. Play Today's Set should resume on the new hand,
   not on a stuck reveal, with the same scores.
6. Keep playing until the set ends (games are to the winning score; a set is up to three games) and the final result
   card shows. Network: `record-game` then `complete`, both 200. The result card shows a rank.
7. Open `/daily-fritz/leaderboard` (cached for up to 60 s, so wait a minute). The test account's username must be on
   the board for today's date.
8. In the SQL editor, with the `attempt_id` from step 3:

```sql
select status, result->>'verification_status' as verification_status, completed_at
from public.daily_fritz_attempts where id = '<attempt_id>';
-- expect: completed | verified

select event_type, payload->>'outcome' as outcome, verifier_code, count(*)
from public.daily_fritz_events where attempt_id = '<attempt_id>'
group by 1, 2, 3 order by 1;
-- expect: hand_verified (one per hand), attempt_started, game_recorded, attempt_completed;
--         no verification_failed rows
```

Pass: step 4 early request answered 200 and `unverified: false`, step 7 shows the account, step 8 says
`completed | verified` with no `verification_failed`. Anything else: roll back, then investigate.
