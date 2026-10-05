# Hosting and services cost plan

Research only. Re-baselined 2026-10-04 around the decision to **spend nothing
and upgrade nothing until marketing starts**. Real usage today: about 3 daily
players and fewer than 10 real sign-ups. No code, plan, account or data changes
were made. Every SQL statement below is **proposed, not run**.

Extends `docs/tournament-v2-capacity.md` (the game-server tier runbook).

**How each figure was established**

| Tag | Meaning |
|---|---|
| **[Provider]** | Read on the provider's own pricing, docs or terms page on 2026-10-04 (§12) |
| **[Read]** | Read from our accounts or production without writing anything (Vercel CLI `GET`, Supabase REST `GET`, `whois`, DNS) |
| **[Measured]** | Measured with `server/scripts/tournamentCapacityProbe.ts` against a local server |
| **[Estimate]** | Derived from the above; the assumption is stated |
| **[Unverified]** | Couldn't load from the provider's own page. **Check before relying on it** |

---

## 0. Before-marketing checklist

Nothing here costs money until group C. Groups A and B can happen in any order
now; group C is a plan change plus config on the day marketing starts.

### A. Free code work (me, $0; each needs your approval first)

| # | Item | Why | Owner | Cost |
|---|---|---|---|---|
| A1 | **PR S1**: stop re-uploading the whole room event log on every move (§7) | ≈ 95% of the server's outbound bytes per match; ~11 MB per match into the database | me | $0 |
| A2 | **PR S2**: stop storing a copy of the ghost `compositeLog` in `verified_single_player_matches.completion_result`, plus a compaction script for existing rows (§7) | The single largest use of database space (≈ 550 MB of raw JSON, 80%+ of the total) | me | $0 |
| A3 | **PR S3**: reaper for dead `room_live_sessions` rows, and retention for abandoned guest match logs (§7) | 6,200+ stuck rows; ~360 more a week | me | $0 |
| A4 | **PR S4**: PostHog sampling, env-driven (§8) | Keeps a launch spike inside the free 1M events | me | $0 |
| A5 | **PR S5**: config-driven limits (§7), so each paid upgrade is a dashboard plan change plus env values, with no code | Upgrade day without a deploy of new code | me | $0 |
| A6 | Tournament v2 Phases 1–3 (separate PRs, flags stay off) | — | me | $0 |

### B. Free config and account work (you, $0)

| # | Item | Why | Owner | Cost |
|---|---|---|---|---|
| B1 | **Run the size check** (§6) and send me the result | Database size is the one free limit that can bite before launch | you | $0 |
| B2 | **Tell me which of accounts #1–#18 (§4.2) are yours or agents'** | Decides which cleanup applies | you | $0 |
| B3 | Run the cleanup (§5), starting with C1 (compaction, no data loss) | Frees most of the database | you | $0 |
| B4 | **Point local dev, agents and e2e runs at a second free Supabase project** (Free allows 2 active projects [Provider]) | Today they write into production: two dev/agent accounts hold ~540 MB, and ~360 guest rooms a week are created from dev/test runs | you (I can write the steps) | $0 |
| B5 | Check whether Supabase email confirmation is on; if real sign-ups need confirmation or password resets, add custom SMTP on a free sender (e.g. Resend Free: 3,000/month, 100/day [Provider]) | Supabase's built-in sender allows 2 emails an hour, to your team's addresses only [Provider] | you | $0 |
| B6 | Set the free alerts in §10 | Warning before a limit | you | $0 |
| B7 | Keep the UptimeRobot `/ping` monitor (free; commercial use allowed [Provider]) | Keeps Render awake | you | $0 |

### C. Paid upgrades, on the day marketing starts (you; plan change plus config)

