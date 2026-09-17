# Pre-Launch Hardening Inventory

Date: 2026-09-09
Scope: three questions asked before opening the doors —
1. **Rate limiting / abuse protection** on the auth and signup paths.
2. **Error alerting** — if production broke right now, would a human find out in real time?
3. **Cost-control gaps** — what could run up a bill (or exhaust a free-tier quota and go blind)?

Same discipline as `HARDENING_PLAN.md` / `FEATURE_COMPLETENESS_AUDIT.md` /
`REFACTOR_OPPORTUNITIES.md`: **read-only.** Nothing is fixed here. Every item is
either **closeable** (a concrete end state) or **explicitly deferred** (named, with
why it's out of scope for a pre-launch pass). Findings already tracked elsewhere
are cross-referenced, not re-derived — `HARDENING_PLAN.md` §6 (Auth / session /
rate limiting) is the deep prior work and most of §1 below is a status read of it.

**Infra baseline (verified live via `GET https://racehorse.onrender.com/ready`,
2026-09-09):** server on **Render free tier** — `0.1 CPU / 512 MB, single
instance, cannot horizontally scale, ≥1 restart/day` (`HARDENING_PLAN` T-18);
`nodeEnv: production`; Supabase (auth + Postgres); Sentry; PostHog; Vercel
(frontend). **No paid third-party APIs** — no LLM, image generation, payments,
email/SMS, search, or CDN-transform service anywhere in `server/src`. The cost
surface is small and mostly free-tier quotas, not a metered bill.

---

## 1. Rate limiting & abuse protection — auth and signup

### 1.1 There is no server-side signup or login endpoint

Auth is **entirely client → Supabase**. `client/src/auth/**` calls
`supabase.auth.signUp` / `signInWithPassword` / `resetPasswordForEmail` directly
against the Supabase Auth service; the game server never receives a password, a
signup, or a login. The server only ever *verifies* an already-issued bearer JWT
(`platform/auth/supabaseAuth.ts` `verifyBearerToken` → `GET /auth/v1/user`).

**Consequence:** signup/login abuse protection is **Supabase's**, configured in
the Supabase dashboard, not in this repo:
- Supabase Auth's built-in per-IP rate limits on `/signup`, `/token`, `/recover`,
  `/otp` (Supabase defaults; tunable per project).
- Email-confirmation on/off, and Supabase's own email send-rate cap.
- **CAPTCHA / bot-signup protection** — Supabase supports hCaptcha/Turnstile at
  the Auth level. **Not enabled** (there is no `captchaToken` passed anywhere in
  `client/src/auth/**`, and no `hcaptcha`/`turnstile`/`captcha` reference in the
  tree — grep-confirmed).

On every `auth.users` insert, the `on_auth_user_created` trigger
(`supabase/schema.sql:177`) runs `handle_new_user()` → one `public.profiles` row.
So **one signup = one `auth.users` row + one `profiles` row + (if email
confirmation is on) one Supabase-sent email.**

### 1.2 What a signup flood costs today

Closeable finding. A scripted signup flood (no CAPTCHA to stop it) would:
- burn **Supabase MAU** count (free tier: 50k MAU) and `auth.users` /
  `profiles` storage;
- burn **Supabase's transactional-email quota** if email confirmation is on
  (a flood of confirmation sends);
- **not** meaningfully pollute the ranked leaderboard — the global board filters
  `provisional=eq.false` and a fresh account is provisional; the fallback
  username namespace (`user_<id>`) is also filtered by the ladder queries.
- **not** hit the game server's rate limiters at all (they never see the signup).

**Done looks like:** a decision recorded on whether to enable Supabase Auth
CAPTCHA before launch (the cheapest single lever — it's a dashboard toggle +
passing `options.captchaToken` on the `client.auth.signUp` call in
`useAuth.ts:528`, ideally on the reset-password call too), and a note on the
current Supabase Auth rate-limit values (dashboard read — not visible from the
repo). If CAPTCHA is deemed unnecessary pre-launch, that's a legitimate
POSTURE call — record it, don't leave it unstated.

### 1.3 Server-side rate limiting — status read of `HARDENING_PLAN.md` §6

**§6 is DONE + PUSHED and deployed** (D-12 / D-13; `5e5931b3` 2026-09-03 + AU-3
correction 2026-09-04). Verified against current `main`:
`server/src/trustedProxy.ts` exists; `getUserIdFromAuthHeaderSync` is deleted;
`socialAuth` + `tournamentAuth` both call `verifyBearerToken`.

| §6 gap | What it was | Status |
|---|---|---|
| **AU-3** | No `trust proxy` → every IP-keyed limit bypassable via a spoofed `X-Forwarded-For` | **CLOSED** — range-based `trust proxy` (Cloudflare CIDRs + private ranges) + `requestIp()` prefers `CF-Connecting-IP` gated on `isTrustedInfraPeer` |
| **AU-4** | Per-user limits keyed on an *unsigned* JWT `sub` → bypassable by forging `sub` | **CLOSED** — `getUserIdFromAuthHeaderSync` deleted; the 4 endpoints (`account`-delete, daily-fritz init/submit, record-match) rekeyed on the real client IP |
| **AU-8** | Three divergent auth impls; B/C uncached → one upstream `/auth/v1/user` call per social/tournament/account request | **CLOSED** — B + C consolidated onto `verifyBearerToken` (cache + in-flight dedup + 12s timeout) |
| **AU-1** | Token revocation lag (signOut doesn't kill the access JWT; cache adds TTL on top) | **CLOSED** — cache TTL 60→15s; Supabase project JWT expiry lowered 3600→900s (human, dashboard) |
| **AU-6** | Admin-secret design (fail-closed today — `ADMIN_SECRET` unset in prod, confirmed live) | **PARTIAL** — server `?admin_key=` query acceptance removed; the rest is a **human checklist** (§1.4 below) |

### 1.4 Still open on the auth/rate-limit surface (from §6)

- **AU-6 human checklist — do before ever setting `ADMIN_SECRET` in prod.**
  `/ready` confirms `ADMIN_SECRET: false` today, so the entire admin surface
  (`/api/daily-fritz/{generate,invalidate,reset-attempt,metrics,health,events}`,
  `/api/ranking/process`, `/bot-matches/cleanup-stale`) is 401 for every caller.
  Before activating: one header transport for the POST endpoints (currently
  `req.body.adminKey`), drop the admin-UI `sessionStorage` persistence of the
  entered secret, generate ≥32 bytes of CSPRNG, and consider an IP allowlist for
  the integrity-affecting three (`reset-attempt`, `invalidate`, `ranking/process`)
  rather than public-internet reachability. **This is the one auth item that
  matters at launch** — the moment someone sets a weak `ADMIN_SECRET` to use the
  Daily Fritz admin tools, the brittle transport becomes live. `HARDENING_PLAN`
  §6.4 tracks it.
- **AU-2 / AU-5 — `REVISIT IF SCALE`, correct for launch.** The in-memory rate
  limiter (and cache A) reset on every deploy/restart (≥1/day), so a burst
  straddling a restart gets ~2× budget; socket rate-limit keys on the shared
  Render-proxy address before per-socket auth resolves. Both are immaterial at
  pre-launch concurrency (`connectedSockets: 0` live) and the real fix is a
  shared store (Redis/Upstash) — an upgrade-time change, same class as every
  other in-process structure on the free tier.
- **AU-7 — `ACCEPT`.** Recovery-token URL-fragment window; already well-mitigated
  (`detectSessionInUrl: false` + consume-then-clear). Improvement path (`flowType:
  'pkce'`) flagged for a later client-auth pass.
- **`InMemoryRateLimiter` has no size ceiling / no sweep** (`AU-INV-5`). Now that
  AU-3/AU-4 close the trivial spoofed-key floods, this is a slow leak, not a fast
  one — but it's the one piece of the rate-limit layer that is still
  unbounded-by-design. `REVISIT IF SCALE` (bundle with the shared-store move).

### 1.5 The `/api` catch-all now actually bounds things

Post-AU-3, `restApiLimit` (`/api` + `/bot-matches`, IP-keyed, 5min/600) is a real
limit again rather than advisory. That is the backstop that makes the "no
server-side signup endpoint to protect" situation acceptable — every *other*
authenticated call an abuser could make is bounded.

---

## 2. Error alerting — would anyone find out?

### 2.1 Capture is wired

- **Client:** `client/src/main.tsx` — `@sentry/react` `Sentry.init`, `enabled:
  import.meta.env.PROD && Boolean(VITE_SENTRY_DSN)`, `browserTracingIntegration`.
  **`VITE_SENTRY_DSN` is set in prod** — confirmed: the deployed bundle at
  `playracehorse.com` contains `dsn:"https://…@o4511656845312000.ingest.us.sentry.io/…"`.
- **Server:** `server/src/index.ts` — `@sentry/node` `Sentry.init`, `enabled:
  config.isProd && Boolean(config.sentryDsn)` (`SENTRY_DSN` env),
  `tracesSampleRate: 0.2`, `beforeSend: sentryBeforeSend` (PII scrubber, CC-5),
  `Sentry.setupExpressErrorHandler`, plus explicit `captureException` on
  `unhandledRejection` / `uncaughtException` and `captureMessage` at ~12 named
  call sites. **Confirmed (H5 dashboard check, 2026-09-09):** client and server
  send to **one shared Sentry project** (a `node-express` project) — the client
  `VITE_SENTRY_DSN` and the server `SENTRY_DSN` are the *same* DSN, so `SENTRY_DSN`
  is set on the Render service and server-side capture is live. There is **no
  second project**; every alert rule below covers both client and server events.

### 2.2 Capture ≠ notification — ~~the actual gap~~ CLOSED (H5, 2026-09-09)

Whether a captured event pages/emails/Slacks a human in real time is a Sentry
project setting (alert rules + a connected notification channel), which lives in
the Sentry dashboard, not this repo. **Done, verified in the dashboard:**

- `SENTRY_DSN` is set on the Render service (same DSN as the client — one shared
  `node-express` project; see §2.1).
- **Baseline issue-alert rule live:** fires when an issue is **new or regressed**,
  filtered to **level ≥ error**, notifying the **`#racehorse` team by email**,
  throttled to **once per 30 min** per issue.
- **Three tag-scoped rules live**, each routed **individually to the maintainer**
  (not the team alias) so an abuse/corruption signal is unmissable:
  `move_log_verification_failed_repeat`, `match_winner_conflict`,
  `invariant_violation` (the tags PRs #150/#151 attach).
- **Spike protection: ON.**
- Plan: **Developer (free)** — usage this cycle **23 / 5,000** events, **no
  payment method on file** (so the quota is a hard ceiling, not a spend risk;
  events past 5k/mo are dropped — the §3.1 `beforeSend` guard is what keeps a
  storm from getting there). Free-tier event quota is understood — see §3.1.

### 2.3 Code-level alerting gaps (these *are* in the repo)

Closeable findings, all from `HARDENING_PLAN.md`:

- **No per-user aggregation on the structured alerts.** The app raises targeted
  Sentry messages for specific conditions — `auth_timeout_stale_session`,
  `recovery_set_session_failed` (§6.1.7), `[daily-fritz] verification bypassed`
  (DF-G2), `[home:daily-summary] upstream timeout`, tournament
  `tournament_match_winner_conflict` (D-3), `dailyPuzzleGeneration.shouldAlert`
  — but they fire **per incident with no per-user context** (`HARDENING_PLAN`
  MP-G14 / DF-G2 residual, MP-INV-19). A serial abuser doctoring transcripts, or
  one account repeatedly hitting an authority mismatch, reads as a string of
  unrelated one-offs. **Done:** DF-G2's alert already got per-user escalation
  (`verification_bypassed_repeat` at ≥3/7d, `f717b851`) — the residual is
  applying the same pattern to the MP move-log-verification-failure alert and the
  tournament winner-conflict alert. **DONE — PR #150** (move-log alert per-user
  `warning`→`error`/`_repeat` at ≥3/7d; winner-conflict fingerprinted per match).
- ~~**No alert on generic tournament invariant violations** (`HARDENING_PLAN`
  T-15): double advancement, `winner_id` not a participant, "no target match for
  advancement" — detected only by reading logs after a player complains. There is
  a structured `warn`, but no notification.~~ **DONE — PR #150 (winner conflict)
  + PR #151** (`winner_not_participant`, `no_advance_target`,
  `advance_target_missing`, `double_advancement` — `Sentry.captureMessage`,
  `level: error`, fingerprinted per match, tag `tournament_alert`).
- **No alert on a Daily Fritz stranded-completed-set** — `DF-G1` shipped a boot
  sweep + reaper, so the strand *self-heals*, but a spike in strands (a sign of a
  cold-instance `/complete` failure rate) has no signal.
- **The `/ready` `dailyPuzzleGeneration.shouldAlert` path does `Sentry.captureMessage`**
  when the puzzle-generation horizon slips (`registerHealthRoutes.ts:187`) — good
  — but it only evaluates **when `/ready` is hit**. `/ready` is hit by the Render
  health check and the `/ping` keep-alive, so it *is* polled, but there's no
  independent scheduled check.

### 2.4 Not a gap

- Sentry PII scrubbing (`sentryScrubbers.ts` — `password` / `refresh_token` /
  `email` exact-match keys, CC-5) is in place and tested. The server never
  handles credentials anyway (§1.1).
- `beforeSend` is wired on both client and server.

---

## 3. Cost-control gaps

### 3.1 Sentry event quota — the real one

**Closeable finding.** `tracesSampleRate: 0.2` samples *performance* traces, but
**errors are captured at 100% with no client-side rate limit, no
`ignoreErrors` volume guard, and no dedup throttle.** A production error loop
(a component that throws every render, a hot server path that `captureException`s
on every request during a Supabase blip) will **exhaust the Sentry free-tier
event quota (5k errors/mo) in minutes** — and once the quota is gone, *every
subsequent real error is dropped*. That is the worst failure mode for topic 2:
an error storm both floods and then blinds.

~~**Done looks like:** a `beforeSend` (client and server) that drops or samples
past a per-minute threshold for a given fingerprint~~ **DONE — PR #149.**
`sentryVolumeGuard` (server + client, kept in sync): per-signature cap
(5/min, then heartbeat every 20th) and a global cap (20/min) inside `beforeSend`,
which now returns `null` past the caps. **Dashboard side also done (H5):** spike
protection is ON; the plan is Developer/free with no payment method on file, so
the 5k/mo quota is a hard drop-ceiling with no spend risk (23/5000 used this
cycle at check time). See `docs/ops/sentry-alerting-setup.md`.

### 3.2 Supabase — mostly closed by the §6 work

- The **DoS-amplification vector** (one API request → one upstream `/auth/v1/user`
  call, uncached on impls B/C) is **closed** by AU-8 consolidation.
- The **rate-limit-bypass amplification** (forge `sub` / spoof IP → unbounded
  verifier + Glicko-recompute + DB-scan load) is **closed** by AU-3/AU-4.
- **`/ready` is unauthenticated and runs a live Supabase latency probe on every
  hit** (`registerHealthRoutes.ts` `supabase` check). A `/ready` flood = Supabase
  read amplification. Low severity (one cheap probe query), but `/ready` is not
  behind any rate limiter — worth a `cronLimit`-style IP bound or a short cache
  on the probe result. **PARTLY DONE — PR #152:** probe abort 3s→2s +
  `circuitBreakable`, so a `/ready` flood against a slow/down Supabase collapses
  to fail-fast instead of 2s-per-hit. A dedicated IP bound on `/ready` itself is
  still **REVISIT** — minor.
- **`leaderboardLimit`** (60s/30, IP) now actually bounds the unbounded-scan
  leaderboard endpoints post-AU-3.
- Free-tier ceilings to watch at launch: 500 MB DB, 5 GB egress/mo, 50k MAU. No
  code lever for these — a dashboard-alert / usage-monitor decision.

### 3.3 Render — bounded by construction

Free tier, single instance, **no autoscaling** → the compute bill cannot run
away. The risk there is **availability** (OOM restart drops in-memory rooms;
0.1 CPU is marginal for socket.io — `HARDENING_PLAN` T-18, ACCEPTED RISK at
current scale), not cost. If/when upgraded to a paid always-on instance, it's a
fixed monthly price, still not metered-runaway.

### 3.4 PostHog — client analytics volume

`client/src/lib/analytics.ts` — `posthog-js`, lazy-loaded, `track()` called from
~dozens of sites (home, daily-fritz init `mode_impression`, etc.). No client-side
event throttle. Free tier is 1M events/mo. A real user generates maybe tens of
events per session; at pre-launch traffic this is nowhere near the ceiling, but
a bot loop hammering a screen that `track()`s on mount could burn it. **REVISIT
IF SCALE** — and PostHog has its own project-level billing limit / spike toggle.

### 3.5 GitHub Actions — bounded

`gen-puzzles.yml` (puzzle-pool generation, every 6h) and CI run on GitHub's
free minutes for a public repo (effectively unlimited). Not a cost concern.

### 3.6 The debug-ingest endpoints — no production cost

`VITE_DEBUG_DAILY_FRITZ` → two hardcoded `http://127.0.0.1:7933/ingest/<uuid>`
posts (`handLifecycleRules.ts`, `dailyFritz/api.ts`). One is
`import.meta.env.DEV`-only (statically eliminated); the other has an env escape
hatch. `FEATURE_COMPLETENESS_AUDIT` §5.6 already tracks confirming
`VITE_DEBUG_DAILY_FRITZ` is unset in prod (a `vercel env ls` check). Local
console noise only — **no production cost or data path.**

---

## 4. Summary — what to actually do before launch

**Must-do (cheap, and the exposure is real at launch):**
1. ~~**Sentry dashboard check** (§2.2 / §3.1) — DSN set on Render, one issue-alert
   rule to a watched channel, spike protection on, understand the 5k/mo error
   quota.~~ **DONE — H5 fully closed (2026-09-09).** Verified in the dashboard,
   not just written up: one shared `node-express` project (client + server, same
   DSN — so `SENTRY_DSN` *is* set on Render); baseline alert rule live (new/
   regressed issue, level ≥ error → `#racehorse` team email, 30-min throttle);
   three tag-scoped rules live routed to the maintainer individually
   (`move_log_verification_failed_repeat`, `match_winner_conflict`,
   `invariant_violation`); spike protection ON; Developer/free plan, 23/5000 this
   cycle, no payment method on file. Steps recorded in
   `docs/ops/sentry-alerting-setup.md` (commit `4f0ccec7`).
2. **Decide on Supabase Auth CAPTCHA** (§1.2) — enable it (dashboard toggle + a
   `captchaToken` on the `signUp` call) or record the POSTURE decision not to.
   **Deferred by maintainer decision — out of scope for this pass.**
3. **Do not set `ADMIN_SECRET` until the AU-6 checklist is done** (§1.4). It's
   fail-closed now; keep it that way until the transport is hardened. **Unchanged.**

**Should-do (code, small):**
4. ~~`beforeSend` volume guard on Sentry (§3.1) — return `null` past a per-minute
   per-fingerprint threshold, client and server.~~ **DONE — PR #149.** Shared
   `sentryVolumeGuard` (per-signature + global per-minute caps, heartbeat sampling)
   wired into `beforeSend` on server and — new — client.
5. ~~Per-user aggregation on the MP move-log-verification and tournament
   winner-conflict alerts (§2.3), mirroring DF-G2's `f717b851`.~~ **DONE — PR #150.**
   Move-log alert now escalates `warning`→`error` + `_repeat` tag past a per-user
   7-day threshold; winner-conflict alert fingerprinted per match.
6. ~~An IP bound or short cache on `/ready`'s Supabase probe (§3.2).~~ **DONE — PR #152.**
   Probe abort tightened 3s→2s and marked `circuitBreakable` so a slow/down
   Supabase costs one timeout, not one per Render poll.

**Also done this pass:** T-15 tournament invariant alerting (§2.3) — winner
conflict in PR #150; `winner_not_participant` / `no_advance_target` /
`advance_target_missing` / `double_advancement` in **PR #151**. All fingerprinted
per match, `level: error`, tag `tournament_alert`.

**Deferred, correctly (`REVISIT IF SCALE` / upgrade-time):** AU-2, AU-5,
`InMemoryRateLimiter` ceiling, the shared-store move for all in-process state,
PostHog throttle, T-18 (0.1-CPU instance).

**Already closed and verified:** AU-3, AU-4, AU-8, AU-1 — the rate-limit layer
bounds a deliberate actor again, and the auth path no longer amplifies a Supabase
outage. This inventory found **no live authz break and no runaway-cost path**.

---

**Update (2026-09-09) — §4 closed except CAPTCHA.**
- **Item 1 (Sentry dashboard):** DONE — H5 fully closed. Alert rules, tag-scoped
  routing, spike protection, and plan/quota all verified live in the dashboard
  (see §2.2). One shared Sentry project for client + server, not two.
- **Items 4, 5, 6:** shipped as PRs #149, #150, #152.
- **T-15 alerting gap:** closed via #150 + #151.
- **Item 2 (CAPTCHA):** deferred by maintainer decision.
- **Item 3 (`ADMIN_SECRET`):** unchanged — stays fail-closed until the AU-6
  checklist is done.

Nothing in this document is now blocking launch: error alerting is wired and
verified, and the one open item (CAPTCHA) is a recorded decision, not a gap.
