# Hosting and services cost plan

Research only, 2026-10-04. No code, plan or account changes were made. This
extends `docs/tournament-v2-capacity.md` (the tier and upgrade runbook for the
game server) to every paid or limited service the project uses.

**How each figure was established**

| Tag | Meaning |
|---|---|
| **[Provider]** | Read on the provider's own pricing, docs or terms page on 2026-10-04 (URL in §8) |
| **[Read]** | Read from our own accounts or production without writing anything (Vercel CLI `GET`, Supabase REST `GET`, `whois`, DNS) |
| **[Measured]** | Measured with `server/scripts/tournamentCapacityProbe.ts` against a local server |
| **[Estimate]** | Derived from the above with the stated assumption |
| **[Unverified]** | Couldn't load from the provider's own page; from memory. **Check before relying on it** |

---

## 1. Inventory

Found from env var names (`server/src`, `client/src`), dependencies, `vercel.json`
(including its CSP `connect-src`), `client/capacitor.config.ts`, CI workflows,
`HARDENING_PLAN.md` and `PRE_LAUNCH_HARDENING.md`.

| Service | Used for | Evidence |
|---|---|---|
| **Render** | Game server (Express + socket.io), `racehorse.onrender.com` | `VITE_SERVER_URL`, CSP, HARDENING_PLAN |
| **Supabase**: Postgres | All persistence | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| **Supabase**: Auth | Email + password sign-up, password reset (`client/src/auth/useAuth.ts`) | `signUp`, `resetPasswordForEmail` |
| **Supabase**: auth emails | Confirmation and reset emails, through Supabase's built-in sender unless custom SMTP is set (not visible from the repo) | — |
| Supabase: Storage, Realtime, Edge Functions | **Not used** (no `.storage`, no `.channel(`, no functions dir) | grep |
| **Vercel** | Client SPA hosting, project `racehorsedoms`; a second project `racehorse-server` and an unrelated `mahjong-helper` in the same team | `vercel` CLI |
| Vercel KV / Upstash | **Not used**: env vars exist in `server/.env.local` (pulled by the Vercel CLI) but no code references them | grep |
| **Sentry** | Errors and traces, client + server, one shared project | `VITE_SENTRY_DSN`, `@sentry/*` |
| **PostHog** | Product analytics (client) | `VITE_POSTHOG_KEY`, `posthog-js` |
| **UptimeRobot** | HTTP monitor on `/ping` every 5 min, keeps Render awake | HARDENING_PLAN T-17 / D-4 |
| **Domain** `playracehorse.com` | Registrar **Namecheap**, Namecheap BasicDNS, **expires 2027-06-17** | `whois`, `dig` [Read] |
| **GitHub** | Repo (public), Actions: CI, puzzle generation every 6 h, security posture, smoke tests | `gh repo view` |
| **Apple Developer** | Needed for the Capacitor iOS shell (TestFlight / App Store) | `client/ios`, `@capacitor/ios` |
| Google Play | Not used yet (no `client/android`) | — |
| Google Fonts | Free CDN | CSP |
| Email sending (custom SMTP) | **Not set up as far as the repo shows**; proposed for launch (§3) | — |
| Web push | Not built (tournament Phase 3). Standard Web Push needs no paid provider | — |

---

## 2. Each service: plan, usage, first limit, what happens