| # | Item | Cost | Why it can't wait past launch |
|---|---|---|---|
| C1 | **Vercel Pro** | $20/month [Provider] | Hobby is non-commercial only [Provider] |
| C2 | **Supabase Pro** | $25/month [Provider] | Backups, no read-only cliff at 500 MB, no pausing |
| C3 | **Render Standard** (`1c-2g`), with a card on the workspace | ~$25/month [Unverified] | Free sleeps and lags at ≈ 4 live matches [Measured]; card avoids the bandwidth shutdown |
| C4 | Apple Developer, only when the iOS build ships | $99/year [Provider] | Needed for TestFlight / App Store |
| Later | Sentry Team $26, Resend Pro $20, PostHog paid, Supabase compute, Google Play $25 one-time | per §10 alerts | Only when their alert fires |

---

## 1. Current real usage vs the free limits

| Service | Free limit | Real usage now | Headroom |
|---|---|---|---|
| Supabase database | **500 MB, then read-only** [Provider] | **Unknown on disk** (run §6). Raw JSON ≈ 700 MB before compression; ≈ 550 MB of it is ghost `compositeLog` copies [Read] | **The one to watch** |
| Supabase egress | 5 GB/month [Provider] | Unknown (dashboard). **This research itself used ≈ 0.75 GB**: one uncompressed read of `completion_result` (~553 MB) before I switched to gzip, then ~100 MB compressed | Probably fine at 3 daily players |
| Supabase MAU | 50,000 [Provider] | ≤ 641 auth users, 5 signed in during the last 30 days [Read] | Huge |
| Supabase auth email | 2/hour, team addresses only [Provider] | Unknown whether confirmation is on | Bites on the first real sign-up wave |
| Supabase pausing | after 1 week inactive [Provider] | Server traffic keeps it active | Fine while the server runs |
| Render CPU | 0.1 CPU, lag from ≈ 4 live matches [Measured] | ~3 daily players | Fine |
| Render bandwidth | 5 GB/month, then spun down until next month (no card) [Provider] | Unknown (dashboard). At ≈ 11.6 MB per live match [Measured], 5 GB ≈ **430 live matches a month** | Fine at today's play; a tournament playtest is ≈ 7 matches |
| Render instance hours | 750/month per workspace [Provider] | One always-awake service ≈ 744 h | Fine with exactly one free service |
| Vercel Hobby | 100 GB transfer, 1M requests [Provider] | Unknown (usage API is Pro-only) | Fine at this scale |
| Sentry Developer | 5,000 errors/month, 1 user [Provider] | 23/5,000 (2026-09-09) [Read] | Fine |
| PostHog | 1M events/month [Provider] | Unknown; 4 event types, autocapture off, ≈ 4–8 events a session [Read: `client/src/lib/analytics.ts`] | Fine |
| UptimeRobot | 50 monitors, 5 min [Provider] | 1 monitor | Fine |
| Domain | Namecheap, expires **2027-06-17** [Read] | — | Renewal next June |

## 2. Which free limits could bite before marketing

1. **Supabase database size (500 MB, read-only above it).** Most likely, and
   possibly close already. When it hits, every write fails: games, sign-ups,
   ratings, tournaments. Growth today comes almost entirely from dev and agent
   play (§4), not real players. Mitigation: B1 → B3 (cleanup), B4 (separate
   dev project), A2 (stop the copies).
2. **Supabase auth email (2 an hour, team only).** Only if email confirmation
   or password reset is used by real players. Mitigation: B5.
3. **Render bandwidth (5 GB).** Unlikely before marketing: it would take
   ≈ 430 live matches in a month. A1 would raise that roughly 20×.
4. **Supabase egress (5 GB).** Unlikely at 3 daily players. Large read-only
   investigations (like this one) are the main risk; use gzip.

Everything else is far from its limit.

## 3. Stay free until launch

- No card on Render, no paid plans, no purchases.
- Keep production for real players only: dev, agents and e2e on a second free
  Supabase project (B4).
- Clean up once (§5), then keep growth near zero with A2 and A3.
- Check database size monthly (§6); act at the thresholds in §6.
- Tournament playtests on the free tier are fine. One event is ≈ 7 matches,
  ≈ 80 MB of Render bandwidth today (≈ 5 MB after A1), and under 1.5 MB of
  database. Open the app a few minutes before start so Render is awake.
- At launch, do group C in one sitting.

---

## 4. Where the database space comes from

Read-only scan, 2026-10-04, gzip responses (≈ 100 MB of egress). Sizes are
JSON text as returned by the API, **before** Postgres compression; §6's query
gives the true on-disk numbers.

### 4.1 By account class

Test accounts = email at `racehorse-test.invalid` (618), `qa.invalid` (4) or
`example.com` (1): **623 of 641**. "Other" = the remaining 18, which include
yours and any agent accounts on real domains.

| Table | Rows | Raw JSON | Test accounts | "Other" accounts | No user (guest rooms) |
|---|---|---|---|---|---|
| `verified_single_player_matches` | 1,248 | **553.8 MB** | 46 rows, 0.1 MB | 1,202 rows, **553.7 MB** | — |
| `room_live_sessions` | 6,643 | 43.3 MB | 1 row, 0.3 MB | 14 rows, 0.2 MB | **6,611 rows, 41.4 MB** (+17 rows / 1.4 MB of deleted users) |
| `daily_fritz_attempt_operations` | 3,626 | 29.7 MB | 211 rows, 1.2 MB | 3,415 rows, 28.5 MB | — |
| `ghost_games` | 449 | 25.2 MB | 2 rows, 0.2 MB | 447 rows, 25.0 MB | — |
| `room_match_logs` | 3,020 | 22.0 MB | — | 95 rows, 4.5 MB | **2,921 rows, 17.3 MB** (+4 rows of deleted users) |
| `daily_fritz_events` | 13,220 | 10.3 MB | 825 rows, 0.7 MB | 6,259 rows, 5.6 MB | 6,136 rows, 4.0 MB |
| `daily_fritz_attempts` | 507 | 4.7 MB | 46 rows, 0.2 MB | 461 rows, 4.5 MB | — |
| `game_reviews`, `review_completion_jobs` | 21 | 7.9 MB | — | all | — |
| `ghost_profiles` | 55 | 1.9 MB | 41 rows, 0.3 MB | 14 rows, 1.6 MB | — |
| Everything else (48 tables) | — | ≈ 35 MB (sampled) | | | |

**Conclusion:** the 623 test accounts hold only **≈ 3 MB**. The space is in:

- **Ghost `compositeLog` copies** inside `verified_single_player_matches.completion_result`:
  ≈ 550 MB, owned almost entirely by two accounts (below). Each stored
  completion carries 144+ full game states (≈ 260 KB since the cap; up to
  2.8 MB before it). The only reader is the idempotent replay of the same
  completion request (`server/src/http/routes/ghost.ts:296`), which happens
  within seconds of the original. The live copy lives in
  `ghost_profiles.composite_log` and is already capped.
- **Dead guest rooms**: 5,986 `room_live_sessions` rows stuck in `playing`
  and older than 7 days, plus 215 in `lobby`. Rooms never live that long, so
  these are leftovers (≈ 360 created in the past week). Plus ≈ 2,900
  abandoned guest match logs.

### 4.2 The 18 "other" accounts (anonymized)

`vspm` = `verified_single_player_matches`. "Last 30d" = completed games since
2026-09-04.