| Service | Current plan | Usage now vs limit | Limit you'd hit first | What hitting it looks like |
|---|---|---|---|---|
| **Render** | Free instance, Hobby workspace [Read: HARDENING_PLAN; not re-checked in the dashboard] | Bandwidth **unknown** (dashboard only). Instance hours: 750 a month per workspace [Provider], enough for exactly one always-awake service | **Outbound bandwidth, 5 GB/month** on Hobby [Provider]. Each live 30-point match sends **≈ 11.6 MB** out of Render: ≈ 0.53 MB of socket traffic to the two players plus ≈ 11 MB of `room_live_sessions` uploads to Supabase [Measured]. 5 GB ≈ **430 live matches a month, every mode combined** [Estimate, assuming Render meters traffic to Supabase as public egress] | No card on file: "Render spins down your workspace's services until the start of the next month". With a card: $0.15/GB [Provider]. **A hard stop for the whole app** |
| | | CPU 0.1 / RAM 512 MB [Provider] | Lag from ≈ 4 live matches [Measured, capacity doc] | Slow moves, `/ping` timeouts, watchdog alerts |
| **Supabase** | Free [Read: PRE_LAUNCH_HARDENING 2026-09-09; not re-checked] | **Auth users 641** (so MAU ≤ 641) vs 50,000 [Read]. Database size **unknown**: raw JSON in the largest tables totals ≈ 700 MB before Postgres compression (`verified_single_player_matches.completion_result` alone is 553 MB of JSON across 722 completed games) [Read]. On disk it's likely 150–400 MB [Estimate] vs **500 MB**. Egress unknown | **Database size, 500 MB**, possibly close already. Second: auth email, **2 emails an hour, only to your team's addresses** [Provider] | Over 500 MB: "Free Plan projects enter read-only mode" [Provider]: every write fails (games, sign-ups, ratings). Email: sign-up confirmations and password resets to players are refused |
| | | No backups on Free [Provider] | — | Data loss has no recovery path |
| | | Pauses "after 1 week of inactivity" [Provider] | Unlikely while the server polls it | Whole backend offline until resumed |
| **Vercel** | **Hobby** [Read: team `billing.plan = hobby`] | Usage API is Pro-only, so dashboard only. Hobby includes 100 GB Fast Data Transfer, 1M CDN requests [Provider] | **The terms, not a number**: Hobby is "restricted to non-commercial personal use only" [Provider] | If a limit is exceeded: "wait until 30 days have passed" [Provider]. Commercial use on Hobby breaks the fair-use terms |
| **Sentry** | Developer (free), no card [Read: `docs/ops/sentry-alerting-setup.md`] | 23 / 5,000 errors (2026-09-09) | 5,000 errors/month; 1 user [Provider] | Extra errors dropped (no spend). Volume guard and spike protection already on |
| **PostHog** | Unknown plan (likely free) | Unknown (dashboard) | 1M events/month free [Provider] | With a billing limit: "additional data is lost forever" [Provider]. Without one, first paid tier $0.00005/event [Provider] |
| **UptimeRobot** | Free | 1 of 50 monitors, 5-min interval [Provider] | — | Commercial use allowed: "available for any use, including commercial" [Provider] |
| **Domain** | Namecheap, expires 2027-06-17 [Read] | — | Renewal | Site unreachable if it lapses. Price **[Unverified]** (namecheap.com refused the fetch): .com renewals are typically ~$15–20/year |
| **GitHub** | Public repo [Read] | Actions on standard runners | — | Free for public repos [Unverified: from memory] |
| **Apple Developer** | Unknown whether enrolled | — | Needed before TestFlight | $99/year [Provider] |
| **Google Play** | Not used | — | — | $25 one-time [Provider]; new personal accounts need **12 testers opted in for 14 days** before production [Provider] |
| **Email (SMTP)** | None | — | — | e.g. Resend Free: 3,000/month, **100/day**; Pro $20/month, 50,000/month [Provider] |

---

## 3. Free-tier terms that conflict with a marketed launch

| Service | Term | Impact | Fix |
|---|---|---|---|
| **Vercel Hobby** | "restricted to non-commercial personal use only". Commercial = any deployment "used for the purpose of financial gain of **anyone** involved in **any part of the production**"; examples include payments and ads [Provider] | A marketed product run as a business is almost certainly commercial, even with no payments in the app | **Vercel Pro**, $20/month per seat with a $20 usage credit [Provider], before marketing (arguably before any public launch) |
| **Render Free** | "Do not use them for production applications" [Provider]; sleeps after 15 min idle; "might restart … at any time" | Not a legal bar, but an explicit non-production tier, and it sleeps through event starts | Paid instance (§4) |
| **Render Hobby workspace** | 5 GB outbound, **services spun down for the rest of the month** if exceeded with no card [Provider] | One busy week of live matches stops everything | **Add a card now** (free); overage $0.15/GB |
| **Supabase Free** | Read-only at 500 MB; no backups; pauses after a week idle; 2 auth emails/hour, team addresses only, "not … production" [Provider] | Sign-ups can't be confirmed; a size spike freezes all writes; no restore point | **Supabase Pro** + **custom SMTP** |
| **Sentry Developer** | 1 user [Provider] | Fine solo; blocks adding a teammate | Team $26/month [Provider] when needed |
| **Google Play** | 12 testers × 14 days for new personal accounts [Provider] | Lead time, not cost | Start the closed test early if Android is planned |
| UptimeRobot Free | Commercial use explicitly allowed [Provider] | none | — |