| # | Domain | Created | Last sign-in | vspm rows | vspm MB | Last 30d | Daily Fritz ops | Ghost games |
|---|---|---|---|---|---|---|---|---|
| 1 | gmail.com | 2026-02 | 2026-10-04 | 506 | 278.0 | 37 | 996 | 221 |
| 2 | aol.com | 2026-02 | 2026-07-09 | 301 | 262.2 | 32 | 983 | 161 |
| 3 | andrealynn.com | 2026-04 | 2026-08-16 | 149 | 8.6 | 57 | 1,226 | 46 |
| 4 | gmail.com | 2026-02 | 2026-10-04 | 185 | 3.1 | 4 | 165 | 13 |
| 5 | gmail.com | 2026-04 | 2026-04-25 | 29 | 1.0 | 0 | 0 | 4 |
| 6 | mac.com | 2026-07 | 2026-07-09 | 3 | 0.1 | 0 | 0 | 2 |
| 7 | requesta.app | 2026-08 | 2026-08-24 | 2 | 0.0 | 0 | 45 | 0 |
| 8–18 | gmail.com ×9, sjsu.edu ×1 (one more gmail) | 2026-02…08 | various | 0–12 each | 0.0 | 0 | 0 | 0 |

Accounts #2 and #3 completed games in the last 30 days without signing in
during that time. That fits agents or local dev servers using the e2e auth
bypass (`E2E_DAILY_FRITZ_USER_ID`, non-production servers only) with
production's database. Only you can say which accounts are yours, agents' or
real players' (B2). **The cleanup below doesn't depend on that answer**: C1
loses no game data for anyone.

---

## 5. Proposed cleanup (not run)

Run in the SQL editor, one block at a time, ideally at a quiet hour. Each
block previews first. Row updates and deletes only make space *reusable*;
the database-size number drops after `VACUUM FULL` on that table (C6), which
locks it briefly, so run that when nobody is playing. `VACUUM` must be run
**on its own**, not pasted together with other statements.

| Step | What | Frees (raw JSON) | Data lost |
|---|---|---|---|
| C1 | Remove the stored `compositeLog` copy from completions older than 1 day | **≈ 550 MB** | None that anything reads (replays happen within seconds) |
| C2 | Delete `room_live_sessions` rows idle > 7 days in `lobby` / `playing` / `hand_over` | ≈ 40 MB | Dead rooms only |
| C3 | Delete abandoned guest match logs (no participant users) older than 30 days | ≈ 16 MB | Guest abandoned-game logs (no player sees them) |
| C4 | Delete the 623 test-domain accounts (cascades) | ≈ 3 MB + cleaner leaderboards | Test accounts |
| C5 | Delete the 1,403 unstarted v1 tournament slots (`E2` in the tournament preflight) | ≈ 0.5 MB | Empty slots |
| C6 | `VACUUM FULL` the tables touched | Returns the space to the database-size number | — |

On disk the savings are smaller than the raw JSON (Postgres compresses large
values). §6's query shows exactly how much C1 would free on disk (its
`compositeLog` row).

**C1 compaction** (repeat until it reports `UPDATE 0`; 100 rows per run keeps
each transaction short):

```sql
-- preview
select count(*) as rows_to_compact,
       pg_size_pretty(sum(pg_column_size(completion_result))) as stored_size_now
  from public.verified_single_player_matches
 where completion_result ? 'compositeLog'
   and completed_at < now() - interval '1 day';

-- run repeatedly until UPDATE 0
with batch as (
  select match_id
    from public.verified_single_player_matches
   where completion_result ? 'compositeLog'
     and completed_at < now() - interval '1 day'
   limit 100
)
update public.verified_single_player_matches v
   set completion_result = v.completion_result - 'compositeLog'
  from batch
 where v.match_id = batch.match_id;
```

**C2 dead live sessions:**

```sql
-- preview
select status, count(*) from public.room_live_sessions
 where status in ('lobby', 'playing', 'hand_over')
   and updated_at < now() - interval '7 days'
 group by status;

delete from public.room_live_sessions
 where status in ('lobby', 'playing', 'hand_over')
   and updated_at < now() - interval '7 days';
```

**C3 abandoned guest match logs:**

```sql
-- preview
select count(*) from public.room_match_logs
 where status = 'abandoned'
   and coalesce(array_length(participant_user_ids, 1), 0) = 0
   and archived_at < now() - interval '30 days';

delete from public.room_match_logs
 where status = 'abandoned'
   and coalesce(array_length(participant_user_ids, 1), 0) = 0
   and archived_at < now() - interval '30 days';
```

**C4 test accounts** (deletes cascade to every table with a foreign key to
the user; CI guardrail #6 / `check:cascade-delete` keeps those cascading, and
the three big tables below are `uuid … references auth.users on delete
cascade`, so the after-check should return 0s):

```sql
-- preview: should be 623
select count(*) from auth.users
 where split_part(email, '@', 2) in ('racehorse-test.invalid', 'qa.invalid', 'example.com');

delete from auth.users
 where split_part(email, '@', 2) in ('racehorse-test.invalid', 'qa.invalid', 'example.com');

-- after-check: rows left in tables without a foreign key (should be 0 or tiny)
select 'verified_single_player_matches' t, count(*) from public.verified_single_player_matches v
 where not exists (select 1 from auth.users u where u.id = v.user_id)
union all
select 'daily_fritz_attempts', count(*) from public.daily_fritz_attempts a
 where not exists (select 1 from auth.users u where u.id = a.user_id)
union all
select 'ghost_games', count(*) from public.ghost_games g
 where not exists (select 1 from auth.users u where u.id = g.user_id);
```

**C6 reclaim** (each line on its own, quiet hour):

```sql
vacuum full public.verified_single_player_matches;
```
```sql
vacuum full public.room_live_sessions;
```
```sql
vacuum full public.room_match_logs;
```

If accounts #1–#3 turn out to be agents, deleting them would free ≈ 30 MB
more after C1. Not worth it unless you want them gone anyway.

---

## 6. Size check (single copy-paste, read-only)

```sql
select what, pg_size_pretty(bytes) as size, bytes
from (
  select 1 as ord, 'DATABASE TOTAL (the 500 MB limit)' as what,
         pg_database_size(current_database()) as bytes
  union all
  select 2, 'compositeLog copies C1 would remove (stored size)',
         coalesce(sum(pg_column_size(completion_result)) filter (where completion_result ? 'compositeLog'), 0)
    from public.verified_single_player_matches
  union all
  select 3, 'table: ' || relname, pg_total_relation_size(relid)
    from (select relname, relid from pg_statio_user_tables
           order by pg_total_relation_size(relid) desc limit 10) t
) x
order by ord, bytes desc;
```

| DATABASE TOTAL | Meaning | Action |
|---|---|---|
| under 250 MB | Comfortable | Monthly check |
| 250–400 MB | Plan the cleanup | Run C1–C3 within a few weeks; do B4 |
| **over 400 MB** | **Worry**: 80% of the limit, and dev runs add tens of MB a week | Run C1 + C6 now |
| over 475 MB | One busy dev week from read-only | Run C1–C3 + C6 today |

The second row shows how much C1 frees on disk (the compositeLog copies are
most of the `completion_result` values that hold them). Send me the output and
I'll update §1 and §4 with real numbers.

---

## 7. Proposed storage-fix PRs (not implemented until you approve)

| PR | Change | Effect | Risk / test |
|---|---|---|---|
| **S1** live-session writes | `buildLiveSessionRow` (`server/src/multiplayer/roomLivePersistence.ts`) stops sending `structuredClone(room.events)` on every move: persist the game state plus only the events hydration needs (or a capped tail), full log once at game end | Per match ≈ 11 MB → ≈ 1 MB out of Render [Estimate]; less CPU per move (capacity doc §5.1) | Multiplayer runtime: needs the restart chaos script (`npm run chaos:multiplayer-restart`) and the hydration tests; its own PR, not tournament work |
| **S2** completion copies | Store `completion_result` without `compositeLog` going forward; on a replay, rebuild it from `ghost_profiles.composite_log`. Ship the C1 statement as a committed script for you to run | Stops ≈ 260 KB per ghost completion | Ghost completion replay test: same response shape |
| **S3** dead-row retention | A daily, cheap reaper: delete `room_live_sessions` idle > 7 days (excluding live rooms), and abandoned guest `room_match_logs` > 30 days. Runs only when the server is up; one indexed delete a day | Stops the ≈ 360 rows a week | Must never touch a live room: `updated_at` guard + test |
| **S5** config-driven limits | Env-configurable values that change with the hosting tier: Sentry `tracesSampleRate` (hard-coded 0.2 today), PostHog sample rate (S4), a soft cap on concurrent live rooms with a friendly "busy, try again" message (tier-sized: ≈ 4 on Free, 60 on Starter, 120 on Standard [Measured]), tournament `TOURNAMENT_MAX_PLAYERS` (design §5.1). Rate limits are already env-driven | Upgrade = plan change + env values; the cap protects a free instance from a spike | Defaults equal today's behaviour |