---

## 4. Cost scenarios

**Prices used** (monthly unless marked):

| Item | Price | Source |
|---|---|---|
| Render instance Starter (0.5 CPU / 512 MB) | ~$7 | **[Unverified]** (render.com/pricing didn't render; specs are [Provider]) |
| Render instance Standard (1 CPU / 2 GB) | ~$25 | **[Unverified]** |
| Render instance `2c-4g` | ~$85 | **[Unverified]** |
| Render bandwidth overage | $0.15/GB | [Provider] |
| Supabase Pro | $25, incl. $10 compute credit (covers Micro) | [Provider] |
| Supabase compute Small / Medium | ~$15 / ~$60 (minus the $10 credit) | [Provider] |
| Supabase disk over 8 GB | $0.125/GB-month | [Provider] |
| Supabase egress over 250 GB | $0.09/GB | [Provider] |
| Vercel Pro | $20 per developer seat, $20 credit | [Provider] |
| Sentry Team | $26 | [Provider] |
| PostHog | free to 1M events, then $0.00005/event (first tier) | [Provider] (later tiers not loaded) |
| Resend Pro | $20 | [Provider] |
| Apple Developer | $99/year | [Provider] |
| Google Play | $25 one-time | [Provider] |
| Domain renewal | ~$18/year | **[Unverified]** |

### a) Playtest: as free as possible

Assumptions: 1–3 events with 4–8 friends, otherwise today's traffic.

| Item | Monthly | Yearly | Note |
|---|---|---|---|
| Render Free + **card added to the workspace** | $0 | $0 | A playtest event is ~7 matches ≈ 80 MB |
| Supabase Free | $0 | $0 | Check DB size first (§7) |
| Custom SMTP (Resend Free) | $0 | $0 | Needed only if players must confirm email or reset passwords |
| Vercel Hobby | $0 | $0 | A private playtest is non-commercial |
| Sentry, PostHog, UptimeRobot free | $0 | $0 | |
| Domain renewal | — | ~$18 | Due 2027-06 [Unverified price] |
| Apple Developer | — | $99 | Only if the playtest uses the iOS build (TestFlight); $0 for web only |
| **Total** | **$0** | **~$18–117** | |

### b) Soft launch: tournaments on, 3 events a day, a few hundred active users

Assumptions: ~300 monthly / ~100 daily actives; 3 events a day (≈ 21 matches) +
~20 other live matches a day ≈ **1,200 live matches/month**; ~100 completed Fritz
games a day.

| Item | Monthly | Note |
|---|---|---|
| Render Starter | ~$7 [Unverified] | Comfortable to ≈ 64 live matches [Measured] |
| Render bandwidth | ≈ $1.35 | 1,200 × 11.6 MB ≈ 14 GB, minus 5 GB included [Estimate] |
| Supabase Pro | $25 | Backups, no read-only cliff, real SMTP rate limits |
| Vercel Pro | $20 | Public launch = commercial |
| Resend Free | $0 | ~a few sign-ups a day, well under 100/day |
| Sentry Developer, PostHog free, UptimeRobot free | $0 | ~100 DAU × ~50 events × 30 ≈ 150k PostHog events |
| **Monthly** | **≈ $53** | With Standard instead of Starter: ≈ $71 |
| **Yearly** | **≈ $640** + Apple $99 + domain ~$18 = **≈ $760** (≈ $970 on Standard) | |

### c) Marketed launch: several thousand daily users

Assumptions, stated plainly: **5,000 DAU, 20,000 MAU**; 30% play a live match
each day (1.5 each) plus 6 tournament events a day ≈ **1,200 live matches/day ≈
36,000/month**, 20% of a day's matches in the peak hour → **≈ 60 concurrent
matches** at peak; **2 completed Fritz games per DAU per day**; 40 PostHog events
per DAU per day; ~200 sign-ups a day.

| Item | Monthly, today's code | Monthly, after the two storage fixes (§6) | Note |
|---|---|---|---|
| Render Standard (`1c-2g`) | ~$25 [Unverified] | ~$25 | 60 concurrent is well inside the measured ≥ 128 |
| Render bandwidth | **≈ $62** (36k × 11.6 MB ≈ 418 GB) | ≈ $5 (≈ 1 MB/match) | [Estimate] |
| Supabase Pro | $25 | $25 | |
| Supabase compute | ≈ $5–50 (Small or Medium) | ≈ $5 | ≈ 60 writes/s at peak from live matches [Estimate] |
| Supabase disk | **≈ $15–30/month by month 6, +$2–5 every further month** | ≈ $0–2 | Fritz `compositeLog` ≈ 260 KB per game × 10k games/day ≈ 2.6 GB/day of JSON; ~0.6–1.3 GB/day on disk [Estimate] |
| Supabase egress | likely ≤ 250 GB included | same | **Not measured**; watch the dashboard |
| Vercel Pro | $20 | $20 | SPA traffic ≈ 150 GB of the 1 TB included [Estimate] |
| Sentry Team | $26 | $26 | 5k errors/month is too tight at this volume |
| PostHog | **≈ $50–250** | ≈ $0–50 with sampling | 6M events/month; the upper bound uses only the first-tier price |
| Resend Pro | $20 | $20 | ~200 sign-ups/day > 100/day free |
| UptimeRobot | $0 (Solo $12 for faster checks, optional) | $0 | |
| **Monthly** | **≈ $250–510** | **≈ $125–180** | |
| **Yearly** | **≈ $3.0k–6.1k** + $99 + $25 one-time (Play) + ~$18 | **≈ $1.5k–2.2k** + the same | |

### Which costs move and which are flat

| Flat (a fixed price per month) | Scales with usage (can surprise you) |
|---|---|
| Render instance, Vercel seat, Supabase Pro base, Sentry Team base, Resend Pro base, Apple, domain | **Render bandwidth** (live matches × 11.6 MB today), **Supabase disk** (Fritz `compositeLog`, room logs), Supabase egress, MAU over 100k, compute size, **PostHog events**, Sentry pay-as-you-go if enabled, Vercel usage beyond the credit, Resend tier jumps |

Vercel Pro has a default **$200 on-demand budget** with notifications, and can
pause projects at 100% [Provider]. Supabase Pro has **spend caps on by
default** [Provider]: with the cap on, overages are blocked rather than billed.
Check what the cap blocks before relying on it at launch.

---

## 5. When each tier is outgrown, and the cheapest upgrade order

| Resource | Outgrown at | Based on |
|---|---|---|
| Render Free CPU | ≈ 4 concurrent live matches | [Measured] |
| Render Hobby bandwidth (5 GB) | ≈ 430 live matches/month, all modes (≈ 14 a day); 3 tournament events a day alone is ≈ 630 a month | [Measured] × [Provider] |
| Render Starter | ≈ 64 concurrent matches (CPU); RAM 512 MB caps near ≈ 250 | [Measured] |
| Render Standard | ≥ 128 concurrent matches (not saturated in the test) | [Measured] |
| Supabase Free DB (500 MB) | **Possibly within weeks of a soft launch**: per completed Fritz game ≈ 260 KB of JSON (current code); per live match ≈ 70–200 KB retained (`room_match_logs` median 5 KB, plus ≈ 110 `mp_authority_events` × 268 B and ≈ 110 `room_command_receipts` × 295 B); per 8-player tournament event ≈ 0.5–1.4 MB | [Read] row sizes × [Estimate] |
| Supabase Free auth email | The first sign-up wave (2 emails/hour) | [Provider] |
| Supabase Pro disk (8 GB) | ≈ 1–2 weeks at scenario (c) volumes with today's code | [Estimate] |
| Sentry Developer | ≈ 5,000 errors/month, or a second teammate | [Provider] |
| PostHog free | ≈ 800 DAU at 40 events/day | [Estimate] |
| Resend Free | 100 emails/day | [Provider] |

**Cheapest upgrade order** (cost → what it removes):

1. **Card on the Render workspace** ($0 + pennies of overage): removes the
   month-long bandwidth shutdown.
2. **Custom SMTP on Resend Free** ($0): removes the 2-emails-an-hour sign-up wall.
3. **Supabase Pro** ($25): backups, no read-only cliff at 500 MB, no pausing.
4. **Render Starter** (~$7): no sleeping, ≈ 16× the free CPU.
5. **Vercel Pro** ($20): commercial use allowed.
6. **Render Standard** (~$25 total, replacing Starter): marketed-launch headroom.
7. **Sentry Team** ($26), **Resend Pro** ($20), **PostHog paid**, **Supabase compute**:
   only when their own threshold (§7) fires.
8. **Apple** ($99/year) when the iOS build ships; **Google Play** ($25) if and when Android
   starts (plus the 14-day test).

---

## 6. Before marketing vs. wait for real usage

**Before marketing starts** (each is cheap compared with the failure it
prevents):

- Card on Render; Render **Standard**; Vercel **Pro**; Supabase **Pro**; custom SMTP
  (Resend, Free is enough until ~100 emails/day).
- A **PostHog billing limit**, so a traffic spike drops analytics instead of billing.
- **Two code fixes that change the bill more than any tier choice** (separate PRs,
  not tournament work):
  1. Stop re-uploading the whole room event log on every move
     (`server/src/multiplayer/roomLivePersistence.ts`). ≈ 95% of Render outbound
     traffic per match [Measured] (capacity doc §5.1).
  2. Cap or compact `completion_result.compositeLog.states` in
     `verified_single_player_matches` (≈ 260 KB per completed Fritz game, 144 full
     states; older rows reach 2.8 MB) [Read]. Keep only what the feature reading it
     needs, and add a retention window.

**Can wait for real usage:** Sentry Team, Resend Pro, PostHog paid, Supabase
compute above Micro, Render `2c-4g`, UptimeRobot Solo, Google Play.

---

## 7. Alert thresholds to set

| Service | Alert at | Where |
|---|---|---|
| Supabase DB size | **400 MB** on Free (80% of 500); on Pro, **80% of the current disk**, and on growth > 1 GB/day | Dashboard usage page. Spot check (read-only, SQL editor): `select pg_size_pretty(pg_database_size(current_database()));` and the top tables: `select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 10;` |
| Supabase egress | 4 GB (Free) / 200 GB (Pro) a month | Dashboard usage |
| Supabase MAU | 40,000 (Free) / 80,000 (Pro) | Dashboard usage |
| Supabase auth emails | Any "rate limit exceeded" in Auth logs | Auth logs |
| Render bandwidth | **4 GB** (80% of Hobby's 5 GB), then at every $10 of overage | Render billing / usage page |
| Render memory | RSS > 400 MB on a 512 MB instance; > 1.6 GB on 2 GB | Hourly `resource usage` log line (already emitted) + Render metrics |
| Render CPU / latency | Event-loop lag warnings > 10 an hour; any watchdog stall | Existing lag monitor → Sentry |
| Vercel | 50% / 80% / 100% of the spend budget (Pro default $200) | Vercel spend management |
| Sentry | 4,000 of 5,000 errors | Sentry usage alerts |
| PostHog | 800k events; billing limit at your chosen ceiling | PostHog billing |
| Resend | 80 emails a day (Free) | Resend dashboard |
| Domain | Auto-renew on; reminder 60 days before 2027-06-17 | Namecheap |
| Apple | Reminder 30 days before the membership renewal | Apple Developer account |

---

## 8. Sources (fetched 2026-10-04)

Loaded: supabase.com/pricing; supabase.com/docs/guides/platform/database-size;
…/compute-and-disk; …/manage-your-usage/disk-size;
supabase.com/docs/guides/auth/auth-smtp; vercel.com/docs/plans/hobby;
vercel.com/pricing; vercel.com/docs/limits/fair-use-guidelines;
render.com/docs/free; render.com/docs/compute-plans;
render.com/docs/outbound-bandwidth; sentry.io/pricing;
posthog.com/docs/product-analytics/pricing; posthog.com/docs/billing/limits-alerts;
uptimerobot.com/pricing; uptimerobot.com/terms;
developer.apple.com/support/enrollment;
support.google.com/googleplay/android-developer/answer/6112435 and /14151465;
resend.com/pricing.

**Not loaded:** render.com/pricing (instance and workspace plan prices; the
page body didn't render), namecheap.com (403), PostHog tiers above 2M events.
Every figure from these is marked [Unverified].

**Not readable without writing or an admin token:** Render bandwidth and
billing, Supabase database size, egress and plan (no management token), Vercel
usage (API is Pro-only), PostHog usage, whether Supabase custom SMTP or email
confirmation is enabled, Apple enrollment status.