## 8. PostHog sampling plan (proposal, S4)

Today [Read: `client/src/lib/analytics.ts`]: four events (`session_start`,
`game_opened`, `game_completed`, `share_initiated`), plus PostHog's
`$pageleave` (`capture_pageleave: true`). Autocapture and pageviews are off;
`person_profiles: 'always'`. That's ≈ 4–8 events a session, so 1M free events ≈
125k–250k sessions a month: about **1,500–2,500 daily users** before any cost
[Estimate].

Plan:

1. Turn off `capture_pageleave` (≈ 1 event a session, not used by any metric in the file).
2. Per-session sampling: decide once per browser session with
   `VITE_POSTHOG_SAMPLE_RATE` (default `1.0`); send nothing when not sampled. Add
   `sample_rate` as an event property so dashboards can scale counts.
3. Keep `share_initiated` unsampled if it's the headline metric (small volume).
4. At launch: set the rate from expected DAU (for example 0.25 at 10k DAU keeps
   it near 1M events), and use PostHog's billing limit once on a paid plan.
   What PostHog does when a **free** org exceeds 1M without a card wasn't on the
   pages I could load [Unverified].

---

## 9. Inventory and terms (reference)

| Service | Used for | Plan now | Terms that matter at launch |
|---|---|---|---|
| Render | Game server `racehorse.onrender.com` | Free instance, Hobby workspace [Read: HARDENING_PLAN] | "Do not use them for production applications"; sleeps after 15 min; may restart any time; 5 GB bandwidth then spun down without a card [Provider] |
| Supabase | Postgres, Auth, auth email (Storage/Realtime/Functions unused) | Free [Read: PRE_LAUNCH_HARDENING] | 500 MB then read-only; no backups; 2 auth emails/hour to team only, "not … production"; pauses after a week idle [Provider] |
| Vercel | Client SPA (`racehorsedoms`; also `racehorse-server`, `mahjong-helper` in the team) | **Hobby** [Read] | "non-commercial personal use only"; commercial = financial gain of anyone involved in any part of the production [Provider] |
| Sentry | Errors, client + server | Developer, no card [Read] | 5k errors, 1 user [Provider] |
| PostHog | Analytics | Likely free | 1M events free [Provider] |
| UptimeRobot | `/ping` monitor | Free | Commercial use allowed [Provider] |
| Namecheap | `playracehorse.com`, DNS | Expires 2027-06-17 [Read] | Renewal price [Unverified] |
| GitHub | Public repo, Actions | Free | Free for public repos [Unverified] |
| Apple Developer | iOS shell | Unknown | $99/year [Provider] |
| Google Play | Not used | — | $25 one-time; 12 testers × 14 days for new personal accounts [Provider] |
| Vercel KV / Upstash | **Not used** (env vars only) | — | — |

## 10. At launch: costs, outgrow points, alerts

### 10.1 Monthly cost at launch (unchanged from the earlier plan, minus anything pre-launch)

| Scenario | Monthly | Yearly |
|---|---|---|
| Until launch | **$0** | $0 (domain renewal ~$18 next June [Unverified]) |
| Soft launch (~300 users, 3 events a day) | ≈ $70 (Render Standard ~$25, Supabase Pro $25, Vercel Pro $20, bandwidth ≈ $1) | ≈ $850 + Apple $99 if iOS |
| Marketed (5k DAU, 20k MAU, 2 Fritz games and ~3 sessions per DAU a day) with S1 + S2 done | ≈ $125–180 (adds Sentry Team $26, Resend Pro $20, Supabase compute $5–50; PostHog $0 with S4) | ≈ $1.5k–2.2k + Apple + Play $25 one-time |
| Marketed, without S1 + S2 | ≈ $280–370 (adds bandwidth ≈ $62, disk $15–30 by month 6 and growing, PostHog ≈ $85–110 at 6–8 events a session) | ≈ $3.4k–4.4k |

Prices: Vercel Pro $20, Supabase Pro $25 (incl. $10 compute credit), Supabase
disk $0.125/GB-month over 8 GB, Sentry Team $26, Resend Pro $20, Render
bandwidth $0.15/GB, Apple $99/year, Play $25 one-time [Provider]. Render
instances (Starter ~$7, Standard ~$25, `2c-4g` ~$85) [Unverified].

**Scales with usage:** Render bandwidth, Supabase disk/egress/MAU/compute,
PostHog, Resend tiers, Vercel usage above the credit. **Flat:** instance,
Vercel seat, Supabase Pro base, Sentry Team, Apple, domain.

### 10.2 When each free or paid tier is outgrown

| Limit | Outgrown at |
|---|---|
| Render Free CPU | ≈ 4 concurrent live matches [Measured] |
| Render Hobby bandwidth | ≈ 430 live matches/month today; ≈ 5,000 after S1 [Estimate] |
| Render Starter / Standard | ≈ 64 / ≥ 128 concurrent matches [Measured] |
| Supabase Free DB | Now or soon at dev-run growth; after cleanup + S2 + S3 + B4, years at real-player volumes [Estimate] |
| Supabase auth email | First real sign-up wave without custom SMTP |
| PostHog free | ≈ 1,500–2,500 DAU unsampled [Estimate] |
| Sentry Developer | 5k errors/month or a second teammate |

### 10.3 Alerts (all free to set)

| Service | Alert at | How |
|---|---|---|
| Supabase DB size | **400 MB** | Monthly §6 check; dashboard usage page |
| Supabase egress | 4 GB/month | Dashboard usage |
| Render bandwidth | 4 GB/month | Render usage page (check weekly once tournaments run) |
| Render memory | RSS > 400 MB | Existing hourly `resource usage` log + Render metrics |
| Event-loop lag | > 10 warnings an hour, any watchdog stall | Already in Sentry |
| Sentry | 4,000 errors | Sentry usage notifications |
| PostHog | 800k events/month | PostHog usage |
| Domain | 60 days before 2027-06-17; auto-renew on | Namecheap |

---

## 11. What I couldn't read

Database size on disk (needs §6), Render bandwidth, Supabase egress and plan
(no management token), Vercel usage (API is Pro-only), PostHog usage, whether
Supabase email confirmation or custom SMTP is on, Apple enrollment.

## 12. Sources (fetched 2026-10-04)

Loaded: supabase.com/pricing; supabase.com/docs/guides/platform/database-size,
…/compute-and-disk, …/manage-your-usage/disk-size;
supabase.com/docs/guides/auth/auth-smtp; vercel.com/docs/plans/hobby;
vercel.com/pricing; vercel.com/docs/limits/fair-use-guidelines;
render.com/docs/free, /compute-plans, /outbound-bandwidth; sentry.io/pricing;
posthog.com/docs/product-analytics/pricing, /docs/billing/limits-alerts;
uptimerobot.com/pricing, /terms; developer.apple.com/support/enrollment;
support.google.com/googleplay/android-developer/answer/6112435 and /14151465;
resend.com/pricing.

Not loaded: render.com/pricing (body didn't render), namecheap.com (403),
PostHog tiers above 2M events and free-org overage behaviour.
