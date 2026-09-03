# Racehorse Hardening Plan

A persistent, cross-session plan to bring the tournament and multiplayer systems
up to a standard comparable to how chess.com or Miniclip (8 Ball Pool) would run
them — scoped realistically to a solo founder + AI-agent team, pre-marketing.

**This document is the source of truth.** Any agent or person picking this up
cold should read the "How to use this document" section, then the "Current
focus" line, then the section for the system in progress.

---

## Current focus

**As of 2026-09-03:**

- **System 1 (Tournament) → CLOSED.** Steps 1–5 complete; residual accepted-risk / cosmetic items only (T-10, T-13–T-15, T-18, T-19 — see §1.7).
- **System 2 (Multiplayer rooms) → fully passed through, Tiers A–E.** Steps 1–5 done. **Tier A + Tier B gaps CLOSED + LIVE in prod:** MP-G1/MP-G2 (room-table schema + grant lockdown), MP-G3 (spectate room-kind gate + auth), MP-G4 (game-over side-effect idempotency), MP-G6 (`room_command_receipts` + `mp_authority_events` applied). MP-INV-6 + MP-INV-15 proven by the §2.6 harness. **Tiers C/D/E verified 2026-09-02 (§2.3.3), all REVISIT-IF-SCALE / ACCEPT** — nothing escalated; MP-G12 moved C→E (fix already shipped). Remaining System-2 work is all deferred-until-scale (§2.3 Tier C/D) + the §2.6.4 harness passes for the not-yet-covered invariants.
- **Cross-cutting security sweep (§ before "# System 1") → done.** `fritz_challenge_*` / daily-fritz command RPC anon-execute gap (8th drift instance) — `2026-09-02_fritz_challenge_rpc_lockdown.sql` applied to prod, all 10 functions verified locked. `handle_new_user` + posture (b)/(c)/(d) all confirmed safe/closed. Residual: extend `assert_security_posture()` to check `SECURITY DEFINER` views (coverage, nothing to find); 3 fritz functions have grant lockdown but body guards deferred (low-priority defence-in-depth); the `gauntlet_*` client RPCs still carry the advisory (by-design, scrapped feature).
- **System 3 (Daily modes) → CLOSED 2026-09-02.** Active modes: **Daily Fritz +
  Puzzle Rush**. Steps 1–3 done; §3.2 DM-INV-1..18 + §3.3 DF-G1..DF-G5 RATIFIED
  (D-10). **Shipped (pushed `f717b851`, CI green):**
  - **DF-CAND-1 — Daily Puzzle Ladder decommissioned.** `/api/daily-puzzle/*`
    routes + nightly warm job + `/daily` client routes removed; Home no longer
    fetches the ladder. `supabase/migrations/2026-09-02_daily_puzzle_ladder_decommission.sql`
    drops the `insert_own`/`update_own` policies + revokes client write grants
    (tables kept `public` read-only for `socialProfile.ts` /
    `homeCompletionDates.ts`). pg16-verified. **Migration NOT yet applied to
    prod DB — human runs it.**
  - **DF-G1 — stranded-set reaper.** `recoverStrandedDailyFritzAttempts`
    (`server/src/dailyFritzStrandedRecovery.ts`): boot sweep 20 s after listen +
    15-min reaper, wired in `index.ts`; finalizes `status='started'` attempts
    with a complete set older than 30 min via the shared
    `applyDailyFritzAttemptFinalization` (extracted from `/complete`). Mirrors
    `recoverTournamentMatches`; never promotes a `rejected` run (DM-INV-11).
    **Open: confirm live after the next Render deploy** (a `daily-fritz-recovery`
    boot-sweep log line, or a `recovery_succeeded`/`recovery_failed` event).
  - **DF-G2 — streak filter + per-user alert.** `getDailyFritzStreak` filters
    through `isDailyFritzAttemptStreakEligible` (drops `rejected` /
    `unverified_hands`, keeps `legacy_unverified`); the existing
    `verification_bypassed` Sentry alert gains per-user aggregation
    (`countRecentDailyFritzVerificationFailures` → `warning`→`error` at ≥3/7d).
    Verification stays non-blocking for `status='completed'` (D-10 POSTURE).
  - **Corrections from a Step-3 code trace (recorded with D-10, §3.2 header):**
    DF-G1's "async re-verification lost on restart" was based on **dead code**
    (`scheduleDailyFritzRecordGameVerification`, zero callers); DF-G2's "no
    alert" was wrong (the alert already existed).
  - **Parked, not integrity work:** DF-G3 / DF-G4 (REVISIT IF SCALE), DF-G5
    (ACCEPT), DF-CAND-1b (delete dead `route:'daily'` Home branches +
    `client/src/dailyPuzzle/**`), DF-CAND-3 / DF-CAND-4 (legacy
    `daily_puzzle_scores*` tables; stale `admin@example.com` policy on
    `daily_puzzles`).

- **Plan restructured 2026-09-03 (D-11).** The old "System 4: Everything else"
  catch-all is dissolved into leverage-ordered **Systems 5–13** (scaffolds
  written; each starts at its own Step 1 when reached). Latent/dev-only surfaces
  → the Appendix. Ordering rationale + the full inventory are in D-11 + the
  System 5–13 scope blocks. See **"Continuing this plan"** at the end of this
  file — it is written for a fresh session with no prior context.

- **System 5 (Legacy League) → CLOSED 2026-09-03 (decommissioned).** Confirmed
  dead: no `league_*` writes since April 2026, zero client HTTP/socket emitters,
  legacy handlers already gated off (`ENABLE_LEGACY_TOURNAMENTS` default false),
  no cross-system dependency on `finalizeTournamentMatchHook`, no external FK
  into the tables. **Removed:** `registerLeagueRoutes` + `registerLegacyTournamentHandlers`
  + the hook + rate-limit mounts; `server/src/league/**` (7 files) +
  `server/src/legacyTournament/**` (2) + `http/routes/league.ts`; the wasted
  `gameOverPersistence.ts` live-fixture query (a DB round-trip per game-over);
  `config.enableLegacyTournaments`; `supabase/league.sql`. **Migration**
  `2026-09-03_legacy_league_decommission.sql` — **DROPs** all 6 `league_*` tables
  (not archived — zero remaining readers, unlike the Ladder). pg16-verified.
  Suite green (server 1188, client 1482); server lint 233→217 problems.
  `roomKind.ts`'s inert `legacy_league` classification is parked. **Pending
  human: apply the migration.**

- **System 6 (Auth / session + rate limiting) → Step 1 audit written (§6.1)
  2026-09-03, awaiting human review.** Maps **three divergent server auth impls**
  (`supabaseAuth.ts` cached / `socialAuth.ts` uncached / `tournamentAuth.ts`
  uncached — all hitting `/auth/v1/user`); cache **A**'s **≤60 s revocation lag**
  (a `signOut` doesn't revoke the access-token JWT at all); the **signature-
  unverified sync JWT decode** (`getUserIdFromAuthHeaderSync`) used for rate-limit
  keys → forged `sub` bypasses per-user limits on record-match / account-delete /
  daily-fritz; **`ADMIN_SECRET` is unset in prod** (`/ready` confirms) → all admin
  endpoints fail-closed today, but the design is a single static secret with
  `?admin_key=` query transport on 3 GETs + `localStorage` in the admin UI;
  `InMemoryRateLimiter` with **no eviction ceiling** + **no `trust proxy`** →
  every IP-keyed limit bypassable via `X-Forwarded-For`; socket auth is per-action
  not per-connection. `e2eDevAuth` confirmed dead in prod (two gates). CORS allows
  **any `*.vercel.app`**. `/ready` discloses env-presence + load telemetry + the
  release SHA. **8 windows AU-1..AU-8** parked for Step 2 ranking. No fixes.
  **Stop — await human review of §6.1 before Step 2.**

- **System 6 Step 2 (§6.2 invariants + §6.3 gap list) — CANDIDATE, written
  2026-09-03, awaiting sign-off (→ D-13).** **AU-INV-1..8**; **AU-1..AU-8**
  risk-ranked. **FIX NOW:** **AU-3 + AU-4** — no `trust proxy` + a
  signature-unverified JWT `sub` used as a rate-limit key means **the entire
  rate-limit layer is bypassable by anyone reading the (public) source** —
  including account-deletion abuse and Daily-Fritz-verifier load amplification on
  a 0.1-CPU box; fix is `app.set('trust proxy', 1)` + `requestIp → req.ip` +
  drop the unverified key (~1 day). **AU-8** — consolidate the two uncached auth
  impls (`socialAuth`, `tournamentAuth`) onto the cached one (`supabaseAuth`):
  removes a per-request `/auth/v1/user` round-trip on the most-polled routes and
  is the prerequisite for any AU-1 fix. **POSTURE:** **AU-1** (revocation lag —
  cut cache TTL 60→15 s now; Supabase JWT-expiry setting + a denylist are
  human-action / scale-gated; `signOut` doesn't revoke the JWT at all) and
  **AU-6** (`ADMIN_SECRET` is unset → admin surface fail-closed today; a concrete
  "before you ever set it" checklist — starting with deleting server-side
  `?admin_key=` query-param acceptance). **REVISIT IF SCALE:** AU-5, AU-2.
  **ACCEPT:** AU-7. No fixes yet. **Stop — await human sign-off on §6.2 / §6.3
  before Step 3.**

- **System 2 Step 1** (§2.1): audit written. 10 subsections — topology-as-fact
  (§2.1.1), in-memory `Room` + 4 backing tables (§2.1.2), state writes (§2.1.3),
  seat/identity binding (§2.1.4), concurrency windows MP-1..MP-8 (§2.1.5),
  game-over/forfeit sequence (§2.1.6), authz map (§2.1.7), recovery (§2.1.8),
  move-log verification (§2.1.9), prior art (§2.1.10). **SIGNED OFF 2026-09-01**
  — human ratified §2.1 content, `pg_policies` confirmed against prod, and the
  RPC EXECUTE-grant sweep it surfaced is fixed in prod + repo.

- **System 2 Step 2** (§2.2 + §2.3): **SIGNED OFF 2026-09-01 (Decisions D-9).**
  MP-INV-1..19 + MP-G1..MP-G17 RATIFIED as written (incl. the §2.3.2
  verification-pass verdict changes). Residual notes in D-9: MP-INV-2
  guest-reconnect gap (→ MP-G13), MP-INV-19 is a posture decision not a hard
  invariant (→ MP-G14).

- **System 2 Steps 3 + 4** (§2.4 / §2.5, Tier-A scope: MP-G1, MP-G3, MP-G4;
  MP-G2 folded into MP-G1): **IMPLEMENTED 2026-09-01 (§2.4.6).** MP-G3 —
  `registerRoomSpectateHandlers.ts` now requires auth (`auth_required`) and
  gates on `roomKind` (`not_spectatable` for private rooms unless
  `config.spectatable`); failed-lookup limiter untouched. MP-G4 — every
  game-over side-effect sink idempotent on `sourceMatchId`: `appendMatch`
  (stable id + dedup), `recordPublicOnlineMatch` (`resolution=ignore-duplicates`
  + `matches_room_match_id_uidx`), `writeMatchActivity`/`writeForfeitActivity`
  (`activity_feed.dedupe_key` + unique index), `recordMatchEnd` (conditional
  PATCH `status=eq.in_progress` — first-terminal-wins, also fixes the
  matchmaking half of MP-G5). Two migrations
  (`2026-09-01_room_tables_schema_and_grant_lockdown.sql`,
  `2026-09-01_gameover_sideeffect_idempotency.sql`) **applied to prod
  2026-09-01 and verified** — posture advisory cleared for both room tables,
  anon write → grant-layer `42501`, both idempotency indexes built clean.
  **MP-G1 / MP-G2 / MP-G4 CLOSED.** Code pushed + **deployed to Render
  2026-09-01 (prod release `907435df`, `/ready` confirmed).** **MP-G3 verified
  live in prod** — unauthenticated `room:spectate` → `auth_required`;
  authenticated `room:spectate` on a private room → `not_spectatable`
  (smoke-tested, throwaway room, cleaned up). **MP-G3 CLOSED.**
  `tsc -b` clean; full server suite 204 files / 1173 tests pass; new
  idempotency + spectate-gate unit tests; server lint no new problems.
  Deferred as designed: the retry-from-step-1 structure, the private-room
  `room_match_logs` first-terminal latch (MP-G5, Tier C).

- **System 2 MP-G6 (Tier B)** — **CLOSED + LIVE 2026-09-01.**
  `room_command_receipts` and `mp_authority_events` were confirmed absent from
  prod (5th/6th drift instance);
  `2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql` applied
  (human, SQL editor). Verified read-only: `to_regclass` non-NULL for all 3
  objects; service_role GET `200 */0` (was `PGRST205`); RLS on (posture clean,
  advisory_count unchanged); anon GET/INSERT `401 42501`; service_role INSERT
  round-trip works. No deploy needed — the server code already targeted these
  tables and was degrading silently. **Every Tier-A and Tier-B gap in System 2
  is now closed + live.**

- **System 2 Step 5 (§2.6)** — **FIRST PASS DONE 2026-09-01.** `mpInvariantHarness.test.ts`
  (13 tests) + `mpSideEffectStore.testkit.ts` (in-memory port of the MP-G4
  unique indexes + `recordMatchEnd` conditional PATCH) prove **MP-INV-6**
  (spectate gating) and **MP-INV-15** (idempotent game-over side-effects) —
  including the real `persistGameOverOnce` retry loop re-running steps 4/5/6 and
  still writing each sink once — plus a focused MP-INV-1..3 base check. Full
  server suite **205 files / 1186 tests**; `tsc -b` clean (server + client);
  server lint no new problems. No pg16 script needed (§2.6.3 — no real-row-lock
  claim in MP-INV-1..19; the one DB-level MP-G4 guarantee was already verified
  against real Postgres). Remaining invariants (MP-INV-7/8/10/11/13/16/17/18/19)
  get harness passes as their tiers open (§2.6.4). **System 2: Steps 1–5 done
  for the Tier-A/B scope.**

- **System 2 Tiers C/D/E — verification pass 2026-09-02 (§2.3.3).** Traced every
  Tier C/D/E gap against the code, read-only. **Nothing escalates to Tier A/B.**
  Corrections: **MP-G12 C→E** — the audit was wrong, `game:rematch` already
  `await`s the game-over persist promise (`waitForActiveGameOverPersist`), the
  recommended fix is shipped. **MP-G7** — real for the *abandon* case; the
  freshness fence catches a resurrected game-over row but not an abandon one
  (record corrected; verdict Tier C holds). **MP-G10** confidence low-med→low
  (couldn't construct a failure). MP-G5 + MP-G14 now have live telemetry
  (MP-G6). MP-G8/G11/G13/G15/G16/G17 confirmed as classified. Highest-value
  Tier-C to do early: **MP-G13** (auth-bypass class, narrow) + a per-room attach
  lock (also closes MP-G10 / MP-G11 residuals).

- **Deploy state note (2026-09-02):** all session work is pushed to
  `origin/main` (HEAD `6a89418f`). **Prod runs `907435df`** for the app server
  (Render did not auto-deploy the doc/test/migration commits since — no
  server-code difference; MP-G3/MP-G4 code is the last real deploy). The
  security migrations (MP-G6, fritz RPC lockdown) were applied directly in the
  SQL editor and are live. Prod ≠ `origin/main` HEAD but is functionally
  current.

- **Cross-cutting security sweep (2026-09-02) — 1 confirmed gap, FIXED + LIVE.**
  See the "Cross-cutting security follow-up sweep" block above §"# System 1".
  **10 `SECURITY DEFINER` command RPCs were anon-executable in prod** (8 Fritz
  Challenge + `commit_daily_fritz_attempt_command` / `start_daily_fritz_attempt_command`
  — Daily Fritz, live); no internal `auth.uid()` check; the `revoke … from
  public, authenticated` in the repo never applied (8th drift instance). Anon
  could hijack an open challenge's opponent / overwrite a victim's attempt
  result & scores. Tamper audit: **no evidence of exploitation** (Fritz
  Challenge dormant — 17 all-`open` challenges, 9 never-advanced attempts).
  **`2026-09-02_fritz_challenge_rpc_lockdown.sql` APPLIED TO PROD 2026-09-02 —
  CLOSED + LIVE:** all 10 anon-probe `42501 permission denied` (was `200`);
  authenticated `42501`; service_role normal (app unaffected); `assert_security_posture()`
  no longer flags any of the 10. PART A grant-locked all 10; PART B added a
  `_assert_fritz_rpc_server_only()` body guard to 7; 3 body guards deferred as
  low-priority defence-in-depth. The other follow-ups (`handle_new_user`,
  posture b/c/d) all **safe/closed** — posture (d) directly confirmed (all 7
  `public` views are `security_invoker=true`, no `SECURITY DEFINER` view).

- **Step 1** (current-state audit): COMPLETE — §1.1, §1.3.
- **Step 2** (invariants): RATIFIED — T-INV-1..10 (D-3); T-INV-6 reworded +
  re-ratified to feeder-gating (D-6, code merged PR #94).
- **Step 3** (state machine / concurrency design): COMPLETE 2026-08-31. All
  sub-tasks written, reviewed, and merged (PRs #93 / #95):
  - Match state machine — states, transitions T-a..T-h, per-actor triggers,
    RPC rejection rules, near-simultaneous-caller lock walkthrough (§1.4.2)
  - RPC surface = **three functions** `complete_tournament_match` /
    `promote_tournament_match` / `generate_tournament_bracket` + helpers
    (§1.4.3, D-5)
  - PR #91 assessed against the design (§1.4.1)
  - Authz layer shape — `authorizeMatchParticipant()` + ack/status mappers in
    `tournamentAuth.ts` (§1.4.5)
  - Reconciler multi-instance = **singleton via `TOURNAMENT_SCHEDULER_ENABLED`
    boot flag** (§1.4.6, D-7); advisory-lock rejected (PostgREST has no
    holdable session — reason preserved).
- **Step 4** (refactor): IN PROGRESS. Sub-tasks (§1.5.2):
  - PR #91 line-by-line review vs the ratified design (§1.5.1) — **DONE**. Zero
    conflicts.
  - **PR-A** — three RPCs + helpers (§1.4.3) — **MERGED PR #97 (2026-08-31)**.
    Closes T-2, T-3, T-4, T-7, T-8, T-9. Verified on local pg16 + full suite.
  - **PR-B** — authz layer `authorizeMatchParticipant()` (§1.4.5) — **MERGED
    PR #98 (2026-09-01)**. Closes T-5, T-6. `isTournamentRoomCode` moved to a
    leaf module.
  - **PR-C** — `TOURNAMENT_SCHEDULER_ENABLED` boot flag (D-7) — **MERGED
    PR #99 (2026-09-01)**. Closes T-16.
  - **T-11** — `fetchActiveAssignedMatchForUser` selection — **DONE / downgraded**
    (PR #101, 2026-09-01). Analysis showed PR-A/PR-B already neutralized the
    data-integrity concern (see §1.3 T-11); the small residual hardening
    (`humanJoinedAt` top sort key + warn on multi-match) shipped.
  - **T-12** — collapse the two "tournament room" concepts — **DONE**
    (PR #102 / PR-D, 2026-09-01). One `roomKind()` classifier; loud
    non-widening comment on the game-over branch; rematch-in-tournament-room
    hole closed as a flagged behavior change.
  - RLS migration #9 → **T-1 CLOSED** (verified in prod 2026-08-31).
- **Step 5** (tests prove closure): IN PROGRESS — scoped into PR-E/F/G.
  - **PR-E** — `assertBracketConsistent` helper — **MERGED PR #103**.
  - **PR-F** — concurrency + recovery harness (in-memory port, CI) — **MERGED
    PR #104 (2026-09-01)**. Redundant producers 1–3 (quiet + loud D-3 paths),
    "RPC committed / Node crashed before dispatch" → recovery re-dispatches,
    reconciler survives `advance_target_missing`, cold-wake catch-up identical
    across 3 processing orders. **Scope: Node orchestration, NOT DB
    serialization** — that's PR-G.
  - **PR-G** — local-only pg16 script — **MERGED PR #106 (2026-09-01)**.
    `scripts/tournament-db-verify.sh` (hermetic throwaway pg16): greenfield
    apply of the curated migration chain, two-session `FOR UPDATE`
    serialization (guards T-3/T-4), RLS registrations diagnostics,
    `assert_security_posture()` plant-a-violation. Plus
    `supabase/tests/rls_registrations_lockdown.sql` + `docs/ops/tournament-db-verify.md`.
    Not CI (no pg service / no migration runner).
  **The tournament system (System 1) is closed.**

**Infra / liveness — settled 2026-08-31.** T-17 CLOSED (UptimeRobot re-typed
ICMP→HTTP on `/ping` @ 5 min + `SERVER_URL` set; both verified). T-18 + T-19 =
ACCEPTED RISK at current scale, revisit at paid-tier upgrade. D-4 = external
monitor, free tier. `/internal/tick` not built.

**RLS / config hardening — 2026-09-01.** A Supabase advisor flagged a public
table with RLS disabled. Confirmed the project is ours via local env files;
did not use the email link. **Initial scope assessment was wrong** — the first
probe conflated "a client role holds a write grant" with "a client role can
write"; on RLS-enabled tables (the large majority) RLS is the real gate, and a
spot check confirmed anon writes to them are rejected. **Actual issue: 4
tables with RLS not enabled** — `bot_match_pending`, `ghost_games`,
`ghost_profiles` (lockdown SQL for these already existed in
`2026-08-11_authoritative_ranking_and_bot_pending.sql` and `supabase/ghost.sql`
but had never been applied to prod), plus `ranked_games_backup_bugfix` (an
undocumented one-off backup from an April rating-bug investigation — 8 rows,
one dev account, no code references; exported to `~/racehorse-security-backups/`
then dropped). The advisor sweep also flagged `commit_glicko_game_update`
(SECURITY DEFINER with a mutable `search_path`, EXECUTE granted to client
roles). A data-integrity check across `profiles` / `ranked_games` /
`rating_periods` found **no evidence of misuse** — the only rating anomalies
trace to the known April bug on one dev account. **Fixes**
(`supabase/migrations/2026-09-01_ghost_bot_pending_rls_lockdown.sql`,
`..._commit_glicko_rpc_lockdown.sql`, both self-asserting): enable RLS +
deny-all on `bot_match_pending`; RLS + own-row select on the ghost tables;
revoke client write grants; drop the backup table; pin the RPC `search_path`
and restrict its EXECUTE to `service_role`. Applied via the SQL editor and
verified before/after. **Pattern: this is the third reviewed, correct
migration found sitting unapplied** (T-1 registrations lockdown, these RLS
tables, this RPC). Root cause: no CI migration runner, no schema-posture
check. **Follow-up (built this session):** `assert_security_posture()`
service-role RPC + a weekly GitHub Actions cron that hard-fails if any
`public` table has RLS off or any SECURITY DEFINER function has a mutable
`search_path`, with advisory-only reporting for client-callable RPC judgment
calls.

**RPC EXECUTE-grant sweep — 2026-09-01. RESOLVED — fixed in prod + repo.**
While closing out the System 2 Step 1 follow-up the human asked for an urgent
check of the admin-only content-lifecycle RPCs. Triaged
`assert_security_posture()` ADVISORY 2 (`securitydefiner_client_executable`,
~35 functions). Most are legitimately client-facing (`gauntlet_start_attempt`,
`gauntlet_submit_round`, `commit_daily_fritz_attempt_command`, the `project_*` /
`*_is_immutable` trigger functions, …). **Four are admin-only and must not be
client-callable:**

| RPC | What it does | Prod state before the fix |
|---|---|---|
| `publish_daily_fritz_challenge(text,date,int,int,int,int,int,int,int,int,text,int,text,text,jsonb,timestamptz)` | publishes a Daily Fritz challenge | **CONFIRMED `anon` = true** — live, real exposure |
| `invalidate_daily_fritz_challenge(date,text)` | invalidates a published Daily Fritz day | **CONFIRMED `anon` = true** — live, real exposure |
| `gauntlet_publish_day(date,text,jsonb,jsonb,timestamptz)` | publishes a Gauntlet day | client-executable — **preventive** (see below) |
| `gauntlet_close_day(date)` | closes a Gauntlet day | client-executable — **preventive** (see below) |

**The Daily Fritz finding was a live gap in a shipped feature, not
hypothetical.** `2026-08-01_daily_fritz_published_challenges.sql` revoked
EXECUTE from `public` and `authenticated` only — it **omitted `anon`**, and
Supabase grants EXECUTE on new public functions to `anon` explicitly, so
`revoke … from public` never removed it. An anonymous `POST
/rest/v1/rpc/publish_daily_fritz_challenge` (or `…/invalidate_…`) could publish
or invalidate a Daily Fritz day out of schedule. Neither function has any
body-internal auth check — protection is grant-only. **No evidence it was
exploited** (Daily Fritz publications all trace to the server's scheduled
publisher; content is content-addressed + `on conflict do nothing`, so a
replay of the real package is a no-op and a *different* package raises
`daily_fritz_challenge_identity_conflict`). Still, the window was real.

**Gauntlet mode is scrapped / in-progress** — not shipped, no multiplayer
connection, no `pg_cron`, no server caller. `gauntlet_publish_day` /
`gauntlet_close_day` had no lockdown migration ever written; locking them down
now is **preventive**, so they don't ship exposed if the feature is revived.

**Fix (human, SQL editor, 2026-09-01) — same revoke/grant pattern for all
four:**

```sql
revoke all on function public.<fn>(<sig>) from public, anon, authenticated;
grant  execute on function public.<fn>(<sig>) to service_role;
```

**Verified in prod** with `has_function_privilege` for all four × {anon,
authenticated, service_role} → `anon = false`, `authenticated = false`,
`service_role = true` across the board (table in the changelog entry).

**Repo sync:** `supabase/migrations/2026-09-01_content_lifecycle_rpc_execute_lockdown.sql`
— self-asserting, carries all four real signatures, notes that it
supersedes/corrects the `anon`-omission in
`2026-08-01_daily_fritz_published_challenges.sql` and that the fix is **already
live in prod** (brings the repo in sync; idempotent if re-applied). This is the
**4th** reviewed-SQL-drift instance — root cause is still "no CI migration
runner".

No body guard was added (matching the codebase's grant-based pattern for these
RPCs); a `service_role`-claim check + `set search_path` in the bodies remains
optional defence-in-depth for a later pass.

**Deferred to a later Daily-modes (System 3) pass — raised by the human
2026-09-01, NOT today's problem, logged so they are not lost:**

1. **`fritz_challenge_*` REST / grant contradiction** — a REST-exposure vs
   EXECUTE/table-grant mismatch on the `fritz_challenge` surface, spotted in the
   human's SQL-editor session. Not yet investigated by the agent.
2. **`handle_new_user()` body review** — `SECURITY DEFINER`, client-executable
   per ADVISORY 2, and explicitly marked `pending review` in the
   `2026-09-01_assert_security_posture_rpc.sql` comment. Read the body; confirm
   it can only touch the newly-created auth user's own `profiles` row and cannot
   be driven to create or overwrite an arbitrary profile.
3. **`assert_security_posture()` follow-up queries b / c / d** — (b) RLS-disabled
   / policy-present edge cases; (c) the full mutable-`search_path` list on
   `SECURITY DEFINER` functions; (d) **`SECURITY DEFINER` views** — views run
   with the definer's rights and bypass RLS, and the current posture RPC does
   **not** check for them at all. Extend the RPC to cover (d) or run the query
   manually.

**Cross-cutting security follow-up sweep — 2026-09-02 (read-only investigation;
nothing fixed).** The three items above investigated. Verdicts:

**(1) `handle_new_user()` — CONFIRMED SAFE.** Source:
`supabase/migrations/2026-08-26_signup_profile_username_from_metadata.sql`
(also in `supabase/schema.sql`). Wired as `after insert on auth.users for each
row` (trigger `on_auth_user_created`). Body does exactly one write —
`insert into public.profiles (id, username) values (new.id, <desired-or-fallback>)
on conflict (id) do nothing` — **id is always the trigger `NEW.id`, there is no
parameter, nothing forgeable**, and `on conflict do nothing` means it can never
overwrite an existing profile. The username-collision check is a read
(`select 1 from profiles where username = …`), no cross-row write.
`set search_path = public` — pinned, not a (c) issue. **Not client-callable:**
it `returns trigger`, so PostgREST does not expose it (`/rpc/handle_new_user`
absent from the OpenAPI spec; a direct `POST /rest/v1/rpc/handle_new_user` →
`PGRST202` for anon *and* service_role) and Postgres refuses a direct
`SELECT handle_new_user()` (`0A000 trigger functions can only be called as
triggers`). A client cannot insert into `auth.users` to fire it with a forged
id. The `assert_security_posture()` ADVISORY-2 flag on it is a **false positive**
of the "EXECUTE-to-PUBLIC by default" heuristic — add it to
`intentional_client_rpcs` (or `revoke execute … from public, anon, authenticated`
for tidiness). Same reasoning clears the other trigger functions in that
advisory list (`assert_fritz_challenge_attempt_invite`,
`fritz_challenge_contract_is_immutable`, `project_*` — all `returns trigger`,
all `PGRST202`).

**(2) `fritz_challenge_*` RPC grants — CONFIRMED GAP (auth-bypass,
competitive-integrity). 7th drift instance.** The earlier "PGRST202 / not
exposed" reading was a **wrong-shape call** — the functions ARE exposed. Real
state, confirmed by live anon probes against prod:

| Function (all `SECURITY DEFINER`, all in `supabase/fritz_challenges.sql` or `2026-08-02_fritz_challenge_authority_primitives.sql` with `revoke … from public, authenticated` **that never reached prod**) | `anon` call | `authenticated` call |
|---|---|---|
| `claim_fritz_challenge_opponent(uuid, uuid)` | **executes** (`[] 200`) | `42501 permission denied` (403) |
| `advance_fritz_challenge_hand(uuid,int,int,jsonb,int,int,int,int)` | **executes** | (assumed same) |
| `start_fritz_challenge_attempt(uuid, uuid)` | **executes** | — |
| `record_fritz_challenge_game(…)` | **executes** | — |
| `get_or_create_fritz_challenge_hand(uuid,int,int,jsonb)` | **executes** (hits an FK error → past the grant check) | — |
| `create_fritz_challenge_invite(…)` | **executes** (hits `recipient_not_friend` business check) | — |
| `commit_fritz_challenge_attempt_command(…)` | **executes** (`{"outcome":"rejected","error_code":"attempt_not_found"}`) | — |
| `start_fritz_challenge_attempt_command(…)` | **executes** (`challenge_not_found`) | — |

- **`anon` has EXECUTE, `authenticated` does not** — a logged-*out* request can
  do what a logged-*in* one cannot. Backwards ACL; the vector is specifically
  the public anon key.
- **None of these functions has an `auth.uid()` check** — they trust their
  `p_user_id` / `p_attempt_id` / `p_challenge_id` params. (Contrast:
  `gauntlet_start_attempt` → anon gets `P0001 "Authentication required"` — the
  gauntlet RPCs *do* guard internally. The fritz ones do not.)
- **Concrete unauthenticated writes** (SECURITY DEFINER ⇒ bypasses the table's
  RLS): `claim_fritz_challenge_opponent('<open challenge id>', '<any uuid>')` →
  `UPDATE fritz_challenges SET opponent_user_id = <attacker's pick>,
  status='active'` — hijack who plays an open challenge.
  `advance_fritz_challenge_hand` / `record_fritz_challenge_game` /
  `commit_fritz_challenge_attempt_command` with a victim's `attempt_id`
  (+ `user_id`) → overwrite/forge that attempt's `result`, scores, verified
  hand/game receipts.
- **Also confirmed anon-callable (2026-09-02 follow-up probe):**
  `commit_daily_fritz_attempt_command(21 params)` and
  `start_daily_fritz_attempt_command` — anon → `200` + business error
  (`unsupported_command` / `challenge_unavailable`), not `42501`. The
  `2026-08-01_daily_fritz_transactional_commands.sql` revokes never applied
  either. **Daily Fritz is an actively-used, leaderboard feature** — an anon
  with a victim's matched `p_user_id` + `p_attempt_id` can forge Daily Fritz
  attempt state / scores. So the gap is **10 functions**, spanning a dormant
  feature (Fritz Challenge) *and* a live one (Daily Fritz).
- **Mitigant:** needs a target UUID out-of-band — `fritz_challenges` and
  `fritz_challenge_attempts` **deny anon reads** (RLS, `*/0`), so ids are not
  enumerable; challenge ids travel in share links. **Tamper audit run
  2026-09-02 (service-role read): NO evidence of exploitation.**
  `fritz_challenges` = 17 rows, **all `status='open'`**, zero ever `active`/
  `completed` (⇒ `claim_fritz_challenge_opponent` has never flipped a challenge
  in prod). `fritz_challenge_attempts` = 9 rows, **all `status='started'` at
  game 1 / hand 0, `final_score` all NULL**, one dev account, nothing since
  2026-08-03 (⇒ `advance_*` / `record_*` / `commit_*` have never mutated a real
  attempt). The vulnerable write paths have zero history.
- **Fix — `2026-09-02_fritz_challenge_rpc_lockdown.sql` — APPLIED TO PROD
  2026-09-02, CLOSED + LIVE.** Human ran it in the SQL editor ("Success. No rows
  returned" ⇒ self-assert passed). Agent verified read-only:
  - **Anon probe, all 10 functions → `HTTP 401 / 42501 permission denied for
    function` (was `200` before).** Every one: `claim_fritz_challenge_opponent`,
    `advance_fritz_challenge_hand`, `start_fritz_challenge_attempt`,
    `record_fritz_challenge_game`, `get_or_create_fritz_challenge_hand`,
    `create_fritz_challenge_invite`, `commit_fritz_challenge_attempt_command`,
    `start_fritz_challenge_attempt_command`, `commit_daily_fritz_attempt_command`,
    `start_daily_fritz_attempt_command`.
  - **Authenticated** spot-check (throwaway JWT) on
    `claim_fritz_challenge_opponent` + `start_daily_fritz_attempt_command` →
    `403 / 42501 permission denied for function`.
  - **service_role** spot-check on 4 (`claim_fritz_challenge_opponent`,
    `advance_fritz_challenge_hand`, `commit_daily_fritz_attempt_command`,
    `start_fritz_challenge_attempt_command`) → `200` with normal business logic
    (`[]` / `unsupported_command` / `challenge_not_found`), **no permission
    error** — the app server keeps working, and the PART-B
    `_assert_fritz_rpc_server_only()` guard correctly passes for service_role.
  - `assert_security_posture()` → `hard_fail_count: 0`; **NONE of the 10 (nor
    `_assert_fritz_rpc_server_only`) still flagged `securitydefiner_client_executable`**
    (they were, before) ⇒ the `has_function_privilege`-equivalent check confirms
    anon + authenticated have no EXECUTE on all 10. `advisory_count` dropped
    76→60 across this session's fixes.
  - **Still flagged (separate, lower-priority):** the `gauntlet_*` client-facing
    RPCs (client→Supabase-RPC design, internal `Authentication required` guards,
    scrapped feature) and the `returns trigger` false positives
    (`handle_new_user`, `*_is_immutable`, `project_*`).
  - **PART A** — `revoke all … from public, anon, authenticated` +
    `grant execute … to service_role` for **all 10** (`to_regprocedure` guard →
    skips any not present). This closes the gap at the grant layer for both
    features.
  - **PART B** — a `_assert_fritz_rpc_server_only()` helper
    (`raise` unless `auth.role()` is `service_role` or NULL/internal) called as
    the first statement of the **7** whose full body lives in a single repo
    source (the 5 `fritz_challenges.sql` fns + the 2
    `2026-08-02_fritz_challenge_authority_primitives.sql` command RPCs), body
    reproduced verbatim. Durable belt for a future grant re-drift (service_role
    bypasses grants). These are server-only (only
    `server/src/http/stores/fritzChallenge{Store,CommandStore}.ts` call them,
    via the service-role key — zero client callers).
  - **Deferred body guards** (the grant lockdown is LIVE, so the gap is closed;
    these are pure defence-in-depth against a future grant re-drift, low
    priority): `create_fritz_challenge_invite` (body is prod-only, not in the
    repo); `commit_daily_fritz_attempt_command` + `start_daily_fritz_attempt_command`
    (`commit_*` redefined across 3 migrations — latest `2026-08-19` — needs the
    exact current body diffed from prod). The `_assert_fritz_rpc_server_only()`
    guard applies unchanged when done.
  - Self-asserting; pg16-verified before apply; **prod-verified after apply
    (above)**. 8th drift instance fixed.

**(3) posture follow-up queries b / c / d:**
- **(b) — no gap.** `assert_security_posture()` HARD FAIL 1 iterates every
  `public` table for RLS-disabled and returns `hard_fail_count: 0` /
  `hard_fails: []`. RLS is ON for every `public` table ⇒ there are **no inert
  policies on RLS-disabled `public` tables**. (Non-`public` schemas are outside
  the RPC's scope — a full-cluster `pg_policies ⋈ pg_class` check would need the
  SQL editor, low priority.)
- **(c) — no gap.** HARD FAIL 2 is exactly the mutable-`search_path` check on
  `SECURITY DEFINER` functions; `hard_fails: []` ⇒ **zero `SECURITY DEFINER`
  functions in `public` have a mutable `search_path`.** (Every function read
  this session had `set search_path = public`.) Definitive for `public`.
- **(d) — FULLY CLOSED (2026-09-02), directly confirmed.** The human ran
  `select c.relname, c.reloptions from pg_class c join pg_namespace n on
  n.oid=c.relnamespace where n.nspname='public' and c.relkind='v';` →
  **exactly 7 views, every one `reloptions = ["security_invoker=true"]`:**
  `daily_fritz_{funnel,failure,retention,event}_metrics`,
  `fritz_challenge_{funnel,failure}_metrics`, `mp_authority_funnel_metrics`.
  **There is no `SECURITY DEFINER` view in `public`.** (Belt: same 7 are the
  only views in the PostgREST OpenAPI spec, and live probe = anon 401 /
  authenticated 403 / service_role 200 on all — no client can `SELECT` any view
  anyway.) The posture RPC not checking for `SECURITY DEFINER` views remains a
  *coverage* gap in the RPC — worth adding a check — but there is nothing for it
  to find today.

**Net:** **1 confirmed gap** (**item 2 — fritz/daily-fritz command RPCs
anon-executable, auth-bypass; 10 functions**) → `2026-09-02_fritz_challenge_rpc_lockdown.sql`
**APPLIED TO PROD 2026-09-02 — CLOSED + LIVE.** All 10 anon-probe `42501` (was
`200`); authenticated `42501`; service_role normal; posture no longer flags any
of the 10. PART A grant-locked all 10; PART B body-guarded 7; 3 body guards
deferred as low-priority defence-in-depth. **4 confirmed safe/closed:**
`handle_new_user`, posture (b), posture
(c), posture (d) (the last **directly confirmed** 2026-09-02 — all 7 `public`
views are `security_invoker=true`, no `SECURITY DEFINER` view exists). Residual:
extend `assert_security_posture()` to *check* for `SECURITY DEFINER` views
(coverage gap, nothing to find now).

**Resolved — the long-standing uncommitted working-tree pile is gone.** A
share-card / Puzzle-Rush-dossier redesign had sat uncommitted across several
sessions; on 2026-09-01 it was committed to `feat/share-card-dossier-redesign`
→ draft PR #100, then **closed and the branch deleted** (16 files, no design
review, mixed scope, CI red). Not pursued. The one salvageable idea — Wordle-
style emoji share text — may be redone later as a single tested file; no ticket
for it, noted here only.

**⚠ UNREVIEWED RISK — PR #91 was merged early, out of sequence.** The human
merged #91 (`e4760058`) before Step 4's review happened. What is now live on
`main`:
- an **app-level** compare-and-set, `persistence.completeMatchIfNotCompleted`
  (`?status=neq.completed` conditional PATCH), used by `applyMatchResult`;
- an inline participant check in `applyMatchResult`
  (`winner_not_match_participant`);
- inline participant checks in `roomForfeit` and `roomSocketAttach`
  (`room:join`);
- the registrations RLS lockdown migration.
This CAS has **not** been checked against the now-ratified Postgres-RPC
decision (D-2) or T-INV-1..10. Assessment of whether it conflicts with /
duplicates / is superseded by the RPC is in **§1.4.1** (done before Step 3
state-machine work, per the human's instruction).

---

## How to use this document

### Sequencing (do not reorder)

Audit-first, one system at a time. **The next system to work is the first below
that is not CLOSED.** Systems 5–13 are scaffolds only (D-11) — each starts at its
own Step 1 when work reaches it. There is no System 4.

1. **Tournament** ← **CLOSED** (Steps 1–5)
2. **Multiplayer rooms** ← **passed through Tiers A–E**; Tier-A/B fixed + live, C/D/E deferred-until-scale
3. **Daily modes** (active: Daily Fritz + Puzzle Rush) ← **CLOSED 2026-09-02** — D-10 ratified, DF-CAND-1 decommissioned + DF-G1/DF-G2 shipped (`f717b851`); DF-G3/G4 REVISIT-IF-SCALE, DF-G5 ACCEPT. *Pending human: apply `2026-09-02_daily_puzzle_ladder_decommission.sql`.*
4. *(dissolved — see 5–13, D-11)*
5. **Legacy League / Legacy Tournament** ← **CLOSED 2026-09-03 (decommissioned)** — confirmed dead in prod, server code + 6 `league_*` tables removed (`2026-09-03_legacy_league_decommission.sql`). *Pending human: apply the migration.*
6. **Auth / session + rate limiting** (cross-cutting) ← **Step 1 RATIFIED (D-12); Step 2 (§6.2/§6.3) CANDIDATE 2026-09-03**, awaiting sign-off (D-13) before Step 3. FIX-NOW: AU-3/AU-4 (rate-limit bypass) + AU-8 (consolidate auth impls); POSTURE: AU-1, AU-6
7. **`@racehorse/game-core`** — shared score oracle ← scaffold
8. **Ranking / Glicko-2** (cross-cutting) ← scaffold
9. **Match runtime layer** (`modules/` + `match/` + server rooms/realtime) ← scaffold
10. **Individual game modes** (Ghost, Bot, Fritz Challenge, Matchmaking, No Brainer) ← scaffold
11. **Social / stats / account** ← scaffold
12. **Progression & learning** (Journey, Learn, Analyzer — client-only, light-touch) ← scaffold
13. **Remaining cross-cutting / infra** (un-audited RLS, admin endpoints, telemetry, deploy posture) ← scaffold

**Do not start refactoring a system until its audit (steps 1–3 below) is written
down and its invariants are ratified with the human.** We never fix based on
vibes or memory. **Latent/dev-only surfaces** are in the Appendix, not this list.

### Per-system structure

Each system section contains, in order:

1. **Current-state map** — every place state is read/written, every authz check
   (present or missing), every concurrency window, every recovery/reconnect
   path. Read-only investigation. No fixes.
2. **Invariants** — the small set of things that must always be true, written
   explicitly. Marked `RATIFIED` (agreed with human) or `CANDIDATE` (proposed,
   not yet agreed).
3. **Gap list** — ranked by risk: `data-corruption` > `player-visible-bug` >
   `cosmetic`. Each gap tied to a specific file/function, not a vague area.
4. **State machine / concurrency design** — the explicit model the system should
   follow: states, transitions, who may trigger each, how races are prevented.
5. **Refactor plan** — concrete steps to close each gap: funnel mutations
   through one guarded path, add version/CAS guards, extract authz into one
   layer.
6. **Test plan** — the concurrency/chaos tests and invariant assertions that
   *prove* a gap is closed.
7. **Checklist** — every item above as a `- [ ]` line, so progress is visible
   and resumable.

### Rules for this document

- **One step per session. Stop after each numbered step and wait for the
  human's explicit go-ahead before starting the next.** This applies even when
  the next step looks obvious or mechanical. The human needs to actually read
  and respond between steps — do not chain "Step N" and "Step N+1" in the same
  session. "Numbered step" means the items under a system's checklist (Step 1
  audit, Step 2 invariants, Step 3 design, Step 4 refactor, Step 5 tests) and
  any explicitly numbered sub-task the human hands you.
- **Every checked-off item must reference the commit/PR or test that closed it.**
  Format: `- [x] … — closed by <PR #123 / commit abc1234 / test file:name>`.
- **Nothing is marked done without a passing test for the invariant it
  protects.** "Looks fixed" is not done.
- Keep the **Current focus** line at the top accurate at all times.
- Log every non-obvious decision in the **Decisions log** at the bottom
  (`D-n`), with the reasoning, so it is not silently reversed later.
- When a section's investigation reveals the scope was wrong, say so in Current
  focus and adjust — don't quietly expand.

---

# System 1: Tournament (scheduled-tournament engine)

Scope: `server/src/scheduledTournament/**` and its integration points in
`server/src/multiplayer/**` and `server/src/realtime/gameOverPersistence.ts`.
The 8-player single-elimination bracket that runs on a fixed 30-minute cadence.

> Not in scope for this section: the **legacy** round-robin "league" tournament
> (`server/src/tournament/tournament.ts`, `server/src/legacyTournament/`,
> `server/src/http/routes/league.ts`). It is a separate socketId-based system.
> Deferred to **System 5** (Legacy League decommission — looks dead in prod).
> Flagged here only so a future agent does not confuse the two — `types.ts` even
> carries a comment about it.

## 1.1 Current-state map

### 1.1.1 Data model (Supabase / Postgres)

Three tables (`2026-05-14_scheduled_tournaments.sql` + later migrations):

| Table | Key columns | Notes |
|---|---|---|
| `scheduled_tournaments` | `status` (check: upcoming/registration_open/in_progress/completed/cancelled), `scheduled_start` (**unique**), `registration_open_at`, `registration_close_at`, `win_target`, `max_players`, `winner_id` | Status is a plain text column with a CHECK. No `version`/`updated_at`. |
| `scheduled_tournament_registrations` | `status` (registered/withdrawn/eliminated/active/winner), `seed`, `placement`, **`unique (tournament_id, user_id)`** | `seed` and `placement` are server-authored but see Gap T-1. |
| `scheduled_tournament_matches` | `round` (1–3), `match_number`, `player1_id`, `player2_id`, `winner_id`, `status` (waiting/ready/in_progress/completed/bye), `room_code`, `ready_at`, `ready_deadline_at`, `started_at`, `completed_at`, `player{1,2}_joined_at`, `player{1,2}_score`, `winner_source`, `status_reason`, `forfeit_user_id`, `no_show_user_id`, `bot_tier`. **`unique (tournament_id, round, match_number)`** | No `version` column. No CHECK that `winner_id ∈ {player1_id, player2_id}`. No partial-unique guaranteeing one active match per user. |

Indexes exist for the hot paths (`idx_stm_ready`, `idx_stm_ready_deadline`,
`idx_stm_players`, `idx_str_*`).

**RLS:**
- `scheduled_tournaments`: `st_select_all` (select true). No client write policy → writes are service-role only. OK.
- `scheduled_tournament_matches`: `stm_select_all` (select true). No client write policy → service-role only. OK.
- `scheduled_tournament_registrations`: `str_select_all` (select true) **+ `str_insert_self` (`insert with check auth.uid() = user_id`) + `str_update_self` (`update using/with check auth.uid() = user_id`)**. See Gap T-1.

### 1.1.2 All state writes (who writes what, from where)

Every write goes through `persistence.ts` helpers, which are thin wrappers over
`supabaseFetch` (PostgREST) using the **service-role key**. There are **no
transactions** — every helper is a single `POST`/`PATCH`/`DELETE`.

| Write helper (`persistence.ts`) | Mutates | Called from |
|---|---|---|
| `updateTournamentStatus(id, status, {winner_id?})` | `scheduled_tournaments.status`, `.winner_id` | `engine.generateBracket` (→in_progress), `completeTournament` (→completed), `cancelTournament`, `openRegistration`, `closeRegistrationAndStart` |
| `insertRegistration(tid, uid)` | new registration row | `routes.ts` POST /register, `socketHandlers.ts` tournament:register |
| `withdrawRegistration(tid, uid)` | DELETE registration row | `routes.ts` DELETE /register, `socketHandlers.ts` tournament:withdraw |
| `updateRegistrationStatus(tid, uid, status, seed?)` | `registrations.status`, `.seed` | `engine.generateBracket` (all → active + seed), `applyMatchResult` (loser → eliminated), `completeTournament` (winner → winner) |
| `updateRegistrationPlacement(tid, uid, placement)` | `registrations.placement` | `engine.persistTournamentPlacements` (on tournament completion) |
| `insertMatch({...})` | new match row | `engine.generateBracket` only (7 rows: 4 QF + 2 SF + 1 F) |
| `updateMatch(matchId, patch)` | any of ~18 match columns | **many** — see below |

**`updateMatch` call sites** (this is the crux):

| Caller | Purpose | Guard before write |
|---|---|---|
| `engine.applyMatchResult` | mark `completed` + winner + scores; then a **second** `updateMatch` to advance winner into next round | `if (match.status === 'completed') return;` — a **read-then-write** check, not atomic |
| `engine.reconcileExpiredReadyMatches` | promote `ready`→`in_progress` when room is live; extend `ready_deadline_at`; (then calls `applyMatchResult` for no-show) | `status === 'ready'` read; room existence check |
| `matchDispatch.dispatchTournamentMatch` | set `room_code`, `ready`, `ready_at`, `ready_deadline_at` | `alreadyReady` read-then-write |
| `matchDispatch.promoteScheduledMatchToInProgress` | `ready`→`in_progress`, `started_at` | `status === 'completed'/'bye'/'in_progress'` read |
| `registerTournamentAttachHandlers` (multiplayer) | `player{1,2}_joined_at` on attach | `if (!humanJoinedAt(match, uid))` read |
| `roomForfeit.applyActiveMatchForfeit` (multiplayer) | calls `applyMatchResult` with `winnerSource:'forfeit'` | see Gap T-4 |
| `recovery.recoverTournamentMatches` | re-dispatch (→ `dispatchTournamentMatch`) | status/room checks |

### 1.1.3 Producers that can complete the same match (the race)

`applyMatchResult` (directly or via `applyTournamentGameOverFromRoom`) can be
entered for one match id from **five** independent producers:

1. **Real game over** — `roomSession.broadcastStateUpdate` → `onGameOver`
   scheduler → `gameOverPersistence.persistGameOverOnce` →
   `applyTournamentGameOverFromRoom` → `applyMatchResult`. Deferred, retried up
   to 4×.
2. **Forfeit on leave** — `multiplayer/roomForfeit.ts` → `applyMatchResult`
   (`winnerSource:'forfeit'`), retried up to 4×.
3. **No-show reconciler** — `engine.reconcileExpiredReadyMatches` (scheduler
   tick, every 30 s) → `applyMatchResult` (`winnerSource:'no_show'`).
4. **Bot-vs-bot auto-resolve** — `engine.resolveBotOnlyMatch` (from scheduler
   tick, `dispatchScheduledStartMatches`, `reconcileExpiredReadyMatches`,
   `applyMatchResult`'s own advancement tail) → `applyMatchResult`.
5. **Bye walkover** — `engine.generateBracket` → `applyMatchResult`
   (`byeWalkover:true`). One-shot at bracket generation.

Producers 1–3 can genuinely overlap for the *same* match in the same instant
(e.g. a player rage-quits at the score screen right as the no-show timer
fires and the opponent's game-over write lands). Producer 4 recurses through
`applyMatchResult`'s advancement tail on every completion.

### 1.1.4 Bracket advancement is a multi-statement, non-atomic sequence

`applyMatchResult` (engine.ts ~450–551) performs, with no transaction:

1. `updateMatch(match.id, { status:'completed', winner_id, scores, … })`
2. `updateRegistrationStatus(loserId, 'eliminated')` (if human loser)
3. emit `tournament:match_completed` to both players
4. `emitRoundCompletedIfNeeded` (reads all matches)
5. if round 3 → `completeTournament` (placements + status + activity + emit) **and return**
6. else: compute `advanceSlot`, re-fetch all matches, find target, `updateMatch(target.id, { player{1|2}_id: winnerId, status, bot_tier })`
7. re-fetch target, emit `tournament:match_updated`
8. if target now `ready` → `dispatchTournamentMatch(target)` → possibly `resolveBotOnlyMatch(target)` (recursion)

A crash or a second overlapping call between any two steps leaves partial state.
Observed symptom already in logs: `"no target match for advancement"` warn
(step 6 target missing).

### 1.1.5 Authorization checks (present / missing)

| Path | Identity source | Check present | Gap |
|---|---|---|---|
| REST `/api/tournaments/*` | `requireAuthUserId` → validates Bearer token against `/auth/v1/user` | `register`/`unregister` also call `rejectMismatchedPayloadUserId` | reads (`/me`, `/my`, `/history`, `/:id/bracket`, `/:id/result`) — `/me` and `/my` require auth; `/:id/bracket`, `/:id/result`, `/upcoming`, `/:id` are **public** (acceptable — bracket data is public, but bracket includes usernames + ratings) |
| Socket `tournament:register` / `:withdraw` / `:get_bracket` | `getSocketUserId(socket)` (verified `socket.data.userId`) + `rejectMismatchedPayloadUserId` | present for register/withdraw; `get_bracket` unauthenticated (public) | — |
| Socket `tournament:attach_assigned_match` | `handlerDeps.normalizeUserId(socket.data.userId)` | **checks `match.player1_id === uid || match.player2_id === uid`** ✔ | none — this path is correctly gated |
| Socket `room:join` for a tournament room | `socket.data.userId` | **NONE on `main`** — a tournament room code is derivable from the public bracket (`makeTournamentRoomCode` = pure fn of tournament id + round + match number), so an unassigned client can guess it and take the empty seat | **Gap T-3** (PR #91 adds a check; unmerged, pre-audit) |
| `roomForfeit.applyActiveMatchForfeit` | `handlerDeps.normalizeUserId(abandoningPlayer.userId ?? socket.data.userId)` | **on `main`: none** — `winnerUserId = match.player1_id === uid ? player2 : player1`, so a `null`/guest/non-participant leaver forfeits the match *to player1* | **Gap T-4** (PR #91 adds a check; unmerged, pre-audit) |
| `applyMatchResult` `params.winnerId` | caller-supplied | **on `main`: none** — `winner_id` is written verbatim; if it is not a participant, the loser lookup yields `null`, nobody is eliminated, and a stranger advances | **Gap T-2** (PR #91 adds a check; unmerged, pre-audit) |
| Registration rows (direct Supabase write from browser) | anon key + user JWT | RLS `str_insert_self` / `str_update_self` allow the user to INSERT/UPDATE **their own** registration row, including `seed`, `status`, `placement` | **Gap T-1** (PR #91's migration locks this down; unmerged, pre-audit) |

### 1.1.6 Recovery / reconnect paths

| Trigger | Path | What it does |
|---|---|---|
| Server boot (+2 s) | `index.bootstrapScheduledTournamentInfrastructure` → `recovery.recoverTournamentMatches` | For each `in_progress` tournament in its active window: re-`dispatchTournamentMatch` for `ready` matches; recreate room for `in_progress` matches whose room is gone |
| Scheduler tick (30 s) | `scheduler.ts` `tick` → `dispatchScheduledStartMatches` + `reconcileExpiredReadyMatches` | Dispatch waiting matches past `scheduled_start`; promote/extend/no-show-resolve expired `ready` matches; auto-resolve bot-only pairs |
| Client reconnect | `GET /api/tournaments/me` → `fetchActiveAssignedMatchForUser` | Returns the user's current `ready`/`in_progress` assigned match + room code so the client can re-attach via `tournament:attach_assigned_match` |
| Room gone on attach | `registerTournamentAttachHandlers` → `dispatchTournamentMatch({reason:'repair'})` | Rehydrates the reserved room from the match row, up to 2 retries in the handler |
| Game-over match id lost after restart | `applyTournamentGameOverFromRoom` → `findTournamentMatchByRoom(room.code)` | Falls back to resolving the match by `room_code` when `room.scheduledTournamentMatchId` is not in memory |
| In-memory `scheduledTournamentMatchId` not persisted | `room:join` (PR #91) → `isTournamentRoomCode(code)` shape check → `fetchMatchByRoomCode` | Recognises a tournament room after a restart even though the marker field is gone |

`ready_deadline_at` and `ready_at` are **DB-persisted**, so the no-show timer
survives restarts (deliberate — see `scheduler.ts` comment). But the reconciler
loop is **single-instance only** — `scheduler.ts` and `engine.ts` both carry
explicit comments: *"before multi-instance scale, this must move behind a DB
lease/lock."* Render currently runs one instance.

### 1.1.7 Idempotency infrastructure that already exists elsewhere (reusable prior art)

- `ranking/insertRankedGameIdempotent.ts` + `2026-06-17_ranked_games_source_idempotency.sql` — `ON CONFLICT (player_id, source_match_id) DO NOTHING`, `Prefer: resolution=ignore-duplicates`, empty response ⇒ duplicate.
- `2026-08-01_room_command_receipts.sql` — a command-receipt table for idempotent room command handling.
- PR #91's `completeMatchIfNotCompleted` — a `status=neq.completed` conditional PATCH; the same compare-and-set idea, not yet generalised.

## 1.2 Invariants

Status: **RATIFIED 2026-08-31** (Decisions D-3). T-INV-1..10 below are the
agreed invariant set for the tournament system. Changes from here require a new
dated Decisions-log entry.

**Concurrency mechanism (locked — Decisions D-2):** match completion and bracket
advancement run inside **one Postgres transaction function (RPC)**, not
application-level version/CAS and not an in-process serialized funnel. The
invariants below are therefore written as **obligations of that function**: what
it must read, validate, and write inside a single transaction, and what it must
reject. "The RPC" below means this function.

Each invariant states: the rule, the mechanism that must enforce it, and (where
relevant) the RPC behaviour on violation.

### Match lifecycle

**T-INV-1 — Completion is atomic and terminal.**
A match reaches `completed` at most once. In the same transaction that sets
`status='completed'`, the RPC also sets `winner_id`, `winner_source`,
`player1_score`, `player2_score`, `completed_at`, and `status_reason`. After a
match is `completed`, none of those columns ever change again.
*Enforced by:* the RPC does all of it in one transaction; a `BEFORE UPDATE`
trigger (or the RPC's own guard) rejects any write that mutates a row already
in `completed`. DB CHECK: `completed` rows must have non-null `winner_id`,
`winner_source`, `completed_at`.

**T-INV-2 — The winner is a real participant.**
For a non-`bye` match, `player1_id` and `player2_id` are both non-null at
completion, and `winner_id ∈ {player1_id, player2_id}`.
*Enforced by:* the RPC validates its `winner_id` argument against the locked
match row and `RAISE EXCEPTION` (does not write) if it fails. DB CHECK on the
table as a backstop: `status <> 'completed' OR winner_id IS NULL OR winner_id IN (player1_id, player2_id)`.

**T-INV-3 — Idempotent + conflict-explicit.**
Re-calling the RPC for an already-`completed` match is **not** an error:
- same `winner_id` as recorded → success no-op, returns the existing result.
- different `winner_id` → returns the **recorded** result with a
  `conflict=true` flag; makes **no** write; the caller logs and surfaces the
  recorded outcome. (Producers 1 and 2 retry up to 4× and producers 1–3 can
  collide — the RPC is the single arbiter and later callers accept its answer.)
*Enforced by:* the RPC reads the locked row first and branches before any write.
*Observability (D-3):* whenever the `conflict=true` branch fires, the Node
caller emits **one structured log line** at `warn` — a fixed, greppable event
name (e.g. `tournament_match_winner_conflict`) with `{matchId, tournamentId,
recordedWinnerId, attemptedWinnerId, attemptedSource}`. Not a player-facing
error; we are not blocking on it. A genuine winner disagreement should be
impossible if T-INV-2 and the state machine are correct, so this line existing
in production logs is the signal that something in the design was missed.

**T-INV-4 — Scores are consistent with the outcome.**
`player1_score` and `player2_score` are both ≥ 0. The winner's score ≥ the
loser's score. For `no_show` / `forfeit` / `bot_simulated` completions the
winner's score = the tournament `win_target` and the loser's = 0.
*Enforced by:* RPC computes the score pair itself from `(winner_id,
winner_source, win_target, reported_scores)` rather than trusting the caller
for the derived cases; CHECK constraint for the ≥ 0 part.

### Bracket advancement

**T-INV-5 — Exactly one advancement per completed match.**
Completing a non-`bye`, non-final match performs **exactly one** write that
places `winner_id` into **exactly one** slot (`player1_id` or `player2_id`,
per `advanceSlot`) of **exactly one** next-round match, in the **same
transaction** as the completion. Re-running the RPC for that match never
advances again (follows from T-INV-3).
*Enforced by:* advancement is code inside the RPC, after the completion write,
before `COMMIT`. The target-slot write is conditional (`WHERE <slot> IS NULL OR <slot> = winner_id`)
so a repeat is a no-op, not a double-fill.

**T-INV-6 — Feeder gating.** *(reworded + re-ratified 2026-08-31, Decisions D-6.)*
A round-*N* match enters `ready`/`in_progress` only after **both of its feeder
matches** (round *N*−1, match numbers `2M−1` and `2M`) are `completed` or `bye`.
This is bracket-exact — SF1 (fed by QF1+QF2) may start while QF3/QF4 still play.
*Enforced by:* structurally — `complete_tournament_match`'s advancement step
sets the target to `ready` only when *both* its slots are filled, which happens
exactly when both feeders have completed. `promote_tournament_match` needs no
separate previous-round check. Bot-only auto-simulation uses the same
two-feeder condition (`areFeederMatchesComplete`, replacing the old
whole-round `isPreviousRoundComplete`).

**T-INV-7 — One live match per user.**
A user appears as `player1_id`/`player2_id` in **≤ 1** match with status
`ready` or `in_progress` across all tournaments at any instant.
*Enforced by:* a partial unique index is not directly expressible (two columns,
two rows) — instead this is a **consequence** of T-INV-5 + T-INV-6 being
correct, plus an `assertBracketConsistent` check that fails loudly if it is
ever violated. Revisit in Step 3 whether a helper table or exclusion
constraint is worth it.

**T-INV-8 — Exactly one bracket, created once.**
A started tournament has exactly 7 match rows: 4 round-1, 2 round-2, 1 round-3.
They are created in one atomic operation and never re-created.
*Enforced by:* bracket generation is an RPC that takes `pg_advisory_xact_lock(tournament_id)`
(or `INSERT ... ON CONFLICT DO NOTHING` on all 7 followed by a count assertion)
so two concurrent `closeRegistrationAndStart` calls cannot both generate and
one cannot half-generate. `unique (tournament_id, round, match_number)` is the
backstop.

### Registration / tournament lifecycle

**T-INV-9 — Registration integrity fields are server-only.**
`registrations.seed`, `.placement`, and `.status` are written **only** by the
service-role backend. The browser (anon key + user JWT) may not INSERT or
UPDATE any column of `scheduled_tournament_registrations`. Registration and
withdrawal happen through the server.
*Enforced by:* RLS — no client INSERT/UPDATE/DELETE policy, and the underlying
grants revoked (this is Gap T-1 / the migration in PR #91, to be reviewed in
Step 4).

**T-INV-10 — Elimination / placement follows the bracket.**
When a match completes: the human loser's registration → `eliminated` (bots
excluded). When the round-3 match completes: the winner's registration →
`winner`, the tournament → `completed` with `winner_id` = that match's winner
(and only from `in_progress`), and every human who played gets a `placement`
consistent with the round they lost in. These registration/tournament writes
happen in the **same transaction** as the triggering match completion.
*Enforced by:* the RPC performs the registration + tournament writes before
`COMMIT`; a CHECK that `scheduled_tournaments.status='completed'` implies
non-null `winner_id`; `assertBracketConsistent` verifies placement ↔ elimination
round agreement.

### Notes for Step 3

- T-INV-1..5, T-INV-10 are all obligations of **one** RPC
  (`complete_tournament_match`). T-INV-6 and T-INV-8 are obligations of the
  **promote** and **generate-bracket** RPCs respectively — Step 3 decides
  whether those are one function or three.
- T-INV-7 and T-INV-9 are not RPC obligations: T-INV-7 is a derived property to
  assert, T-INV-9 is pure RLS.
- Every RPC returns a structured result (`{status, winner_id, winner_source,
  conflict, advanced_to}`) so the Node layer never re-reads to find out what
  happened.

## 1.3 Gap list (ranked by risk)

### data-corruption

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-1** — **CLOSED 2026-08-31** | Client could INSERT/UPDATE its own `scheduled_tournament_registrations` row via the anon Supabase client (`seed`, `status`, `placement`) — `seed` decides the double-no-show tiebreak, `placement` is read back by `/api/tournaments/history` and `/:id/result`. | was: RLS `str_insert_self` / `str_update_self` | **Closed by** the `2026-08-30_tournament_registration_rls_lockdown.sql` migration (merged PR #91), **verified applied to production 2026-08-31**: the human ran the diagnostic — client-writable policies = 0 rows, client INSERT/UPDATE/DELETE grants = 0 rows, `relrowsecurity = true`. All writes are service-role only. |
| **T-2** | `applyMatchResult` writes `params.winnerId` to `winner_id` with no check that it is a participant. Non-participant winner ⇒ `loserId` computes to `null` ⇒ nobody eliminated ⇒ a stranger advances into the next round as a real entrant. | `engine.ts` `applyMatchResult` (~466–489, `main`) | Corrupt bracket, wrong champion. *(PR #91 adds guard; unmerged.)* |
| **T-3** | Match completion is a read-then-write (`if (match.status === 'completed') return;`) with no DB-level CAS. Producers 1–3 (§1.1.3) can each pass the read and each run the completion + advancement sequence, second winner overwriting the first, bracket advanced twice. | `engine.ts` `applyMatchResult` (~465–551, `main`) | Double advancement, wrong winner carried forward, loser un-eliminated. *(PR #91's `completeMatchIfNotCompleted` addresses this one window; unmerged.)* |
| **T-4** | Bracket advancement (`applyMatchResult` steps 1–8, §1.1.4) is multi-statement with no transaction. Crash/overlap between steps leaves: match `completed` but winner never advanced; or next match with one slot filled and stale `status`; or loser eliminated but match not completed. | `engine.ts` `applyMatchResult` | Stuck bracket requiring manual DB repair (`docs/ops/tournament-apply-match-result-repair.md` already exists — evidence this happens). |
| **T-5** — **CLOSED 2026-09-01** | `room:join` had no tournament-assignment ACL on `main`. Room code is guessable from the public bracket. An unassigned client takes the empty seat; on game over their `userId` becomes `winner_id` and advances. | was: `multiplayer/roomSocketAttach.ts` | **Closed by PR #98 (PR-B):** the `room:join` branch now calls `authorizeMatchParticipant()` — one fresh-read participant gate, fail-closed when a match-id marker or bracket row resolves. |
| **T-6** — **CLOSED 2026-09-01** | `roomForfeit` on `main` had no participant check: `winnerUserId = match.player1_id === uid ? player2 : player1`. A `null`/guest/non-participant leaver forfeits the match **to player1**. | was: `multiplayer/roomForfeit.ts` (~130) | **Closed by PR #98 (PR-B):** forfeit path calls `authorizeMatchParticipant()`; `not_authenticated` / `not_a_participant` → status `idle` + warn + `return null` (forfeit ignored), never a default winner. |
| **T-7** | `generateBracket` idempotency is a read-then-write (`existingMatches.length > 0` early return) before 7 inserts. Two overlapping calls (two scheduler ticks; scheduler + a manual trigger) both pass the check; the `unique` constraint then rejects the duplicate inserts and `closeRegistrationAndStart` throws — tournament stuck in `registration_open`, never starts. | `engine.ts` `generateBracket` (~293–296) | Liveness: tournament fails to start. Integrity is saved by the unique constraint. |
| **T-8** | `updateRegistrationStatus` (eliminated/active/winner) is last-write-wins with no ordering guard. If a match is re-resolved (T-3/T-4) or the no-show reconciler and a real game-over disagree, a player's status can flip (`eliminated` → `active`, or a loser marked `winner`). | `engine.ts` (multiple call sites) | Wrong "you're still in" / "you won" state shown to players and written to history. |

### player-visible-bug

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-9** | No-show / forfeit / game-over all emit `tournament:match_completed` with `winnerSource` hard-coded to `'game_over'` in one branch regardless of the real source (`applyMatchResult` line ~497: `params.winnerSource ?? (params.byeWalkover ? 'game_over' : 'game_over')`). | `engine.ts` `applyMatchResult` emit block | Client shows "you lost" instead of "opponent didn't show" / "opponent forfeited". |
| **T-10** | `reconcileExpiredReadyMatches` runs off a 30 s poll. A match can sit `ready` up to ~30 s past `ready_deadline_at` before no-show resolves; two ticks overlapping a slow Supabase call can both enter the loop for the same match. | `scheduler.ts` tick + `engine.reconcileExpiredReadyMatches` | Delayed resolution; compounds T-3. |
| **T-11** — **DOWNGRADED to low-priority hardening / accepted (2026-09-01, PR #101)** | `fetchActiveAssignedMatchForUser` returns *the latest* of multiple surviving `ready`/`in_progress` matches for a user. Originally filed as data-integrity (masking T-6; wrong-match-on-reconnect). | `persistence.ts` `fetchActiveAssignedMatchForUser` | **Why it's no longer a real integrity gap:** (1) **"masks T-6" is obsolete** — T-6 (forfeit defaulting the win to player1) was closed *at its source* by PR-B's `authorizeMatchParticipant` in the forfeit path; a wrong pick by this selector now only routes the player to a *different real match they are a participant of*. (2) **Intra-tournament "two active matches" is closed by PR-A** — the only way a user was ever in 2+ non-completed matches of the *same* tournament was a T-3/T-4 partial-write / double-advancement state; PR-A's atomic `complete_tournament_match` RPC eliminates those, so within one tournament a user now has exactly one active match, always. (3) **Cross-tournament overlap** (user in two tournaments whose active windows overlap) is the only remaining case where 2+ candidates survive filtering, and the tie-breaker is a *deliberate, tested* heuristic — `persistence.test.ts` → "prefers the newest attachable tournament match over older stale candidates" locks it in; the newer tournament is the one that just started, the older is about to be `cancelled` by the reliably-ticking scheduler (post PR-C + T-17) or was already no-showed. **PR #101 hardening (shipped):** `humanJoinedAt(match, userId)` is now the top sort key ahead of `scheduled_start` (a room the player actually entered beats "newest tournament"), and `filtered.length > 1` now `log.warn`s (referencing T-11 / T-15) instead of being silent. No further work planned. |
| **T-12** — **CLOSED 2026-09-01 (PR #102 / PR-D)** | Two "tournament room" concepts — `cfg.tournamentId` (legacy league) vs `room.scheduledTournamentMatchId` (scheduled) — answered by 4 disagreeing ad-hoc predicates. `roomSession`'s game-over persist gate depended on the discrepancy: a scheduled-tournament room has no `cfg.tournamentId`, so `!isTournamentRoom` was true and it flowed through the "private match" branch to reach `applyTournamentGameOverFromRoom` — and that branch is the **only** path a played-to-completion tournament result takes to the bracket. Widening `isTournamentRoom` to also mean scheduled rooms (the obvious "fix") would silently sever it. | was: `multiplayer/roomSession.ts`, `mpAuthorityTelemetry.ts`, `roomLivePersistence.ts`, `registerRematchPregameHandlers.ts` | **Closed by PR #102:** one `server/src/multiplayer/roomKind.ts` leaf classifier (`roomKind() → private \| matchmaking \| scheduled_tournament \| legacy_league` + `isScheduledTournamentRoom` / `isLegacyLeagueRoom` / `isAnyTournamentRoom`). `roomSession` gate renamed to `isLegacyLeagueRoom(room)` (value-identical) with a **loud comment** forbidding the widening + explaining why. `resolveMpAuthoritySourceType` / `inferLiveSessionSourceType` reimplemented on `roomKind` so they stop disagreeing. **Behavior fix (flagged):** `game:rematch` was blocked only in legacy-league rooms; a crafted rematch on a scheduled-tournament room during the post-game-over cleanup window could start a fresh game floating free of the (idempotency-protected) bracket — now blocked via `isAnyTournamentRoom`. Tests: `roomKind.test.ts` + `roomSession.gameOverRouting.test.ts`. |

### cosmetic / lower-risk

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-13** | `emitToUserIds` iterates **all** connected sockets for every emit (O(sockets) per event, several per completion). | `engine.ts` `emitToUserIds` | Fine at current scale; O(n²)-ish under load. |
| **T-14** | Heavy `log.info` on hot read paths (`fetchActiveAssignedMatchForUser` logs full candidate list every call; `registerTournamentAttachHandlers` logs `'accepted'` twice). | `persistence.ts`, `registerTournamentAttachHandlers.ts` | Log volume / cost. |
| **T-15** | No metric / alert on invariant violations (double advancement, `winner_id` not a participant, "no target match for advancement" warn). Detection is by reading logs after a player complains. | whole system | No early warning. |
| **T-16** — **CLOSED 2026-09-01** | `scheduler.ts` ran the no-show reconciler (and the whole scheduler tick) on a `setInterval` inside every server process. If Render ever runs 2+ instances, each would tick its own reconciler — two instances could pick up *different* stale `ready` matches in the same tick and each "correctly" no-show-resolve them, duplicating reconciliation work + log noise (the per-match RPC row lock protects a single call, not "only one instance should scan"). | was: `scheduler.ts`, `engine.reconcileExpiredReadyMatches` | **Closed by PR #99 (PR-C):** `startTournamentScheduler` is gated on `config.tournamentSchedulerEnabled` (`TOURNAMENT_SCHEDULER_ENABLED`, default `true`) — no-ops with a boot log line when false, gating the whole tick incl. the reconciler and seed fallback. Structurally moot on free tier (1 instance); set `false` on web dynos once a dedicated scheduler worker exists. Advisory-lock alternative rejected + rationale preserved in the code comment and §1.4.6. |

### infrastructure / liveness — NOT fixed by the RPC design

Added 2026-08-31 after confirming Render = **free tier, 0.1 CPU / 512 MB,
spins down after 15 min of no inbound HTTP**. These are a **different failure
class** from the concurrency gaps: the RPC makes writes atomic, but a
transaction function is irrelevant if **the process is not running to call it**,
and a cold Supabase connection pool on 0.1 CPU makes even the RPC call slow and
timeout-prone.

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-17** — **CLOSED 2026-08-31** | **Free-tier spin-down stalled the scheduler and the no-show reconciler.** While the instance was spun down (no player connected, no HTTP), the `scheduler.ts` 30 s `setInterval` did not run — registration/bracket/dispatch/no-show all frozen until an inbound request cold-started a fresh instance, whose boot tick then caught up (status-guarded) but **late**. **Root cause of "no pinger":** an UptimeRobot monitor *did* exist but was configured as **ICMP Ping type**, which Render does not answer — it read "No Response" / ~6.5 % uptime and kept nothing warm. **Fix:** monitor changed to **HTTP(s) type → `https://racehorse.onrender.com/ping`, every 5 min**. Confirmed by the human: **100 % uptime, no gaps, over the following hour.** At 5-min cadence the instance never reaches Render's 15-min idle timeout, so the process stays alive and the 30 s tick runs continuously (verified: the tick needs only a live process, not a triggering request). **Second signal (also verified):** `SERVER_URL=https://racehorse.onrender.com` is set in Render — human confirmed post-redeploy that `GET /ready` → `recommendedEnv.SERVER_URL: true` (fresh deploy `67fb5dac…`, `uptimeSeconds` reset). The internal 10-min self-ping (`index.ts` ~950) is now active as a redundant backup. **Residual (accepted):** a process killed by deploy / crash / OOM stays down until the next ≤ 5-min monitor hit restarts it — bounded and acceptable. | `scheduler.ts`, external UptimeRobot monitor, Render plan | Closed by: (1) UptimeRobot HTTP monitor on `/ping` @ 5 min — 100 % uptime verified over the observation window; (2) `SERVER_URL` set in Render — `/ready` confirms `true` post-redeploy. Both human-configured outside the repo. |
| **T-18** — **ACCEPTED RISK at current scale (2026-08-31)** | **0.1 CPU / 512 MB is marginal for a socket.io game server.** Timer callbacks drift under event-loop starvation (the 30 s reconciler can run every 40–90 s); GC pauses on 512 MB with 4 concurrent match states + all daily-mode state; **OOM restart** is plausible and drops all in-memory rooms (recovered 2 s post-boot by `recoverTournamentMatches`, with a gap). A **cold Supabase pool right after wake** is exactly when `applyMatchResult`'s 4-retry loop is most likely to exhaust and hit the ops-repair give-up path. | whole server process, Render plan | **Not being fixed now.** Accepted at current (pre-marketing, near-zero concurrent load) scale. **Revisit at upgrade time** — a paid always-on instance with real CPU/RAM removes most of this. The RPC work (§1.4) reduces the blast radius (atomic completion + advancement means a cold-instance retry can't half-write the bracket). |
| **T-19** — **ACCEPTED RISK at current scale (2026-08-31)** | **Lifecycle transitions fire late on wake, and registration can be un-openable during a sleep window.** If the instance is asleep across `registration_open_at`, players who open the app before it wakes see a tournament that never opened; the boot tick may `openRegistration` + `closeRegistrationAndStart` in the same tick, collapsing the registration window to zero. `isTournamentPastActiveWindow` is 2 h, so a stale tournament isn't cancelled — it dispatches to absent players. | `scheduler.ts` tick | **Not being fixed now.** The 5-min external monitor (T-17 mitigation) largely removes the trigger — the instance shouldn't be asleep across a registration window if it's pinged every 5 min. Residual edge cases (monitor outage, deploy at exactly the wrong minute) accepted at current scale. **Revisit at upgrade time**, likely alongside moving lifecycle transitions into an RPC that reasons about "did we miss the window" explicitly. |

**Evidence this is already biting (not hypothetical):**
- Commit `b49872ce` — *"Fix post-wake API hangs by bootstrapping tournaments and bounding Supabase … register tournament REST and scheduler at listen time instead of first socket … return safe fallbacks when optional upstream calls stall."* This is a spin-down/wake fix. Post-wake hangs were real.
- `scheduler.ts` comment: *"Fire one immediate tick so an existing-due tournament catches up at boot"* — written because tournaments were found overdue at boot.
- The ops-repair doc exists — the give-up path has fired in production.
- We **cannot** cleanly attribute past stuck brackets to concurrency vs. cold-start from the repo alone. Honest read: **both, and they compound** — a cold instance + cold Supabase pool + 0.1 CPU is when producers overlap *and* when retries exhaust. The RPC fixes the first half; T-17/T-18 are the second half and need an **infra** fix.

**Infra decision — RESOLVED (D-4, 2026-08-31):** external uptime monitor on
`/ping` every 5 min, stay on free tier for now. `/internal/tick` remains
unbuilt and unneeded unless a future D-4 revision moves the scheduler off the
web process.

#### T-17 follow-up (2026-08-31): does the scheduler need a tick-triggering HTTP hit?

**No.** Verified from code, not assumed:

- `server.listen(PORT, () => { bootstrapScheduledTournamentInfrastructure(io, app); … })`
  (`index.ts` ~917) runs at **process boot**, unconditionally, before any
  socket or HTTP request. It calls `startTournamentScheduler(io)`, which does
  `void tick()` immediately then `setInterval(tick, 30_000)`.
- That `setInterval` is a **plain Node timer**. Once the process is running it
  fires every 30 s **on its own** — no incoming request required. The tick's
  own logic (`now >= openAt` / `>= closeAt` / `>= startAt`) means it processes
  anything overdue.
- So: **any request that keeps the process from spinning down is sufficient.**
  A generic uptime ping to `/ping` fully restores scheduler + reconciler
  behaviour — it does **not** need to hit a special catch-up route. The premise
  "a plain ping keeps it awake but doesn't trigger catch-up" is **false** for
  this codebase.

**Implication for `/internal/tick`:** not needed for keep-warm. It becomes
useful only under D-4 options (a)/(b) — moving the scheduler *off* the web
process to a cron that then needs an endpoint to trigger the tick. **Do not
build it until D-4 is decided.** (If the pinger is confirmed working and we
stay on-process, `/internal/tick` is dead weight.)

#### T-17 follow-up (2026-08-31): is there an external pinger already? — CANNOT VERIFY FROM REPO

Checked and found **nothing conclusive in the repository**:
- No committed uptime/monitor config (`.render/`, UptimeRobot, cron-job.org, etc.).
- `.github/workflows/smoke-test.yml` hits prod (`/healthz`, `/api/daily-fritz/today`) **but triggers only `on: push: [main]`** — after a deploy, not on a cron. `daily-fritz-authority-soak.yml` is `workflow_dispatch` (manual) only.
- `/ping`, `/health`, `/healthz` handlers **do not log the request** — no
  access-log middleware, no User-Agent capture anywhere in `server/src`. So
  even if we could read Render logs, a plain `/ping` hit would leave no trace
  beyond Render's own platform request metrics.

**What the human needs to check outside the repo** (agent cannot):
1. **Render dashboard → Metrics / Logs** — look for a regular inbound request
   pattern (every ~5 min) on `/ping` or `/`; Render's request log shows path +
   sometimes UA.
2. **UptimeRobot / cron-job.org / Pingdom / BetterStack / any monitor account**
   — is there a monitor pointed at `racehorse.onrender.com`? What URL, what
   interval?
3. If a pinger exists: confirm (a) the **max gap between hits never exceeds
   ~13 min** (Render's idle timeout is 15 min; leave margin), and (b) it hits a
   **lightweight** endpoint — `/ping` and `/health` are pure `res.json`, safe;
   `/healthz` does a **Supabase round-trip every hit** and would be wasteful /
   add DB load if pinged every 5 min. Point any pinger at **`/ping`**.

**Resolution (2026-08-31): T-17 CLOSED.** There *was* an UptimeRobot monitor —
but configured as **ICMP Ping type**, which Render never answers, so it showed
"No Response" / ~6.5 % uptime and kept nothing warm. Re-typed to **HTTP(s) →
`https://racehorse.onrender.com/ping`, every 5 min**; human verified **100 %
uptime, no gaps, over 1 h**. `SERVER_URL` was also `false` in prod
(`GET /ready`) so the internal self-ping had never run; human set
`SERVER_URL=https://racehorse.onrender.com` + redeployed and confirmed
`GET /ready` → `SERVER_URL: true` (fresh deploy `67fb5dac…`). Both signals
verified.

> Side note (out of scope, logged for later): `/ready` also shows
> `ADMIN_SECRET`, `CLIENT_URL`, `DAILY_PUZZLE_CRON_SECRET` unset in prod. Not
> part of this system's work; worth a look during **System 13** (cross-cutting /
> infra) / a general env-hygiene pass.

## 1.4 State machine / concurrency design

### Locked: concurrency mechanism (Decisions D-2)

**Match completion and bracket advancement run inside one Postgres transaction
function (RPC).** Not `version`/CAS, not an in-process serialized funnel.

Rationale: the T-3/T-4 bug is fundamentally "8 non-atomic writes". A single
plpgsql function that (a) locks the match row, (b) validates the transition,
(c) writes completion + advancement + registration/tournament changes in one
transaction closes the race **and** the partial-write problem at once, with no
application-level locking to get wrong. It is also **instance-count agnostic**:
we have not ruled out 2+ server instances, and an in-process funnel would
silently break under that condition. This decision is what makes horizontal
scaling safe later without redoing this work.

**Deployment instance count — NEEDS HUMAN CONFIRMATION.** The architecture
requires exactly 1: `rooms.ts` holds all room state in a module-level `Map`,
there is no socket.io Redis adapter, and `scheduler.ts`/`engine.ts` carry
explicit "single-instance only" comments. An agent cannot read the Render
dashboard. Treat as 1 until the human writes the real number here:
`Render web service instances = ____ (confirmed by human on ____)`.

### 1.4.1 What is live on `main` after PR #91 — does it conflict with the RPC?

PR #91 merged early (Current focus ⚠). Assessment against D-2 + T-INV-1..10:

| #91 change (live on `main`) | Relationship to the RPC | Action in Step 4 |
|---|---|---|
| `persistence.completeMatchIfNotCompleted` — `?status=neq.completed` conditional PATCH | **Superseded, not conflicting.** It is a real DB-level compare-and-set, so it correctly closes the *"who claims the match"* race (T-INV-3 first-writer-wins). But it only makes the **5 completion columns** atomic — loser elimination, next-round advancement, target status, and `completeTournament` still run as separate un-transacted PATCHes **after** it. So T-INV-1 is partially met; **T-INV-5 and T-INV-10 (same-transaction advancement / elimination) are not**. The RPC's `SELECT … FOR UPDATE` + single transaction fully subsumes this function. | **Delete** `completeMatchIfNotCompleted` and its `persistenceInterface` entry when the RPC replaces the completion path. |
| Inline participant check in `applyMatchResult` (`winner_not_match_participant` throw) | **Duplicated by the RPC.** #91 checks in JS against a pre-CAS `fetchMatchById` read — a TOCTOU gap (the row's `player{1,2}_id` can change between the read and the write via a prior-round advancement; round-gating makes this unlikely but not impossible). The RPC does the same check **inside the transaction against the locked row**, closing the gap. | **Remove** the JS check when the RPC owns completion; the RPC is the single enforcement point for T-INV-2. |
| Inline participant check in `roomForfeit` (leaver must be a participant) | **Complementary — this is authz, not concurrency.** Correct behaviour, wrong layer (inline, the exact anti-pattern §1.5 targets). Does not fight the RPC. | **Refactor** into the §1.5 shared guard; keep the behaviour. |
| Inline `room:join` tournament-assignment ACL in `roomSocketAttach` + `isTournamentRoomCode` | **Complementary — authz, not concurrency.** Same as above. | **Refactor** into the §1.5 shared guard; keep the behaviour and the code-shape fallback. |
| Registrations RLS lockdown migration (`2026-08-30_…`) | **Independent and correct.** Pure RLS; this *is* T-INV-9 / closes Gap T-1. No relationship to the RPC. | **Keep. Verified applied to prod 2026-08-31** (all three diagnostic checks clean: 0 client-writable policies, 0 client write grants, RLS on). Gap T-1 → CLOSED. |

**Answer to "are we carrying two competing concurrency mechanisms?"**
Not *competing* — `completeMatchIfNotCompleted` and the future RPC both mean
"first writer wins on the match row", and even during a mixed rollout the CAS
PATCH and the RPC's `FOR UPDATE` serialize correctly at the DB. But we are
carrying **one-and-a-partial**: the CAS covers ~1 of the ~5 writes the RPC will
own. It is an acceptable **interim** (it does stop the common-case
double-advancement today) — but Step 4 must **delete it in the same PR that
introduces the RPC**, not leave both. Do not build anything new on top of the
CAS. The participant check is a straightforward **move** (JS → RPC). The
forfeit / room:join checks are **authz** and move to §1.5, untouched in
behaviour.

### 1.4.2 Match state machine (Step 3 — ratified, merged PR #93)

#### States

| State | Meaning | Terminal? |
|---|---|---|
| `waiting` | Row exists; one or both player slots may still be empty; not dispatched. | no |
| `bye` | Created with exactly one player (the other slot `null`). Degenerate — auto-walked-over to `completed` at bracket generation. **With the current bot-fill (`buildOrderedEntrants` pads to 8), byes never occur in production**; the path is kept for `providedEntrants` / bot-fill-disabled. | transitions immediately |
| `ready` | Both players known; room reserved; `ready_at` + `ready_deadline_at` set; waiting for humans to attach. | no |
| `in_progress` | All human players attached; the domino game has a live state. | no |
| `completed` | Outcome recorded: `winner_id`, `winner_source`, scores, `completed_at`. | **yes — T-INV-1** |

No error/terminal-failure state today. A match stuck in `ready`/`in_progress`
past the tournament active window is left as-is while the *tournament* is
`cancelled` by the scheduler (Gap — revisit whether the match needs an
`abandoned` state in Step 4).

#### Transitions, and who may trigger each

Actors: **P1** real game over · **P2** forfeit-on-leave · **P3** no-show
reconciler · **P4** bot-vs-bot auto-resolve · **P5** bye walkover · **S**
scheduler (dispatch/promote) · **A** player attach · **G** bracket generator.

| # | Transition | Actor(s) | Writer | Notes |
|---|---|---|---|---|
| T-a | ∅ → `waiting` / `bye` | G | `generate_tournament_bracket` RPC | 7 rows in one transaction. QF with a null slot → `bye`; all others → `waiting`. |
| T-b | `bye` → `completed` | P5 | `complete_tournament_match` RPC | one-shot inside `generate_tournament_bracket`. |
| T-c | `waiting` → `waiting` (slot fill only) | P1–P5 (advancement tail of a *feeder* match) | `complete_tournament_match` RPC (same txn as the feeder's completion) | writes `player{1,2}_id`; status stays `waiting` because the other slot is still `null`. |
| T-d | `waiting` → `ready` | S (QF, at/after `scheduled_start`) **or** advancement tail (SF/Final, when the *second* feeder fills the last slot) | `promote_tournament_match` RPC (S) / `complete_tournament_match` RPC (advancement) | Guard: tournament `in_progress`, `now ≥ scheduled_start`, **both feeder matches `completed`/`bye`** (T-INV-6 — structurally enforced by advancement filling both slots), both player ids non-null. The Node dispatch layer then reserves the room + sets `ready_at`/`ready_deadline_at`. |
| T-e | `ready` → `in_progress` | A (attach) **or** S (reconciler, room already live) | `promote_tournament_match` RPC | Guard: status `ready`, all human players have `joined_at`, room has state. |
| T-f | `ready` → `completed` | P2 (forfeit before start) · P3 (no-show after `ready_deadline_at`) · P4 (bot-only) | `complete_tournament_match` RPC | Guard: see rejection rules below. |
| T-g | `in_progress` → `completed` | P1 (game reached `win_target`) · P2 (forfeit mid-game) | `complete_tournament_match` RPC | Guard: see rejection rules below. |
| T-h | `completed` → `completed` | any of P1–P5 (retry / race loser) | `complete_tournament_match` RPC | **no-op**. Same `winner_id` → idempotent success. Different `winner_id` → `conflict=true`, no write, structured `warn` log (D-3). |

#### How the RPC rejects an invalid transition (does NOT silently no-op)

`complete_tournament_match(p_match_id, p_winner_id, p_winner_source,
p_reported_p1_score, p_reported_p2_score, p_actor)` — plpgsql, one transaction:

1. `SELECT * ... WHERE id = p_match_id FOR UPDATE` → not found ⇒
   `RAISE EXCEPTION 'match_not_found'`.
2. **Already `completed`:** compare `winner_id`.
   - equal ⇒ `RETURN` recorded row, `conflict=false` (idempotent success).
   - different ⇒ `RETURN` recorded row, `conflict=true`, **no write**.
3. **Status is `waiting`** ⇒ `RAISE EXCEPTION 'match_not_playable'` (includes
   the current status). A producer trying to complete a `waiting` match is a
   bug and must surface, not vanish.
4. **`p_winner_source = 'game_over'` and status ≠ `in_progress`** ⇒
   `RAISE EXCEPTION 'game_over_on_non_started_match'`. A real game-over cannot
   originate from a match that never started.
5. **`p_winner_source ∈ ('no_show','forfeit','bot_simulated')` and status ∉
   (`ready`,`in_progress`)** ⇒ `RAISE EXCEPTION 'invalid_source_for_status'`.
6. **T-INV-2:** `player1_id`/`player2_id` both non-null and
   `p_winner_id ∈ (player1_id, player2_id)` ⇒ else
   `RAISE EXCEPTION 'winner_not_participant'`.
7. **T-INV-4 score derivation:**
   - `no_show`/`forfeit`/`bot_simulated` ⇒ RPC sets `(win_target, 0)` oriented
     to the winner; the caller's reported scores are ignored.
   - `game_over` ⇒ use `p_reported_*`, but assert both ≥ 0 and winner's ≥
     loser's ⇒ else `RAISE EXCEPTION 'score_inconsistent'`.
8. Write completion columns (T-INV-1). Then, in the same transaction:
   elimination (T-INV-10), advancement (T-INV-5) or final/tournament completion
   (T-INV-10), each conditional so a repeat is a no-op.
9. `RETURN (status, winner_id, winner_source, player1_score, player2_score,
   conflict, advanced_to_match_id, advanced_to_slot)`.

Exceptions from 1/3/4/5/6/7 propagate to Node: retry producers (P1, P2) retry
up to 4× then give up to the ops-repair path; P3/P4 log and move on. `conflict`
is the only "expected, non-exceptional, still-notable" outcome — hence the D-3
log line.

`promote_tournament_match` and `generate_tournament_bracket` follow the same
shape (lock → validate → `RAISE EXCEPTION` on invalid, never silent).

#### Near-simultaneous callers — which rows lock, and why it serializes

**Two producers, same match (e.g. P1 game-over write lands as P3's no-show
timer fires):**
- Both call `complete_tournament_match(match_X, …)`.
- Each transaction's first statement is `SELECT … WHERE id = match_X FOR
  UPDATE` — a lock on **exactly one row: `match_X`**.
- First transaction acquires it, runs steps 3–8 (completion + advancement),
  `COMMIT`s, releases.
- Second transaction's `SELECT … FOR UPDATE` was **blocked** on that lock; it
  now proceeds, reads `match_X` as `completed`, and takes step 2 (idempotent
  success or `conflict=true`). It performs **no** completion or advancement.
- Result: exactly one completion, exactly one advancement. T-INV-1/3/5 hold
  with zero application-level locking.

**Two *different* feeder matches advancing into the same next-round match
(SF1 fed by QF1 and QF2 finishing together):**
- QF1's RPC: locks `QF1` (step 1), then at advancement locks `SF1`
  (`UPDATE … WHERE id = SF1 …`), sets `SF1.player1_id`, sees `player2_id`
  still `null` ⇒ `SF1.status` stays `waiting`, `COMMIT`.
- QF2's RPC: locks `QF2`, then blocks on `SF1`'s row lock until QF1 commits;
  then sets `SF1.player2_id`, sees `player1_id` now filled ⇒ sets
  `SF1.status = 'ready'`, `COMMIT`.
- Lock order is always **(own feeder row) → (target row)**, and no two RPCs
  share an "own feeder row", so the only contended row is the target, taken
  **second** by both ⇒ **no deadlock**, clean serialization.
- The advancement `UPDATE` carries `AND (<slot> IS NULL OR <slot> =
  p_winner_id)` so a retry of QF1's RPC after QF2 committed is a no-op, not a
  double-write.

**Two `closeRegistrationAndStart` calls for one tournament (two scheduler
ticks overlapping a slow Supabase read):**
- `generate_tournament_bracket` takes `pg_advisory_xact_lock(hashtext(p_tournament_id))`
  as its first statement (there is no pre-existing row to `FOR UPDATE`).
- One acquires it, inserts the 7 rows + walks over byes, `COMMIT`s (releasing
  the advisory lock at transaction end).
- The other blocks, then proceeds; its inserts are `INSERT … ON CONFLICT
  (tournament_id, round, match_number) DO NOTHING` ⇒ all no-ops; it returns the
  existing bracket. Closes Gap T-7 (liveness — no more "unique violation →
  stuck in `registration_open`").

### 1.4.3 RPC surface — three functions (Step 3 — decided D-5, merged PR #93)

**Decision: three functions + shared helpers.** (Decisions D-5.)

| Function | Owns invariants | Locks | Callers | Signature (shape) |
|---|---|---|---|---|
| `complete_tournament_match(p_match_id, p_winner_id, p_winner_source, p_reported_p1, p_reported_p2, p_actor)` | T-INV-1, 2, 3, 4, 5, 10 | `SELECT … WHERE id = p_match_id FOR UPDATE`; then the advancement target row | P1 game-over, P2 forfeit, P3 no-show, P4 bot-resolve, P5 bye | returns `(status, winner_id, winner_source, player1_score, player2_score, conflict bool, advanced_to_match_id, advanced_to_slot)` |
| `promote_tournament_match(p_match_id, p_to_status, p_actor)` — `p_to_status ∈ ('ready','in_progress')` | (transition validity only — see T-INV-6 note) | `SELECT … WHERE id = p_match_id FOR UPDATE` | S (scheduler: `waiting→ready` for round 1; `ready→in_progress` when room live), A (attach: `ready→in_progress`) | returns `(status, started_at, ready_at, ready_deadline_at, conflict bool)` |
| `generate_tournament_bracket(p_tournament_id)` | T-INV-8 | `pg_advisory_xact_lock(hashtext(p_tournament_id::text))` + 7× `INSERT … ON CONFLICT DO NOTHING` | G (`closeRegistrationAndStart`) | returns the 7 match rows |
| **helpers** (plain SQL/plpgsql, same migration, not called from Node): `_tournament_is_participant(match_row, user_id)`, `_tournament_canonical_scores(winner_id, winner_source, win_target, reported_p1, reported_p2)`, `_tournament_advance_target(round, match_number)` (the `advanceSlot` map in SQL) | — | — | — | — |

**Why three, not one `tournament_match_command(p_match_id, p_command, p_args jsonb)`:**
- Each function is a **small auditable transaction** — "what can complete a
  match" is readable without wading past promote/generate branches.
- **Different lock targets** are explicit per function (match row / match row /
  advisory lock), not buried in a `CASE`.
- **Different signatures** — `complete` needs winner+scores+source, `promote`
  needs a target status, `generate` needs only a tournament id. One function
  means a fat `jsonb` arg with runtime shape validation.
- **Blast radius** — a bug in bracket *generation* is in a different deployable
  object from match *completion*.
- Cost: three migration objects to keep in step; shared logic lives in the
  three helper functions above rather than being duplicated or inlined.
- `generate_tournament_bracket` is arguably a different concern entirely
  (bracket *creation*, not match *state*) — the name is deliberately
  `generate_…` not `…_match` to signal that.

**T-INV-6 correction — RESOLVED (re-ratified 2026-08-31, Decisions D-6).**
The original wording ("every round-(N−1) match `completed`/`bye`") was
**stricter than bracket correctness requires**. A round-N match only needs its
**two direct feeder matches** complete — SF1 (fed by QF1+QF2) can start while
QF3/QF4 still play. That two-feeder condition is **already structurally
enforced** by `complete_tournament_match`'s advancement step (`status = CASE
WHEN <other slot> filled THEN 'ready' ELSE 'waiting'`).
- `promote_tournament_match` needs **no** previous-round gate.
- **T-INV-6 reworded** in §1.2 to the feeder-gating form. Re-ratified.
- **`isPreviousRoundComplete` replaced by `areFeederMatchesComplete(tournamentId,
  round, matchNumber)`** in `canAutoSimulateBotOnlyMatch` — pulled forward from
  Step 4 at the human's explicit direction (D-6). One engine test
  (`"does not complete semifinal bot-only matches before quarterfinals finish"`)
  updated to assert the T-INV-6 behaviour instead of the old strict one.

**Client-side impact check for the reword (2026-08-31, before ratification):**
Does any client code / copy assume the strict whole-round rule?

| Surface | Finding |
|---|---|
| `tournament:round_completed` socket event | Server emits it (`emitRoundCompletedIfNeeded`), asserted in `engine.test.ts` — **no client listener anywhere**. Not in `client/.../socketEventRegistry.ts` (which lists `match_updated` / `match_ready` / `match_completed` / `bracket_generated` / `completed`). It is a **dead event**. |
| Bracket view (`TournamentBracketScreen.tsx`, `tournamentBracketDisplay.ts`) | Renders **per-match** — each cell reads its own `status` / `winner_id` / slot ids. A partially-filled SF ("You vs TBD") is **already a designed, rendered state** (`is-pending` class, `TBD` slot label). Nothing keys off "previous round fully done". |
| "When is my next match" (`yourReadyMatch`, `activeAssignedMatch`, `canAttach`) | **Per-match** — the client offers the attach banner the instant *your* match is `ready`. No round gate. |
| `hubState.ts` "waiting" states | All are **pre-tournament-start** (`registered_waiting` = waiting for the event to begin). No between-rounds "waiting for round 1 to finish" state. |
| `TournamentFlowStepper` ("Register → Lock → Round 1 → Semifinal → Final") | **Static decorative** progression label. Not driven by round completion. |
| Notifications / toasts | None about round completion. |
| Post-match navigation (`useTournamentSessionNavigation`) | Sends the player to the **bracket view** to wait; the attach banner appears when *their* SF becomes `ready`. No round gate. |

**And the engine already works on the two-feeder condition for human matches.**
`applyMatchResult`'s advancement tail sets the target to `ready` and calls
`dispatchTournamentMatch` the moment **both** its feeders complete
(`engine.ts` ~525, ~544) — regardless of the other half of round 1.
`isPreviousRoundComplete` is used in **exactly one place**:
`canAutoSimulateBotOnlyMatch` — gating **bot-vs-bot** SF/Final auto-simulation.
That is invisible to players: the bracket-reveal logic
(`computeBracketRevealThroughRound`) hides non-human match results beyond the
player's current round anyway.

**Conclusion:** the reword is **safe to ratify**. It documents what the engine
already does for human matches. Relaxing `isPreviousRoundComplete` to the
two-feeder condition changes only **bot-only** SF/Final timing (they'd
auto-resolve a bit sooner) — still invisible to players, no bracket-view
inconsistency (the "You vs TBD" partial-SF is how it renders today). The dead
`round_completed` emit can stay or be removed in Step 4; nothing depends on it.

### 1.4.5 Authz layer shape (Step 3 — decided, merged PR #93)

**Problem.** The audit (§1.1.5) found the *authorization* question — "may this
user act on this match?" — answered by **inline, duplicated, inconsistent**
checks: `registerTournamentAttachHandlers` has one (correct), `roomForfeit` got
one from PR #91, `roomSocketAttach`'s tournament branch got one from PR #91,
`applyMatchResult` got one (moving into the RPC per D-5). Each re-implements
"fetch the match, null-check, completed-check, `player1_id/player2_id ===
uid`". The *authentication* question ("who is this?") is already consistent
(`requireAuthUserId` for REST, `getSocketUserId` for sockets, both in the
existing `tournamentAuth.ts`).

**Shape.** One authorization function, added to `tournamentAuth.ts` (which
already owns the auth primitives). It takes the **verified** user id + the
resource reference, reads the match **fresh** (so a stale client id can't slip
through), and returns either `{ ok: true, match }` (so the caller doesn't
re-fetch) or `{ ok: false, code }` with a typed denial. Sibling mappers turn
`code` into a socket ack or an HTTP status **consistently**.

```ts
// added to server/src/scheduledTournament/tournamentAuth.ts

export type TournamentAuthzDenial =
  | 'not_authenticated'   // no verified user id
  | 'match_not_found'
  | 'match_completed'     // terminal — nothing to act on
  | 'not_a_participant';  // authenticated, but not player1/player2 of this match

export type MatchParticipantAuthz =
  | { ok: true; match: MatchRow }
  | { ok: false; code: TournamentAuthzDenial };

/**
 * The single participant gate. Every socket handler / route that acts on a
 * tournament match (attach, forfeit, join a tournament room, read live state)
 * calls this first. `ref` is a match id or a room code (the latter uses the
 * PR #91 code-shape fallback for post-restart rooms). Reads the match fresh.
 */
export async function authorizeMatchParticipant(
  userId: string | null,
  ref: { matchId: string } | { roomCode: string },
  opts?: { allowCompleted?: boolean },
  deps?: { fetchMatchById: typeof fetchMatchById; fetchMatchByRoomCode: typeof fetchMatchByRoomCode },
): Promise<MatchParticipantAuthz>;

export function matchAuthzAck(code: TournamentAuthzDenial): { ok: false; error: string };   // socket
export function matchAuthzHttpStatus(code: TournamentAuthzDenial): 401 | 403 | 404 | 409;   // REST
```

**One example call site** — `registerTournamentAttachHandlers` (`tournament:attach_assigned_match`):

```ts
socket.on('tournament:attach_assigned_match', async (payload, cb) => {
  const userId  = getSocketUserId(socket);          // verified identity — unchanged
  const matchId = parseMatchId(payload);
  if (!matchId) return cb?.({ ok: false, error: 'missing_matchId' });

  const authz = await authorizeMatchParticipant(userId, { matchId });
  if (!authz.ok) return cb?.(matchAuthzAck(authz.code));   // ← the whole gate, one line

  const match = authz.match;                        // fresh, participant-verified, no re-fetch
  // … proceed with dispatch / room attach using `match` …
});
```

Those three lines replace, in this handler alone: the `if (!authenticatedUserId)`
block, the `fetchMatchById` + null check, the
`match.status === 'completed' || match.completed_at || match.winner_id` block,
and the `match.player1_id !== uid && match.player2_id !== uid` block — and the
**same** three lines then replace the divergent hand-rolled versions in
`roomForfeit` and `roomSocketAttach`.

**Scope note.** This gate is tournament-specific (it knows about
`scheduled_tournament_matches`). System 2 (multiplayer rooms) will define its
own `authorizeRoom…` guard following the identical *shape*
(`(userId, ref, opts) → { ok, resource } | { ok: false, code }` + ack/status
mappers). If the shape proves identical we lift the type into a shared
`authz.ts` then — not building a generic framework now.

### 1.4.6 No-show reconciler multi-instance stance (Decisions D-7 — 2026-08-31)

**Problem.** `scheduler.ts` runs the reconciler tick on a `setInterval` in
every server process. The per-match RPC row lock (D-2) protects a single
`complete_tournament_match` call — it does **not** stop two instances from each
*scheduling* that call for different stale matches in the same tick. Under 2+
instances that means duplicated reconciliation work and log noise (each acting
"correctly" in isolation).

**Rejected — `pg_try_advisory_lock` at the top of the tick.** The server has
**no direct Postgres connection**: every DB call is `supabaseFetch` → PostgREST
over HTTP, and each call checks out a *different* pooled connection. A
session-scoped `pg_try_advisory_lock` is bound to one backend connection and
releases the moment that HTTP request's connection returns to the pool —
before the next call in the tick starts. Only `pg_try_advisory_xact_lock`
works over PostgREST, and only *inside a single RPC*. **Preserved here so a
cold session does not re-propose it.**

**Rejected — a lease/heartbeat table** (`scheduler_leases(name, holder,
expires_at)` + a `try_acquire_lease` RPC): real machinery for a problem that
does not exist at 1 instance, and unnecessary once the flag below is on the
table.

**Rejected — RPC-embedded `pg_try_advisory_xact_lock`** (move the whole
scan+resolve into one plpgsql function): unnecessary overlap with the RPC work
already scoped in §1.4.3; the reconciler's logic doesn't need to be in SQL to
be single-instance.

**Decision (D-7): run the scheduler + reconciler as a singleton via a
boot-time flag.** `TOURNAMENT_SCHEDULER_ENABLED`, default `true`.
`startTournamentScheduler` checks it and no-ops (with a boot log line) when
false. A loud comment marks it. When multi-instance ever happens, the flag is
`true` on **exactly one** process — the dedicated scheduler worker (D-4 option
e) — and `false` on the web dynos. Schedulers are singletons even at large
scale; you split them to a dedicated worker, not leader-elect them inside N web
instances. The RPC row locks already make the *completion path*
instance-agnostic; the scheduler just needs to be told "you're not the leader,
don't tick."

**Cost now:** one `if` at startup + a comment + a log line. **Structurally
moot on free tier** (Render runs 1 instance).

**Not in scope for D-7:** the reconciler's actual no-show detection / winner
selection logic is unchanged; T-17–T-19 are unaffected (already resolved).

### 1.4.7 Deferred design question (not a Step 3 blocker)

- **`abandoned` match state?** — whether a match stranded past the tournament
  active window needs an explicit state rather than being left in
  `ready`/`in_progress` under a `cancelled` tournament. Revisit in Step 4.

### 1.4.8 How the RPC design interacts with the liveness gaps (T-17..T-19)

The RPC design and the infra fix are **orthogonal and both required**:

- The RPC makes every write **atomic and idempotent** — so when a stalled
  scheduler finally wakes and fires the boot catch-up tick, calling
  `complete_tournament_match` / `promote_tournament_match` for a batch of
  overdue matches is **safe to do all at once**, in any order, with retries.
  This actually makes T-17's "catch up on wake" *more* robust than the current
  8-non-atomic-writes version, where a cold-instance batch is exactly when
  partial writes happen.
- But the RPC **cannot make a tick fire while the process is asleep.** T-17's
  core problem — "the timer doesn't run" — is untouched by anything in §1.4.
  That needs D-4's infra decision.
- **Sequencing note for Step 4/5:** the concurrency-harness test (§1.6) should
  additionally simulate "instance was asleep for 20 min, wakes, runs one
  catch-up tick against 4 overdue matches" and assert `assertBracketConsistent`
  — that is the real production scenario on free tier, not just two producers
  racing on a warm box.

## 1.5 Refactor plan

### 1.5.1 Step 4 first sub-task — merged PR #91 reviewed line-by-line (2026-08-31)

PR #91 (`fix(tournament): close bracket-advancement holes and lock down
registration RLS`, merged commit `e4760058`) assessed against T-INV-1..10
(§1.2), the state machine (§1.4.2), the three-RPC surface (§1.4.3 / D-5), and
the authz shape (§1.4.5). Every change is one of: **KEEP** (matches the
ratified design), **SUPERSEDED** (the RPC/authz work replaces it — leave until
that lands, remove *with* it), or **CONFLICT** (inconsistent with an invariant
or transition — fix before Step 4 proceeds).

**Result: zero conflicts.** Nothing in #91 needs a fix before Step 4 starts.

| # | Change | Location (current `main`) | Verdict | Step 4 action |
|---|---|---|---|---|
| 1 | `MatchPatch` type extracted from `updateMatch`'s inline signature | `persistence.ts:267`, `persistenceInterface.ts` | **KEEP** | none — `updateMatch` / `MatchPatch` still needed for non-completion writes (`room_code`, `ready_at`, `player{1,2}_joined_at`, …) |
| 2 | `completeMatchIfNotCompleted(matchId, patch)` — app-level CAS (`PATCH ?id=eq.X&status=neq.completed`) | `persistence.ts:295–307` | **SUPERSEDED** | delete in the PR that adds `complete_tournament_match`. Covers only the 5 completion columns — not advancement / elimination / tournament-completion, which the RPC does in the same transaction (T-INV-1/5/10). |
| 3 | interface: `+ completeMatchIfNotCompleted`, `updateMatch(patch: MatchPatch)` | `persistenceInterface.ts` | **SUPERSEDED** (the method) / **KEEP** (`MatchPatch` usage) | remove `completeMatchIfNotCompleted` from `EnginePersistence` + `defaultEnginePersistence` alongside #2 |
| 4 | `if (winnerId !== player1_id && winnerId !== player2_id) throw 'winner_not_match_participant'` | `engine.ts` `applyMatchResult` `:495–502` | **SUPERSEDED** | this is T-INV-2, but checked in JS against a *pre-CAS* `fetchMatchById` read — a TOCTOU gap (`player{1,2}_id` can move via prior-round advancement between the read and the write). The RPC does it **inside the transaction against the `FOR UPDATE`-locked row**. Remove the JS check when the RPC owns completion. Not a conflict — strictly more restrictive than the old (no-check) code, same throw shape as the RPC's `RAISE EXCEPTION`. |
| 5 | CAS completion + `if (!claimed) { log 'result already applied…'; return; }` | `engine.ts` `applyMatchResult` `:510–528` | **SUPERSEDED** | ⚠ the no-op is **silent and winner-agnostic** — it does not distinguish "same winner" (idempotent success) from "different winner" (T-INV-3's `conflict=true` + the D-3 `tournament_match_winner_conflict` structured `warn`). Not a regression (still no double-write), just short of T-INV-3's observability bar. The RPC implements the full same/different branch + the D-3 log. |
| 6 | `isTournamentRoomCode(code)` — regex on the room-code shape | `matchDispatch.ts:48` | **KEEP** | the authz shape's `{ roomCode }` variant (§1.4.5) uses this exact function for the post-restart fallback |
| 7 | forfeit participant check — replaces the 2-branch ternary; non-participant leaver → `tournamentForfeitApplyStatus='idle'`, warn, `return null` | `roomForfeit.ts:141–160` | **SUPERSEDED → authz layer** | correct behaviour, wrong layer. Replace the inline block with `authorizeMatchParticipant(userId, { roomCode: room.code })`; keep the "forfeit ignored" outcome. Not a conflict — a non-participant can't trigger transitions T-f/T-g anyway. |
| 8 | `room:join` tournament ACL — for `via==='room:join'`, resolve the match (by id or room-code shape) and reject if `userId` ∉ `{player1_id, player2_id}` | `roomSocketAttach.ts:367–388` | **SUPERSEDED → authz layer** | consolidate this **and** the attach handler's own participant check into `authorizeMatchParticipant`. Closes Gap T-5 (seat hijack). Not a conflict. |
| 9 | RLS lockdown migration — drop client-writable policies by cmd+roles, revoke grants, assert end state | `supabase/migrations/2026-08-30_tournament_registration_rls_lockdown.sql` | **KEEP** | this **is** T-INV-9 / closes Gap T-1, and does more than the minimum (name-agnostic, revokes grants, self-asserting). **Open verification:** no migration runner exists in CI (`.github/workflows/` has none) — confirm this migration has actually been applied to the production database (merged ≠ applied). |
| 10 | test mock plumbing — `completeMatchIfNotCompleted` added to 5 mock persistence objects; no new assertions | `*.test.ts` ×5 | **SUPERSEDED** | removed alongside #2/#3 |

### 1.5.2 Step 4 work list (falls out of 1.5.1 — not started)

1. **The three RPCs** (`complete_tournament_match` / `promote_tournament_match`
   / `generate_tournament_bracket`) + helpers (§1.4.3). *Same PR* deletes #2,
   #3(method), #4, and the #10 mocks. Implements T-INV-1..5, T-INV-10, and
   T-INV-3's conflict branch + the D-3 log line (which #5 does not).
2. **The authz layer** — `authorizeMatchParticipant()` + `matchAuthzAck` /
   `matchAuthzHttpStatus` in `tournamentAuth.ts` (§1.4.5). Consolidates #7,
   #8, and the attach handler's existing check. Keeps #6 (`isTournamentRoomCode`).
3. **`TOURNAMENT_SCHEDULER_ENABLED`** boot flag (D-7).
4. **Keep + verify:** #1 (`MatchPatch`), #9 (RLS migration — *confirm it ran in
   prod*). Consider a DB CHECK/trigger on `scheduled_tournament_registrations`
   as belt-and-suspenders for T-INV-9 (Step 4/5 scope — flag).
5. **T-INV-6** already done (PR #94).

Each of 1–3 is its own PR, each naming the gap(s) it closes and the test that
proves it (Step 5 harness).

### 1.5.3 Full refactor plan

**TODO — sequenced after the human signs off on 1.5.2.**

## 1.6 Test plan

**Scoped 2026-09-01 into three PRs (E/F/G). PR-E merged.**

- **PR-E — `assertBracketConsistent` helper.** `assertBracketConsistent.testkit.ts`
  — checks the *observable consequences* of T-INV-1/2/5/6/7/8/10 against a set
  of rows, plus a D-3 check that no spurious `tournament_match_winner_conflict`
  log fired (addition #2). Wired into the two full-bracket `engine.test.ts`
  tests; PR-F/G consume it. **Merged PR #103.**
- **PR-F — concurrency + recovery harness (in-memory port, CI).**
  - Redundant-producer test: producers 1–3 (§1.1.3 — real game-over / forfeit /
    no-show reconciler) for one match id; assert one `applied:true`, the rest
    `applied:false` with `conflict` correct, one advancement, loser eliminated
    once, `tournament_match_winner_conflict` warn count as expected (0 for
    same-winner, 1 for a genuine mismatch). Proves the **Node orchestration +
    the port's logic** handle a redundant producer — *not* DB serialization
    (the in-memory port is synchronous end-to-end; that's PR-G).
  - **Reframed** recovery test (the original "kill `applyMatchResult` between
    each step" is obsolete — PR-A made completion+elimination+advancement one
    transaction): "the RPC committed but the Node post-processing (socket emit,
    next-match dispatch, `resolveBotOnlyMatch`) didn't run" → `recoverTournamentMatches`
    re-dispatches; and the reconciler tick survives an `advance_target_missing`
    soft-return without throwing.
  - Cold-wake catch-up (§1.4.8): one tick against a batch of overdue matches,
    run through **≥2 different processing orders**, asserting identical end
    state via `assertBracketConsistent` (addition #3 — a fixed order only
    proves that order).
- **PR-G — local-only pg16 script (`scripts/tournament-db-verify.sh`) — DONE, PR #106.**
  A hermetic throwaway pg16 (own `initdb` in a temp dir, deleted on exit;
  refuses to run if any env/arg points at a remote or Supabase target). Applies
  a **curated** tournament migration chain (not all 42 — the full history needs
  more of Supabase than a shim provides) + `shim.sql` (`auth` schema, `auth.users`,
  `auth.uid()`, the 3 roles). Then: two `psql` sessions each call
  `complete_tournament_match` on the same match with **different winners** — B
  blocks on A's row lock (≥1s, measured), then no-ops (`applied:false` /
  `conflict:true`); bracket then shows one completion + one advancement. The
  **only** test of Postgres-level serialization — guards T-3/T-4; the PR-A
  verification was run once and thrown away. Then the RLS greenfield check (the
  `2026-08-30` lockdown self-assert must not have rolled back + its 3
  diagnostics clean) and an `assert_security_posture()` plant-a-violation.
  Committed with `supabase/tests/rls_registrations_lockdown.sql` and
  `docs/ops/tournament-db-verify.md`. **Not in CI** — no Postgres service, no
  migration runner (which is *why* it exists).

## 1.7 Checklist

### Step 1 — Current-state audit
- [x] Data model + RLS mapped — §1.1.1
- [x] All state writes catalogued — §1.1.2
- [x] Completion-race producers enumerated — §1.1.3
- [x] Bracket-advancement sequence mapped — §1.1.4
- [x] Authorization checks (present/missing) mapped — §1.1.5
- [x] Recovery / reconnect paths mapped — §1.1.6
- [x] Existing idempotency prior art noted — §1.1.7
- [x] Gap list written and risk-ranked — §1.3

### Step 2 — Invariants
- [x] Concurrency mechanism decided (Postgres RPC) — Decisions D-2
- [x] T-INV-1..10 rewritten as obligations of the RPC / DB, not just app code — §1.2
- [x] T-INV-1..10 reviewed line-by-line and signed off by the human — Decisions D-3 (2026-08-31)
- [x] Invariants marked `RATIFIED` — §1.2 status line, Decisions D-3

### Step 3 — State machine / concurrency design — **COMPLETE 2026-08-31**
- [x] Concurrency mechanism chosen and logged in Decisions — D-2
- [x] PR #91 (merged early) assessed against D-2 + invariants — §1.4.1
- [x] Match state machine drawn (states, transitions, trigger authority per producer) — §1.4.2 — merged PR #93
- [x] RPC rejection behaviour for invalid transitions specified — §1.4.2
- [x] `SELECT ... FOR UPDATE` lock targets identified + near-simultaneous-caller walkthrough — §1.4.2
- [x] One RPC vs. three decided — **three** (`complete` / `promote` / `generate`) + helpers — §1.4.3, Decisions D-5 — merged PR #93
- [x] Authz-layer shape chosen — `authorizeMatchParticipant()` + ack/status mappers in `tournamentAuth.ts`; signature + `tournament:attach_assigned_match` example call site in §1.4.5 — merged PR #93
- [x] Multi-instance stance for the no-show reconciler chosen — **singleton via `TOURNAMENT_SCHEDULER_ENABLED` boot flag** (Decisions D-7, §1.4.6); advisory-lock / lease-table / RPC-embedded-lock rejected with reasons preserved — PR #95
- [x] T-INV-6 reworded + re-ratified (D-6); `isPreviousRoundComplete` → `areFeederMatchesComplete` merged as PR #94 (commit on main)

### Step 4 — Refactor — **COMPLETE 2026-09-01** (PR-A/B/C/D merged; T-11 downgraded, T-12 closed). Step 5 is the only remaining tournament work.
- [x] **Merged PR #91 reviewed line-by-line vs the ratified design** — §1.5.1. Zero conflicts; work list in §1.5.2. (2026-08-31)
- [x] **PR-A: the three RPCs** + helpers (§1.4.3) — **merged PR #97 (2026-08-31)**. Closes gaps **T-2, T-3, T-4, T-7, T-8, T-9**; deleted #91's `completeMatchIfNotCompleted` (#2/#3), the JS participant check (#4), the `if(!claimed)` no-op (#5), and the mock plumbing (#10); added T-INV-3's conflict branch + the D-3 `tournament_match_winner_conflict` log. Verified on local pg16 (two-session `FOR UPDATE` race) + full server suite.
- [x] **PR-B: the authz layer** `authorizeMatchParticipant()` + `matchAuthzAck` / `matchAuthzHttpStatus` (§1.4.5) — **merged PR #98 (2026-09-01)**. Closes gaps **T-5, T-6**; consolidated #91's #7/#8 + the attach handler's own inline check into one fresh-read gate; `isTournamentRoomCode` + `makeTournamentRoomCode` moved to a dependency-free leaf `tournamentRoomCode.ts` (keeps #6, breaks the persistence-graph pull). Fail-closed `room:join` semantics preserved from #91.
- [x] **PR-C: `TOURNAMENT_SCHEDULER_ENABLED` flag** (D-7) — **merged PR #99 (2026-09-01)**. `startTournamentScheduler` gated on `config.tournamentSchedulerEnabled` (default `true`); no-ops + boot log when false, covering the tick, the no-show reconciler, and the seed fallback. `.env.example` documents it. Tests: config parsing + scheduler no-tick-when-false. Closes gap **T-16**.
- [x] #91's RLS migration (#9) **verified applied to prod 2026-08-31** — 3 diagnostic checks clean → gap **T-1 CLOSED**
- [x] **T-11** (`fetchActiveAssignedMatchForUser` picks latest) — **DOWNGRADED + hardened, PR #101 (2026-09-01)**. PR-A/PR-B neutralized the integrity concern (§1.3 T-11); shipped `humanJoinedAt` top sort key + multi-match warn.
- [x] **T-12** (two "tournament room" concepts) — **CLOSED, PR #102 / PR-D (2026-09-01)**. One `roomKind()` classifier; game-over gate renamed + loud non-widening comment; rematch-in-tournament-room hole closed.
- [ ] **T-10** (30s poll latency) — accepted; **T-13–T-15** (cosmetic / observability) — lower priority
- Note: T-INV-6 (feeder gating — an *invariant*, not a §1.3 gap) already enforced — merged PR #94
- [x] T-17 — **CLOSED** — root cause was a **mis-typed ICMP UptimeRobot monitor** (not a missing pinger). Fixed to HTTP(s) → `/ping` @ 5 min, 100 % uptime verified; `SERVER_URL` set, `GET /ready` confirms `true`, self-ping active as second signal. — D-4, changelog 2026-08-31
- [ ] T-18, T-19 — **ACCEPTED RISK at current scale** (D-4 / §1.3). Not fixed now; revisit at paid-tier upgrade.

### Step 5 — Tests prove closure — **COMPLETE 2026-09-01** (PR-E/F/G merged). System 1 (Tournament) is fully closed.
- [x] `assertBracketConsistent` helper written + wired into engine tests — **PR #103 / PR-E (2026-09-01)**. `assertBracketConsistent.testkit.ts` — observable consequences of T-INV-1/2/5/6/7/8/10 + the D-3 spurious-conflict-log check. 12 unit tests; wired into `engine.test.ts`'s two full-bracket tests. PR-F and PR-G consume it.
- [x] **PR-F** — Concurrency + recovery harness — **PR #104 / PR-F (2026-09-01)**. `concurrencyRecoveryHarness.test.ts` — redundant producers 1–3 (same-winner quiet path: 0 conflict logs; conflicting-winner loud path: first wins + one D-3 log per disagreement), "RPC committed / Node crashed before dispatch" → `recoverTournamentMatches` re-dispatches the orphaned `ready` target, reconciler tick survives `advance_target_missing` on one match and still resolves the next, cold-wake catch-up produces an identical bracket end-state across forward / reversed / shuffled processing orders. `vi.mock('../logger')` → real captured log output (not fixtures). **Explicitly proves Node orchestration, not Postgres `FOR UPDATE` serialization — that is PR-G.**
- [x] **PR-G** — **PR #106 (2026-09-01)**. `scripts/tournament-db-verify.sh` — a hermetic throwaway pg16 instance (its own `initdb`, deleted on exit; aborts if any env/arg points at a remote/Supabase target). Checks: (1) greenfield apply of the curated tournament migration chain (`shim.sql` + 10 files, in order; the 2026-08-30 lockdown self-asserts); (2) two `psql` sessions call `complete_tournament_match()` on one match with different winners — B blocks on A's row lock (>= 1s, measured), then takes the `applied:false`/`conflict:true` branch; bracket then shows one completion + one advancement, loser eliminated once (**the real Postgres-level `FOR UPDATE` proof — guards T-3/T-4**; the PR-A verification that proved this was run once and thrown away); (3) the three RLS registrations diagnostics come back clean on the fresh schema; (4) `assert_security_posture()` returns `hard_fail_count` 0 clean, 1 after a planted `disable row level security` (naming the table), 0 after re-enable. Committed alongside `supabase/tests/rls_registrations_lockdown.sql` (paste-into-SQL-editor artifact) and `docs/ops/tournament-db-verify.md`. Not CI — no Postgres service, no migration runner (which is *why* it exists). Runs green locally, 3× no flake. **Note:** the `FOR UPDATE` check uses fixed sleeps (1.5s head start / 1.0s threshold / 3s hold) — a future flake is a timing-margin issue first, not automatically a lock regression.

---

# System 2: Multiplayer rooms

Scope: `server/src/rooms.ts`, `server/src/multiplayer/**`,
`server/src/realtime/gameOverPersistence.ts`, `server/src/roomEvents.ts`, and
the room-facing parts of `server/src/matchmaking/**` and
`server/src/spectator/**`. Two-player live dominoes rooms — private (code-share),
matchmaking (quick match), and scheduled-tournament rooms (System 1 seats its
matches here). Room lifecycle, seat allocation, reconnection, abandon/forfeit,
move-log verification, spectator attach.

> Not in scope for this section: the **bracket** side of scheduled tournaments
> (System 1, closed) — §2.1 covers only the room→bracket handoff. The legacy
> league (`server/src/league/**`, `legacyTournament/`) is **System 5**; §2.1 notes
> where the game-over path still branches into it but does not audit it.

> **Structural note — this system is not DB-authoritative.** Unlike System 1
> (Postgres is the source of truth, the RPC is the sink), a multiplayer room's
> authority is the **in-memory `Room` object in `rooms.ts`**. The DB tables
> (`room_live_sessions`, `room_match_logs`, `room_command_receipts`,
> `matchmaking_matches`) are a durability/hydration/idempotency backing, not the
> record. This changes the shape of the audit: the concurrency analysis is about
> in-process interleaving and process-restart recovery, not row locks, and it is
> **wholly dependent on the single-instance deployment fact in §2.1.1**.

## 2.1 Current-state map

Status: **written 2026-09-01, Step 1.** Read-only investigation. No fixes. The
gap list (§2.3) and invariants (§2.2) are not written yet — this section only
maps what is there.

### 2.1.1 Deployment topology — the assumption everything else rests on

**Fact (human-confirmed via the Render dashboard, 2026-08-31, HARDENING_PLAN
D-2 addendum):** the server runs as **exactly one process** on Render's free
tier ($0, 0.1 CPU, 512 MB). The free tier **cannot** horizontally scale.

Corroborating evidence in the repo:

- `index.ts` (~508) constructs `new Server(server, { … })` with **no socket.io
  adapter** — no `@socket.io/redis-adapter`, no `createAdapter` call anywhere.
  The default in-memory adapter means every `io.to(room).emit(...)` is
  process-local: a second instance could not deliver broadcasts to the first
  instance's sockets.
- All room state is a module-level `Map` or similar in-process structure, none
  of it shared: `rooms` (`rooms.ts`), the roster store, `graceTimersByRoomSeat`
  (`disconnectGrace.ts`), the `withRoomGameplayLock` chains
  (`roomGameplayLock.ts`), `nextHandStartsByRoom` (`rooms.ts`), the spectator
  registry (`spectatorRegistry.ts`), `inFlightHydrationByRoomCode`
  (`roomLivePersistence.ts`), the matchmaking registries.
- `index.ts` (~887) — the port-in-use guard message treats a bound port as
  "an existing Racehorse server instance", i.e. one per host.
- System 1's scheduler singleton (D-7) is already predicated on this.

**Consequence for this audit:** every concurrency window in §2.1.5 is analysed
as *in-process async interleaving*. A second instance would give each instance a
disjoint view of every room (double seat allocation, split-brain game state,
double forfeit, broadcasts that reach only half the clients) — a **different and
larger** failure class not covered here.

**Revisit trigger (same status as D-7):** if the Render plan changes to anything
that can run 2+ instances, or a dedicated worker/process split is introduced,
§2.1.5 and §2.2 must be re-derived before that change ships. The in-memory
`Room` Map would need to move behind shared storage (or a sticky-routing +
per-room-owner model), and the game-over / forfeit / hydration paths would each
need a cross-instance guard. Flag it in **Current focus** the moment it is on
the table.

### 2.1.2 Data model — in-memory `Room` + the tables that back it

**The authority: `Room` (`rooms.ts`, ~57–125).** Held in `const rooms =
new Map<RoomCode, Room>()`. Lost entirely on process restart; reconstructed
lazily per room from `room_live_sessions` on the next attach (§2.1.8 — there is
**no** boot-time recovery sweep, unlike System 1).

Load-bearing fields (the ones authz / recovery / idempotency / bracket-handoff
decisions read):

| Field | Meaning | Read by |
|---|---|---|
| `code` | 5-char room code (`makeCode`, `A–Z2–9` minus ambiguous) or a reserved code (matchmaking / tournament) | everything |
| `players: string[]` | **synthetic `playerSeatId` values** in engine seat order — never socket ids, never user ids (`allocatePlayerSeatId()`) | seat/authz checks, engine |
| `state: GameState \| null` | authoritative game state; `null` pre-start | gameplay, masking, game-over detection |
| `config: RoomConfig` | `winningScore`, `tilesPerPlayer`, `fritzTier`, **`tournamentId`** (legacy league only), `tournamentMatchId`, `tournamentMode` | `roomKind`, scoring, legacy-league game-over |
| `matchId` | stable id for this match instance; `room_match_logs` PK, ranked-game `sourceMatchId` | archive, ranked idempotency |
| `matchmakingMatchId?` | set ⇒ matchmaking room; drives `matchmaking_matches` update on end + spectator discovery | game-over, spectator projection |
| `matchmakingParticipantUserIds?` | M4 seat ACL — only these two userIds may attach | `attachSocketToTrackedRoom` |
| `scheduledTournamentMatchId?` / `scheduledTournamentId?` / `scheduledTournamentBotTier?` | set ⇒ scheduled-tournament room; the routing key to System 1's bracket. **Not persisted in the room shell** (§2.1.8) | game-over routing, `room:join` tournament ACL, `roomKind` |
| `abandonedAt?` / `abandonedByUserId?` / `abandonedWinnerUserId?` / `abandonedReason?` | terminal intentional-leave marker; abandoned rooms are not recoverable | join/gameplay/forfeit guards |
| `tournamentForfeitApplyStatus?` | `idle\|pending\|succeeded\|failed` — `abandonedAt` for a tournament room is latched **only after** `applyMatchResult` succeeds; `pending`/`failed` block the room without claiming the bracket advanced | join/gameplay/abandon guards |
| `activeGameOverPersist?` / `gameOverPersistStatus?` | in-flight game-over side-effect promise + `idle\|pending\|succeeded\|failed`; rematch waits on it | rematch handler, `nextHand` |
| `asyncStateVersion` | bumped on each hand (start/next) to invalidate dangling async closures from a previous game | `startGame`, `nextHand`, live persist |
| `eventSequence` / `events: RoomMatchEvent[]` | append-only per-room event log; monotonic | persist freshness, spectator feed, `room_match_logs` |
| `ghostMoveLogs: Record<seatId, GhostMoveLogEntry[]>` / `ghostTurnIndex` | per-seat move transcript — the move-log-verification input (§2.1.9) | game-over verification, ghost service |
| `durability: RoomDurabilityState` | commit fence + degraded/failed status; gates mutating operations | `roomDurabilityPolicy`, hydration freshness |
| `disconnectExpiries?: Record<seatId, number>` | count of grace-timer expiries per seat; ≥ 2 ⇒ forfeit | `disconnectGrace` |
| `preGameDraw?` / `preGameDrawTimer?` | pre-game high-draw state + its timer (in-memory) | match start |

**Room-adjacent in-memory state (not on `Room`, same process-local lifetime):**
the roster store (`getRoomRoster`/`setRoomRoster` — `RoomPlayer` = `{id: seatId,
socketId, username, userId}`, this is where the **seatId ↔ userId** binding
actually lives), reconnect-seat holds, `graceTimersByRoomSeat`, gameplay-lock
chains, `nextHandStartsByRoom`, spectator sessions, in-flight hydration promises.

**Room classification — `roomKind()` (`multiplayer/roomKind.ts`, T-12 / PR-D):**
one classifier, precedence order:

```
scheduledTournamentMatchId  → 'scheduled_tournament'
config.tournamentId         → 'legacy_league'
matchmakingMatchId          → 'matchmaking'
otherwise                   → 'private'
```

Helpers: `isScheduledTournamentRoom`, `isLegacyLeagueRoom`, `isAnyTournamentRoom`
(cross-cutting: telemetry, rematch block). The game-over persist path in
`gameOverPersistence.ts` deliberately reads `room.scheduledTournamentMatchId`
**directly** (not `roomKind`) because that branch *is* the routing to bracket
advancement — see the loud comment there and §1.3 T-12.

**DB tables:**

| Table | Migration? | Purpose | Key columns | RLS |
|---|---|---|---|---|
| `room_live_sessions` (`/rest/v1/room_live_sessions`) | **NONE — unmanaged schema** | hydration shell + full unmasked snapshot for reconnect/restart recovery. Debounced upsert on `room_code` while the room is live; deleted on terminal finalize | `room_code`, `match_id`, `status` (`lobby\|playing\|hand_over\|game_over\|abandoned`), `source_type` (`private\|matchmaking\|tournament`), `game_state` (jsonb, **unmasked** — `assertUnmaskedGameStateForPersistence`), `game_state_sequence`, `room_shell` (jsonb, incl. `durabilityCommit` fence), `engine_seat_ids`, `roster` (jsonb, **incl. `userId`**), `events` (jsonb), `last_event_sequence`, `participant_user_ids`, `matchmaking_match_id`, `scheduled_tournament_id`, `scheduled_tournament_match_id`, `started_at`/`updated_at`/`created_at` | **RLS ON, anon reads nothing (verified live 2026-09-01)** — `assert_security_posture()` `hard_fail_count:0` (RLS enabled); anon `SELECT` → HTTP 200 `content-range: */0` against 2458 rows. **Residual:** `assert_security_posture()` lists this table under `client_write_grant_rls_on` (anon+authenticated hold INSERT/UPDATE/DELETE grants, RLS-gated only — the same advisory carried by 44 tables incl. `profiles` / `ranked_games`, not a hard fail); and the **authenticated-role `SELECT` policy is unread** — if a participant can read their own live row they get the *unmasked* `game_state` = the opponent's hand. Still no migration ⇒ 3rd instance of the "unmanaged schema / no posture check" pattern. |
| `room_match_logs` (`/rest/v1/room_match_logs`) | **NONE — unmanaged schema** | terminal archive (one row per finished/abandoned match); read for terminal-join routing and match history | `match_id` (PK, `on_conflict=match_id`), `room_code`, `status` (`completed\|abandoned`), `event_log_version`, `last_event_sequence`, `event_count`, `started_at`, `archived_at`, `participant_user_ids`, `participants`, `summary` (jsonb, incl. `rankingOutcome`), `state_snapshot`, `events` | **RLS ON, anon reads nothing (verified live 2026-09-01)** — anon `SELECT` → HTTP 200 `*/0` against 1236 rows. Same residuals as `room_live_sessions` (write-grant advisory; authenticated-role `SELECT` policy unread — a terminal transcript is less sensitive than a live hand but still per-match private data). |
| `room_command_receipts` (`/rest/v1/room_command_receipts`) | `2026-08-01_room_command_receipts.sql` ✔ | `game:action` idempotency receipts (survive shell trimming; multi-writer diagnostics) | PK `(room_code, player_seat_id, request_id)`, `ack` jsonb, `expires_at`, `match_id` | ✔ RLS enabled, `for all to authenticated using(false) with check(false)` — **service-role writes only, verified in migration.** |
| `matchmaking_matches` | `2026-05-13_matchmaking.sql` ✔ | matchmaking pairing + outcome; `recordMatchEnd` writes `status`/`winner_id`/rating deltas on game-end/forfeit | (see migration) | (verify alongside **System 10** matchmaking) |

**Tables the game-over path *also* writes** (shared, not room-owned — enumerated
in §2.1.6): `scheduled_tournament_matches` (via System 1's RPC),
`ranked_games` + `profiles` (`insertRankedGameIdempotent` /
`processRealtimeMultiplayerGame`), the ghost tables (`completeGhostGame`),
`fixtures` + `league_members` (legacy league live-finalize), plus the stats
match-log and the social activity writer.

### 2.1.3 All state writes (in-memory `Room` + durable)

**In-memory `Room` mutations.** Gameplay-path mutations are serialized per room
by `withRoomGameplayLock` (`roomGameplayLock.ts` — a per-room promise chain).
Everything else is not.

| Mutator (`rooms.ts` unless noted) | Mutates | Under gameplay lock? | Durability contract |
|---|---|---|---|
| `createRoom` / `createReservedRoom` | new `Room` in the Map | no | `notifyLiveRoomStateCommitted` (best-effort schedule) |
| `joinRoom` | `room.players.push(seatId)` (2-player cap) | no (called inside `attachSocketToTrackedRoom`) | roster persisted via live-session upsert |
| `initiatePregameDrawOrStart` / `startGame` | `state`, `preGameDraw`, `asyncStateVersion`, ready sets, event log | **yes** (`initiatePregameDrawOrStartUnlocked` / `startGameUnlocked` wrapped) | `commitLifecycleAfterMutate` — schedule + flush + **rollback + throw `RoomLifecyclePersistUncertainError`** if not durably recoverable |
| `nextHand` / `readyForNextHand` | `state` (new hand), `nextHandReady`, `lastHandEndedAtMs`, event log; `nextHandStartsByRoom` coalescing entry | **yes** (mark phase) + a detached `advance` chain that re-takes the lock | `commitLifecycleAfterMutate`; the detached advance swallows its own rejection, awaiters surface it |
| `act` (`MOVE` / `DRAW` / `PASS`) | `state`, `ghostMoveLogs`, `ghostTurnIndex`, event log, `pendingAutoPassNotice`, `pendingForcedDrawBroadcast` | **yes** (`actUnlocked` wrapped) | `notifyLiveRoomStateCommitted` after each commit; `game:action` handler adds `withGameActionIdempotency` + a rollback-on-uncertain path |
| `disconnectGrace` auto-act | calls `act()` (PASS/DRAW), `disconnectExpiries[seat]++` | via `act()` | flush + `rollbackRoomGameplayCommit` on uncertain, then stall-retry |
| `applyActiveMatchForfeit` (`roomForfeit.ts`) | `tournamentForfeitApplyStatus`, `abandonedAt`, `abandonedByUserId`, `abandonedReason`, `abandonedWinnerUserId`, event log | **no** | tournament: `abandonedAt` latched only after 4×-retry `applyMatchResult` succeeds; private/mm: latched immediately |
| `roomSession` `onGameOver` tail | `activeGameOverPersist`, `gameOverPersistStatus`, `matchLogged`, `rankingOutcome` | no (deferred scheduler) | 4-attempt retry ceiling; `markGameOverPersist{Succeeded,Failed}` |
| `game:rematch` handler | `rematchReady`, then `startGame` (resets `state`, event log) | start is locked; `rematchReady` mutation is not | waits on `gameOverPersistStatus`; archives `room_match_logs` before reset |
| `leaveTrackedRoom` (`roomSocketAttach.ts`) | `room.players` filter, roster, reconnect seats, event log | no | roster persisted best-effort |
| `migrateRoomSeat` / roster edits (`roomSession.ts`) | roster `socketId`/`userId`/`username`, `socket.data.{playerId,roomId,userId,username}` | no | in-memory + next live-session upsert |
| `roomEvents.appendRoomEvent` | `events`, `eventSequence` (monotonic) | inherits caller's lock | persisted with the room |

**Durable writes (all via `supabaseFetch` / PostgREST, service-role key, no
transactions — one `POST`/`PATCH`/`DELETE` each):**

| Helper | Table | Trigger | Idempotency |
|---|---|---|---|
| `schedulePersistLiveRoomSessionForRoom` → debounced `persistLiveRoomSessionNow` | `room_live_sessions` | every committed room mutation while live; forced flush on lifecycle ops + disconnect auto-act + shutdown | upsert on `room_code`; freshness fence in `room_shell.durabilityCommit`; spectator/persist skip when incoming `sequence` < stored |
| `finalizeAndDeleteLiveRoomSession` / `deleteLiveRoomSession` | `room_live_sessions` | terminal (game over persisted, abandoned) | delete by `room_code` |
| `persistRoomMatchLog(room, 'completed'\|'abandoned')` | `room_match_logs` | game-over persist success; forfeit; before rematch reset | `on_conflict=match_id` (last-write-wins on the same match id) |
| `persistRoomCommandReceipt` | `room_command_receipts` | each acked `game:action` | `on_conflict=(room_code,player_seat_id,request_id)`, `resolution=merge-duplicates` |
| `recordMatchEnd` (`matchmaking/persistence.ts`) | `matchmaking_matches` | game-over (completed) / forfeit | PATCH by `matchId`; no ordering guard noted |
| game-over side-effects | shared tables | see §2.1.6 | per-helper — some verified (`insertRankedGameIdempotent`), some **unverified** (`appendMatch`, `recordPublicOnlineMatch`, `writeMatchActivity`) |

### 2.1.4 Seat allocation & attach — the identity binding

A socket becomes a seat through **`attachSocketToTrackedRoom`**
(`roomSocketAttach.ts`), reached by two doors:

- **`room:join`** (`registerRoomJoinHandlers.ts`) — `via: 'room:join'`. Identity
  from `handlerDeps.resolveSocketIdentity(config)` (validates `authToken` →
  `userId`, or `null` for a guest).
- **`tournament:attach_assigned_match`**
  (`registerTournamentAttachHandlers.ts`) — `via: 'tournament:attach_assigned_match'`;
  enforces `match.player{1,2}_id === uid` **before** calling attach (§1.1.5 —
  this path is correctly gated).

A third door, matchmaking, goes through the same function with
`hydrateMatchmakingRoom: true` and an extra shell-hydration + ACL step.

**`attachSocketToTrackedRoom` sequence** (`roomSocketAttach.ts` ~237–718):

1. `leaveExistingSocketRooms({ exceptRoomCode: roomCode })` — sequential,
   awaited; forfeits any *other* live seat this socket holds (P4). Re-attaching
   to the room the socket already occupies is treated as a reconnect (not left).
2. `ensureRoomHydrated(roomCode)` → `room_live_sessions` load + freshness
   validation (§2.1.8). Outcomes: `already_in_memory` / `hydrated` /
   `shell_only` / `not_found` / `persistence_unavailable` /
   `snapshot_freshness_unknown` / `snapshot_invalid` / `snapshot_stale` — the
   last few **throw** (fail closed).
3. Matchmaking shell hydration (if `hydrateMatchmakingRoom` and room not in
   memory) → `handlerDeps.tryHydrateMatchmakingRoomShell(roomCode, userId)`.
   `forbidden` ⇒ `throw 'not_match_participant'` (M4).
4. Terminal-state gates on the in-memory room: `abandonedAt` ⇒ `match_abandoned`
   (+ archived-terminal routing); `tournamentForfeitApplyStatus` `pending`/`failed`;
   `state.gameOver` ⇒ `match_completed` (+ archived-terminal routing).
5. **Matchmaking seat ACL (M4):** if `existingRoom.matchmakingParticipantUserIds`
   is set and `userId` is not in it ⇒ `throw 'not_match_participant'`. Covers
   the already-in-memory shell (the hydrate check alone would lapse once a
   legitimate participant restored the shell).
6. **`room:join` tournament participant ACL (T-5 / PR-B):** only for
   `via === 'room:join'`. If `existingRoom.scheduledTournamentMatchId` is set
   **or** `isTournamentRoomCode(roomCode)` (shape check — tournament codes are a
   pure function of tournament id + round + match number, guessable from the
   public bracket), call `authorizeMatchParticipant(userId, {matchId}|{roomCode},
   {allowCompleted:true})`. Fail closed when a match-id marker or a resolved
   bracket row exists; a bare code-shape match with **no** backing row falls
   through to "ordinary private room" (documented intentional tradeoff). No ACL
   here for `tournament:attach_assigned_match` (already gated upstream).
7. **Reconnect by userId:** if a roster entry has `player.userId === userId` →
   `assertRoomDurabilityOperationAllowed(room, 'reconnect_existing_player')` →
   `migrateRoomSeat(roomCode, existingPlayer.id, socket.id)` **before**
   disconnecting the old socket, then `room:session:superseded` to the old
   socket, a 150 ms delay, `oldSocket.disconnect(true)`. Order is deliberate
   (`resolveActorSeatId` rejects the old socket the instant the roster entry
   moves — closes the duplicate-tab window).
8. **Reconnect-hold reclaim:** else, `pruneReconnectSeats(roomCode)` +
   `identityMatchesReconnectSeat(seat, {username, userId})` → reclaim that seat
   (prevents a solo-host reconnect from forking a zombie seat and falsely
   filling the room).
9. **New seat:** else `allocatePlayerSeatId()` + `joinRoom(roomCode, seatId)`
   (2-player cap in `rooms.ts joinRoom` — `throw 'Room is full'`).
10. `socket.join(code)`; set `socket.data.{roomId, username, userId}` +
    `ensureSocketDataSeat(socket, seatId)`; roster upsert; `room:update` emit.
11. Matchmaking auto-start (M6): if `matchmakingMatchId && !state` and both
    seats' sockets are synced (`waitUntilMatchmakingRoomSocketsReady`), run
    `tryStartMatchIfReady`; a sync timeout aborts + requeues both players
    (`throw 'match_sync_failed'`).
12. Best-effort tournament match metadata lookup (opponent name/rating) —
    never blocks the attach.

**`resolveActorSeatId(roomCode, socket)` (`roomSession.ts` ~206) — the gameplay
authz primitive:** trusts `socket.data.playerId` **only if** the roster says
*this* `socket.id` currently owns that seat (`owner.socketId === socket.id`);
else falls back to `getSeatIdForSocket(roomCode, socket.id)`; else throws.
Explicitly defends the seat-migration ↔ old-socket-teardown race.

**Identity model:** `playerSeatId` values are synthetic and internal. The
`seatId → userId` map is the **roster** (`RoomPlayer.userId`), which lives in
memory and is persisted in `room_live_sessions.roster`. `null` userId = guest
seat (allowed in private rooms; disallowed for ranked/tournament outcomes —
enforced at the game-over / forfeit sites, not at seat allocation).

### 2.1.5 Concurrency windows / race producers

All analysed as **in-process async interleaving** (single instance — §2.1.1).

**What `withRoomGameplayLock` serializes:** `act` (MOVE/DRAW/PASS),
`initiatePregameDrawOrStart` / `startGame` / `nextHand` bodies, the
`readyForNextHand` mark phase and its detached `advance` chain. Per room, FIFO.

**What runs *outside* that lock (the windows):**

| # | Window | Producers that can overlap | Current mitigation | Residual |
|---|---|---|---|---|
| MP-1 | **Game-over side-effect persist** | the deferred `onGameOver` scheduler runs detached from the lock; a `game:rematch`, a `room:abandon_match`, and a late `act` can all arrive while it is mid-flight | `activeGameOverPersist` promise + `gameOverPersistStatus` gate rematch/next-hand; `act` rejects on `state.gameOver` | rematch/abandon vs. persist ordering rests on status polling, not a lock |
| MP-2 | **Forfeit vs. real game-over** (shared with §1.1.3 producer 2) | `applyActiveMatchForfeit` (from `leaveTrackedRoom`, `room:abandon_match`, or disconnect-timeout) vs. `persistGameOverOnce` — both can call into System 1's `applyMatchResult` for the same tournament match | `authorizeMatchParticipant({allowCompleted:true})` + the RPC is the idempotent arbiter (System 1 T-INV-3); `tournamentForfeitApplyStatus` guards re-entry | non-tournament rooms: `abandonedAt` vs. `state.gameOver` both terminal, last writer wins on `room_match_logs` (`on_conflict=match_id`) |
| MP-3 | **Two attach attempts, same identity** (duplicate tab, reconnect race) | two `attachSocketToTrackedRoom` calls for one `userId` | `migrateRoomSeat` before old-socket teardown; `resolveActorSeatId` roster-ownership check; `inFlightHydrationByRoomCode` dedupes concurrent hydration | attach itself is not lock-serialized; step 7/8/9 branch selection is a read-then-act on roster state |
| MP-4 | **Disconnect-grace auto-act vs. reconnect** | grace timer firing `act()` vs. `onPlayerSocketRejoined` clearing the timer | `clearDisconnectGraceForSeat` on rejoin; expiry re-checks `stillConnected` + current turn before acting | timer callback already scheduled and past its guard checks can still act just as the player reconnects |
| MP-5 | **Pre-game draw timer vs. manual start** | `preGameDrawTimer` firing vs. an explicit start/ready | `startGameUnlocked` clears the timer; "coalesce concurrent starts" no-op when `room.state` already set | timer is in-memory only — lost on restart, leaving a room stuck pre-start until a client re-triggers |
| MP-6 | **`nextHand` coalescing** | multiple `readyForNextHand` + the detached `advance` promise | `nextHandStartsByRoom` single-flight per room; `advance` re-checks `nextHandReady.size` under the lock | the coalescing map is in-memory; a rollback after uncertain flush deliberately leaves `nextHandReady` populated for retry |
| MP-7 | **Spectator publish vs. mutation** | `publishMultiplayerSpectatorSnapshot` reads `room.state` while `act` mutates it | sequence check (`snapshot.sequence < session.latestSnapshot.sequence` ⇒ skip); `maskStateForRecipient(state, null)` | read is not under the lock; a torn read is possible but only feeds the read-only spectator projection |
| MP-8 | **Live-session persist vs. terminal delete** | debounced `persistLiveRoomSessionNow` vs. `finalizeAndDeleteLiveRoomSession` | `setLiveRoomPersistenceShuttingDown`, `cancelScheduledLiveRoomPersistence` on finalize | a debounced write that already left for PostgREST can land after the delete, resurrecting a terminal room's row |

**Cross-instance (out of scope, listed for the revisit trigger):** the `rooms`
Map, roster store, grace timers, lock chains, spectator registry, and hydration
dedupe map are all process-local; a second instance breaks all of MP-1..MP-8
and adds double seat allocation and undeliverable broadcasts.

### 2.1.6 Game-over / match-result sequence (multi-step, non-atomic)

Trigger: the engine sets `state.gameOver` inside a locked `act`; `roomSession`'s
broadcast tail calls `deps.onGameOver(input)` →
`createGameOverPersistScheduler(io)` returns a deferred runner stored in
`room.activeGameOverPersist`, status `pending`.

`persistGameOverOnce` (`gameOverPersistence.ts` ~111) runs, wrapped in a
**4-attempt** retry ceiling (`GAME_OVER_PERSIST_RETRY_DELAYS_MS`). No
transaction; each step is an independent `supabaseFetch`:

1. If `winnerUserId` resolvable → `applyTournamentGameOverFromRoom(io, room, …)`
   → System 1's `applyMatchResult` → `complete_tournament_match` RPC. **Returns
   early if applied** — a tournament match that played to completion reaches the
   bracket *only* through this branch.
2. Tournament room but not applied (or `findTournamentMatchByRoom(room.code)`
   fallback for a rehydrated room with no marker) → `throw`
   `TOURNAMENT_MISSING_WINNER_ERROR` / `TOURNAMENT_APPLY_FAILED_ERROR` (retry /
   give-up; ops repair doc `docs/ops/tournament-apply-match-result-repair.md`).
3. Pending Fritz match → `resolvePendingFritzMatch(room.code)`.
4. `appendMatch(...)` — stats match log.
5. `writeMatchActivity(...)` — social feed, fire-and-forget (`.catch(() => {})`).
6. `recordPublicOnlineMatch(...)` — public online match record (human-v-human,
   fire-and-forget).
7. **Move-log verification gate:** `evaluateHumanMoveLogVerification` →
   `verifyPlayerMoveLog(moveLog, {strictHandContinuity:true})` per human seat.
   Failure ⇒ `private_move_log_verification_failed` telemetry + record the
   result **without Glicko** (the match outcome still stands).
8. `insertRankedGameIdempotent(...)` ×2 (`ON CONFLICT (player_id,
   source_match_id) DO NOTHING`), then `processRealtimeMultiplayerGame(...)` if
   **both** inserts are new — Glicko-2 update to `profiles`.
9. `completeGhostGame(...)` per human seat (feeds the ghost/Fritz system;
   `applyGlicko` gated on verification).
10. `recordMatchEnd(...)` → `matchmaking_matches` (if `matchmakingMatchId`).
11. `room.rankingOutcome` set (`applied` / `duplicate` / `verification_skipped`
    / `eligible_not_applied` / `not_ranked`).
12. Linked `fixtures` / `league_members` → `recordLeagueLiveResult` (legacy
    league live-finalize).

On success: `markGameOverPersistSucceeded(room)` (sets `matchLogged`),
`private_game_over_persist_succeeded` telemetry, `room_match_logs` archived,
`room_live_sessions` row finalized/deleted. On give-up:
`markGameOverPersistFailed`, `match:result_persist_failed` to the room,
`private_game_over_persist_failed` telemetry.

**Partial-failure exposure:** an attempt that fails at step *k* is retried from
step 1. Steps 1 and 8 are idempotent (RPC conflict branch; `ON CONFLICT`).
Steps 4/6/5/9/10/12 rely on each helper's own idempotency — **`appendMatch`,
`recordPublicOnlineMatch`, `writeMatchActivity`, `recordMatchEnd` idempotency is
unverified** and is a Step-1-follow-up / gap-list item. A give-up after 4
attempts leaves: bracket possibly advanced (step 1 succeeded) but ranked/stats/
activity partially written, `room_live_sessions` **not** deleted (room stays
recoverable, `gameOverPersistStatus='failed'`), players see
`match:result_persist_failed`.

**Forfeit variant (`applyActiveMatchForfeit`, `roomForfeit.ts`):** triggered by
`leaveTrackedRoom` when `isLiveSeat && !preserveSeat`, by `room:abandon_match`,
and by `disconnectGrace` after 2 expiries (`forfeitReason:'disconnect_timeout'`,
Glicko scaled ×0.5). Tournament path: `tournamentForfeitApplyStatus='pending'` →
`authorizeMatchParticipant` (T-6 — a `null`/guest/non-participant leaver
forfeits **nothing**, status back to `idle`) → 4× `applyMatchResult`
(`winnerSource:'forfeit'`) → success latches `abandonedAt`; failure ⇒
`tournamentForfeitApplyStatus='failed'`, `abandonedAt` left unset. Private /
matchmaking path: latch `abandonedAt` immediately, then Glicko (actual
`room.state` scores, but outcome forced by who-quit), `recordMatchEnd`,
`persistRoomMatchLog(room, 'abandoned')`, emit `room:match_abandoned`.

### 2.1.7 Authorization checks (present / missing)

| Path | Identity source | Check present | Notes / gap candidate |
|---|---|---|---|
| `room:join` (private room) | `resolveSocketIdentity(config)` → `userId` or `null` | **none beyond knowing the 5-char code** | by design — the code is the capability. But: a guest (`userId=null`) can take a seat; two guests are indistinguishable on reconnect (roster match is by `userId` **or** username/hold) |
| `room:join` (matchmaking room) | as above | `matchmakingParticipantUserIds` ACL (M4) — in-memory **and** post-hydration | requires `userId` (guest can't be a matchmaking participant) |
| `room:join` (scheduled-tournament room) | as above | `authorizeMatchParticipant()` (T-5 / PR-B), fresh bracket read, fail-closed | bare code-shape-with-no-row falls through to private (documented tradeoff) |
| `tournament:attach_assigned_match` | `socket.data.userId` | `match.player{1,2}_id === uid` upstream (§1.1.5) ✔ | — |
| `game:action` (MOVE/DRAW/PASS) | `resolveActorSeatId` | roster-ownership (`owner.socketId === socket.id`) + `room.players.includes(seatId)` + engine turn/legal-move validation | solid; engine is authoritative |
| `game:ready_next_hand` | `resolveActorSeatId` | same as above; `room.players.includes` | — |
| `game:rematch` | `resolveActorSeatId` | `room.players` membership; `isAnyTournamentRoom` ⇒ blocked (T-12 / PR-D); waits on `gameOverPersistStatus` | — |
| `room:abandon_match` | `handlerDeps.normalizeUserId(socket.data.userId)` — **requires auth** | roster lookup by `userId`/`socketId` + `room.players.includes` | a guest seat cannot self-abandon (must disconnect out) |
| `leaveTrackedRoom` forfeit | `abandoningPlayer.userId ?? socket.data.userId` | `isLiveSeat`; tournament ⇒ `authorizeMatchParticipant` (T-6) | private/mm: whoever holds the seat forfeits it |
| `room:spectate` | `resolveSocketIdentity(config)` | `getRoom` + `!abandonedAt` — **no room-kind check** | **any** socket can spectate **any** room (incl. private), receiving `maskStateForRecipient(state, null)` (hands hidden; board, scores, hand counts, move feed visible). Info-exposure question for private rooms — gap candidate |
| Spectator **discovery** (`spectator:*` list) | — | `projectMultiplayerRoomForSpectators` only emits a discoverable session for `matchmakingMatchId && !scheduledTournamentMatchId && !abandonedAt` rooms | private + tournament rooms are spectatable-if-you-know-the-code but not listed |
| `room_live_sessions` / `room_match_logs` (direct Supabase read) | anon key + user JWT | **anon: verified blocked (2026-09-01)** — RLS ON, `SELECT` returns `*/0`. **authenticated: policy text unread** — needs the SQL-editor check | anon exposure ruled out. Open: does the authenticated `SELECT` policy let a participant read their own **live** row (unmasked `game_state` ⇒ opponent's hand)? And should the anon INSERT/UPDATE/DELETE grants be revoked (defence-in-depth; RLS already denies). |
| `room_command_receipts` | — | RLS deny-all client (migration) ✔ | — |

### 2.1.8 Reconnection & recovery paths

| Trigger | Path | What it does |
|---|---|---|
| **Server boot** | *(none)* | **There is no live-room recovery sweep.** Unlike System 1's `recoverTournamentMatches`, `index.ts server.listen` does not rehydrate rooms. An in-progress room whose players don't reconnect simply does not exist in memory until someone attaches. |
| Client reconnect / attach | `attachSocketToTrackedRoom` → `ensureRoomHydrated` → `loadLiveRoomSession(code)` → `validateLiveRoomHydrationRow` (freshness) → `applyLiveSessionRow` → supplement `room_command_receipts` from table → `hydrateGameActionReceiptsForRoom` | rebuilds the `Room` from `room_live_sessions`; `already_in_memory` short-circuits |
| Hydration freshness | `validateLiveRoomHydrationRow` + the `durabilityCommit` fence in `room_shell` | outcomes: `hydrated` / `shell_only` (roster but no game state) / `snapshot_stale` / `snapshot_invalid` / `snapshot_freshness_unknown` — the stale/invalid/unknown ones **throw** on attach (`room_snapshot_uncommitted`, etc.) rather than admit a possibly-behind room |
| Concurrent hydration | `inFlightHydrationByRoomCode` single-flight per code | second caller awaits the first |
| Disconnect (active player, mid-hand) | `onActivePlayerSocketDisconnect` → 30 s `graceTimersByRoomSeat` timer (in-memory, lost on restart) | on expiry, if still disconnected and it's their turn: durability check → auto-`act` (PASS/DRAW) → flush → rollback + stall-retry (6 × 10 s, then **pause — no forfeit**) if not durably recoverable; after **2** successful expiries → `applyActiveMatchForfeit('disconnect_timeout')` |
| Rejoin during grace | `onPlayerSocketRejoined` → `clearDisconnectGraceForSeat` + `disconnectExpiries[seat]=0` | emits `player:reconnected` |
| Terminal room join | archived `room_match_logs` row → `resolveArchivedTerminalJoin` → `MatchTerminalJoinError` | client routed to the result screen instead of a dead room |
| Rehydrated tournament room | `scheduledTournamentMatchId` is **not** in the persisted shell → `room:join` uses `isTournamentRoomCode(code)` shape + a fresh bracket lookup (PR-B) | keeps the tournament ACL working across a restart |
| Graceful shutdown (SIGTERM/SIGINT) | `platform/gracefulShutdown.ts`: notify clients → stop HTTP → `flushAllPendingLiveSessions({timeoutMs})` → close sockets → exit | bounded flush of all debounced pending live-session writes |
| Hard kill / OOM | *(none)* | debounced pending `room_live_sessions` write is lost; the last committed row is the recovery point (a few seconds of play may be gone; freshness fence should force `snapshot_stale` rather than silent rollback) |
| Self-ping | `index.ts` ~950 — `SERVER_URL` set ⇒ `fetch(${SERVER_URL}/ping)` every 10 min | redundant backup to the external UptimeRobot monitor (System 1 T-17) |

**Lost on every restart:** `graceTimersByRoomSeat`, `preGameDrawTimer`, the
spectator registry, `nextHandStartsByRoom`, `withRoomGameplayLock` chains,
`getRoomRuntimeStats` counters, in-flight hydration promises.

### 2.1.9 Move-log / match-log verification — verified vs. merely recorded

**Server-authoritative (verified by construction):** the game itself. The client
sends action *intents* (`MOVE {tile, position}`, `DRAW`, `PASS`); the server's
engine (`applyMove` / `resolveDrawUntilPlayableAtomically` /
`finalizeMandatoryAutoPasses`) computes the next `GameState`, and every commit
runs `assertTileCountInvariant` + `assertValidGameState`. A client cannot inject
a board state. `handStateTamperBackstop` (`handStateTamperBackstop.test.ts`) is
the regression guard for this.

**Recorded, sequence-guarded, but not independently re-verified:**

- `RoomMatchEvent` log (`roomEvents.ts`) — append-only, monotonic `eventSequence`;
  persisted to `room_live_sessions.events` and archived to
  `room_match_logs.events`. On persist, an incoming snapshot with a lower
  sequence is skipped. Not re-checked for internal consistency on read.
- `room_match_logs.state_snapshot` / `summary` — a point-in-time archive; no
  replay-verification on write or read.

**Verified at game-over (and only gating Glicko, not the result):**

- `ghostMoveLogs[seatId]` — the per-seat transcript, same shape as the Daily
  Fritz engine journal. `verifyPlayerMoveLog(moveLog, {strictHandContinuity:true})`
  checks hand continuity (each entry's `hand_before` follows from the previous
  entry's play/draw). Failure ⇒ record the match **without Glicko** +
  `private_move_log_verification_failed` telemetry. The match outcome, scores,
  and `room_match_logs` archive are unaffected.
- `assertUnmaskedGameStateForPersistence` — guards that what goes into
  `room_live_sessions.game_state` is the full state, never a
  `maskStateForRecipient` projection (so a hydrated room isn't missing the
  opponent's hand).

**The analogue of System 1's "is the score server-authoritative?" question:**
here the *game* is server-authoritative, but the *transcript* used for anti-cheat
(`ghostMoveLogs`) is verified only for hand-continuity and only at the end, and a
verification failure is non-blocking. Whether that is the right posture is a §2.2
question.

### 2.1.10 Existing idempotency / durability prior art (reusable)

- **`roomCommandReceiptStore` + `gameActionIdempotency`** — `withGameActionIdempotency(roomCode, playerSeatId, requestId, execute)` returns the cached `ack` for a replayed `game:action`; backed by `room_command_receipts` (RLS-locked, migrated) **and** an embedded `room_shell.actionReceipts` snapshot, reconciled on hydration.
- **`roomDurability` / `roomDurabilityPolicy`** — a commit fence + `idle|degraded|failed` status; `assertRoomDurabilityOperationAllowed(room, op)` gates `match_start` / `new_hand` / `gameplay_action` / `rematch` / `reconnect_existing_player` / `join_new_player` against it.
- **`commitLifecycleAfterMutate` / `captureRoomLifecycleSnapshot` / `rollbackRoomLifecycleCommit`** — the mutate → schedule → flush → *roll back and throw `RoomLifecyclePersistUncertainError`* contract, already shared by `startGame` / `nextHand` / `readyForNextHand` and the disconnect auto-act.
- **`insertRankedGameIdempotent`** (`ON CONFLICT (player_id, source_match_id) DO NOTHING`, `resolution=ignore-duplicates`) — the ranked-write idempotency primitive, already used by both the game-over and forfeit paths.
- **`asyncStateVersion`** (per-hand bump) + **monotonic `eventSequence`** + the persist/spectator **sequence-skip** — the "reject a stale write" pattern.
- **System 1's `complete_tournament_match` RPC** — for scheduled-tournament rooms this is *already* the atomic, idempotent, conflict-explicit sink for both game-over and forfeit. The multiplayer side's job is to route to it correctly and durably, not to re-implement the guarantee.
- **`matchmaking` `recordMatchEnd`** — single PATCH of the outcome row (ordering-guard status TBD in §2.3).

## 2.2 Invariants

Status: **RATIFIED 2026-09-01 (Decisions D-9).** The human reviewed
MP-INV-1..19 line-by-line and signed off. Residual notes are in D-9 — the two
that matter: **MP-INV-2** has a known unclosed guest-reconnect gap (tracked as
MP-G13, Tier C), and **MP-INV-19 is a posture decision, not a hard invariant**
(move-log verification stays non-blocking; the ratified direction is to add an
alert + per-user tracking, MP-G14). Changes from here require a new dated
Decisions-log entry.

**Framing.** System 2 has no single sink like System 1's RPC. Authority is the
in-memory `Room` (§2.1.2); the enforcing mechanisms are spread across the
per-room `withRoomGameplayLock` chain, the `attachSocketToTrackedRoom` sequence,
the roster store, the deferred game-over scheduler, the `commitLifecycleAfterMutate`
durability contract, and RLS. Each invariant names **the rule**, **the mechanism
that enforces it today** (or **UNENFORCED** → the §2.3 gap that covers it), and
the **failure mode** if it breaks. Every invariant is grounded in a concurrency
window (MP-1..MP-8, §2.1.5) or an authz row (§2.1.7) — none is invented fresh.
The concurrency *mechanism* for the unenforced ones is a **Step 3** decision, not
this step.

**Precondition for all of them:** the single-instance deployment fact (§2.1.1).
A second instance breaks every invariant here simultaneously — that is the
§2.1.1 revisit trigger, not a set of individual gaps.

### Seat & identity binding

**MP-INV-1 — One seat, one live socket, re-checked every action.**
At any instant a `playerSeatId` in `room.players` is owned by exactly one
`socket.id` (the roster's `RoomPlayer.socketId`). Every gameplay action
re-derives the actor's seat from *current* roster ownership, never from a value
cached on the socket.
*Enforced by:* `resolveActorSeatId` (`roomSession.ts` ~206) — trusts
`socket.data.playerId` only if `roster.owner.socketId === socket.id`, else
`getSeatIdForSocket`, else throws; reconnect runs `migrateRoomSeat` **before**
tearing down the old socket (§2.1.4 step 7), and `room:session:superseded` +
150 ms + `disconnect(true)` for the old one.
*Failure mode:* a superseded tab plays a move as the reconnected player (MP-3).

**MP-INV-2 — Seat identity is fixed for the life of the match.**
Once a seat is bound to an identity — a `userId`, or a guest (`userId=null`) +
username/hold — only that identity may reclaim it on reconnect. A different
`userId` is never seated into an occupied or held seat.
*Enforced by:* §2.1.4 steps 7–8 — reconnect-by-userId requires
`player.userId === userId`; hold-reclaim requires `identityMatchesReconnectSeat`;
new-seat allocation (step 9) runs only when neither matches and the room is
under cap.
*UNENFORCED for two guest seats:* the reconnect match is username-or-hold only —
a second guest who knows the room code and the first guest's display name can
reclaim their seat (§2.3 **MP-G13**). Ranked/tournament rooms require `userId`,
so this is a private-unranked exposure.

**MP-INV-3 — At most two seats; the cap is allocation-time and permanent.**
`room.players.length ≤ 2` always. Reconnect, hold-reclaim, and seat migration
never grow `room.players` — only `joinRoom` (step 9) appends, and it rejects a
third.
*Enforced by:* `rooms.ts joinRoom` 2-player cap (`throw 'Room is full'`); steps
7–8 mutate ownership, not membership; the step-8 reclaim exists specifically to
stop a solo-host reconnect forking a phantom opponent.
*Failure mode:* a zombie third seat filling a room / a phantom opponent.

### Room-kind access control

**MP-INV-4 — Matchmaking rooms admit only their two matched users.**
A socket may hold a seat in a room with `matchmakingParticipantUserIds` set only
if its `userId` is one of the two — checked against the in-memory room **and**
re-checked after any shell hydration.
*Enforced by:* `attachSocketToTrackedRoom` step 3 (`tryHydrateMatchmakingRoomShell`
→ `forbidden` ⇒ throw) + step 5 (in-memory ACL) — M4.
*Failure mode:* a stranger takes a matchmaking seat; on game-over their `userId`
gets the rated result.

**MP-INV-5 — Scheduled-tournament rooms admit only the two bracket participants.**
For `via === 'room:join'`, if the room is (or by code-shape looks like) a
scheduled-tournament room, the joiner passes `authorizeMatchParticipant` against
a **fresh** bracket read; fail-closed whenever a match-id marker or a resolved
bracket row exists.
*Enforced by:* step 6 (T-5 / PR-B); survives a restart via `isTournamentRoomCode`
shape + fresh lookup (the marker isn't in the shell).
*Known tradeoff:* a bare code-shape match with no backing bracket row falls
through to "ordinary private room" — documented, accepted.
*Failure mode:* the historical T-5 hole — guess the bracket-derivable code, take
the empty seat, advance as a stranger.

**MP-INV-6 — Spectators see only masked state, and only where spectating is allowed.**
A spectator socket receives `maskStateForRecipient(state, null)` — board,
scores, hand counts, move feed; never a hand. Spectator **discovery** lists
matchmaking rooms only.
*Enforced by:* `room:spectate` masking (always) + `projectMultiplayerRoomForSpectators`
discovery filter.
*UNENFORCED (second clause):* `room:spectate` has **no room-kind check** — any
socket that knows a 5-char code can spectate a **private** room (§2.3 **MP-G3**).
Whether private rooms should be spectatable at all without a participant
relationship is a Step 2 decision (see §2.3.1).

### Game-state authority & mutation ordering

**MP-INV-7 — Every state mutation is engine-computed, lock-serialized, invariant-checked.**
`room.state`, the event log, and `ghostMoveLogs` are mutated only inside
`withRoomGameplayLock` for that room, FIFO per room. A client action is an
*intent* (`MOVE {tile,position}` / `DRAW` / `PASS`); the server engine computes
the next `GameState`. Every commit runs `assertTileCountInvariant` +
`assertValidGameState`.
*Enforced by:* `roomGameplayLock.ts`; the `*Unlocked` wrapping of `act` /
`startGame` / `nextHand`; the engine; `handStateTamperBackstop`.
*Failure mode:* a client injects a board state; two actions interleave mid-commit.

**MP-INV-8 — `eventSequence` is strictly monotonic; stale writes are refused everywhere.**
Per room, `eventSequence` only increases. Any consumer that receives a
lower-or-equal sequence than it has already applied — the live-session persist,
the spectator projection, hydration freshness — **skips** it, never applies it.
*Enforced by:* `roomEvents.appendRoomEvent` monotonic bump; the sequence-skip in
`persistLiveRoomSessionNow` / spectator publish; `validateLiveRoomHydrationRow`.
*Failure mode:* a debounced older snapshot overwrites a newer one; a torn
spectator view.

**MP-INV-9 — Lifecycle transitions are commit-or-rollback.**
`startGame` / `nextHand` / `readyForNextHand` and the disconnect auto-act either
persist durably or are rolled back in memory and throw
`RoomLifecyclePersistUncertainError`. The room never advances on a state that
isn't recoverable.
*Enforced by:* `commitLifecycleAfterMutate` / `captureRoomLifecycleSnapshot` /
`rollbackRoomLifecycleCommit`; `assertRoomDurabilityOperationAllowed`.
*Failure mode:* a hand starts, the process dies before the write lands, the
reconnecting player hydrates a room that never "really" started.

### Persistence & recovery

**MP-INV-10 — The persisted snapshot is always full, unmasked, and fresh-or-rejected.**
`room_live_sessions.game_state` is the complete server `GameState` (both hands,
boneyard order, dead tiles) — never a `maskStateForRecipient` projection.
Hydration admits a room only if the snapshot passes the `durabilityCommit`
freshness fence; `snapshot_stale` / `_invalid` / `_freshness_unknown` **throw**
on attach.
*Enforced by:* `assertUnmaskedGameStateForPersistence` on write;
`validateLiveRoomHydrationRow` on read.
*Failure mode:* a hydrated room missing the opponent's hand / silently rolled
back to an earlier board.

**MP-INV-11 — Terminal finalize is final.**
After `finalizeAndDeleteLiveRoomSession` / `deleteLiveRoomSession` for a room, no
later write re-creates its `room_live_sessions` row.
*UNENFORCED:* a debounced `persistLiveRoomSessionNow` already dispatched to
PostgREST can land **after** the delete and resurrect the row (MP-8 / §2.3
**MP-G7**). `setLiveRoomPersistenceShuttingDown` + `cancelScheduledLiveRoomPersistence`
cover the *scheduled* write, not the *in-flight* one.
*Failure mode:* a finished match's row reappears with `status='playing'`; a
later attach hydrates a live room that is actually over.

**MP-INV-12 — Room tables are server-authored only.**
`room_live_sessions` / `room_match_logs` / `room_command_receipts` accept writes
only via the service-role key. Clients cannot write them (RLS `_no_client_write`
deny-all), cannot read live `room_live_sessions` rows at all, and can read
`room_match_logs` only for their own **terminal** rows (by design).
*Enforced by:* RLS — **confirmed against prod 2026-09-01** (§2.7, D-8). Holds.
*Residual:* client INSERT/UPDATE/DELETE grants still exist (RLS-gated only) —
defence-in-depth revoke (§2.3 **MP-G2**); `room_command_receipts` may not be
applied to prod at all (§2.3 **MP-G6**).

**MP-INV-13 — A restart loses only what is reconstructable.**
Everything lost on restart (`graceTimersByRoomSeat`, `preGameDrawTimer`, lock
chains, `nextHandStartsByRoom`, spectator registry, in-flight hydration) is
either re-derivable from `room_live_sessions` on the next attach or is a timer
whose absence is safe.
*UNENFORCED for two cases:* `preGameDrawTimer` lost mid-draw strands a room
pre-start (MP-5 / §2.3 **MP-G8**); there is **no boot recovery sweep**, so an
in-progress room with both players disconnected across a restart does not exist
until someone reconnects (§2.3 **MP-G9** — likely accept).

### Game-over / result integrity

**MP-INV-14 — One terminal outcome per match; first commit wins.**
A match ends exactly once. Whichever of {play-to-completion game-over,
forfeit/abandon} commits first is the recorded outcome; the other becomes a
no-op that does **not** overwrite the winner, scores, or terminal status.
*Enforced by:* tournament rooms — System 1's `complete_tournament_match` RPC is
the idempotent arbiter (T-INV-3) + `tournamentForfeitApplyStatus`.
*UNENFORCED:* non-tournament rooms — `abandonedAt` and `state.gameOver` are both
terminal and the later `persistRoomMatchLog` / `recordMatchEnd` just overwrites
(`on_conflict=match_id` last-write-wins) (MP-2 / §2.3 **MP-G5**).
*Failure mode:* a rage-quit at the score screen records "abandoned" over a
completed game (or vice-versa); a matchmaking rating delta applied for the wrong
reason.

**MP-INV-15 — Each downstream sink receives a match's result at most once.**
The game-over side-effect sequence (§2.1.6) is retried as a whole up to 4×.
Every sink it touches — bracket, ranked/Glicko, `matchmaking_matches`, stats
match-log, ghost, activity feed, `room_match_logs` — must be idempotent on match
id so a retry after a partial failure does not double-apply.
*Enforced by:* bracket (RPC conflict branch), ranked (`insertRankedGameIdempotent`
`ON CONFLICT`).
*UNENFORCED:* `appendMatch`, `recordPublicOnlineMatch`, `writeMatchActivity`,
`recordMatchEnd` idempotency is **unverified** (§2.3 **MP-G4**) — the direct
multiplayer analogue of System 1's T-3.
*Failure mode:* double stats rows, a duplicated activity-feed post, a second
matchmaking outcome write with a fresh rating delta.

**MP-INV-16 — The tournament bracket is reached only one way, and only after it's real.**
For a scheduled-tournament room, a played-to-completion result reaches System
1's bracket **only** through the `applyTournamentGameOverFromRoom` branch of
`persistGameOverOnce`. `abandonedAt` for a tournament room is latched **only
after** `applyMatchResult` succeeds; `pending` / `failed` block the room without
asserting the bracket advanced.
*Enforced by:* `gameOverPersistence.ts` reading `room.scheduledTournamentMatchId`
directly (the loud-comment branch, T-12); `tournamentForfeitApplyStatus`.
*Failure mode:* the T-12 hole — widening `roomKind` severs the only bracket
path; a crafted rematch floats a game free of the bracket.

**MP-INV-17 — No rated outcome without two real accounts; no defaulted forfeit winner.**
A ranked or tournament result is applied only when **both** seats carry a
non-guest `userId`. A forfeit is applied only by a socket that currently holds a
live seat; a `null` / guest / non-participant leaver forfeits nothing and never
causes a winner to be defaulted to the other seat.
*Enforced by:* guest exclusion at the game-over / forfeit sites (not at seat
allocation); tournament forfeit `authorizeMatchParticipant` (T-6).
*Failure mode:* the historical T-6 hole — a non-participant leaver hands player1
the win.

### Disconnect / grace

**MP-INV-18 — An auto-act fires only on a still-valid trigger, and never on an uncertain commit.**
A disconnect-grace timer's callback acts (`PASS` / `DRAW`) only if, at execution
time, the seat is still disconnected and it is that seat's turn. A reconnect
that lands first cancels it. If the auto-act cannot be durably committed it
**pauses and retries** (6 × 10 s, then holds — no forfeit). Forfeit happens only
after **2** clean grace expiries.
*Enforced by:* `clearDisconnectGraceForSeat` on rejoin; the expiry's
`stillConnected` + turn re-check; the rollback + stall-retry path.
*Residual:* a callback already past its guard checks can still act in the
instant the player reconnects (MP-4 / §2.3 **MP-G11**) — one turn, tight window.

### Anti-cheat posture — open question, not yet an invariant

**MP-INV-19 — POSTURE DECISION (Step 2).** Today: `ghostMoveLogs` is verified
for hand-continuity only, only at game-over, and a failure suppresses Glicko but
not the result or the `room_match_logs` archive. Decide whether that is the
right bar for a rated ladder, or whether a verification failure should
additionally (a) raise a structured alert (the System 1 D-3 pattern) and (b) be
tracked per-user. **Not** proposing to block the result on it. → §2.3 **MP-G14**.

## 2.3 Gap list (risk-ranked)

Status: **RATIFIED 2026-09-01 (Decisions D-9)**, including the §2.3.2
verification-pass verdict changes (MP-G5 A→C, MP-G9 ACCEPT→REVISIT). Every §2.1
candidate is carried through and ranked. Step 3 scope = Tier A only (MP-G1,
MP-G3, MP-G4; MP-G2 folded into MP-G1) — see §2.4.

**Scoring.** *Severity* ∈ {data-corruption, competitive-integrity, auth-bypass,
player-visible-bug, cosmetic}. *Likelihood* is judged **for the confirmed
single-instance deployment (§2.1.1)** and realistic pre-marketing traffic — a
"cross-instance" failure is out of scope (it is the §2.1.1 revisit trigger, not
a gap). *Blast radius* = how far one occurrence spreads. *Verdict* ∈ {**FIX NOW**
(Step 3), **VERIFY NOW** (cheap prod check), **REVISIT IF SCALE** (accepted at
current scale, re-rank when traffic/instances change), **ACCEPT** (deliberate,
no action)}.

### Tier A — real bug, fix in Step 3

**Status 2026-09-01: all three CLOSED and LIVE IN PROD.** MP-G1/MP-G2/MP-G4 —
code `37054fda` + both migrations applied to prod and verified. MP-G3 — code
`37054fda`, **deployed to Render 2026-09-01 (prod release `907435df`) and
verified live**: an unauthenticated `room:spectate` returns `auth_required`, an
authenticated `room:spectate` on a private room returns `not_spectatable`
(smoke-tested against prod, throwaway room, cleaned up).


| ID | Gap | Location | Severity | Likelihood (1 instance) | Blast radius | Verdict | Protects |
|---|---|---|---|---|---|---|---|
| **MP-G3** | `room:spectate` has **no room-kind check** (`registerRoomSpectateHandlers.ts` — `getRoom(code)` + `!abandonedAt`, then a `maskStateForRecipient(state, null)` snapshot; the spectator socket may be **unauthenticated** — `resolveSocketIdentity` returns `userId:null` and is not rejected). Any socket with a 5-char code spectates a **private** room and sees board, scores, hand counts, and the move feed (not hands). **Confirmed in code (2026-09-01 verification pass):** ranked eligibility is decided *solely* by `a.userId && b.userId && !fritzActivityCtx` in `persistGameOverOnce` (`gameOverPersistence.ts` ~199, ~233) — **not** by matchmaking origin, no room-kind flag — so a private room with two logged-in players **is** fully rated (Glicko-2 → `profiles`, `ranked_games`, `recordPublicOnlineMatch`). A spectator relaying the live board to one player is real rating manipulation. | `multiplayer/registerRoomSpectateHandlers.ts`; `realtime/gameOverPersistence.ts` | competitive-integrity + info-exposure | **low–medium** — enumeration *is* throttled (`room:spectate` 30/min/socket + a 5-failed-lookup/60s block on `room:join`+`room:spectate`, `index.ts` ~647), so the vector is an **obtained/shared/leaked code** (Discord, stream, link) + a watcher, not a brute-force scan | one private room per leaked code | **FIX NOW** — premise confirmed, fix is cheap (room-kind gate + require the spectator to be an invited/known party), per-incident impact is ladder-rating manipulation | MP-INV-6 |
| **MP-G4** | Game-over side-effect helpers **`appendMatch` / `recordPublicOnlineMatch` / `writeMatchActivity` / `recordMatchEnd`** have **unverified idempotency**. The whole §2.1.6 sequence is retried up to 4× from step 1, so any failure at step ≥4 replays the earlier network writes. Direct analogue of System 1's **T-3**. | `gameOverPersistence.ts` §2.1.6 steps 4/5/6/10; `matchmaking/persistence.ts` `recordMatchEnd` | data-corruption | medium–high (steps 4/5/6 are network calls; a single transient failure triggers the replay) | cumulative — every match that hits a partial failure double-writes stats / a dup activity post / a second matchmaking outcome (fresh rating delta) | **FIX NOW** | MP-INV-15 |
| **MP-G1** | **`room_live_sessions` / `room_match_logs` schema is unmanaged** — canonical DDL sits in `supabase/room_live_sessions.sql` / `room_match_logs.sql` but there is **no migration**. 4th instance of the documented "reviewed SQL never applied / prod silently diverges" root cause (T-1, ghost tables, commit_glicko, the content-lifecycle RPCs). | `supabase/*.sql` vs `supabase/migrations/` | process / latent-drift | high that it bites again on the next RLS or column change | any future room-table schema change | **FIX NOW** (cheap — the DDL exists; also folds in MP-G2) | MP-INV-12 |

### Tier B — verify against prod now (cheap), fix if confirmed

| ID | Gap | Location | Severity | Verdict | Protects |
|---|---|---|---|---|---|
| **MP-G6** — **CLOSED + LIVE 2026-09-01** | Both `room_command_receipts` and `mp_authority_events` were **confirmed absent from prod** (service_role `PGRST205`, not in OpenAPI, no `assert_security_posture()` trace; both source migrations `5947dd36` / `420be2b7` committed but never applied — 5th/6th drift instance). **Fixed:** `2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql` **applied to prod (human, SQL editor); self-assert passed.** Verified read-only after: `to_regclass` → all 3 objects non-NULL; PostgREST OpenAPI now lists all 3; `service_role` GET → `200 */0` on both tables + the view (was `PGRST205`); `assert_security_posture()` `hard_fail_count:0`, neither table flagged, `advisory_count` unchanged at 70 (⇒ RLS on, no client write grant); anon GET **and** INSERT → `401 / 42501 permission denied for table` on both; `service_role` INSERT round-trip → `201` (incl. `mp_authority_events` with `event='private_game_over_persist_succeeded'` — the name the original CHECK would have rejected), test rows DELETEd (`204`), tables back to `*/0`. Corrections vs the originals that shipped: explicit `revoke`/`grant` on `room_command_receipts`; the stale `event` CHECK dropped on `mp_authority_events`. **No deploy needed** — the server code (`roomCommandReceiptStore`, `mpAuthorityEventStore`) already targets these tables and was silently degrading; it now writes for real. | `roomCommandReceiptStore`, `mpAuthorityEventStore` | player-visible-bug (latent, silent) + lost observability — **resolved** | **DONE.** | MP-INV-15 |
| **MP-G2** — **CLOSED 2026-09-01** | Client `INSERT/UPDATE/DELETE` grants existed on both room tables (RLS-gated only). | room-table grants | none today | **DONE** — `2026-09-01_room_tables_schema_and_grant_lockdown.sql` applied to prod; `assert_security_posture()` no longer flags either table, anon `INSERT` → `42501 permission denied for table`. | MP-INV-12 |

### Tier C — theoretical at current scale; revisit when traffic / instance count changes

| ID | Gap | Window | Severity | Why it's low now | Verdict | Protects |
|---|---|---|---|---|---|---|
| **MP-G5** | **Non-tournament terminal outcome is last-writer-wins.** `abandonedAt` and `state.gameOver` are both terminal; the later `persistRoomMatchLog` / `recordMatchEnd` overwrites (`on_conflict=match_id`). A rage-quit at the score screen, or a disconnect-timeout racing a real finish (MP-2), records the wrong terminal status / blames the wrong player. Tournament rooms are covered (RPC + `tournamentForfeitApplyStatus`); private/matchmaking are not. **The matchmaking half is fixed by MP-G4's `recordMatchEnd` conditional PATCH** (first-terminal-wins) — the `room_match_logs` half is the residual. | MP-2 | player-visible-bug + minor data-corruption | **low; 0 evidence.** §2.3.2 scan for `status='abandoned' AND summary->>gameOver='true'` = 0 rows; ~88 human-v-human matches ever. **Now measurable in prod** (2026-09-02): MP-G6 made `mp_authority_events` live, so `private_match_abandoned` + `private_match_archived` events for one `room_code` close in time would show the race. | one match's archive | **REVISIT IF SCALE** (was Tier A — downgraded 2026-09-01). Step 3: a "first terminal outcome wins" latch for private (mirror `tournamentForfeitApplyStatus`). | MP-INV-14 |
| **MP-G7** | Debounced live-session write in flight to PostgREST lands **after** `finalizeAndDeleteLiveRoomSession`'s DELETE → resurrects a `status='playing'` row. `finalizeAndDeleteLiveRoomSession` calls `persistLiveSessionRowNow` **directly** (bypasses the `inFlightPersistByRoomCode` single-flight) and does not await an in-flight write. | MP-8 | player-visible-bug | **verified 2026-09-02 (§2.3.3):** the freshness fence (`validateLiveRoomHydrationRow:565`) rejects a resurrected **game-over** row (status↔`game_state` consistency) — but **NOT** an **abandon** resurrect (`status='playing'` + `gameOver=false` is self-consistent; `abandonedAt` lives only in `room_shell` and is overwritten). Window: a debounced write (`LIVE_PERSIST_DEBOUNCE_MS=75`) mid-HTTP at the DELETE instant + a surviving process. | **REVISIT IF SCALE** — Step 3: a short-lived tombstone / `deleted_at` guard so a late upsert no-ops (this is the real fix — the fence is not sufficient for the abandon case) | MP-INV-11 |
| **MP-G8** | `preGameDrawTimer` is in-memory; a restart during the (seconds-long) pre-game high-draw window strands the room pre-start until a client re-triggers. | MP-5 | player-visible-bug | tiny window; client re-trigger recovers it | **REVISIT IF SCALE** — Step 3 if cheap: persist a `preGameDrawDeadline`, or fall back to immediate start on hydrate | MP-INV-13 |
| **MP-G9** | **No boot-time live-room recovery sweep.** A restart drops every in-memory `Room`; rooms recover **lazily** when a player reconnects and re-hydrates from `room_live_sessions`. If **neither** player of an in-progress match reconnects, the match is stranded — no archive, no result, no rating applied — and there is **no periodic stale-live-session reaper** to clean it up. Tournament rooms are covered separately by System 1's `reconcileExpiredReadyMatches`. | §2.1.8 | player-visible-bug ("my ranked game vanished with no result"); **not** corruption (the freshness fence rejects a stale hydration cleanly) | **restarts are more frequent than a dedicated box** (§2.3.2): deploy-driven, `main` took commits on 20 of the last 21 days (bursty — up to 58/day); prod is on `a93eea1e` (committed 11:36 PT) with `uptimeSeconds ≈ 20360` (~5.6 h) ⇒ ≥1 restart today. Free-tier *idle* spin-down is mitigated (T-17 pinger) but deploy restarts are not; Render crash logs aren't visible from here. Lazy hydration does handle the common case (someone reconnects). | **REVISIT IF SCALE** (was ACCEPT — upgraded 2026-09-01: restart frequency is real, currently more a heavy-dev artifact than a prod steady-state one). Step 3: pair with a **periodic stale-`room_live_sessions` reaper** (resolve/abandon a live row untouched for N minutes) rather than a boot sweep; document the lazy-hydration rationale in §2.4. | MP-INV-13 |
| **MP-G10** | `attachSocketToTrackedRoom` is **not lock-serialized** — the step 7/8/9 branch selection is a read-then-act on roster state after the (deduped) `ensureRoomHydrated` await. | MP-3 | player-visible-bug (double-allocated / zombie seat) | **verified 2026-09-02 (§2.3.3): low** — could not construct a concrete failure for a single identity: the post-hydration reconnect-by-userId branch (`roomSocketAttach.ts:406–432`) is fully synchronous, `resolveActorSeatId` ownership + `joinRoom`'s 2-seat cap bound the rest. Downgraded from low–medium. | **REVISIT IF SCALE** — a per-room attach lock is belt-and-braces (also closes MP-G11's residual), not a fix for a demonstrated bug | MP-INV-1, MP-INV-2, MP-INV-3 |
| **MP-G11** | A disconnect-grace timer callback already past its `stillConnected` + turn guards can still auto-`act` in the instant the player reconnects. | MP-4 | player-visible-bug | one turn; tight window between guard check and the locked `act` | **REVISIT IF SCALE** — Step 3 if cheap: re-check seat ownership *inside* the locked `act` the callback schedules | MP-INV-18 |
| **MP-G13** | **Two guest seats are indistinguishable on reconnect** — the roster match is `userId` **or** username/hold, and both guests have `userId=null`. A second guest who knows the room code and the first guest's display name can reclaim their seat. | §2.1.4 step 8 | auth-bypass (narrow) | low — private + unranked context, needs code + known display name | **REVISIT IF SCALE** — Step 3 if cheap: bind a guest seat to a per-connection hold token, not the username | MP-INV-2 |

### Tier D — anti-cheat posture decision (Step 2)

| ID | Question | Recommendation |
|---|---|---|
| **MP-G14** | Move-log verification is **non-blocking and hand-continuity-only**, run once at game-over; a failure suppresses Glicko but not the result or the `room_match_logs` archive (§2.1.9). Is that the right bar for a rated ladder? **Confirmed 2026-09-02** — `verifyPlayerMoveLog({strictHandContinuity:true})` → on fail `emitMpAuthorityFunnel('private_move_log_verification_failed')` + `humanGlickoEligible=false`. **Partially addressed:** since MP-G6, `mp_authority_events` is live so the failure IS durably recorded + queryable (`mp_authority_funnel_metrics`). | Keep it non-blocking for the *result*. Remaining Step-3 work: (a) an actual **alert** (notification) on the failure event, not just a queryable row; (b) **per-user aggregation** so repeated failures for one account surface. MP-INV-19's resolution target. |

### Tier E — accept, no action

| ID | Item | Why accept |
|---|---|---|
| **MP-G15** | MP-6 — `nextHandStartsByRoom` coalescing map is in-memory; a rollback after an uncertain flush deliberately leaves `nextHandReady` populated for retry. | Deliberate design; the retry is the correct behaviour. |
| **MP-G16** | MP-7 — spectator publish can do a torn read of `room.state` while `act` mutates it. | Feeds only the read-only, masked spectator projection; the sequence-skip drops stale snapshots. Cosmetic. |
| **MP-G17** | `room_match_logs` participant-reads-own-**terminal**-rows (RLS `room_match_logs_select_own`). | Post-game, per-match-private data, readable only by a participant of that match. Deliberate and confirmed (§2.7 / D-8). Re-classify to a Tier-C item only if a concrete "why should the client not have this" emerges — none identified. |
| **MP-G12** — **moved here from Tier C (2026-09-02, §2.3.3)** | Rematch vs the in-flight game-over persist. The §2.1.5 audit said it "rests on status polling, not awaiting the promise" — **wrong.** `game:rematch` → `waitForActiveGameOverPersist` → `return await pending` awaits `room.activeGameOverPersist`; the pre-assignment window is handled by an `idle`-status reject (`MATCH_RESULT_STILL_SAVING_MESSAGE`). The recommended fix is already implemented. |

### 2.3.1 — §2.1.7 authz-map items: real gap, or already covered?

The user asked for a plain call on every row of §2.1.7 that "reads unfinished":

- **`room:spectate` — no room-kind check** → **REAL GAP (MP-G3, Tier A).** Not
  covered anywhere else. The masking is real, but masked board + scores + move
  feed of a *ranked* private game is enough to assist a player, and there is no
  code-rate-limit. Fix in Step 3.
- **Spectator discovery limited to matchmaking rooms** → **NOT a gap.** This is
  correct narrowing — private and tournament rooms are deliberately not
  listed/discoverable. The residual ("spectatable if you know the code") is
  MP-G3, not a discovery problem.
- **`room:join` private room — "no check beyond the 5-char code"** → **NOT a
  gap.** The code is the capability, by design; consistent with every
  code-share product. The sub-point that matters — *guest* reconnect ambiguity —
  is broken out as **MP-G13 (Tier C)**.
- **`room:abandon_match` requires auth; a guest seat can't self-abandon** →
  **NOT a gap.** Intentional — a guest leaves by disconnecting, which routes
  through `leaveTrackedRoom` / grace-timeout forfeit.
- **`leaveTrackedRoom` forfeit — "private/mm: whoever holds the seat forfeits
  it"** → **NOT a gap.** Seat = capability; forfeiting your own seat is correct.
  The dangerous case (a non-participant forfeiting *someone else's* tournament
  match) was T-6, closed by PR-B; MP-INV-17 records it.
- **`room_live_sessions` / `room_match_logs` authenticated SELECT** →
  **CLOSED this session** (§2.7, D-8). Not a gap. Residuals are MP-G2
  (defence-in-depth grants) and MP-G17 (deliberate terminal-row read).
- **`room_command_receipts` RLS deny-all** → correct; but the table may not be
  in prod at all — **MP-G6 (Tier B)**.

### 2.3.2 — Step 2 verification pass (2026-09-01)

The human asked for three §2.2/§2.3 claims to be checked against the code /
prod, not asserted. Findings and the resulting changes:

**1. MP-G3 — "private rooms with two logged-in users are ranked."**
**CONFIRMED in code.** `persistGameOverOnce` (`gameOverPersistence.ts` ~199,
~233) gates all rating side-effects on `a.userId && b.userId && !fritzActivityCtx`
— nothing else. No matchmaking-origin check, no room-kind flag, no
ranked-opt-in. `roomSession.ts` ~749 routes every non-legacy-league room
(private + matchmaking + scheduled-tournament) into `onGameOver` →
`persistGameOverOnce`. So a private room with two authenticated players gets a
real Glicko-2 update (`profiles`), a `ranked_games` row, and
`recordPublicOnlineMatch`. The spectate handler
(`registerRoomSpectateHandlers.ts`) does `getRoom` + `!abandonedAt` + a masked
snapshot with **no room-kind check** and **allows an unauthenticated spectator**
(`resolveSocketIdentity` → `userId:null`, not rejected).
*Correction made:* my §2.3 text claimed "no rate limit ⇒ cheap enumeration" —
**wrong.** `room:spectate` is capped 30/min/socket and a 5-failed-lookup/60 s
block covers `room:join`+`room:spectate` (`index.ts` ~647), so brute-forcing the
~24 M code space is not realistic. *Result:* severity **stays
competitive-integrity** (premise confirmed), likelihood **medium → low–medium**
(vector is a leaked/shared code, not a scan), verdict **stays FIX NOW / Tier A**
(cheap fix, real per-incident rating impact).

**2. MP-G5 — "medium likelihood" for the terminal-outcome race.**
**Not measurable from here, and no evidence it has fired.** The purpose-built
durable telemetry table `mp_authority_events` (`2026-08-20_mp_authority_events.sql`)
returns `PGRST205` — **not applied to prod** (new MP-G6 sub-finding). The
`emitMpAuthorityFunnel` `console.info` lines go only to Render stdout (no query
API here, short free-tier retention). `room_match_logs` uses
`on_conflict=match_id` (last-write-wins), so a race collapses to one row — but a
scan for `status='abandoned' AND summary->>'gameOver'='true'` returned **0
rows**. Base rate: ~88 human-v-human `room_match_logs` ever (43 completed / 45
abandoned) — a high abandon rate but a narrow overlap window and no detectable
occurrence. *Result:* likelihood **medium → low**, "not precisely measurable"
stated explicitly, verdict **FIX NOW / Tier A → REVISIT IF SCALE / Tier C**.

**3. MP-G9 — "both players offline across a restart is rare."**
**Restarts are more frequent than assumed.** They are deploy-driven; `main` took
commits on **20 of the last 21 days**, bursty (up to 58/day). Prod `/ready`:
release `a93eea1e` (committed 2026-09-01 11:36 PT), `uptimeSeconds ≈ 20360`
(~5.6 h) ⇒ at least one restart earlier today. Free-tier *idle* spin-down is
mitigated (T-17 pinger, 100 % uptime verified) but **deploy restarts are not**.
Render crash logs are not visible from this session. The lazy-hydration
mitigation genuinely covers the case where a player reconnects; the residual is
a **stranded `room_live_sessions` row** (no result, no archive) when neither
does, and there is **no stale-row reaper**. Tournament rooms are covered by
System 1's reconciler. *Result:* verdict **ACCEPT → REVISIT IF SCALE**; Step 3
should add a periodic stale-live-session reaper, not just a boot sweep. Framed
as currently more a heavy-development artifact than a production steady-state
one.

**Net:** two verdicts changed (MP-G5 down a tier, MP-G9 up from ACCEPT), one
correction (MP-G3 rate-limit claim), one new sub-finding (`mp_authority_events`
unapplied → MP-G6). Tier A is now **MP-G1, MP-G3, MP-G4** (MP-G5 moved out).

### 2.3.3 — Tier C/D/E verification pass (2026-09-02)

The Tier-A/B gaps were code-verified in Step 5; the Tier C/D/E rows were still
"initial reads" from the §2.1 audit. Traced each against the actual code /
data, read-only. **No gap escalates to Tier A/B.** Two corrections:

**MP-G12 — the audit was wrong; the recommended fix is already implemented.**
The §2.1.5 MP-1 note said "rematch/abandon vs. the in-flight game-over persist
rests on status polling, not awaiting the promise." In fact `game:rematch` →
`registerRematchPregameHandlers.ts:79` → `waitForActiveGameOverPersist(room.code)`
→ `roomSession.ts:685` **`return await pending`** — it awaits the actual
`room.activeGameOverPersist` promise, falling back to a status check only when
the promise is already gone. The narrow window (game-over set in the locked
`act`, `activeGameOverPersist` not yet assigned in the broadcast tail) is
handled: `gameOverPersistStatus` is `idle` there → the handler returns
`MATCH_RESULT_STILL_SAVING_MESSAGE` and **rejects** the rematch rather than
proceeding. **→ MP-G12 reclassified Tier C → Tier E (ACCEPT).** The "Step 3:
await the promise" recommendation is done.

**MP-G7 — real for the *abandon* case; the audit's "freshness fence rejects
the stale hydration" reasoning is only half right.** `finalizeAndDeleteLiveRoomSession`
(`roomLivePersistence.ts:736`) calls `persistLiveSessionRowNow` **directly**,
bypassing `persistLiveRoomSessionNow`'s `inFlightPersistByRoomCode` single-flight
guard, and does **not** await an in-flight debounced write before the DELETE.
For a **game-over** finalize, a resurrected stale row is caught:
`validateLiveRoomHydrationRow` (`:565`) requires `row.status` to match
`row.game_state` (`gameOver → 'game_over'`), and `inferLiveSessionStatus` maps
`state.gameOver → 'game_over'`, so any write after game-over already carries
`status='game_over'` and hydration routes it to the terminal archive. For an
**abandon** finalize, `status='playing'` + `game_state.gameOver=false` is
self-consistent → the fence passes; `abandonedAt` lives only in `room_shell`,
which the resurrected stale write overwrites without it → the attach's
`existingRoom.abandonedAt` / `state.gameOver` terminal checks
(`roomSocketAttach.ts:311/337`) don't fire → a reconnecting player can hydrate
into a `playing` room that was actually abandoned, with no route to a
result/terminal screen. **Window:** a debounced write (`LIVE_PERSIST_DEBOUNCE_MS
= 75`) that already fired and is mid-HTTP at the instant the abandon finalize's
DELETE lands (network RTT ~50–200 ms), *and* a process that survives to serve
the next attach. **Verdict holds (Tier C, REVISIT IF SCALE — player-visible,
not corruption, tight window), but the record is corrected: the fence covers
game-over, not abandon; the Step-3 tombstone/`deleted_at` guard is the real
fix.**

**Confirmed as classified (no change):**
- **MP-G8** — `serializeRoomShell` (`:246`) genuinely does not include
  `preGameDraw`; it's an in-memory `setTimeout` (`rooms.ts:123`). A restart
  mid-draw loses it; the room reloads as `lobby` (initial) or terminal
  (rematch), client re-triggers. Player-visible, recoverable, tiny window.
- **MP-G11** — the grace-expiry callback's `stillConnected` check
  (`disconnectGrace.ts:279`) → `act()` call (`:303`) is **fully synchronous**;
  a reconnect (a socket macrotask) cannot interleave unless the per-room
  gameplay lock is already held by another action. One auto-`PASS`/`DRAW`.
  Extremely narrow — arguably Tier E, kept at C.
- **MP-G13** — `identityMatchesReconnectSeat` (`roomSession.ts:361`) matches
  two `userId=null` guests by case-insensitive `username` (generic names
  rejected). Confirmed exactly as stated. Private + **unranked** only (a guest
  seat produces no Glicko / `ranked_games`), needs code + display name +
  reconnect-hold timing. Auth-bypass severity, narrow scope; C holds.
- **MP-G14** (Tier D) — confirmed: `verifyPlayerMoveLog({strictHandContinuity:true})`
  at game-over; failure → `emitMpAuthorityFunnel('private_move_log_verification_failed')`
  + `humanGlickoEligible=false`, result/archive stand. **Now partially
  addressed** — since MP-G6 (2026-09-01) `mp_authority_events` is live, so the
  failure event is durably recorded and queryable via
  `mp_authority_funnel_metrics`. Residual: no *alert* (notification), no
  per-user aggregation.
- **MP-G15 / MP-G16 / MP-G17** (Tier E) — spot-confirmed. MP-G16:
  `projectMultiplayerRoomForSpectators` returns a deep-copied masked snapshot
  and does not mutate `room.state` (`spectatorRegistry.test.ts` asserts
  `JSON.stringify(room.state)` unchanged); a torn read only affects a
  read-only masked projection. MP-G17: RLS `room_match_logs_select_own`,
  deliberate (D-8).

**Downgraded confidence (not a tier change):**
- **MP-G10** — could not construct a concrete duplicate-seat / zombie for a
  single identity: two concurrent `attachSocketToTrackedRoom` calls share the
  `ensureRoomHydrated` promise (`inFlightHydrationByRoomCode`), then run a
  **fully synchronous** reconnect-by-userId branch (`roomSocketAttach.ts:406–432`)
  — one finishes migrate+`setRoomRoster` before the other starts; the second
  re-finds the same seat and re-migrates to its own socket; `resolveActorSeatId`
  ownership + `joinRoom`'s 2-seat cap bound the rest. Likelihood **low-medium →
  low**; a per-room attach lock would be belt-and-braces, not a fix for a
  demonstrated bug. Stays Tier C.

**MP-G5 note:** since MP-G6 landed, `mp_authority_events` persists the
`private_match_abandoned` / `private_match_archived` / `private_game_over_persist_*`
funnel events — so the private-room terminal-outcome race **is now measurable
in prod** (query for a room_code with both an abandon and an archived event
close in time). The "not measurable" caveat in MP-G5's row is stale going
forward.

**Net:** MP-G12 C→E (fix already shipped); MP-G7 record corrected (fence covers
game-over only); MP-G10 confidence lowered; MP-G5 + MP-G14 note the MP-G6
telemetry is now live. **Nothing escalates to Tier A/B.** The Tier-C fixes stay
"revisit when traffic / instance count changes" — the highest-value one to do
early is **MP-G13** (auth-bypass class, even if narrow) alongside a per-room
attach lock (closes MP-G10 + MP-G11's residual for free).

## 2.4 State-machine / concurrency design

Status: **DESIGN COMPLETE (Step 3) + IMPLEMENTED (Step 4), 2026-09-01.** Scope =
the three Tier-A gaps only (MP-G1, MP-G3, MP-G4; MP-G2 folded into MP-G1), per
Decisions D-9. Tiers B–E and the deeper concurrency questions (attach
serialization, the private-room `room_match_logs` terminal-outcome latch, the
stale-live-session reaper) are their own later pass. **The design below is
unchanged; §2.4.6 records what shipped in Step 4.** The two SQL migrations are
written and verified on a throwaway pg16 but **not applied to prod**.

Unlike System 1, none of these three is a match-lifecycle state machine, so
there is no RPC-surface or lock-target decision. The design work is: a
schema-codification migration (MP-G1, mechanical), one authorization gate on one
handler (MP-G3, a decision + a check), and an idempotency-key decision for each
of four game-over side-effect sinks (MP-G4), all reduced to one rule — *every
side effect of a match ending must be idempotent on that match's `sourceMatchId`*
— which is exactly the shape of System 1's T-3 fix (`insertRankedGameIdempotent`
+ a unique index).

### 2.4.1 The little concurrency there is

The only interleaving that matters here is the **`persistGameOverOnce` 4-attempt
retry** (`createGameOverPersistScheduler`, `GAME_OVER_PERSIST_MAX_ATTEMPTS`).
Each attempt re-runs the whole function from step 1 (§2.1.6). Verified structure:

- Steps 4 / 5 / 6 (`appendMatch`, `writeMatchActivity`, `recordPublicOnlineMatch`)
  run **before** the ranked block and are gated by nothing — they re-execute on
  every retry.
- Step 8 (`insertRankedGameIdempotent`) is already idempotent (`ON CONFLICT`);
  on a retry it returns `isNew:false`, which skips *both*
  `processRealtimeMultiplayerGame` **and** the game-over-path `recordMatchEnd`
  (both sit inside the `insertA.isNew && insertB.isNew` block, `gameOverPersistence.ts`
  ~308/329). So Glicko is not double-applied and the game-over-path matchmaking
  write is not repeated.
- `recordMatchEnd` is **also** called from the forfeit path (`roomForfeit.ts`
  ~342) and the reserved-room cleanup path (`reservedRoomCleanup.ts` ~88), which
  are *not* behind the ranked-insert gate.

MP-G3 and MP-G1 have no concurrency dimension — MP-G3 is a missing check, MP-G1
is a missing file.

### 2.4.2 MP-G1 (+ MP-G2) — room-table schema migration

**Problem.** `room_live_sessions` and `room_match_logs` exist in prod (RLS +
policies confirmed, D-8) but their DDL lives only in
`supabase/room_live_sessions.sql` / `supabase/room_match_logs.sql`, never in
`supabase/migrations/` — 4th instance of the drift root cause. MP-G2:
anon + authenticated still hold `INSERT/UPDATE/DELETE/TRUNCATE` grants on both
(RLS-gated only).

**Design.** One self-asserting migration —
`supabase/migrations/2026-09-01_room_tables_schema_and_grant_lockdown.sql`
(**written this step**) — that:

1. `create table if not exists` both tables with the **exact** definition from
   the two `supabase/*.sql` files. Idempotent — a no-op against current prod.
2. `alter table … add column if not exists …` for every column, as a
   drift-reconciler (cheap insurance; no column drift suspected).
3. `create index if not exists` for every index.
4. `alter table … enable row level security` + `drop policy if exists` /
   `create policy` for the **three D-8-confirmed policies**
   (`room_live_sessions_no_client_write`, `room_match_logs_select_own`,
   `room_match_logs_no_client_write`) — matching confirmed prod state exactly,
   so also a no-op.
5. **MP-G2:** `revoke insert, update, delete, truncate on … from anon, authenticated`
   on both tables. **SELECT is left intact for `authenticated`** —
   `room_match_logs_select_own` needs it for a participant to read their own
   terminal row (the deliberate MP-G17 behaviour). `room_live_sessions`
   additionally gets `revoke select … from anon, authenticated` (no policy
   grants any client a read; small defence-in-depth extension beyond MP-G2's
   "write grants" wording — flagged in the file header).
6. Re-affirm `grant … to service_role`.
7. **Self-assert `do $$ … $$`:** raise unless — RLS enabled on both; the three
   policies present with the expected `cmd`/`qual`;
   `has_table_privilege('anon'|'authenticated', …, 'INSERT'|'UPDATE'|'DELETE')`
   is false on both; `has_table_privilege('service_role', …, 'INSERT')` true.
   Same shape as `2026-09-01_commit_glicko_rpc_lockdown.sql` /
   `…_content_lifecycle_rpc_execute_lockdown.sql`.

**Not applied to prod by this step.** The DDL / policy parts are already live;
the grant revoke is a real change and applies in Step 4 (or the human runs it
and this file becomes the record, like the content-lifecycle migration). Header
note in the file: it supersedes `supabase/room_live_sessions.sql` /
`room_match_logs.sql` as the source of truth (delete or leave as pointers in
Step 4).

### 2.4.3 MP-G3 — `room:spectate` room-kind gate

**Problem.** `registerRoomSpectateHandlers.ts` does `getRoom(code)` +
`!abandonedAt` + a masked snapshot, with **no room-kind check** and **no auth
requirement**. A private room with two logged-in players is fully rated
(§2.3.2), so a spectator relaying the masked board + move feed to one player is
rating manipulation.

**Decisions (the design call the human asked for):**

1. **Should private rooms be spectatable without a participant relationship? →
   No — block outright.** There is no invite / friend / "allow spectators"
   infrastructure on private rooms, building one is out of scope, and there is
   no evidence anyone uses private-room spectate. The intended spectator
   surfaces are **matchmaking** rooms (already discoverable) and **tournament**
   rooms (public bracket). *Revisit path:* an opt-in `RoomConfig.spectatable`
   flag at room creation later — the gate below already reads that flag, so the
   later change is one line.
2. **Should spectating require authentication? → Yes.** A non-null `userId` is
   cheap, makes every spectator attributable (the `spectator_joined` room event
   already records `actorUserId`), and removes the anonymous-coach vector.
   Guests can still *play* private rooms; they can't lurk.

**Concrete change** (`registerRoomSpectateHandlers.ts`, after the `getRoom` +
`abandonedAt` checks succeed and before `socket.join(code)`, ~line 54):

```ts
import { roomKind } from './roomKind';
// …
if (!userId) {
  return cb?.({ ok: false, error: 'auth_required' });
}
const kind = roomKind(room);
const spectatable =
  kind === 'matchmaking' ||
  kind === 'scheduled_tournament' ||
  kind === 'legacy_league' ||
  room.config?.spectatable === true; // future opt-in for private rooms
if (!spectatable) {
  return cb?.({ ok: false, error: 'not_spectatable' });
}
```

- `roomKind` is the existing T-12 / PR-D classifier — no new predicate.
- Two new ack error codes: `auth_required`, `not_spectatable` — the client
  routes both to "you can't watch this game" (not a retry).
- The failed-room-lookup limiter is **not** incremented for `not_spectatable`
  (the room exists; only genuine misses feed brute-force detection).
- No change to masking, the roster snapshot, or the `spectator_joined` event.

**Closes:** MP-INV-6's second (`UNENFORCED`) clause.

### 2.4.4 MP-G4 — idempotent game-over side-effect sinks

**Principle (the design).** Every side effect of a match ending is idempotent on
`sourceMatchId` (= `room.matchId`, already threaded through `persistGameOverOnce`
and used as `ranked_games.source_match_id`). Then the 4-attempt retry, a
forfeit-then-late-game-over, or any double-fire lands the same rows. This is
T-3's fix generalised: a stable key column + a partial unique index + an insert
that ignores conflicts.

| Helper | Sink | Key today? | Concrete change |
|---|---|---|---|
| **`appendMatch`** (`stats/matchLog.ts`) | local `data/matches.jsonl` — append-only file, **ephemeral** (wiped on every Render deploy); feeds only `computeWeeklyAwards` (60 s cache) | No — random `id` per call, no dedup on append | (1) caller passes `id: sourceMatchId` (currently passes none); (2) `appendMatch` reads the file and returns without appending if a line with that `id` exists; (3) `computeWeeklyAwards` dedups on read by `id` as a backstop. **Note:** the file's non-durability is a separate latent gap (a table would be better) — out of MP-G4 scope, flagged for a later stats pass. |
| **`recordPublicOnlineMatch`** (`stats/recordPublicMatch.ts`) | `public.matches` | Partial — **read-then-write** on `metadata->>'roomMatchId'` (TOCTOU; OK for sequential retries, not true concurrency; no constraint) | Add `create unique index if not exists matches_room_match_id_uidx on public.matches ((metadata->>'roomMatchId')) where (metadata->>'roomMatchId') is not null;`. POST with `Prefer: return=minimal, resolution=ignore-duplicates`. Keep the SELECT as a fast-path, not the guarantee. |
| **`writeMatchActivity`** (`social/activityWriter.ts`) | `public.activity_feed` (one row per side, `type` ∈ `win`/`loss`) | **No key at all** — a retry produces duplicate feed rows | `alter table public.activity_feed add column if not exists dedupe_key text;` + `create unique index if not exists activity_feed_dedupe_key_uidx on public.activity_feed (dedupe_key) where dedupe_key is not null;`. Extend `writeActivity(userId, type, metadata, dedupeKey?)`; `writeMatchActivity` gains a `sourceMatchId` param and passes `dedupeKey = ${sourceMatchId}:${userId}:${type}`. Insert with `resolution=ignore-duplicates`. Puzzle/streak/daily-fritz activity passes no key → unconstrained, unchanged. The other caller (`http/routes/ghost.ts` ~334) either passes a key from the ghost match id or is documented as non-idempotent there (that path is not retried). |
| **`recordMatchEnd`** (`matchmaking/persistence.ts`) | `public.matchmaking_matches` (PATCH by `id`) | Row-convergent (UPDATE by PK), but `ended_at` is rewritten each call and three caller paths (game-over / forfeit / cleanup) can each fire for one match | Make the PATCH **conditional on current status**: `…?id=eq.<id>&status=eq.in_progress`. First terminal write wins; later ones update 0 rows. (System 1's `?status=neq.completed` CAS idea.) Put `ended_at` in the body only on that transition. **This also fixes the matchmaking half of MP-G5** (first-terminal-outcome-wins for `matchmaking_matches`); the private-room `room_match_logs` half of MP-G5 stays Tier C. |

**Idempotency migration.** The `matches` unique index + the `activity_feed`
`dedupe_key` column/index go in a **sibling** migration
`supabase/migrations/2026-09-01_gameover_sideeffect_idempotency.sql` (kept
separate from §2.4.2 so the schema-codification and the new constraints are
independently reviewable/revertible), also self-asserting. Written in Step 4
alongside the code changes.

**Not in this pass:** the retry loop's "re-run from step 1" structure itself — a
per-match "side-effects checkpoint" so a retry skips completed steps would be
cleaner but is a bigger change; Step 4 decides whether the idempotency keys
alone are sufficient. The private-room `room_match_logs` first-terminal-wins
latch (MP-G5, Tier C) is out of scope.

### 2.4.5 Step-3 deliverables

- `supabase/migrations/2026-09-01_room_tables_schema_and_grant_lockdown.sql` —
  **written + pg16-verified** (MP-G1 + MP-G2).
- MP-G3 spectate gate — **specified** (§2.4.3).
- MP-G4 per-helper changes + `…_gameover_sideeffect_idempotency.sql` —
  **specified** (§2.4.4).

### 2.4.6 Step-4 — what shipped (2026-09-01)

Implemented exactly as designed above. **Both migrations applied to prod; code
deployed to Render (prod release `907435df`); MP-G3 smoke-verified live.**

| Gap | Files | Change |
|---|---|---|
| **MP-G3** | `multiplayer/registerRoomSpectateHandlers.ts`, `rooms.ts` (`RoomConfig.spectatable?`) | `auth_required` check right after identity resolution (before `leaveExistingSocketRooms`); `not_spectatable` room-kind gate after the `abandonedAt` check — private blocked unless `config.spectatable`, matchmaking/scheduled_tournament/legacy_league allowed. Failed-lookup limiter untouched (comment + test). |
| **MP-G4 `appendMatch`** | `stats/matchLog.ts`, `realtime/gameOverPersistence.ts` | caller passes `id: sourceMatchId`; `appendMatch` returns the existing entry (no append) when a line with that `id` exists; `computeWeeklyAwards` dedups on `id` as a backstop. |
| **MP-G4 `recordPublicOnlineMatch`** | `stats/recordPublicMatch.ts` | POST now `Prefer: return=minimal,resolution=ignore-duplicates`; SELECT kept as a fast-path only (comment). Backed by `matches_room_match_id_uidx`. |
| **MP-G4 `writeMatchActivity`** | `social/activityWriter.ts`, `realtime/gameOverPersistence.ts` | `writeActivity()` gains an optional `dedupeKey` (adds `dedupe_key` to the body + `resolution=ignore-duplicates`); `writeMatchActivity` gains `sourceMatchId` and builds `${sourceMatchId}:${userId}:${type}`. **Also wired `writeForfeitActivity`** (it already carries `sourceMatchId`) — same table, same retry class; a 1-line same-family extension beyond the literal §2.4.4 list, flagged here. |
| **MP-G4 `recordMatchEnd`** | `matchmaking/persistence.ts` | PATCH now `?id=eq.<id>&status=eq.in_progress` — first terminal write wins; later calls (game-over / forfeit / cleanup) update 0 rows. Comment notes this fixes the matchmaking half of MP-G5; `room_match_logs` half stays Tier C. |
| **schema** | `supabase/migrations/2026-09-01_gameover_sideeffect_idempotency.sql` | `matches_room_match_id_uidx` (partial unique on `(metadata->>'roomMatchId')`) + `activity_feed.dedupe_key` column + `activity_feed_dedupe_key_uidx` (partial unique). Self-asserting. **pg16-verified:** applies clean + idempotent; `ON CONFLICT DO NOTHING` dedups both tables; null `dedupe_key` rows unconstrained. |

**Tests.** `tsc -b` clean (server + client). Full server suite **204 files /
1173 tests pass**. New: `stats/matchLog.test.ts` (retry-same-id ⇒ one line;
weekly-awards dedup), `stats/recordPublicMatch.test.ts` (ignore-duplicates
header; SELECT fast-path), `matchmaking/recordMatchEnd.test.ts`
(`status=eq.in_progress` on every call; sim no-op), `social/activityWriter.test.ts`
+2 (`dedupe_key` + header with `sourceMatchId`; omitted without it). Updated:
`registerRoomSpectateHandlers.test.ts` (happy path → matchmaking room; +4 gate
tests), `spectateSeatPreservation.test.ts` (`seedOtherRoom` opts in via
`config.spectatable`). Server lint: **no new problems** (74 pre-existing errors,
verified identical with/without the diff).

**Not done (deferred, as designed):** the retry loop's "re-run from step 1"
structure / a per-match side-effects checkpoint; the private-room
`room_match_logs` first-terminal latch (MP-G5, Tier C).

## 2.5 Refactor plan

**Tier-A slice CLOSED + LIVE 2026-09-01 (see §2.4.6).** MP-G1, MP-G2, MP-G3,
MP-G4 implemented + tested; **both migrations applied to prod 2026-09-01 and
verified** (`assert_security_posture()` no longer flags the room tables; anon
writes get a grant-layer `42501`; both idempotency indexes built clean —
`matches` had no `roomMatchId` duplicates); **code pushed + deployed to Render
(prod release `907435df`)**; **MP-G3 smoke-verified live in prod.**
The rest of §2.5 (Tiers B–E, deeper concurrency) is a later pass.

- [x] **MP-G3 — CLOSED + LIVE.** Spectate room-kind gate + auth requirement —
  `37054fda`, deployed 2026-09-01 (prod release `907435df`). Smoke-tested against
  prod: unauth `room:spectate` → `auth_required`; authed `room:spectate` on a
  private room → `not_spectatable`.
- [x] **MP-G4 — CLOSED.** Idempotent game-over side-effect sinks (4 helpers +
  `2026-09-01_gameover_sideeffect_idempotency.sql`) — code `37054fda`; migration
  **applied to prod 2026-09-01** (self-assert passed; `matches` had 0 duplicate
  `roomMatchId` values, so `matches_room_match_id_uidx` built clean).
- [x] **MP-G1 + MP-G2 — CLOSED.** `2026-09-01_room_tables_schema_and_grant_lockdown.sql`
  **applied to prod 2026-09-01.** Verified: `assert_security_posture()` no longer
  flags either room table under `client_write_grant_rls_on`; anon `INSERT` →
  `42501 permission denied for table` (grant-layer denial, not just RLS).
- [x] **MP-G6 (Tier B) — CLOSED + LIVE 2026-09-01.** Both tables were confirmed
  absent from prod; `2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql`
  applied (human, SQL editor, self-assert passed). Verified read-only:
  `to_regclass` all non-NULL; in OpenAPI; service_role GET `200 */0` (was
  `PGRST205`); posture `hard_fail_count:0` + no new advisory ⇒ RLS on, no client
  write grant; anon GET/INSERT `401 42501`; service_role INSERT round-trip
  `201`→`DELETE 204`. No deploy needed (server code already targeted these
  tables, was degrading silently).
- [ ] Tiers C–E — later

## 2.6 Test plan

Status: **Step 5 first pass DONE 2026-09-01.** Scoped (per the human) to the
invariants whose *enforcement changed this session* and now needs proof —
**MP-INV-6** (spectate gating, MP-G3) and **MP-INV-15** (idempotent game-over
side-effects, MP-G4 + MP-G6) — plus a focused base check of **MP-INV-1..3**.
The already-solid invariants keep their existing coverage (cited below).

### 2.6.1 The harness (this pass)

Analogous to System 1's PR-F (`concurrencyRecoveryHarness.test.ts`) + the PR-E
helper. **CI-safe, in-memory, no DB.**

- **`server/src/multiplayer/mpSideEffectStore.testkit.ts`** — a faithful JS port
  of what the two 2026-09-01 MP-G4 migrations add to prod: the partial unique
  indexes `matches_room_match_id_uidx` / `activity_feed_dedupe_key_uidx` and
  `recordMatchEnd`'s conditional `PATCH ?status=eq.in_progress`. Wired as the
  `supabaseFetch` + `node:fs` mock so the **real** helpers run against it.
  (System 1 analogue: `inMemoryMatchRpc.testkit.ts`.)
- **`server/src/multiplayer/mpInvariantHarness.test.ts`** — 13 tests, each
  naming the invariant and citing the assertion that maps to its stated rule:

| Test | Proves | Assertion ↔ rule |
|---|---|---|
| unauth spectate rejected before room state touched | **MP-INV-6** ("a spectator socket must be authenticated") | `ack = {ok:false, error:'auth_required'}` **and** `socket.join` / `leaveExistingSocketRooms` never called |
| authed spectate on a private room | **MP-INV-6** ("a private room is not spectatable without opt-in") | `ack = {ok:false, error:'not_spectatable'}`, no `socket.join` |
| private room with `config.spectatable` | **MP-INV-6** (opt-in escape hatch) | `ack.ok === true`, `socket.join(code)` |
| matchmaking / scheduled_tournament / legacy_league (×3) | **MP-INV-6** (intended spectator surfaces still work) | `ack.ok === true` for each `roomKind` |
| side-effect tail run **twice**, same `sourceMatchId` | **MP-INV-15** ("each sink receives a result at most once") | `jsonlLines.length === 1`; `matches.length === 1`; `activityFeed.length === 2` (not 4) with keys `${src}:user-a:win` / `${src}:user-b:loss` |
| **real `persistGameOverOnce` retry loop** (attempt 1 fails at `completeGhostGame`, attempt 2 succeeds) | **MP-INV-15** under the real §2.1.6 retry structure | `completeGhostGame` called ≥ 2×, yet `jsonlLines`/`matches`/`activityFeed` still `1/1/2` |
| `recordMatchEnd` game-over then late forfeit | **MP-INV-14 / MP-INV-15** ("first terminal write wins") | after both calls: `matchmaking_matches` row `status==='completed'`, `winner_id==='user-a'` (the 2nd call matched 0 rows) |
| sim match never written | regression guard (MP-G4 didn't change this) | row stays `in_progress` |
| seat migrates → stale socket can't act | **MP-INV-1** ("actor re-derived from current roster ownership") | `resolveActorSeatId(newSock) === 'seat-a'`; `resolveActorSeatId(staleSock)` throws |
| redundant reconnects for one identity | **MP-INV-3** ("reconnect never grows `room.players`") | `room.players` stays `['seat-a','seat-b']` after 2 more `migrateRoomSeat` |
| third identity into a full room | **MP-INV-2 / MP-INV-3** (allocation-time cap) | `joinRoom('seat-c')` throws `Room is full`; `players.length === 2` |

### 2.6.2 Existing coverage relied on (not re-written)

- **MP-INV-15, receipt half** (`room_command_receipts` idempotency of a replayed
  `game:action`) — `gameActionIdempotency.test.ts`, `roomCommandReceiptStore.test.ts`,
  `actionReceiptDurability.test.ts`. MP-G6 (2026-09-01) applied the backing
  table so this path is no longer degraded to the embedded snapshot.
- **MP-INV-1** — `resolveActorSeatId.test.ts` (stale-socket rejection).
- **MP-INV-4** (matchmaking seat ACL) — `matchmakingSeatAcl.test.ts`,
  `roomSocketAttach.test.ts`.
- **MP-INV-5** (tournament participant ACL) — `registerTournamentAttachHandlers.test.ts`,
  System 1's PR-B tests.
- **MP-INV-9** (lifecycle commit-or-rollback) — `handLifecyclePersistRollback.test.ts`,
  `gameActionPersistRollback.integration.test.ts`.
- Per-helper MP-G4 unit tests — `matchLog.test.ts`, `recordPublicMatch.test.ts`,
  `matchmaking/recordMatchEnd.test.ts`, `activityWriter.test.ts`.
- **MP-G3 gate** — `registerRoomSpectateHandlers.test.ts` (+4 gate tests),
  `spectateSeatPreservation.test.ts`.

### 2.6.3 Local-pg16 script (System 1's PR-G analogue) — NOT needed this pass

Every MP-INV is scoped to single-instance in-process interleaving (§2.1.1) —
there is **no real-Postgres-row-locking claim** in MP-INV-1..19 (unlike System
1's `complete_tournament_match` `SELECT … FOR UPDATE`). The one DB-level
guarantee that shipped this session — the MP-G4 partial unique indexes +
`recordMatchEnd`'s conditional PATCH — was already verified against real
Postgres directly: pg16 apply + a prod insert / `ON CONFLICT DO NOTHING` /
DELETE round-trip (changelog 2026-09-01). No new script.

### 2.6.4 Not yet covered (future Step-5 passes, as tiers open)

MP-INV-7/8 (gameplay-lock serialization, `eventSequence` monotonicity),
MP-INV-10/11/13 (hydration freshness, terminal-finalize finality, restart
recovery), MP-INV-16/17 (tournament-bracket routing, no-defaulted-winner),
MP-INV-18 (grace auto-act), MP-INV-19 (move-log posture). These invariants did
not change this session; they get a harness pass when their tier (C/D) is
worked.

## 2.7 Checklist

### Step 1 — Current-state audit
- [x] Deployment topology stated as a verified fact + revisit trigger — §2.1.1
- [x] Data model (in-memory `Room` + 4 tables + shared write targets) mapped — §2.1.2
- [x] All state writes (in-memory + durable) catalogued — §2.1.3
- [x] Seat allocation & attach / identity binding mapped — §2.1.4
- [x] Concurrency windows (MP-1..MP-8) enumerated — §2.1.5
- [x] Game-over / forfeit multi-step sequence mapped — §2.1.6
- [x] Authorization checks (present/missing) mapped — §2.1.7
- [x] Reconnection / recovery paths mapped — §2.1.8
- [x] Move-log / match-log verification (verified vs recorded) mapped — §2.1.9
- [x] Existing idempotency / durability prior art noted — §2.1.10
- [x] **Step 1 follow-up — anon read verified against live DB (2026-09-01).**
  Both tables: RLS ON (`assert_security_posture()` `hard_fail_count:0`), anon
  `SELECT` → HTTP 200 `content-range: */0` against 2458 / 1236 rows. **No anon
  exposure.** Not urgent.
- [x] **Step 1 follow-up — authenticated-role SELECT probed against live DB
  (2026-09-01).** Minted a genuine `authenticated`-role JWT (throwaway user via
  service-key admin API, created → password-grant → deleted; role/aud verified
  `authenticated`). Non-participant authed `SELECT`:
  `room_live_sessions` → `content-range */0`; `room_live_sessions?room_code=eq.<live room>`
  → `*/0`; `room_match_logs` → `*/0`. **No broad `TO authenticated USING(true)`
  SELECT policy on either table — a logged-in non-participant reads zero rows.**
  The "any logged-in user scrapes live `game_state`" scenario is disproven.
- [x] **Authenticated *participant*-reads-own-row — resolved via repo DDL +
  probe (2026-09-01).** The canonical DDL lives in `supabase/room_live_sessions.sql`
  and `supabase/room_match_logs.sql` (not in `supabase/migrations/` — hence §2.1's
  "unmanaged schema"; but it is *reviewed* SQL, not absent). It says:
  - `room_live_sessions`: only policy is `room_live_sessions_no_client_write`
    = `FOR ALL TO authenticated USING(false) WITH CHECK(false)`. `USING(false)`
    covers SELECT ⇒ **a participant cannot read their own live row. The unmasked
    `game_state` is never exposed to any client.** No competitive-integrity hole.
  - `room_match_logs`: `room_match_logs_select_own` = `FOR SELECT USING (auth.uid()
    = any(participant_user_ids))` ⇒ a participant **can** read their own
    *terminal* (game-over/abandoned) archive rows by design — `events` /
    `state_snapshot` / `summary` for matches they played. This is post-game data,
    not a live hand; acceptable, but note it in Step 2 as a deliberate exposure.
  The non-participant probe above is consistent with both policies. Full prod
  confirmation that prod matches this DDL = the `pg_policies` query below (still
  worth running once — this is the 3rd "reviewed SQL maybe unapplied" instance).
- [x] **Prod policy text confirmed against the repo DDL (human ran the
  `pg_policies` query 2026-09-01).** Exactly 3 rows, all matching:
  `room_live_sessions_no_client_write` (ALL / {authenticated} / qual `false` /
  wc `false`), `room_match_logs_select_own` (SELECT / {public} / qual
  `auth.uid() = ANY (participant_user_ids)` / wc null),
  `room_match_logs_no_client_write` (ALL / {public} / qual `false` / wc
  `false`). No `qual true` anywhere. `room_live_sessions` has **no** SELECT
  policy for any role and nothing at all for `anon` ⇒ RLS default-deny ⇒ only
  `service_role` reads it. **Authenticated-role SELECT question CLOSED — no
  competitive-integrity hole.**
- [x] **FOLLOW-UP ITEM (→ §2.3 MP-G6) — RESOLVED to a written fix migration
  2026-09-01.** Both `public.room_command_receipts` (`2026-08-01_room_command_receipts.sql`)
  and `public.mp_authority_events` (`2026-08-20_mp_authority_events.sql`) are
  **CONFIRMED absent from prod** — `service_role` `PGRST205` (not a stale cache:
  `room_live_sessions`/`room_match_logs` resolve), absent from the PostgREST
  OpenAPI spec, no `assert_security_posture()` trace. 5th/6th drift instance.
  Fix: `2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql`
  (creates both + the funnel view; adds the missing grants to
  `room_command_receipts`; drops the stale `event` CHECK on `mp_authority_events`;
  self-asserting) — written + pg16-verified. **Human to apply in the SQL editor.**
- [ ] **Defence-in-depth (deferred, not blocking):** revoke the
  anon/authenticated INSERT/UPDATE/DELETE grants on both room tables (RLS
  already denies via the `_no_client_write` policies; this is the same 44-table
  `client_write_grant_rls_on` advisory). Roll into the schema-management
  migration when the unmanaged-schema gap is closed.

### Steps 2–6
- [x] **Step 2 — Invariants (§2.2) + risk-ranked gap list (§2.3) — SIGNED OFF
  2026-09-01 (Decisions D-9).** RATIFIED as written incl. the §2.3.2
  verification-pass changes. Residual notes in D-9 (MP-INV-2 guest-reconnect
  gap → MP-G13; MP-INV-19 = posture not hard invariant → MP-G14).
  MP-INV-1..19 across 8 domains (seat/identity,
  room-kind ACL, state authority, persistence/recovery, game-over integrity,
  disconnect/grace, anti-cheat posture) — each grounded in an MP-1..MP-8 window
  or a §2.1.7 authz row, each with rule / enforcing-mechanism-or-UNENFORCED /
  failure-mode. §2.3 ranks 17 gaps (MP-G1..MP-G17). **After the 2026-09-01
  verification pass (§2.3.2):** Tier A (fix now) = **MP-G1** unmanaged schema,
  **MP-G3** spectate ACL (confirmed: private 2-authed-user rooms are fully
  ranked; spectator can be unauthenticated), **MP-G4** game-over idempotency
  (T-3 analogue); Tier B (verify now) = **MP-G6** (`room_command_receipts` +
  `mp_authority_events` both unapplied to prod), **MP-G2** grant revoke; Tier C
  (revisit if scale) = **MP-G5** (downgraded from A — 0 evidence, unmeasurable),
  **MP-G7..MP-G13**, **MP-G9** (upgraded from ACCEPT — restarts are deploy-driven
  ~daily in active dev); Tier D (posture) = **MP-G14** move-log; Tier E (accept)
  = **MP-G15..MP-G17**. §2.3.1 = plain verdict per §2.1.7 authz row; §2.3.2 =
  the verification-pass record. **Awaiting human line-by-line sign-off**
  (→ Decisions D-9, mirroring D-3). Step 3 does not start until then.
- [x] **Step 3 — State-machine / concurrency design (§2.4) — DONE 2026-09-01,
  Tier-A scope only (MP-G1, MP-G3, MP-G4).** §2.4.1–§2.4.5: MP-G1+MP-G2 →
  `2026-09-01_room_tables_schema_and_grant_lockdown.sql`; MP-G3 → spectate
  room-kind gate (private blocked outright, auth required); MP-G4 → every
  game-over side-effect sink idempotent on `sourceMatchId`, per-helper.
- [x] **Step 4 — Refactor (§2.5, Tier-A slice) — DONE 2026-09-01 (§2.4.6).**
  MP-G3 + MP-G4 code shipped (7 files, `37054fda`). `tsc -b` clean; full server
  suite 204/1173 pass; new idempotency + spectate-gate unit tests; server lint
  no new problems. **Both SQL migrations applied to prod 2026-09-01 and
  verified** (posture advisory cleared; anon write → grant-layer 42501; both
  idempotency indexes built clean). **Code pushed + deployed to Render
  2026-09-01 (prod release `907435df`); MP-G3 smoke-verified live in prod
  (`auth_required` / `not_spectatable`). All 4 Tier-A gaps CLOSED + LIVE.**
- [~] **Step 5 — Tests prove closure (§2.6) — FIRST PASS DONE 2026-09-01.**
  Scoped to what changed this session: **MP-INV-6** + **MP-INV-15** proven by
  `mpInvariantHarness.test.ts` (13 tests) + `mpSideEffectStore.testkit.ts`
  (in-memory port of the MP-G4 unique indexes / conditional PATCH), plus a
  focused MP-INV-1..3 base check. Full server suite **205 files / 1186 tests**;
  `tsc -b` clean (server + client); server lint no new problems. No pg16 script
  needed (§2.6.3 — no real-row-lock claim in MP-INV-1..19). Remaining invariants
  get harness passes as their tiers open (§2.6.4).

---

# System 3: Daily modes

Scope: **Daily Fritz** (`server/src/dailyFritz*`, `server/src/http/routes/dailyFritz*`,
`server/src/http/stores/dailyFritz*`) and **Puzzle Rush** (`server/src/puzzleRush/**`,
`server/src/http/routes/puzzleRush.ts`, `…/stores/puzzleRushStore.ts`) — the two
**active** modes. Puzzle Rush is the live "Daily Puzzle" (per
`2026-08-20_puzzle_rush_daily_official.sql`). The **Daily Puzzle Ladder**
(`server/src/dailyPuzzle*`, `…/routes/dailyPuzzle.ts`, `…/stores/dailyPuzzleStore.ts`)
was **retired ~2026-08-20** but is **not decommissioned** — routes still mounted,
`/daily` URL still resolvable, no client surface links there (§3.1.1
reconciliation). It stays in this audit because its forged-score gap (DF-CAND-1)
is still live. One challenge per Pacific calendar day, a score/speed leaderboard
per day, an anti-cheat verification model per mode.

> Not in scope: the **Fritz Challenge** friend-vs-friend feature
> (`fritz_challenges*`, `server/src/http/stores/fritzChallenge*`) — a separate
> head-to-head system, deferred to **System 10** (individual game modes). Its
> RPCs were locked down in the 2026-09-02 cross-cutting sweep; that is not this
> audit.

## 3.1 Current-state map

Status: **written 2026-09-02, Step 1; scope-corrected 2026-09-02** (Daily Puzzle
Ladder reclassified active → retired-but-reachable — see §3.1.1). Read-only
investigation. No fixes, no invariants — this maps what exists. §3.2 (invariants)
/ §3.3 (gap list) not started.

### 3.1.1 The modes — topology, shared infra

> **Scope correction 2026-09-02.** The active Daily modes are **Daily Fritz and
> Puzzle Rush only.** The **Daily Puzzle Ladder** (5-slot) was retired
> ~2026-08-20 when `2026-08-20_puzzle_rush_daily_official.sql` landed ("Puzzle
> Rush becomes the Daily Puzzle"). It was **not fully decommissioned** — this is
> **case (b): reachable but unlinked** (reconciliation below). It is kept in this
> section as retired-but-live surface because its forged-score gap (DF-CAND-1) is
> still exploitable. Where the text below says "the three modes" / "all three",
> read Daily Fritz + Puzzle Rush as active and the Ladder as retired.
>
> **Reconciliation evidence (read-only, 2026-09-02):**
> - **Server routes — MOUNTED.** `server/src/index.ts:290` imports and `:607`
>   calls `registerDailyPuzzleRoutes(app)`. `/api/daily-puzzle/{today,start,submit-slot,complete,leaderboard}`
>   + `/api/cron/daily-puzzle-ladder-warm` all live; rate limits still wired
>   (`index.ts` 436/456/457).
> - **Client URLs — RESOLVABLE, UNLINKED.** `client/src/routing/appRoutePath.ts`
>   still maps `/daily → mode 'daily'` and `/daily/leaderboard → 'dailyPuzzleLeaderboard'`;
>   `AppRoutes.tsx:117-122` still renders `<DailyRoute>` (the 5-slot
>   `DailyPuzzleScreen` play surface) and `<DailyPuzzleLeaderboardRoute>`. **But**
>   `client/src/puzzleRush/dailyPuzzleIsRush.test.ts` is an explicit regression
>   guard: the Home "Daily Puzzle" card routes straight to `puzzleRush`, the
>   Single Player hub no longer lists it, the ladder hub has no door back, and
>   "no live surface should send a player" to `'daily'`. `DailyRoute` is
>   referenced **only** from `AppRoutes.tsx` (the URL dispatch) — nothing
>   navigates to it.
> - **Client API calls — STILL PRESENT** in `client/src/dailyPuzzle/api.ts`
>   (all five endpoints) but only invoked by the now-unlinked `DailyPuzzleScreen`.
> - **Table writes — STOPPED 2026-08-20.** `daily_puzzle_attempts` latest
>   `started_at` / `updated_at` = `2026-08-20T15:59`; `daily_puzzle_slot_results`
>   latest `completed_at` = `2026-08-20T16:00`. `rush_runs` active through
>   `2026-09-02`. The Ladder tables hold only pre-retirement rows.
> - **RLS — UNCHANGED.** `daily_puzzle_attempts` / `daily_puzzle_slot_results`
>   still carry `insert_own` / `update_own` (`with check auth.uid() = user_id`).
>   DF-CAND-1 (verified live earlier this session with a throwaway account) still
>   works; a forged row still sorts onto `/daily/leaderboard`, which is still
>   URL-reachable.
>
> **Verdict: case (b).** Not dead code / dead tables (routes + URLs + RLS all
> live, exploit intact). Not renamed/merged (Puzzle Rush is its own schema —
> `rush_runs` — not a rename of `daily_puzzle_attempts`; the "becomes the Daily
> Puzzle" change was a UI/positioning swap, not a data migration). The retired
> Ladder is an unlinked-but-reachable surface whose integrity gap is unclosed.
> Step 2/3 must decide: decommission (drop routes + tables) or lock the RLS.

All active modes are **HTTP routes on the same single Render process** (§2.1.1 —
one instance, free tier) mounted under `/api/{daily-fritz,puzzle-rush,daily-puzzle}/*`.
Identity at every write endpoint is `getAuthenticatedUserId(req)`
(`platform/auth/supabaseAuth` — validates the `Authorization: Bearer` token
against Supabase, returns a verified `uid`; **not** a client-claimed id). All DB
access from these routes is `supabaseFetch` with the **service-role key**
(bypasses RLS). Content is published by a cron/warm path per mode. There is no
socket.io involvement — these are request/response.

| | Daily Fritz | Puzzle Rush | Daily Puzzle Ladder *(RETIRED ~2026-08-20)* |
|---|---|---|---|
| Prod rows (2026-09-02) | `daily_fritz_runs` 147, `daily_fritz_attempts` 404 | `rush_runs` 26 | `daily_puzzle_attempts` 172, `daily_puzzle_slot_results` 417 — **no writes since 2026-08-20** |
| Shipped to players? | yes | **yes — this is now the live "Daily Puzzle"** (per `2026-08-20_puzzle_rush_daily_official.sql` header; 26 rows = low uptake, not unshipped) | **retired** — routes + `/daily` URL still live, no client surface links there (`dailyPuzzleIsRush.test.ts` guards this) |
| Schema source | `supabase/daily_fritz.sql` + 8 migrations | `2026-08-20_puzzle_rush*.sql` (3) | `supabase/daily_puzzle_ladder_v1.sql` + `2026-08-06_*` (evolved from `daily_puzzle.sql` → `daily_puzzle_v2.sql` → ladder, **in place**) |
| Score authority | server-authored; engine-verified transcript; **verification non-blocking** | server-authored; **engine replay at `/complete`**, over-report ⇒ `invalidated` | server-computed at `/submit-slot` (`validateDailyPuzzleSubmission` engine replay) — **but the score tables are also client-writable via RLS** (see §3.1.4) |
| Client-writable state tables? | **no** (`select_own` + `no_client_write` deny-all) | **no** (RLS deny-all + `revoke all from anon, authenticated`) | **YES** — `daily_puzzle_attempts` / `daily_puzzle_slot_results` carry `insert_own` / `update_own` policies |

### 3.1.2 Daily Fritz — data model + score authority

**Tables** (all `public`, RLS on):

| Table | Key | RLS | Purpose |
|---|---|---|---|
| `daily_fritz_runs` | `run_date` PK | `read_all` (authenticated / `using(true)`) + `no_client_write` | the day's seed / tier / deal_size / `hand_deals` jsonb; `status` ∈ live/archived/invalidated |
| `daily_fritz_attempts` | `id`; **unique `(run_date, user_id)`** | `select_own` (`auth.uid()=user_id`) + `no_client_write` (deny-all) | one attempt per user per day; `status` ∈ started/completed/abandoned; `result` jsonb holds the **authority ledger** + **authority contract**; `final_score`/`won`/`moves_used` server-authored; `current_hand_index` progress; `verified_match_id` links the in-room game |
| `daily_fritz_events` | `id`; **unique `idempotency_key`** | `no_client_access` (deny-all) | append-only event journal: `attempt_started` / `hand_verified` / `next_hand_replayed` / `game_recorded` / `attempt_completed` / `attempt_abandoned` / `verification_failed` / `request_failed` / `retry_request`; `verifier_code`, `transcript_digest` |
| `daily_fritz_published_challenges` | `challenge_id` (text) PK; unique `(run_date, contract_version)`, unique `content_digest` | `read` (authenticated / `using(true)`) + `no_client_write`; **immutable** — `protect_daily_fritz_published_challenge` (BEFORE UPDATE trigger blocks any change except status→invalidated) + `prevent_daily_fritz_published_challenge_delete` | content-addressed challenge package (contract/generation/verifier versions, `package` jsonb) |
| `daily_fritz_attempt_operations` | `id`; unique `(attempt_id, operation_id)`, unique `(user_id, challenge_id, operation_id)` | `no_client_access` | transactional-command idempotency + result cache; `committed_revision`, `status` ∈ committed/rejected |
| `daily_fritz_verified_hands` | PK `(attempt_id, game_number, hand_index)`; unique `(attempt_id, operation_id)` | `no_client_access` | per-hand verified receipt (`transcript_digest`, `action_count`, scores, `verifier_version`, `receipt` jsonb) |
| `daily_fritz_verified_games` | PK `(attempt_id, game_number)`; unique `(attempt_id, operation_id)` | `no_client_access` | per-game verified receipt |
| `daily_fritz_outbox` | `id`; unique `(attempt_id, operation_id, event_type)` | `no_client_access` | async projection queue (`available_at`, `delivered_at`, `delivery_attempts`) |
| `daily_fritz_event_metrics` (view, `security_invoker=true`) | — | `revoke all from anon, authenticated`; `grant select to service_role` | daily funnel aggregate |

**Score-authority model.** An attempt is a **best-of-3 games vs Fritz**. Each
game is a sequence of verified hands. The write path:

1. `/api/daily-fritz/start` → `getAuthenticatedUserId` → `start_daily_fritz_attempt_command`
   RPC (`security definer`, `set search_path = public`, `pg_advisory_xact_lock`
   on `user_id:challenge_id`, `on conflict do nothing` on the attempt) — **now
   service-role-only** (2026-09-02 fritz-RPC lockdown). Writes the **authority
   contract** (`buildDailyFritzAuthorityContract` — rules/policy/verifier
   versions) into `attempt.result` if absent.
2. `/api/daily-fritz/record-game` (and `/next-hand`, `/checkpoint`) →
   `withDailyFritzAttemptLock(attemptId, …)` (in-process per-attempt promise
   chain) → `dailyFritzVerifier` **re-plays the submitted transcript through
   `@racehorse/game-core`** (`applyGameCommand`, `getDailyFritzAuthorityStateDigest`,
   `isOptimalOfficialFritzPlayForVersion` — verifies Fritz's moves were the
   policy-optimal ones) → on success writes a `daily_fritz_verified_hands` /
   `_verified_games` receipt + appends to the authority ledger via
   `commit_daily_fritz_attempt_command` (RPC, `expected_revision` CAS).
   **On verification failure the hand is `writeUnverifiedDailyFritzHand` — "recorded
   as unverified, never refused"** (`dailyFritzRecordGameRoute` ~line 116). A
   `verification_failed` event is journaled; there is also an **async
   verification** re-check path (`dailyFritzRecordGameAsyncVerification`,
   `2026-08-20_daily_fritz_events_async_verification_scheduled`).
3. `/api/daily-fritz/complete` → requires every game to have a complete
   authority record, sets `status='completed'`, `final_score` etc.
4. `/api/daily-fritz/leaderboard/:date` → `daily_fritz_attempts?run_date=eq.X&status=eq.completed&order=completed_at.asc`
   — a **speed** board (first to finish), 5-minute in-process cache. **Does not
   filter on verification status.**

**Idempotency / recovery.** `daily_fritz_events.idempotency_key` unique index;
`daily_fritz_attempt_operations` command dedup + result replay;
`expected_revision` optimistic CAS on the ledger; the event journal is
replayable. `withDailyFritzAttemptLock` is **in-process only** (lost on
restart — the DB advisory lock + CAS are the cross-restart guard).

### 3.1.3 Puzzle Rush — data model + score authority

**Tables** (`public`, RLS deny-all `to anon, authenticated using(false)`,
`revoke all … from public, anon, authenticated`, `grant all … to service_role`):

| Table | Key | Purpose |
|---|---|---|
| `puzzle_pool` | `id`; unique `(source, source_puzzle_id)` | content bank (seeded from `daily_puzzles`); carries `best_possible_score` (**"must never reach a client mid-run"**), `difficulty_score`, `play_count` |
| `rush_runs` | `id`; **partial unique `(user_id) where status='in_progress'`**; **partial unique `(user_id, run_date) where is_official`**; partial `(user_id, run_date) where is_official` | one row per run (replayable — no per-day unique on the base table); `total_score` / `puzzles_solved` "written only by the server's end-of-run replay"; `client_reported_score` kept for the mismatch audit, "never trusted"; `status` ∈ in_progress/completed/invalidated; `run_date` + `is_official` (first run of the Pacific day) govern the daily board |
| `rush_run_puzzles` | `id`; unique `(run_id, ordinal)` | per-puzzle-served row; `raw_score`/`awarded_points` server-graded, `client_raw_score` audit-only; `graded_at`, `grading_error` |

**Score-authority model.**
1. `/api/puzzle-rush/start` → idempotent: `INSERT` (no `on_conflict`), relies
   on the two partial unique indexes; a `23505` on `rush_runs_one_open_per_user_idx`
   ⇒ replay the existing open run. `is_official` chosen by an existence check +
   the `rush_runs_one_official_per_user_day_idx` backstop.
2. `/api/puzzle-rush/report` — **"Records only — no engine replay"** (optimistic
   per-puzzle client report into `client_raw_score` / `submitted_line`).
3. `/api/puzzle-rush/complete` — **"replay every reported line through the real
   engine, compute the authoritative score. That, not what the client reported,
   is stored; a client that over-reported gets the run marked `invalidated`."**
   (`puzzleRush/grading.ts` → `calculateRushAwardedPoints`). Idempotent — a
   duplicate `/complete` returns the stored result.
4. `/api/puzzle-rush/leaderboard` → `buildPuzzleRushLeaderboard(runs)` — readable
   without auth.

**This mode is the cleanest of the three** — fully server-authoritative, RLS +
grants both deny clients, engine-replay verdict, idempotent. **It is the live
"Daily Puzzle"** (the Home card routes here; `2026-08-20_puzzle_rush_daily_official.sql`
header: "Puzzle Rush becomes the Daily Puzzle"). 26 rows ⇒ low uptake so far,
not unshipped — still the least real-world-exercised of the two active modes.

### 3.1.4 Daily Puzzle Ladder *(RETIRED ~2026-08-20)* — data model + score authority + the write gap

**Tables:**

| Table | Key | RLS | Notes |
|---|---|---|---|
| `daily_puzzles` | `id`; unique `(puzzle_date, slot_index, set_version)` | `select_all` (anon+authenticated / `published=true`) + admin write policies keyed on **`(auth.jwt()->>'email') = 'admin@example.com'`** (a **stale placeholder** — no real user has that email; publishing is server-side) | evolved in place from v1→v2→ladder; 5 slots / day (`slot_index` 1–5), `tier`, `slot_max_points`, `objective_type`, `set_version` |
| `daily_puzzle_attempts` | `id`; **unique `(puzzle_date, user_id)`** | **`select_own` + `insert_own` (`with check auth.uid()=user_id`) + `update_own`** | one attempt per user per day; `total_score` / `puzzles_completed` (0–5) / `master_chain_score` / `current_slot_index` / `status` ∈ started/completed; feeds `daily_puzzle_attempts_leaderboard_idx` |
| `daily_puzzle_slot_results` | `id`; unique `(attempt_id, slot_index)` | **`select_own` + `insert_own` + `update_own`** | per-slot `raw_score` / `awarded_points` / `solved` / `perfect` / `submitted_line` |
| `daily_puzzle_scores` / `daily_puzzle_submissions` / `daily_puzzle_completions` | — | not in repo | **legacy** (pre-ladder Daily Puzzle v1/v2); frozen history (`daily_puzzle_completions` still read by `homeCompletionDates.ts` as "frozen history"); 59 / 1 / — rows; policies unknown |

**Score-authority model (the app path).** `/api/daily-puzzle/submit-slot` →
`getAuthenticatedUserId` → `validateDailyPuzzleSubmission({slot, submittedLine,
elapsedSeconds, clientRawScore})` — **the server re-plays the submitted line
through the game engine** (`applyMove` / `getLegalMoves`) and computes
`rawScore` / `movesUsed` / `solved` / `perfect` itself; `clientRawScore` is
audit-only. `/api/daily-puzzle/complete` aggregates `total_score` /
`puzzles_completed` / `master_chain_score` from the slot results. All writes go
through `dailyPuzzleStore.ts` via `supabaseFetch` (service-role). Start is
idempotent (`on_conflict=puzzle_date,user_id`).

**The gap (confirmed live 2026-09-02, read-only).** Unlike Daily Fritz and
Puzzle Rush, `daily_puzzle_attempts` and `daily_puzzle_slot_results` carry
`insert_own` / `update_own` RLS policies, so an **authenticated client can
bypass the API entirely** and `POST /rest/v1/daily_puzzle_attempts` with its own
`user_id` and an arbitrary score:

```
POST /rest/v1/daily_puzzle_attempts   (anon key + a user JWT)
{ "user_id": "<self>", "puzzle_date": "2026-09-02", "status": "completed",
  "puzzles_completed": 5, "total_score": 999999, "master_chain_score": 999999 }
→ HTTP 201, row created
```

Verified against prod with a throwaway account (row + user deleted after). The
`with check (auth.uid() = user_id)` policy passes (own row); the CHECK
constraints only bound `total_score >= 0`, `puzzles_completed between 0 and 5` —
**no upper bound**. That row sorts straight to the top of
`daily_puzzle_attempts_leaderboard_idx` (the daily leaderboard). `update_own`
also allows inflating an existing legitimate attempt. Anon (no JWT) is correctly
rejected (`42501` — can't forge `user_id`).

This is the same class as **T-1** (tournament-registration RLS let the client
write `seed`/`placement`) and the fritz-RPC gap — RLS grants a client write
access to columns that are supposed to be service-role-only, and the
server-side engine-replay validation is simply *bypassed*.

**Retirement does not close this (see §3.1.1 reconciliation).** The mode is
retired but **case (b)**: `/api/daily-puzzle/*` still mounted, `/daily/leaderboard`
still URL-resolvable, RLS unchanged, and DF-CAND-1 was re-verified live this
session. A forged row still lands and still sorts to the top of
`daily_puzzle_attempts_leaderboard_idx`, visible to anyone who navigates to
`/daily/leaderboard` directly. What retirement *does* change: no client surface
links there, and the tables have taken zero writes since 2026-08-20, so there is
no legitimate score to displace and near-zero audience. Severity drops from
"live shipped leaderboard" to "reachable orphan leaderboard" — still a real gap.
Parked as a gap candidate (§3.1.8).

> **RESOLVED 2026-09-02 — decommissioned.** `/api/daily-puzzle/*` routes + the
> nightly ladder warm job + the `/daily` client routes removed; Home no longer
> fetches the ladder. `supabase/migrations/2026-09-02_daily_puzzle_ladder_decommission.sql`
> drops the `insert_own`/`update_own` policies + revokes client write grants on
> both tables (kept in `public` read-only for the two historical readers).
> pg16-verified. Migration pending human apply. See §3.1.8 DF-CAND-1 and the
> 2026-09-02 changelog entry.

### 3.1.5 Authorization map (all three modes)

| Path | Identity | Server check | RLS backstop |
|---|---|---|---|
| `daily-fritz/*` writes | `getAuthenticatedUserId(req)` | attempt lookup filtered `user_id=eq.<uid>`; per-attempt in-process lock; RPC `pg_advisory_xact_lock` + `expected_revision` CAS | `daily_fritz_attempts` `no_client_write` deny-all; events / operations / verified_* / outbox `no_client_access`; RPCs service-role-only |
| `daily-fritz` reads (`/today`, `/history`, `/leaderboard`) | `getAuthenticatedUserId` (leaderboard cache is per-date, not per-user) | — | `daily_fritz_runs` / `_published_challenges` `read_all` to authenticated; `daily_fritz_attempts` `select_own` |
| `puzzle-rush/*` writes | `getAuthenticatedUserId(req)` | `run_id`/`user_id` match; partial unique indexes; engine replay at `/complete` | all 3 tables deny-all **and** grants revoked from clients |
| `puzzle-rush/leaderboard` | optional auth | — | (read via service-role) |
| `daily-puzzle/*` writes *(mode retired; routes still mounted)* | `getAuthenticatedUserId(req)` | `validateDailyPuzzleSubmission` engine replay; `attempt.user_id` match | **`insert_own` / `update_own` — client CAN write (§3.1.4 gap, still live)** |
| `daily-puzzle` `select` *(retired)* | anon + authenticated | — | `daily_puzzles` `select_all` (`published=true`); `daily_puzzle_attempts` / `_slot_results` `select_own` |
| `daily_puzzles` admin write | (n/a — server publishes) | — | `admin@example.com` placeholder policy — **stale / dead** |

### 3.1.6 Concurrency windows

| # | Window | Mode | Current guard |
|---|---|---|---|
| DM-1 | Two concurrent `/start` for one user/day | all | Daily Fritz: RPC `pg_advisory_xact_lock` + `on conflict do nothing` + unique `(run_date,user_id)`. Rush: partial unique `(user_id) where in_progress` → `23505` → replay. Daily Puzzle: `on_conflict=puzzle_date,user_id` + unique. **Bounded in all three.** |
| DM-2 | Concurrent hand/game submits for one Daily Fritz attempt (two tabs, a retry racing a real submit) | Daily Fritz | `withDailyFritzAttemptLock` (in-process, per-attempt) **serializes within one process**; `expected_revision` CAS + `daily_fritz_attempt_operations` unique `(attempt_id, operation_id)` are the cross-restart / (hypothetical) cross-instance guard. `daily_fritz_events.idempotency_key` unique dedups journaled events. |
| DM-3 | Verification failure vs the leaderboard | Daily Fritz | **partial** (corrected in Step 2) — an unverified hand is recorded and the attempt can still reach `status='completed'`, BUT the speed *board* IS verification-gated: `buildDailyFritzLeaderboard` applies `.filter(isDailyFritzAttemptLeaderboardEligible)` (`verification_status==='verified'` + empty `unverified_hands`). The raw PostgREST query at `dailyFritzStore.ts:640` doesn't filter — the consumer does. Residual: `getDailyFritzStreak` is **not** filtered (DF-G2), and there is no alert on a `verification_failed` event (§3.2 posture question, analogue of MP-G14 / MP-INV-19). |
| DM-4 | `/report` (no replay) vs `/complete` (replay) for a Puzzle Rush run | Puzzle Rush | `/complete` recomputes from `submitted_line` and overwrites; over-report ⇒ `invalidated`. A run left `in_progress` (no `/complete`) never reaches the board. |
| DM-5 | Direct client write racing the API write | Daily Puzzle Ladder *(retired — still reachable)* | **none** — both the API (service-role) and a direct client `POST`/`PATCH` (RLS `insert_own`/`update_own`) can write `daily_puzzle_attempts`; last-write-wins on the `(puzzle_date, user_id)` upsert. This is §3.1.4. Retirement means no live API writes any more, but the direct-client path is unchanged and the forged row still surfaces on the URL-reachable `/daily/leaderboard`. |
| DM-6 | Restart mid-attempt | all | Daily Fritz: event-sourced + DB CAS → replayable; the outbox drains async. Rush: idempotent `/complete`. Daily Puzzle: upsert-based, `current_slot_index` persisted. In-process locks (`withDailyFritzAttemptLock`) lost — DB constraints are the real guard. |
| DM-7 | Content publish vs an in-flight attempt | all | Daily Fritz: `daily_fritz_published_challenges` is **immutable** (trigger) — a re-publish for the same `(run_date, contract_version)` / digest is rejected; `daily_fritz_runs.status` can go `live→invalidated`. Daily Puzzle: `daily_puzzles` mutated in place — an admin edit mid-day would change the puzzle under an open attempt (no version fence on the attempt beyond `set_version`). |

### 3.1.7 Recovery / idempotency prior art (reusable)

- **Daily Fritz event journal + `idempotency_key` unique** — every state
  transition is an idempotent event; replay reconstructs the attempt.
- **`daily_fritz_attempt_operations`** — command dedup + cached result (the
  System-1 `insertRankedGameIdempotent` pattern, generalised to a command).
- **`expected_revision` CAS** on the authority ledger — reject a stale write.
- **`daily_fritz_outbox`** — at-least-once async projection with
  `delivery_attempts` / `available_at` (a scheduled drain).
- **Puzzle Rush partial unique indexes** — `(user_id) where status='in_progress'`
  makes "one open run" a DB invariant without forbidding replays.
- **`daily_fritz_published_challenges` immutability triggers** — content, once
  published, cannot be silently changed.
- **Engine replay as the score oracle** — Daily Fritz (`dailyFritzVerifier`),
  Puzzle Rush (`grading.ts`), Daily Puzzle (`validateDailyPuzzleSubmission`)
  all re-run the submitted line through `@racehorse/game-core`. The gap is
  never the *computation* — it's whether the client can write *around* it
  (Daily Puzzle) or whether a failed verification still counts (Daily Fritz).

### 3.1.8 Parked gap candidates (not risk-ranked — that is Step 2)

- **DF-CAND-1 — retired Daily Puzzle Ladder score tables were client-writable
  → DECOMMISSIONED (code merged-pending, migration pending human apply).**
  `daily_puzzle_attempts` / `daily_puzzle_slot_results` `insert_own` /
  `update_own` RLS ⇒ an authenticated client `POST`s an arbitrary `total_score`
  directly, bypassing the server engine-replay; confirmed live (HTTP 201). Same
  class as T-1. **Decommission (2026-09-02, one commit, not yet applied to prod
  DB):**
  - **Server:** removed `registerDailyPuzzleRoutes` + the 3 `/api/daily-puzzle/*`
    rate-limit mounts + the nightly `scheduleDailyPuzzleLadderWarmup` job;
    deleted `server/src/http/routes/dailyPuzzle.ts` (took `/api/cron/daily-puzzle-ladder-warm`
    with it) + its forgery test; trimmed `dailyWarmup.ts` (`warmDailyPuzzleLadders`,
    `isStartupDailyPuzzleWarmupEnabled`, startup puzzle branch).
  - **Client:** removed `/daily` + `/daily/leaderboard` (route table, `AppRoutes`
    branches, `DailyRoute` / `DailyPuzzleLeaderboardRoute`, prerender entries,
    `vercel.json` rewrites); Home command center no longer fetches
    `/api/daily-puzzle/today` (`homeDataLoaders.loadDailyPuzzle` removed,
    `model.daily.puzzle` pinned to `unavailable`). The now-inert `route: 'daily'`
    next-move / timeline branches in `homePrimaryAction.ts` / `homeActivityTimeline.ts`
    were **left in place** — they are gated on `model.daily.puzzle.status === 'ready'`
    which can no longer happen; ripping them out churned delicate personalization
    tests for no functional gain. **Follow-up (DF-CAND-1b, low): delete those
    dead branches + the `continue_daily_puzzle` / `play_daily_puzzle` union
    members + `DailyPuzzleScreen` and the rest of `client/src/dailyPuzzle/**`.**
  - **DB:** `supabase/migrations/2026-09-02_daily_puzzle_ladder_decommission.sql`
    — drops the 4 `insert_own`/`update_own` policies, `revoke insert,update,delete,truncate`
    from `anon`/`authenticated` on both tables; keeps them in `public` as
    **read-only historical** (`select_own` + service-role SELECT retained) because
    `social/socialProfile.ts` (profile "puzzles solved") and
    `http/stores/homeCompletionDates.ts` (streak calendar) still read the
    pre-Aug-20 rows. Self-asserting; pg16-verified clean + idempotent (only
    `select_own` remains, `authenticated` INSERT=f, `service_role` SELECT=t, rows
    preserved). **NOT applied to prod DB — human runs it in the SQL editor.**
  - Full `tsc -b` (client + server) clean; client vitest 1482/1482, server 1183/1183;
    client lint at budget (401/401), server lint unchanged (pre-existing errors).
  Not touched (DF-CAND-3 / DF-CAND-4): `daily_puzzles`, `daily_puzzle_scores`/`_submissions`/`_completions`.
- **DF-CAND-2 — Daily Fritz verification non-blocking → risk-ranked as DF-G2
  (§3.3), partly corrected.** The speed *board* **is** verification-gated
  (`buildDailyFritzLeaderboard` → `.filter(isDailyFritzAttemptLeaderboardEligible)`)
  — the audit's "filters only `status=eq.completed`" was true of the raw query,
  false of the consumer. Real residual: `getDailyFritzStreak` counts unverified
  completions, and there is no alert on `verification_failed`. See §3.3 DF-G2
  (REVISIT IF SCALE + a POSTURE decision).
- **DF-CAND-3 — legacy Daily Puzzle tables.** `daily_puzzle_scores` /
  `daily_puzzle_submissions` / `daily_puzzle_completions` exist in prod, are not
  in the repo schema, and their RLS/grants are unverified. Frozen history
  (`daily_puzzle_completions` still read). Schema-drift / unknown-posture item.
- **DF-CAND-4 — `daily_puzzles` in-place mutation + stale admin policy.**
  `daily_puzzles` was migrated v1→v2→ladder in place; the `admin@example.com`
  write policy is a dead placeholder; an admin edit mid-day changes the puzzle
  under open attempts with no per-attempt content fence.
- **DF-CAND-5 → DF-G3 (§3.3).** `withDailyFritzAttemptLock` in-process only.
  **Traced:** the `expected_revision` CAS + `daily_fritz_attempt_operations`
  unique + in-RPC `pg_advisory_xact_lock` keep ledger integrity airtight without
  it. Residual = a Node-layer read-verify-commit that can surface a CAS conflict
  as an error to a racing tab instead of replaying the cached op result.
  REVISIT IF SCALE.
- **DF-CAND-6 → split.** **(a) outbox projection — NOT a liveness risk:**
  `daily_fritz_outbox` is projected by an **AFTER INSERT DB trigger**
  (`project_daily_fritz_outbox_event()`, `2026-08-01_daily_fritz_canonical_telemetry.sql`)
  — no Node drainer, no `setInterval`. DM-INV-13. **(b) async re-verification —
  IS a liveness risk → DF-G1 (§3.3, FIX NOW):** `scheduleDailyFritzRecordGameVerification`
  is a fire-and-forget bare promise, lost on restart, stranding a hand
  permanently unverified.
- **DF-CAND-7 → DF-G4 (§3.3).** The 2026-09-02 fritz-RPC lockdown left 3
  functions grant-locked but PART-B-body-guard-deferred; 2 are Daily Fritz
  (`commit_/start_daily_fritz_attempt_command`). Grant lockdown holds (verified
  live); the missing in-body backstop is defence-in-depth only. REVISIT IF SCALE.

## 3.2 Invariants

Status: **RATIFIED 2026-09-02 (Decisions D-10).** The human reviewed
DM-INV-1..18 and DF-G1..DF-G5 and signed off "as written". Scope: the **two
active modes — Daily Fritz and Puzzle Rush**. The retired Daily Puzzle Ladder is
excluded (decommissioned 2026-09-02, §3.1.4 / §3.1.8 DF-CAND-1). Changes from
here require a new dated Decisions-log entry.

> **Step-3 code-trace corrections (2026-09-03), recorded with the sign-off** —
> two gap *mechanism* descriptions were written from function names + comments
> and did not survive a full call-site trace. The invariant set and the tier
> verdicts are unchanged; the fix approach for DF-G1 / DF-G2 is revised:
> - **DF-G1** — `scheduleDailyFritzRecordGameVerification` /
>   `runDailyFritzRecordGameVerification` have **zero production callers** (the
>   caller was removed in commit `d027d30d` "Require sync Daily Fritz verify
>   before record-game advance"; the async path is orphaned dead code from the
>   reverted `b0a0a93c` advance-first design). Nothing schedules async
>   re-verification, so nothing is "lost on restart". The record-game / next-hand
>   routes verify **synchronously** and, on a transient infra failure, **refuse
>   to advance** (`409 "retry to continue"`, `canNeverStrandDailyFritzVerification`)
>   rather than stranding the run. The `unverified_hands <> '[]'` predicate in
>   the ratified note targets deliberately-`rejected` sticky attempts, which
>   **DM-INV-11 forbids promoting**. **Corrected DF-G1** below.
> - **DF-G2** — the `verification_failed` alert **already exists**:
>   `recordDailyFritzAdvanceWithoutVerification` (the single choke point both
>   routes call) emits `Sentry.captureMessage('[daily-fritz] verification
>   bypassed …', { level:'warning', tags:{ daily_fritz_alert:'verification_bypassed' }})`,
>   and there is a separate `verification_infrastructure_error` alert. The
>   genuine residuals are **(a) no per-user aggregation** on that alert and
>   **(b) `getDailyFritzStreak` is not verification-filtered** — both fixed in
>   Step 3.

Framing mirrors §1.2 / §2.2: each invariant states **the rule**, **the mechanism
that enforces it today** (or `UNENFORCED` / `PARTIAL`), and **the failure mode**
if it breaks. Each is grounded in a §3.1.6 window (DM-1..DM-7) or a §3.1.5 authz
row. Precondition for all of them: the **single Render instance** (§2.1.1) — a
cross-instance failure is the revisit trigger, not a gap. Unlike System 1 there
is no single RPC sink; unlike System 2 there is no in-memory authority — the
authority is **the DB (event journal + command RPCs + CHECK/unique constraints)
plus server-side engine replay**. `[DF]` = Daily Fritz, `[PR]` = Puzzle Rush,
`[both]` = both modes.

### Score authority

**DM-INV-1 — The recorded score is server-computed by engine replay, never
client-reported. `[both]`**
Every score that reaches a leaderboard or a player's history is produced by
re-running the submitted line/transcript through `@racehorse/game-core` on the
server.
*Enforced by:* `[DF]` `dailyFritzVerifier` re-plays each hand
(`applyGameCommand` + `getDailyFritzAuthorityStateDigest`), writes a
`daily_fritz_verified_hands` / `_verified_games` receipt, and appends to the
authority ledger via `commit_daily_fritz_attempt_command` (`expected_revision`
CAS). `[PR]` `/api/puzzle-rush/complete` → `gradeRun` replays every
`rush_run_puzzles.submitted_line`; `total_score` / `puzzles_solved` are written
only from that result. Client-reported values are stored **audit-only**
(`daily_fritz` transcript diagnostics; `rush_runs.client_reported_score`,
`rush_run_puzzles.client_raw_score`).
*Failure mode:* an inflated score on the daily board.

**DM-INV-2 — No client can write a score or attempt-state row directly. `[both]`**
`daily_fritz_attempts`, `rush_runs`, `rush_run_puzzles`, and every Daily Fritz
sub-table are writable only by the service-role backend.
*Enforced by:* `[DF]` `daily_fritz_attempts` `select_own` + `no_client_write`
(deny-all); `daily_fritz_events` / `_attempt_operations` / `_verified_*` /
`_outbox` `no_client_access`; the `start_/commit_daily_fritz_attempt_command`
RPCs `revoke execute from public, anon, authenticated` (2026-09-02 lockdown —
verified live: anon/authenticated → `42501`). `[PR]` all three tables RLS
deny-all `to anon, authenticated using(false)` **and** `revoke all … from
public, anon, authenticated`.
*Failure mode:* the T-1 / DF-CAND-1 class — a forged leaderboard row that
bypasses replay entirely. (This is exactly what the retired Ladder violated;
§3.1.4.)

**DM-INV-3 — A client over-report is caught and quarantined, not silently
accepted. `[PR]`**
If the client's reported total exceeds the server replay, the run is marked
`status='invalidated'` with an `invalidated_reason` and never reaches the board.
*Enforced by:* `gradeRun` compares `clientReportedScore` against the replayed
total; `/complete` writes `status: grade.valid ? 'completed' : 'invalidated'`.
*Failure mode:* score inflation via a doctored `/report` stream.

**DM-INV-4 — Only a verification-passing attempt appears on the Daily Fritz
speed leaderboard. `[DF]` — PARTIAL**
The public daily board shows an attempt only if every hand carries a verified
receipt.
*Enforced by:* `buildDailyFritzLeaderboard` applies
`.filter(isDailyFritzAttemptLeaderboardEligible)` —
`verification_protocol_version ∈ {1,2}` **and**
`getDailyFritzVerificationStatus(result) === 'verified'` **and**
`result.unverified_hands` empty. (Corrects the §3.1 audit note: the *board* IS
verification-gated; the raw PostgREST query is not, the consumer is.)
*`PARTIAL` / failure mode:* **`getDailyFritzStreak` does NOT apply this filter**
— it counts any `daily_fritz_attempts` row with `status=eq.completed`. An
unverified or verification-failed completion still extends the player's daily
streak and its "done today" state. (§3.3 DF-G2.)

**DM-INV-5 — Fritz's moves in a submitted transcript must be policy-optimal for
the pinned verifier version. `[DF]`**
A transcript in which Fritz "blunders" to inflate the player's margin is
rejected by the verifier.
*Enforced by:* `isOptimalOfficialFritzPlayForVersion` inside `dailyFritzVerifier`
— a non-optimal Fritz move fails verification → the hand takes the
advance-without-verification path → the attempt is not leaderboard-eligible
(DM-INV-4).
*Failure mode:* enforced for the board, **not** for `status='completed'` or the
streak (see DM-INV-4 PARTIAL).

### One attempt / one run per day

**DM-INV-6 — ≤ 1 Daily Fritz attempt per (run_date, user_id). `[DF]`**
*Enforced by:* `unique (run_date, user_id)` on `daily_fritz_attempts`;
`start_daily_fritz_attempt_command` takes `pg_advisory_xact_lock` on
`user_id:challenge_id` and `INSERT … ON CONFLICT DO NOTHING`. DM-1.
*Failure mode:* two attempts, split hand progress, ambiguous leaderboard row.

**DM-INV-7 — ≤ 1 open Puzzle Rush run per user, and ≤ 1 official run per
(user_id, run_date). `[PR]`**
*Enforced by:* partial unique `rush_runs_one_open_per_user_idx (user_id) where
status='in_progress'` and `rush_runs_one_official_per_user_day_idx (user_id,
run_date) where is_official`. `/start` is a plain `INSERT`; a `23505` on the
open-run index ⇒ replay the existing open run; `is_official` chosen by an
existence check with the day index as the backstop. DM-1.
*Failure mode:* multiple concurrent runs for one user; two "official" entries
competing on the daily board.

### Idempotent recovery / mutation ordering

**DM-INV-8 — Every Daily Fritz state transition is an idempotent, replayable
command. `[DF]`**
A retried `/record-game` / `/next-hand` / `/complete` produces the same ledger
state, never a double-append or double-score.
*Enforced by:* `daily_fritz_events.idempotency_key` unique;
`daily_fritz_attempt_operations` unique `(attempt_id, operation_id)` = command
dedup + cached result replay; `expected_revision` optimistic CAS on the ledger
inside `commit_daily_fritz_attempt_command`. DM-2 / DM-6.
*Failure mode:* a network retry double-counts a hand.

**DM-INV-9 — Concurrent hand/game submits for one attempt are serialized. `[DF]`
— PARTIAL**
Two tabs (or a retry racing a live submit) for the same attempt do not interleave
a read-verify-commit.
*Enforced by:* `withDailyFritzAttemptLock(attemptId, …)` — an **in-process
per-attempt promise chain**. `UNENFORCED across a process restart or a second
instance`; the durable guard is the `expected_revision` CAS +
`daily_fritz_attempt_operations` unique inside the RPC.
*`PARTIAL` / failure mode:* the CAS holds ledger *integrity* without the lock
(the losing racer's `commit_*` fails the CAS). The residual is the Node-layer
read-modify-write of `attempt.result` *between* verify and the `commit_*` call —
two requests both read revision N, both verify, one wins the CAS, the other must
replay via `daily_fritz_attempt_operations` rather than error to the client.
(§3.3 DF-G3 — confirm the loser replays cleanly.)

**DM-INV-10 — Puzzle Rush `/complete` is idempotent and terminal. `[PR]` —
PARTIAL**
A duplicate `/complete` returns the stored result; a terminal run is never
re-graded.
*Enforced by:* `if (run.status !== 'in_progress') → return { replayed: true, run }`.
*`PARTIAL` / failure mode:* **no in-process lock and `finalizeRushRun`'s PATCH
has no `status=eq.in_progress` guard** — two concurrent *first-time* `/complete`
calls both grade and both PATCH. Low impact: the replay is deterministic from
the same `rush_run_puzzles` rows, so both writes are identical. A late `/report`
landing between the two grades could be missed. (§3.3 DF-G5.)

**DM-INV-11 — A hand recorded without a verification receipt is durably marked
unverified and never silently promoted. `[DF]`**
*Enforced by:* `recordDailyFritzAdvanceWithoutVerification` appends to
`result.unverified_hands` + journals a `verification_failed` event; the
record-game route comment: *"never-strand: publish with sticky rejected only
after evidence is archived — do not leave pending_verification / fire-and-forget
async verify."* DM-3.
*Failure mode:* a failed hand silently counts as verified on the board.

**DM-INV-12 — A set the player finished always reaches a terminal state. `[DF]`
— UNENFORCED (no recovery sweep)** *(reworded 2026-09-03 after the code trace —
see §3.2 header.)*
Once a Daily Fritz set is complete (`normalizeDailyFritzSetResult(result).setWinner`
is set), the attempt reaches `status='completed'` (with whatever
`verification_status` its ledger earned) — it does not sit at `status='started'`
forever.
*Mechanism today:* **none for the failure case.** `/api/daily-fritz/complete`
finalizes the attempt, but only when the client calls it. If the client crashes,
loses the network, or the server restarts mid-`/complete`, the attempt is
stranded `status='started'` with a complete set. There is **no boot sweep and no
periodic reaper** (unlike System 1's `recoverTournamentMatches`).
*Failure mode:* a legitimate, finished Daily Fritz run is silently absent from
the leaderboard and the player's history, and — after the Pacific-day reset —
effectively lost. This is the real "a legit run vanishes" gap (the async
re-verification path named in the old DF-CAND-6 / first DF-G1 draft is dead code
— §3.2 header). (§3.3 DF-G1.)

**DM-INV-13 — Outbox analytics projection happens exactly once and does not
depend on process liveness. `[DF]`**
*Enforced by:* `daily_fritz_outbox` **AFTER INSERT trigger**
`project_daily_fritz_outbox_event()` (in-DB, synchronous) →
`daily_fritz_events … ON CONFLICT (idempotency_key) DO NOTHING` + sets
`analytics_projected_at`. **No Node drainer / `setInterval` is involved.**
(Corrects the §3.1.8 DF-CAND-6 premise — there is no liveness risk here; the
`available_at` / `delivered_at` columns are vestigial.)
*Failure mode:* n/a — this invariant holds.

### Content integrity

**DM-INV-14 — A published Daily Fritz challenge is immutable. `[DF]`**
Once `daily_fritz_published_challenges` has a row for a `(run_date,
contract_version)` / `content_digest`, the deal never changes.
*Enforced by:* `protect_daily_fritz_published_challenge` BEFORE UPDATE trigger
(blocks every change except `status → invalidated`) +
`prevent_daily_fritz_published_challenge_delete` + content-addressed digest +
unique `(run_date, contract_version)` / unique `content_digest`. DM-7.
*Failure mode:* the deal shifts under an in-flight attempt.

**DM-INV-15 — The authority contract is pinned at start and never renegotiated
mid-attempt. `[DF]`**
Rules / Fritz-policy / verifier versions for an attempt are fixed when the
attempt is created.
*Enforced by:* `buildDailyFritzAuthorityContract` writes the contract into
`attempt.result` at `/start` if absent; `pinAuthorityContractFromVerifiedTranscript`
only *pins* from the first verified transcript, never rewrites. DM-7.
*Failure mode:* a verifier-version bump mid-attempt retroactively moves the
optimality bar (DM-INV-5).

**DM-INV-16 — Puzzle solutions / `best_possible_score` never reach the client
mid-run. `[PR]`**
*Enforced by:* `puzzle_pool.best_possible_score` is documented *"must never
reach a client mid-run"*; the `/start` and `/report` payloads carry the board
and objective but not the target or solution; grading is server-side at
`/complete`.
*Failure mode:* the client knows the exact target and games the clock/score.

### Authorization

**DM-INV-17 — Every write endpoint identifies the actor by verified JWT, not a
client-claimed id. `[both]`**
*Enforced by:* `getAuthenticatedUserId(req)` (`platform/auth/supabaseAuth` —
validates the Bearer token against Supabase) at every `daily-fritz/*` and
`puzzle-rush/*` write route; attempt/run lookups are filtered `user_id=eq.<uid>`
and a mismatch is a 404. §3.1.5.
*Failure mode:* acting as another user / writing to their attempt.

**DM-INV-18 — The command + content-lifecycle RPCs are service-role only. `[DF]`
— PARTIAL (grant layer holds; body backstop missing on 2)**
`start_/commit_daily_fritz_attempt_command`, `publish_daily_fritz_challenge`,
`invalidate_daily_fritz_challenge` execute only for the service role.
*Enforced by:* the 2026-09-01 content-lifecycle lockdown + the 2026-09-02
fritz-RPC lockdown (PART A grant revoke) — verified live: anon / authenticated →
`42501` on all of them.
*`PARTIAL` / failure mode:* the 2 Daily Fritz command RPCs
(`commit_daily_fritz_attempt_command`, `start_daily_fritz_attempt_command`) did
**not** get the PART-B `_assert_fritz_rpc_server_only()` in-body guard the other
7 fritz RPCs got (their bodies span 3 migrations — deferred as a careful pass).
If a future migration re-`grant`ed EXECUTE, there is no in-body `auth.role()`
backstop. (§3.3 DF-G4.)

### Notes for Step 3

- **DM-INV-1/2/6/7/8/11/13/14/15/16/17** are fully enforced today — Step 3 adds
  tests, not fixes.
- **DM-INV-4 (streak), DM-INV-9, DM-INV-10, DM-INV-12, DM-INV-18** carry the
  `PARTIAL` / `UNENFORCED` residuals that §3.3 ranks (DF-G1..DF-G5).
- **DM-INV-12 is the one with a real player-facing failure** (a legit run
  silently missing from the board with no recovery) — it is the Step-3
  priority.
- There is **no client write vector into either active mode** — DM-INV-2 holds,
  which is the whole point of decommissioning the Ladder.

## 3.3 Gap list (risk-ranked)

Status: **RATIFIED 2026-09-02 (D-10)**, with the two Step-3 mechanism
corrections in the §3.2 header applied to the DF-G1 / DF-G2 rows below.

**Scoring** (same axes as §1.3 / §2.3). *Severity* ∈ {data-corruption,
competitive-integrity, auth-bypass, player-visible-bug, cosmetic}. *Likelihood*
is for the **single Render instance** (§2.1.1) and current pre-marketing traffic
(Daily Fritz 404 attempts ever; Puzzle Rush 26 runs). *Verdict* ∈ {**FIX NOW**
(Step 3), **POSTURE** (Step-2 decision, no code), **REVISIT IF SCALE**, **ACCEPT**}.

**DF-CAND-1 (Ladder client-writable scores) — RESOLVED 2026-08→09-02**,
decommissioned; dropped from this list (§3.1.4 / §3.1.8). **DF-CAND-3 / DF-CAND-4**
(legacy `daily_puzzle_scores*` tables; stale `admin@example.com` policy on
`daily_puzzles`) and **DF-CAND-1b** (delete the dead `route:'daily'` Home
branches + `client/src/dailyPuzzle/**`) stay parked — not integrity risks,
out of Step-2 scope.

| ID | Gap (mode) | Location | Severity | Likelihood (1 instance) | Blast radius | Verdict | Protects |
|---|---|---|---|---|---|---|---|
| **DF-G1** *(mechanism corrected 2026-09-03 — see §3.2 header)* | **A finished Daily Fritz set can be stranded with no recovery `[DF]`.** The async-re-verification machinery named in the first draft (`scheduleDailyFritzRecordGameVerification`) is **dead code — zero production callers**. The real gap: `/api/daily-fritz/complete` finalizes a completed set, but only when the client calls it. Client crash / network drop / server restart mid-`/complete` ⇒ the attempt sits `status='started'` with a complete set forever — off the leaderboard, absent from history, lost after the Pacific-day reset. **No boot sweep, no periodic reaper** (System 1 has `recoverTournamentMatches`). | `dailyFritzCompletionRoutes.ts` (`/complete` finalize); no reaper anywhere | player-visible-bug (a legit run silently vanishes) | **medium** — deploy-restarts frequent (MP-G9 evidence: ≥1/day); the `/complete` call is a single HTTP request with a real failure rate on a cold 0.1-CPU pool | one attempt per occurrence; the player's whole day of Daily Fritz | **FIX NOW (Step 3)** — a boot sweep + periodic reaper (mirroring `recoverTournamentMatches`) over `daily_fritz_attempts WHERE status='started'` with a **complete set** and `updated_at` older than N min → finalize via the same path `/complete` uses (compute `isVerified` from the ledger; `verification_status` earns `verified` or `legacy_unverified`; never un-`reject`). Deliberately-`rejected` and mid-set attempts are skipped (DM-INV-11). | DM-INV-12 |
| **DF-G2** *(alert half corrected 2026-09-03 — the alert already exists)* | **(a) Daily-streak counts unverified completions.** The speed *board* is verification-gated (`isDailyFritzAttemptLeaderboardEligible`), but `getDailyFritzStreak` counts any `status=eq.completed` row — an attempt whose hand was `rejected` still extends the streak + "done today". **(b) The `verification_failed` alert exists** (`recordDailyFritzAdvanceWithoutVerification` → `Sentry.captureMessage('[daily-fritz] verification bypassed …', {level:'warning', tags:{daily_fritz_alert:'verification_bypassed'}})`) but fires **per-incident with no per-user context** — a repeat offender looks like a one-off. | `dailyFritzStore.ts` `getDailyFritzStreak`; `dailyFritzVerificationGlue.ts` `recordDailyFritzAdvanceWithoutVerification` | competitive-integrity (minor — streak, not the ranked board) + lost observability | **low** — needs a completion whose transcript failed a verdict (doctored transcript; the honest client can't produce one) | one player's streak; slow detection of a serial abuser | **FIX NOW (Step 3, small)** — (a) filter `getDailyFritzStreak` so a `rejected` / non-empty-`unverified_hands` completion does not count (a `legacy_unverified` pre-protocol completion still counts — do **not** apply the full leaderboard predicate, which would retroactively zero real streaks). (b) add per-user `verification_failed` aggregation to the existing alert: include the user's recent failure count + escalate `level` to `error` past a threshold. Keep verification non-blocking for `status='completed'` (the ratified POSTURE). | DM-INV-4, DM-INV-5 |
| **DF-G3** | **`withDailyFritzAttemptLock` is in-process only `[DF]`.** Confirmed the durable guard (`expected_revision` CAS + `daily_fritz_attempt_operations` unique + `pg_advisory_xact_lock` in the RPC) keeps the **ledger integrity** airtight without the lock — a losing racer's `commit_*` fails the CAS. Residual: the Node-layer read-verify-commit of `attempt.result` is not transactional, so two concurrent submits for one attempt both verify at revision N and one gets a CAS conflict — need to confirm that path **replays the cached operation result** (via `daily_fritz_attempt_operations`) rather than surfacing an error to the racing tab. | `dailyFritzAttemptLock.ts`; `dailyFritzCommandStore.ts`; `commit_daily_fritz_attempt_command` | player-visible-bug (a spurious error on a racing tab) — **not** data-corruption | **low** — needs two concurrent submits for one attempt (two tabs; single-player mode, no adversary) | one request | **REVISIT IF SCALE** — the CAS holds for integrity. Step 3 (if cheap): make the Node command layer treat a CAS conflict as "load and return the `daily_fritz_attempt_operations` cached result" so a double-submit is a clean no-op, not an error. | DM-INV-9 |
| **DF-G4** | **2 Daily Fritz command RPCs are grant-locked but body-guard-deferred `[DF]`.** `commit_daily_fritz_attempt_command` / `start_daily_fritz_attempt_command` got PART-A `revoke execute` (verified live: anon/authenticated → `42501`) but not the PART-B `_assert_fritz_rpc_server_only()` first-line body guard (bodies span 3 migrations — `2026-08-01_daily_fritz_transactional_commands.sql` + 2 more). No exposure today; a future accidental `grant execute` would have no in-body backstop. | `supabase/migrations/2026-09-02_fritz_challenge_rpc_lockdown.sql` (PART B "Deferred" list) | none today; defence-in-depth only | **very low** — needs a future migration to re-grant EXECUTE | — | **REVISIT IF SCALE / defence-in-depth** — add the one-line `perform public._assert_fritz_rpc_server_only();` guard on the next migration that legitimately touches either function body. Not urgent. | DM-INV-18 |
| **DF-G5** | **Puzzle Rush `/complete` has no lock + unconditional finalize PATCH `[PR]`.** Two concurrent first-time `/complete` for one run both `gradeRun` and both `finalizeRushRun` (PATCH by `id`, no `status=eq.in_progress`). Deterministic replay ⇒ identical writes, so no corruption; a `/report` landing between the two grades could be missed from the second grade. Analogue of MP-G4's `recordMatchEnd`. | `puzzleRush.ts` `/complete` (193); `puzzleRushStore.ts` `finalizeRushRun` (299) | cosmetic (deterministic; worst case one late-reported puzzle missed) | **very low** — needs two concurrent `/complete` for one run (client sends it once at clock-zero) | one run | **ACCEPT** (Step 3 if trivially cheap: add `&status=eq.in_progress` to the finalize PATCH, mirroring MP-G4). | DM-INV-10 |

### Tier summary

- **FIX NOW (Step 3):** DF-G1 (stranded-set reaper) + DF-G2 (streak filter +
  per-user alert aggregation). POSTURE for DF-G2: verification stays
  non-blocking for `status='completed'` (D-9 MP-INV-19 stance).
- **REVISIT IF SCALE:** DF-G3, DF-G4.
- **ACCEPT:** DF-G5.

Nothing here is a client-reachable integrity hole — DM-INV-2 holds for both
active modes. The one real player-facing bug is DF-G1 (a legit Daily Fritz run
can silently vanish from the board across a restart).

## 3.4 Checklist

### Step 1 — Current-state audit
- [x] Topology + shared infra mapped — §3.1.1
- [x] Per-mode data model + score authority mapped — §3.1.2 (DF), §3.1.3 (PR)
- [x] Authorization map — §3.1.5
- [x] Concurrency windows DM-1..DM-7 — §3.1.6
- [x] Recovery / idempotency prior art — §3.1.7
- [x] Gap candidates parked — §3.1.8
- [x] Scope-corrected (Daily Puzzle Ladder retired) + reconciled — §3.1.1
- [x] DF-CAND-1 decommissioned (routes + client + migration) — commit `56c0bb67`

### Step 2 — Invariants + risk-ranked gap list
- [x] DM-INV-1..18 written (rule / mechanism-or-`UNENFORCED` / failure) — §3.2
- [x] Every invariant grounded in a DM-window or an authz row — §3.2
- [x] §3.1.8 candidates risk-ranked as DF-G1..DF-G5 — §3.3
- [x] Audit claims re-verified against code (DM-3 leaderboard filter; DF-CAND-6 outbox trigger vs async-verify) — §3.2 / §3.3
- [x] DM-INV-1..18 + DF-G1..DF-G5 reviewed line-by-line and signed off — **Decisions D-10 (2026-09-02)**
- [x] Step 3 scope agreed — DF-G1 + DF-G2 (FIX NOW); DF-G3/G4/G5 not Step-3 work
- [x] Step-3 code-trace: DF-G1 async-verify path is dead code → corrected to a
  stranded-completed-set reaper; DF-G2 alert already exists → corrected to
  per-user aggregation + streak filter (§3.2 header; DF-G1/DF-G2 rows updated)

### Step 3 — Design + implement — **DONE (pushed `f717b851`, 2026-09-02)**
- [x] DF-G1 — `recoverStrandedDailyFritzAttempts` boot sweep + 15-min reaper (`dailyFritzStrandedRecovery.ts`), wired at `index.ts` listen; shared `applyDailyFritzAttemptFinalization` extracted from `/complete` (behaviour-preserving); N = 30 min since `started_at` (rationale in the module) — `f717b851`
- [x] DF-G2 — `isDailyFritzAttemptStreakEligible` + `getDailyFritzStreak` selects+filters `result`; `countRecentDailyFritzVerificationFailures` + per-user escalation on the existing `verification_bypassed` alert (`warning`→`error` + `verification_bypassed_repeat` tag at ≥3/7d) — `f717b851`
- [x] Tests: `dailyFritzStrandedRecovery.test.ts` (7 — finalize / mid-set skip / rejected→legacy_unverified / idempotent / raced-`/complete` / transactional path), `dailyFritzStreakFilter.test.ts` (8), `dailyFritzVerificationRepeatOffenderAlert.test.ts` (3)
- [x] Full suite (server 1200/1200, client 1482/1482) + `tsc -b` clean; server lint unchanged (71 pre-existing errors), client lint at budget
- [x] Pushed to `origin/main` (`f717b851`); CI green

### Step 4/5 — not needed as separate steps
DF-G1/DF-G2 are the whole Step-3 scope and shipped with tests; there is no
refactor tranche. **System 3 is closed** except:
- **Deploy check (open):** confirm the reaper is live after the next Render
  deploy — a `daily-fritz-recovery` boot-sweep log line, or a
  `recovery_succeeded` / `recovery_failed` event / `attempt_completed` metric
  bump. (Boot sweep runs 20 s after listen; periodic every 15 min.)
- **Parked, not System-3 integrity work:** DF-G3 (`withDailyFritzAttemptLock`
  in-process only — CAS holds; REVISIT IF SCALE), DF-G4 (2 daily-fritz command
  RPCs body-guard-deferred — grant lockdown holds; REVISIT IF SCALE), DF-G5
  (Puzzle Rush `/complete` no lock — deterministic replay; ACCEPT), DF-CAND-1b
  (delete dead `route:'daily'` Home branches + `client/src/dailyPuzzle/**`),
  DF-CAND-3/DF-CAND-4 (legacy `daily_puzzle_scores*` tables; stale
  `admin@example.com` policy on `daily_puzzles`).
- **Pending human DB action:** apply `2026-09-02_daily_puzzle_ladder_decommission.sql`.

---

# System 4 — dissolved

The original "Everything else" catch-all was broken out into nine
leverage-ordered systems (5–13) after the **2026-09-02/03 codebase inventory
pass** (the authoritative map of every server/client area, every `index.ts`
registration, and every prod table's live/dead status as of that date — its
findings are folded into the System 5–13 scope descriptions and the Appendix).
There is no System 4. Order is leverage-first: kill dead weight, then de-risk the
shared spine every mode depends on, then work outward to individual features,
lowest-risk last (Decisions **D-11**).

---

# System 5: Legacy League / Legacy Tournament — **CLOSED 2026-09-03 (decommissioned)**

Scope: `server/src/league/**` (7 files, ~2.1k LOC), `server/src/legacyTournament/registerLegacyTournamentHandlers.ts`,
`server/src/http/routes/league.ts` (`/league/*`), `supabase/league.sql`
(`leagues`, `league_members`, `fixtures`, `fixture_match_results`,
`player_league_history`, `league_bots`), the admin jobs
`/league/run-{forfeits,rollover}` + `/league/generate-fixtures`, and the legacy
socket handlers `tournament:{create,join,add_bot,remove_bot,start}` (**distinct**
from System 1's scheduled-tournament events).
**Out of scope (untouched):** the scheduled tournament engine (System 1);
`client/src/tournament/**`; `roomKind.ts`'s `legacy_league` classification
(System 1/2 ratified — left inert, parked).

## 5.1 Current-state map — dead/live verdict (Step 1, 2026-09-03)

**Verdict: DEAD in prod. Decommissioned.** Every signal, re-verified against the
live code + prod:

| Check | Finding |
|---|---|
| Prod write-recency (all 6 tables) | `leagues` / `league_members` / `fixtures` last **2026-04-29**; `fixture_match_results` **2026-04-05**; `league_bots` **2026-04-01**; `player_league_history` **0 rows**. No fixture ever reached `status='completed'`; no `fixtures.live_room_code` was ever set. The `status='active'` leagues / `status='scheduled'` fixtures are abandoned March–May test-season state. |
| Client HTTP emitters into `/league/*` | **zero** — no `fetch` / api call anywhere in `client/src` (non-test). |
| Client socket emitters for `tournament:{create,join,add_bot,remove_bot,start}` | **zero**. The client only emits/listens for scheduled-tournament events (`tournament:attach_assigned_match`, `tournament:{bracket_generated,completed,match_completed,match_ready,match_updated,registration_open,registration_updated}`). |
| Legacy socket handler registration | already gated behind `config.enableLegacyTournaments` (`ENABLE_LEGACY_TOURNAMENTS`, **default `false`**) — off in prod, so `registerLegacyTournamentHandlers` never ran and `finalizeTournamentMatchHook` was permanently `null`. |
| `finalizeTournamentMatchHook` legacy branch — other-system dependency | **none.** `roomSession.ts` / `registerGameplayActionHandlers.ts` call `deps.finalizeTournamentMatch?.(room)` / `maybeFinalizeTournamentMatch?.(room)` — both were `finalizeTournamentMatchHook?.(room)` (null in prod). The scheduled-tournament path (System 1) explicitly does **not** route through it (`roomSession.ts:740` comment); it only fired for a `legacyLeagueRoom` = a room with `config.tournamentId`, which only the deleted `tournament:create` handler set. |
| `league_*` table readers outside `league/` | **one, dead:** `gameOverPersistence.ts` ran `/rest/v1/fixtures?live_room_code=eq.<room.code>` on every game-over — always empty in prod (no fixture ever had a `live_room_code`) → `recordLeagueLiveResult` never called. A wasted DB round-trip per game-over. |
| `index.ts` league imports | all 9 (`assignPlayerToLeague`, `generateLeagueFixtures`, …) were **already dead imports** — imported but not passed to `registerLeagueRoutes` (which only got `getAuthenticatedUserId`/`supabaseFetch`/`isAdminSecret`/`socketsByUserId`); the route file imported them directly. |
| FKs into `league_*` from other tables | **none.** The `league_*` tables reference each other + `auth.users`; nothing outside the cluster references in. `league.sql` has no functions / triggers / views. |
| Git | last *feature* commit to `league/` / `legacyTournament/` predates the April 2026 architecture overhaul (`d9e82c8e`, `9b69def8 overhaulapr3`); every touch since is mechanical. |

## 5.2 Invariants
**N/A — decommissioned.** No invariants; the feature is removed.

## 5.3 Gap list (risk-ranked)
**N/A — decommissioned.** The pre-decommission surface (12 RLS-gated tables via
routes + an unauth-gated legacy socket handler set) is removed, not hardened.

## 5.4 Checklist — **DONE (this System-5 commit, not pushed)**
- [x] Step 1 — dead/live verified (§5.1): zero client emitters, handlers gated off in prod, no `league_*` writes since April, no cross-system dependency on the hook, no external FK into the tables
- [x] **Server removed:** `registerLeagueRoutes` + `registerLegacyTournamentHandlers` + `finalizeTournamentMatchHook` + the 3 `/league` rate-limit mounts + the 2 `initRoomSession` dep wirings; deleted `server/src/league/**` (7 files), `server/src/legacyTournament/**` (2 files), `server/src/http/routes/league.ts`; removed the `gameOverPersistence.ts` live-fixture branch (+ its import + 2 tests); removed `config.enableLegacyTournaments`; `mpInvariantHarness.test.ts` league mock removed; `roomLivePersistence.ts` / `roomSession.ts` comments updated (branches left inert — parked)
- [x] **Migration** `supabase/migrations/2026-09-03_legacy_league_decommission.sql` — **DROP** (not archive; see below) all 6 `league_*` tables `cascade`; self-asserting `to_regclass` check; pg16-verified clean + idempotent (`league.sql` applied → all 6 dropped → none remain; pass 2 no-ops). Deleted `supabase/league.sql` (dead schema file; preserved in git history). **NOT applied to prod DB — human runs it.**
- [x] Full suite: server **206 files / 1188 tests**, client **216 / 1482**; `tsc -b` clean (client + server); client lint at budget; **server lint 217 problems / 68 errors — down from 233 / 71** (deleting `league/` removed pre-existing lint errors; 0 new)
- [ ] Human applies `2026-09-03_legacy_league_decommission.sql`

**DROP, not archive** (contrast with the Daily Puzzle Ladder — §3.1.4 — which was
archived read-only because `socialProfile.ts` + `homeCompletionDates.ts` still
read `daily_puzzle_attempts`): the `league_*` tables have **zero remaining
readers** after the decommission (confirmed by grep of `server/src` + `client/src`),
and the ~200 rows are abandoned March–April 2026 test-season state with no display
surface. `supabase/league.sql` is preserved in git history if the feature is ever
revived.

**Parked (not integrity work):** `roomKind.ts`'s `'legacy_league'` classification
+ `isLegacyLeagueRoom` + the inert `case 'legacy_league':` / `!legacyLeagueRoom`
guards in `roomLivePersistence.ts` / `roomSession.ts` — System 1/2 ratified code
(D-9 / PR #102); `config.tournamentId` is still a valid `RoomConfig` field but
nothing sets it, so these branches are permanently unreachable. Safe to strip in
a later cleanup.

---

# System 6: Auth / session + rate limiting (cross-cutting)

Scope: server `platform/auth/supabaseAuth.ts` (Bearer→uid validation, sha256-keyed
TTL cache w/ 1000-entry ceiling + in-flight dedup), `social/socialAuth.ts`
(`requireAuth`), `platform/auth/adminSecret.ts` (`ADMIN_SECRET` header gate),
`rateLimit.ts` + `middleware/rateLimiter.ts` (`InMemoryRateLimiter` — per-process,
lost on restart) + the ~15 `app.use` rate-limit rules in `index.ts`; client
`auth/**` (16 files — Supabase auth modal, `sessionToken.ts`,
`authTimeoutSessionFallback.ts`, password/email change, `recoveryHash.ts`,
`e2eDevAuth.ts`, `isAdminUser.ts` via `VITE_ADMIN_EMAIL`).

**In scope:** how identity is established on every HTTP request + socket
connection; token-cache correctness under rotation / expiry / revocation;
admin-gate strength + per-endpoint blast radius; the in-memory rate limiter's
single-instance caveat (same class as System 2's in-memory locks — §2.1.1) and
its restart behaviour; client session lifecycle (refresh, the timeout fallback,
recovery-hash handling, the e2e dev-auth path never reaching prod).
**Out of scope:** Supabase's own auth service internals; each feature's own
`getAuthenticatedUserId` usage (covered by that feature's audit).

**Status:** **LIVE** — every authenticated route depends on it. **Step 1 (§6.1)
RATIFIED D-12; Step 2 (§6.2 / §6.3) CANDIDATE 2026-09-03**, awaiting sign-off
(→ D-13) before Step 3.

## 6.1 Current-state map

Status: **written 2026-09-03, Step 1.** Read-only. No fixes, no invariants —
this maps what exists. §6.2 / §6.3 not started.

Prod facts used below (verified live via `GET /ready`, 2026-09-03): `nodeEnv:
production`; `checks.recommendedEnv` → **`ADMIN_SECRET: false`**, `CLIENT_URL:
false`, `CORS_ALLOWED_ORIGINS: true`, `DAILY_PUZZLE_CRON_SECRET: false`,
`SERVER_URL: true`; `requiredEnv` → `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` true.

### 6.1.1 There are **three** server-side auth implementations

All three answer the same question — "what verified `userId` does this
`Authorization: Bearer <jwt>` belong to?" — by calling the same upstream
(`GET <SUPABASE_URL>/auth/v1/user` with `apikey: <service key>` + the caller's
`Authorization`). They do **not** share a cache or a code path.

| # | File / fn | Caches? | Timeout | Extra checks | Callers |
|---|---|---|---|---|---|
| **A** | `platform/auth/supabaseAuth.ts` — `getAuthenticatedUserId(req)` → `getAuthenticatedUserIdFromToken(token)` | **yes** — `Map<sha256(token) → {userId, expiresAt}>`, 60 s TTL on success / 10 s on upstream 4xx / **not cached** on timeout or thrown error; + in-flight dedup (`authenticatedUserIdInFlight`) so a 9-request page fan-out validates once | 12 s `AbortController` → returns `null` on abort | a **non-production** e2e bypass: `token === 'e2e-daily-fritz'` → id from `x-e2e-daily-fritz-user` header or `E2E_DAILY_FRITZ_USER_ID` env (§6.1.8) | daily-fritz routes, puzzle-rush, ghost, stats, bot-matches, `resolveSocketIdentity` (socket identity), daily-fritz checkpoint |
| **B** | `social/socialAuth.ts` — `requireAuth(req, res)` | **no** — every call is an upstream round-trip | none (inherits `supabaseFetch`'s default) | none | `/api/social/*` + `/api/profile/*` (`social/routes.ts`, `socialFriends.ts`, `socialFeed.ts`, `socialProfile.ts`), `/api/account` (`account/routes.ts`) |
| **C** | `scheduledTournament/tournamentAuth.ts` — `requireAuthUserId(req, res, {allowAnonymous?})` → `getUserIdFromBearerToken(token)` | **no** | none | `isValidUuid` on the returned id; `rejectMismatchedPayloadUserId(authUserId, body.userId)` (a client-sent `userId` must equal the token's) | `/api/tournaments/*` (`scheduledTournament/routes.ts`) — System 1 |

Consequence: **B and C pay a full upstream `/auth/v1/user` call on every request**
(latency + Supabase quota + a DoS-amplification factor — one social request → one
upstream auth call); **A** is the only one that survives an upstream blip and that
dedups a fan-out — but **A** is also the only one with a **revocation lag**
(§6.1.2).

There is also a **synchronous, signature-unverified** identity read — §6.1.3.

### 6.1.2 The token→uid cache (`supabaseAuth.ts`) — size, eviction, revocation

- **Key:** `createHash('sha256').update(token).digest('base64url')` — the raw
  bearer token is never stored (good).
- **Value:** `{ userId: string | null, expiresAt: number }`.
- **TTL:** `AUTHENTICATED_USER_ID_TTL_MS = 60_000` on a successful validation;
  `10_000` on an upstream **non-OK** response (a 401/403 is cached as
  `userId: null` for 10 s); on an `AbortError` (12 s timeout) → returns `null`
  **without caching**; on any other thrown error → the promise rejects, nothing
  cached, `authenticatedUserIdInFlight` cleared in `.finally`.
- **Ceiling:** `AUTHENTICATED_USER_ID_MAX_ENTRIES = 1_000`. `pruneAuthenticatedUserIdCache(now)`
  runs on every write: first deletes all `expiresAt <= now` entries, then evicts
  **oldest-by-Map-insertion-order** until `size <= 1000`. So the cache is bounded
  (this was a fix — the comment notes it "grew without bound" before).
- **In-flight dedup:** `authenticatedUserIdInFlight: Map<key → Promise>` — a
  concurrent second request for the same token returns the pending promise;
  cleared in `.finally`.
- **Revocation lag (the window):** a Supabase access token is a self-contained
  JWT valid until its own `exp` (~1 h default). Client `signOut()` revokes the
  **refresh** token, not the access token — `/auth/v1/user` keeps returning the
  user for a signed-out-but-unexpired access token. On top of that, cache **A**
  returns `cached.userId` for up to **60 s** after the last successful upstream
  check **without re-validating**. Net: a leaked/stolen access token is honoured
  by the server for `min(JWT exp, last-check + 60 s)` — worst case ~1 h from a
  fresh token, and a user "signing out" does not shorten it. A Supabase-side
  **ban** (`/auth/v1/user` → 403) propagates on the next upstream check, i.e.
  after the ≤60 s cache entry expires. Caches **B** and **C** have **no**
  revocation lag (uncached) but also no protection against upstream unavailability.

### 6.1.3 `getUserIdFromAuthHeaderSync` — the unverified JWT decode

`supabaseAuth.ts:55` — splits the bearer token on `.`, base64-decodes
`parts[1]`, `JSON.parse`, returns `payload.sub` **with no signature check and no
`exp` check.** Anyone can mint `{"sub":"<anything>"}` as the middle segment.

Callers (all in `index.ts`, all **rate-limit keying only**):
- `dailySubmitLimit` (`/api/daily-fritz/{next-hand,record-game,complete}` — 90/5min)
- `recordMatchLimit` (`/api/stats/record-match` — 20/5min)
- `dailyFritzInitLimit` (`/api/daily-fritz/{today,start}` — 20/60s)
- `accountDeleteLimit` (`/api/account` — 10/10min)

The forged `sub` is **not** used for authorization — the route handlers call auth
impl **A/B/C**, which validate upstream. But the rate-limit *bucket key* becomes
`${scope}:user:${forged-sub}`, so **an attacker rotates the `sub` and gets a fresh
per-user bucket on every request** → the per-user rate limits on those four
endpoints provide no protection against an unauthenticated attacker. The only
backstop is `restApiLimit` (`/api`, IP-keyed — §6.1.5, also bypassable).

### 6.1.4 Admin-secret gate (`platform/auth/adminSecret.ts`)

- `constantTimeEqualSecret(provided, expected)` — returns `false` unless
  `typeof provided === 'string'` and `expected` truthy; then `Buffer.from(x.trim())`
  both sides, **early-returns `false` on a length mismatch** (necessary —
  `timingSafeEqual` throws on unequal lengths — but it does leak secret length
  via timing), then `timingSafeEqual`. `isAdminSecret(v) = constantTimeEqualSecret(v, process.env.ADMIN_SECRET)`.
- **`ADMIN_SECRET` is unset in prod** (`/ready` → `recommendedEnv.ADMIN_SECRET:
  false`, confirmed live). `expected` is `undefined` → `!expected` →
  `constantTimeEqualSecret` returns `false` for **every** input →
  **every admin endpoint is fail-closed / un-callable in prod right now.**
- **Transport is inconsistent across the admin endpoints:**
  | Endpoint | Secret read from | Guards | Blast radius if the secret were set + leaked |
  |---|---|---|---|
  | `POST /api/daily-fritz/generate` | `req.body.adminKey` (JSON body) | `isAdminSecret` | force-generate a Daily Fritz run |
  | `POST /api/daily-fritz/invalidate` | `req.body.adminKey` | `isAdminSecret` | invalidate a published challenge mid-day |
  | `POST /api/daily-fritz/reset-attempt` | `req.body.adminKey` | `isAdminSecret` | wipe any user's Daily Fritz attempt (competitive-integrity) |
  | `GET /api/daily-fritz/metrics` | `x-admin-secret` header **or `?admin_key=` query** | `isAdminSecret` | telemetry read |
  | `GET /api/daily-fritz/health` | `x-admin-secret` **or `?admin_key=`** | `isAdminSecret` | health read |
  | `GET /api/daily-fritz/events/:attemptId` | `x-admin-secret` **or `?admin_key=`** | `isAdminSecret` | per-attempt event log incl. `user_id`s (info disclosure) |
  | `POST /api/ranking/process/:userId` | `req.body.adminKey` | `isAdminSecret` | force a Glicko rating-period recompute for any user |
  | `POST /bot-matches/cleanup-stale` | `req.body.adminKey` | `isAdminSecret` | force-forfeit any user's >30-min-idle pending bot match (rating hit) |
  - The `?admin_key=` query-string option (3 GET endpoints) puts the secret in
    access logs / browser history / `Referer` / proxy logs. `client/src/admin/DailyFritzHealthAdminScreen.tsx`
    already **migrates a legacy `?admin_key=` out of the URL** and uses the
    `x-admin-secret` header — but the server still accepts the query param.
  - Single shared static secret; no IP allowlist, no per-admin identity, no
    second factor. The client admin screen holds the entered secret in React
    state (`resolveInitialAdminKey` — check whether it persists to
    `localStorage`; if so, XSS on the admin's browser = secret theft).
  - `rateLimit adminLimit` = 20 req / 10 min, **IP-keyed** (§6.1.5 — bypassable),
    so it does not meaningfully bound a brute-force; `timingSafeEqual` + a strong
    random secret is the only real protection, and the secret is currently unset.
- **Dead:** `isAuthorizedDailyPuzzleCronRequest` + `handleDailyPuzzleLadderCronWarm`
  (`dailyPuzzleStore.ts`) check `DAILY_PUZZLE_CRON_SECRET` (also unset) — the
  route that used them was deleted in System 3. Appendix / DF-CAND leftover.

### 6.1.5 Rate limiting

**`InMemoryRateLimiter`** (`rateLimit.ts`) — `Map<key → {count, resetAt}>`.
`take()` starts/reuses a bucket; an expired bucket (`resetAt <= now`) is
**overwritten**, never proactively deleted; **there is no size ceiling and no
sweep** — every distinct key is a permanent Map entry until process restart or a
full `.clear()`. (Contrast cache **A**, which at least prunes to 1000.) So the
limiter map grows by one entry per distinct rate-limit key ever seen — and a
key is `${scope}:ip:<ip>` or `${scope}:user:<uid>`, both attacker-influenceable
(below). A slow memory leak; a fast one under a spoofed-key flood.

**Key derivation** (`createRateLimitMiddleware`): `getUserId?.(req)` non-null →
`${scope}:user:${userId}`, else `${scope}:ip:${requestIp(req)}`. `requestIp`
takes `x-forwarded-for.split(',')[0]` when present, else `req.ip`. **There is no
`app.set('trust proxy', …)`** — so `req.ip` is the Render proxy, and
`x-forwarded-for[0]` is **fully client-controlled** (Render *prepends* the real
IP but a client can send its own `X-Forwarded-For: 1.2.3.4` and that becomes
`[0]`). Every IP-keyed HTTP limit is therefore bypassable by rotating a spoofed
leftmost `X-Forwarded-For`; every per-user limit whose `getUserId` is
`getUserIdFromAuthHeaderSync` is bypassable by rotating a forged `sub` (§6.1.3).

**HTTP rules** (all on one shared `restRateLimiter`, `5min/600` default; order =
`app.use` order in `index.ts`):

| Rule | Path(s) | Window / max | Key | Protects |
|---|---|---|---|---|
| `cronLimit` | `/api/cron` | 10min / 20 | IP | (the `/api/cron/*` routes — the daily-puzzle one was deleted; none left?) — verify in Step 2 |
| `leaderboardLimit` | `/api/daily-fritz/leaderboard`, `/api/ranking/leaderboard` | 60s / 30 | IP | unbounded DB leaderboard scans from a single poller |
| `recordMatchLimit` | `/api/stats/record-match` | 5min / 20 | **sync sub** | rating computation on every match record |
| `dailyFritzInitLimit` | `/api/daily-fritz/{today,start}` | 60s / 20 | **sync sub** | Daily Fritz init polling abuse |
| `dailySubmitLimit` | `/api/daily-fritz/{next-hand,record-game,complete}` | 5min / 90 | **sync sub** | Daily Fritz submit spam |
| `adminLimit` | `/api/daily-fritz/{generate,invalidate,reset-attempt,metrics,health,events}`, `/api/ranking/process`, `/bot-matches/cleanup-stale` | 10min / 20 | IP | admin-secret brute-force (weak — see §6.1.4) |
| `accountDeleteLimit` | `/api/account` | 10min / 10 | **sync sub** | repeated irreversible account deletion |
| `restApiLimit` | `/api`, `/bot-matches` | 5min / 600 | IP | catch-all |

*(the `/league/*` rules — `run-forfeits`, `run-rollover`, the `/league`
`restApiLimit` — were removed with System 5.)*

**Socket rules** (`installSocketRateLimit`, `socket.use` per packet, on a
separate `socketRateLimiter` 60s/600 default): a `SOCKET_EVENT_LIMITS` table
(`room:create/join/spectate`, `queue:join`, `friend:invite(:decline)`,
`room:chat:send`, `room:emote:send`, `game:action` 240/min, `hand:ready`,
`player:ready` — all env-tunable via `LIMIT_*_MAX`), default `limitDefaultMax`
600. Key = `socketRateLimitKey(socket)` = `socket.data.userId ??
socket.handshake.address ?? socket.id`. `socket.data.userId` is set **only after**
a handler runs (`registerPresenceHandlers`, `roomSocketAttach`,
`registerRoomLifecycleHandlers`, `registerRoomSpectateHandlers`) — so the first
packets key on `handshake.address` (the Render proxy, shared across all
unauthenticated sockets) or `socket.id` (unique per connection → a reconnect =
a fresh bucket). Plus `failedRoomLookupLimiter` (5 failed `room:join`/`room:spectate`
lookups / 60 s — the MP-G3 backstop, System 2).

**`middleware/rateLimiter.ts`** (`express-rate-limit`-based `apiGeneralLimiter`,
skips localhost) — **defined, imported nowhere. Dead code.** ("for future route
modules" — never adopted.)

**Restart caveat:** both limiter maps + cache **A** + `authenticatedUserIdInFlight`
+ `sessionToken.ts`'s client cache are **process-local, lost on every deploy /
crash / OOM.** Same class as System 2's in-memory `Room` maps and gameplay locks
(§2.1.1) and System 3's `withDailyFritzAttemptLock` — Render is structurally
single-instance and restarts are frequent (§2.3.2 evidence: ≥1/day). On restart:
all rate-limit counters reset to zero (a burst timed across a deploy gets 2×
budget); all token validations must re-hit Supabase (a cold-cache thundering herd
right when the instance is slowest).

### 6.1.6 Socket connection auth

The only `io.use` connection middleware rejects connections during graceful
shutdown. **There is no auth at socket connect.** Any client connects
unauthenticated; identity is established **per action** — the client passes an
`authToken` field in `room:join` / `room:create` / `presence:online` payloads →
`resolveSocketIdentity` → `getAuthenticatedUserIdFromToken` (cache **A**). No
token, or an invalid one → `userId: null` (guest); a client-claimed
**non-UUID-shaped** `userId` without a token is kept (smoke tests / guest flows),
a **UUID-shaped** claim without a token is rejected (`isUuidLike`). `getSocketUserId`
(tournament) additionally requires `isValidUuid(socket.data.userId)`.

### 6.1.7 Client session lifecycle

- **Supabase client** (`lib/supabase.ts`): `persistSession: true` (→ `localStorage`
  `sb-<ref>-auth-token`, holding **both access + refresh tokens**),
  `autoRefreshToken: true`, `detectSessionInUrl: false` (recovery handled
  manually — §6.1.7 recovery). Standard SPA posture; the **localStorage token
  pair means any XSS = full account takeover** (see §6.1.9 CSP notes).
- **`sessionToken.ts`** — an in-memory `{ token, userId }` cache. Authoritative
  source is `onAuthStateChange` (`setCachedSession` on `SIGNED_IN` /
  `TOKEN_REFRESHED` / `USER_UPDATED`; `clearCachedSession` on `SIGNED_OUT` / no
  session). `getCachedSession(loadSession)` falls back to one shared
  `getSession()` on a cold read. Motivation: `getSession()` acquires a lock +
  may refresh, and a 9-request fan-out was paying it 9×.
- **`getAuthHeaders` / `apiFetch`** (`api/client.ts`): attaches
  `Authorization: Bearer <cached token>`; `credentials: 'include'`; 15 s timeout.
  On `401` (attempt 1 only): `refreshSession()` → retry once with the new token;
  if refresh fails **and** the request carried a token → dispatch
  `rh:session-expired` (pops the sign-in modal). e2e path (`import.meta.env.DEV`
  only) short-circuits to `Bearer e2e-daily-fritz`.
- **`signOut`** (`useAuth.ts:649`): **`clearCachedSession()` immediately** (so the
  token stops being attached before the network call), then
  `supabase.auth.signOut()` raced against a timeout → on timeout,
  `signOut({ scope: 'local' })`. `clearLocalSupabaseAuthTokens()` removes
  `sb-*auth-token*` from `localStorage`. Note: this kills the **client's** use of
  the token; the **access token JWT stays valid upstream until its `exp`** (see
  §6.1.2).
- **Timeout fallback** (`authTimeoutSessionFallback.ts`): when a sign-in/up
  request hits `AUTH_REQUEST_TIMEOUT_MS = 15000`, a `getSession()` probe may be
  accepted as success **only if `session.user.email` matches the submitted
  email** (case-insensitive). Guards the "timed-out request silently adopts a
  *previous* user's stale session" failure. `email_mismatch` → `Sentry.captureMessage`
  `level: error`, tag `auth_timeout_stale_session`; `no_session` → console warn
  only. Reports lengths/booleans, never emails/tokens.
- **Recovery hash** (`recoveryHash.ts`): parses `#access_token=…&refresh_token=…&type=recovery`
  from the URL fragment (before BrowserRouter starts), calls `supabase.auth.setSession`,
  and **clears the hash only after `setSession` succeeds** (clearing first burned
  one-shot links on transient failure). Failure → `Sentry` `level: error`, tag
  `recovery_set_session_failed`, lengths only. **Window:** a full valid
  `{access_token, refresh_token}` pair sits in `window.location.hash` until
  `setSession` resolves — readable by any script on the page during that window
  (standard implicit-flow exposure).
- **Password change** (`passwordChange.ts`): `MIN_PASSWORD_LENGTH = 6` (Supabase's
  own floor). **Email change** (`emailChange.ts`): validation only; notes
  Supabase "secure email change" (dual confirmation) is the default.
- **Redirects** (`authRedirect.ts`): `getAuthEmailRedirectTo()` forces the
  canonical `https://playracehorse.com` for `*.vercel.app` preview URLs + legacy
  origins so recovery/confirm links always land on an allowlisted URL.
- **Admin UI gate** (`isAdminUser.ts`): `email === VITE_ADMIN_EMAIL`
  (case-insensitive). `VITE_ADMIN_EMAIL` is **baked into the client bundle** —
  publicly readable → the admin's email is not secret. This is **UI-visibility
  only**; the real gate is the server `ADMIN_SECRET` (§6.1.4).

### 6.1.8 `e2eDevAuth` — confirmed dead in prod (two independent gates)

- **Client** (`auth/e2eDevAuth.ts`): `readE2eDevAuth()` returns `null` unless
  `import.meta.env.DEV` — `false` in a production build, dead-code-eliminated.
- **Server** (`supabaseAuth.ts:76`): the `token === 'e2e-daily-fritz'` branch is
  gated on `process.env.NODE_ENV !== 'production'` — prod is `nodeEnv: production`
  (confirmed live).
- Same posture as System 5's `ENABLE_LEGACY_TOURNAMENTS` check and the
  `e2eInspectRoute` (`E2E_INSPECT=1` + `NODE_ENV !== 'production'`). Two gates,
  both closed in prod.

### 6.1.9 CORS, security headers, health-endpoint disclosure

- **CORS** (`index.ts` `corsOptions`): `origin` reflects the request origin when
  `isAllowedOrigin(origin)`, with `credentials: true`. `isAllowedOrigin`: `!origin
  → true`; the canonical prod origins; `CLIENT_URL` (unset in prod); `CORS_ALLOWED_ORIGINS`
  (set); and `allowedOriginPatterns` — which includes **`/^https:\/\/.*\.vercel\.app$/i`**,
  i.e. **any `*.vercel.app` subdomain** gets a reflected `Access-Control-Allow-Origin`
  + `Access-Control-Allow-Credentials: true`. Practical impact is limited by the
  Bearer-token model (a cross-origin page can't read the victim's `localStorage`
  token, and the API doesn't use cookies), so this is a *wider-than-necessary
  allowlist* rather than an account-takeover vector — but it lets any
  vercel-hosted page call the API cross-origin and read responses.
- **Server security headers** (every response): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (geo/mic/cam off), CSP `default-src 'none'; connect-src
  'self' <supabase> <sentry>`, HSTS in prod. Tight — the API only serves JSON.
- **Client CSP** (`client/public/_headers`): `script-src 'self' 'unsafe-inline'
  https://*.i.posthog.com`; `img-src 'self' data: https:`; `connect-src … wss:
  https:` (the trailing `wss:`/`https:` make the connect-src allowlist
  effectively open). **`'unsafe-inline'` + a localStorage token pair + open
  `img-src https:` = an XSS can exfiltrate the session** via an image beacon.
  (Belongs to §13 telemetry/CSP too — noted here because auth is the asset.)
- **Health endpoints, all unauthenticated:** `/health`, `/ping` (release commit
  SHA); `/healthz` (+ DB probe); **`/ready`** discloses `pid`, `uptimeSeconds`,
  `connectedSockets`, `roomCount`, `gamesInProgress`, the exact `release` commit
  (→ exact source, public repo), Supabase latency, the daily-puzzle ladder
  internal state, and **which recommended env vars are set** (`ADMIN_SECRET`,
  `CLIENT_URL`, `DAILY_PUZZLE_CRON_SECRET`, …). Recon aid; the env-presence map in
  particular tells an attacker the admin surface is currently disabled (or, once
  a secret is set, when to start probing).

### 6.1.10 Concurrency / authz windows

| # | Window | Where | Current behaviour |
|---|---|---|---|
| **AU-1** | **Token-cache revocation lag.** A token revoked/expired/banned at Supabase is still honoured by cache **A** for up to 60 s after the last successful check (and a client `signOut` doesn't revoke the access-token JWT at all — valid to its `exp`). | `supabaseAuth.ts` cache **A** | ≤60 s stale-accept window; auth impls **B**/**C** have none. No push-invalidation. |
| **AU-2** | **Rate-limiter reset on deploy restart.** All `InMemoryRateLimiter` counters + cache **A** + `authenticatedUserIdInFlight` reset to zero on every restart (frequent). | `rateLimit.ts`, `supabaseAuth.ts` | a burst straddling a deploy gets ~2× budget; a cold-cache auth thundering herd hits Supabase right when the instance is slowest (§1.3 T-18 class). |
| **AU-3** | **IP-key spoof.** No `trust proxy`; `x-forwarded-for[0]` is client-set → every IP-keyed HTTP limit (incl. `adminLimit`, `restApiLimit`, `leaderboardLimit`) is bypassed by rotating the header. | `rateLimit.ts` `requestIp` | IP limits are advisory only against a deliberate attacker. |
| **AU-4** | **Forged-`sub` rate-limit-key bypass.** `getUserIdFromAuthHeaderSync` reads `sub` from an unsigned JWT → per-user limits on `record-match`, `account-delete`, daily-fritz init/submit are bypassed by rotating `sub`. Not an authz bypass (handlers re-validate) — a rate-limit bypass. | `supabaseAuth.ts:55`, `index.ts` limit wiring | those 4 endpoints have effectively only the (also-bypassable) IP catch-all. |
| **AU-5** | **`socket.data.userId` unset on first packets.** Early socket events key the socket limiter on `handshake.address` (shared Render-proxy IP for all unauth sockets) or `socket.id` (fresh per reconnect). | `index.ts` `installSocketRateLimit`, `socketRateLimitKey` | either one abusive socket throttles all unauth sockets, or a reconnect loop resets the bucket. |
| **AU-6** | **Admin secret unset → admin surface disabled; if later set, a single static shared secret** with query-string transport on 3 GETs, `localStorage` storage in the admin UI, and only an IP-keyed (spoofable) brute-force limit. A leak = Daily Fritz content control + `reset-attempt` on any user + `ranking/process` on any user + per-attempt info disclosure. | `adminSecret.ts`, `dailyFritzAdminRoutes.ts`, `ranking.ts`, `botMatches.ts` | fail-closed today; brittle if activated as-is. |
| **AU-7** | **Recovery-token exposure window.** A full `{access,refresh}` pair in `location.hash` until `setSession` resolves. | `recoveryHash.ts` | standard implicit-flow exposure; mitigated by `detectSessionInUrl: false` + immediate manual consume + post-success clear. |
| **AU-8** | **Three divergent auth impls.** A fix / hardening (e.g. shorten the revocation window, add a nonce check, handle a Supabase outage) has to be made in three places or they drift — `socialAuth`/`tournamentAuth` already lack the cache, timeout, and e2e-bypass that `supabaseAuth` has. | §6.1.1 | latent drift; inconsistent DoS-amplification and outage-resilience per route family. |

### 6.1.11 Existing prior art / good patterns (reusable)

- **sha256-keyed token cache with a hard ceiling + expiry-then-oldest eviction +
  in-flight dedup** (`supabaseAuth.ts`) — the right shape; just needs a
  revocation story and to be the *only* impl.
- **`timingSafeEqual` for the admin secret** (`adminSecret.ts`) — constant-time
  compare, fail-closed on unset.
- **Email-match gate on the auth-timeout fallback** (`authTimeoutSessionFallback.ts`)
  — closes the "adopt a stale session" hole; alerts the dangerous branch.
- **Consume-then-clear ordering on the recovery hash** (`recoveryHash.ts`) — clear
  only after success so a transient failure doesn't burn a one-shot link.
- **Immediate `clearCachedSession()` on sign-out intent** (`useAuth.ts`) — token
  stops being attached before the network round-trip.
- **Structured auth alerts** (`auth_timeout_stale_session`, `recovery_set_session_failed`)
  — the System 1 D-3 / System 3 DF-G2 alert pattern, already applied here.

## 6.2 Invariants

Status: **CANDIDATE — written 2026-09-03, awaiting human line-by-line sign-off
(→ Decisions D-13, mirroring D-3 / D-9 / D-10).** §6.1 is ratified (D-12).

Framing mirrors §1.2 / §2.2 / §3.2: each invariant states **the rule**, **the
mechanism that enforces it today** (or `UNENFORCED` / `PARTIAL`), and **the
failure mode**. Grounded in a §6.1 subsection and tied to the AU-window(s) it
protects. Precondition for all: the **single Render instance** (§2.1.1) — a
cross-instance failure is the revisit trigger, not a gap.

**AU-INV-1 — The actor on an authenticated route is resolved from a
signature-verified token, never a client claim.**
*Enforced by:* `getAuthenticatedUserId` (A) / `requireAuth` (B) /
`requireAuthUserId` (C) all call `GET /auth/v1/user`, which verifies the JWT
signature + `exp` upstream; C additionally `isValidUuid`-checks the result and
`rejectMismatchedPayloadUserId` rejects a client-sent `userId ≠` the token's.
Socket: `resolveSocketIdentity` verifies `authToken`; a UUID-shaped `userId`
claim without a token → `null`. `getUserIdFromAuthHeaderSync` (unverified `sub`
decode) is used **only** for rate-limit keys, never authz.
*Failure mode:* acting as another user. **HOLDS** — the load-bearing assumption
is that `getUserIdFromAuthHeaderSync` is never wired into an authz decision;
AU-8's three-impl drift is the risk that a future change forgets which impl a
route uses.

**AU-INV-2 — A revoked, expired, or banned token stops being accepted within a
bounded, known window.**
*Enforced by:* `/auth/v1/user` rejects an expired/banned token on the next
upstream check. Cache **A** re-checks upstream at most every 60 s; **B**/**C**
re-check every request.
*`PARTIAL` / failure mode (AU-1):* (a) a client `signOut()` revokes only the
**refresh** token — the access-token JWT stays valid upstream until its own
`exp` (~1 h default), so "sign out" does not bound a *captured* token at all;
(b) cache **A**'s ≤60 s stale-accept stacks on top for A's route families
(daily-fritz, puzzle-rush, ghost, stats, bot-matches, socket). There is no
push-invalidation and no server-side denylist.

**AU-INV-3 — The admin surface is unreachable without the admin secret, and
fail-closed when the secret is unset.**
*Enforced by:* `isAdminSecret(v)` → `constantTimeEqualSecret(v, process.env.ADMIN_SECRET)`
→ `false` for every input when `ADMIN_SECRET` is falsy; `timingSafeEqual` for the
compare when it is set. **`ADMIN_SECRET` is unset in prod** → every
`isAdminSecret`-guarded endpoint returns 401 today.
*`POSTURE` residual (AU-6):* the *design* if the secret is ever set — `?admin_key=`
query-string transport still accepted on 3 GET endpoints, entered-secret held in
`sessionStorage` in the admin UI, one static shared secret, and only a spoofable
IP rate limit bounding brute-force.

**AU-INV-4 — Every rate limit bounds a deliberate actor, not just an honest
client.**
*Enforced by:* `InMemoryRateLimiter` per `${scope}:{user|ip}:<key>`.
*`UNENFORCED against a deliberate actor` / failure mode (AU-3 + AU-4 + AU-5):*
- **No `app.set('trust proxy')`** + `requestIp()` reads `x-forwarded-for.split(',')[0]`
  (leftmost, client-settable) → **every IP-keyed HTTP limit is bypassed** by
  rotating the header: `restApiLimit` (`/api` catch-all), `leaderboardLimit`,
  `adminLimit` (the admin brute-force bound), `cronLimit`.
- `getUserIdFromAuthHeaderSync` forges `sub` → **every per-user HTTP limit is
  bypassed**: `accountDeleteLimit` (10/10 min — irreversible account deletion),
  `dailySubmitLimit` (Daily Fritz submit spam → verifier load), `recordMatchLimit`
  (→ Glicko recompute on every record), `dailyFritzInitLimit`.
- Socket: `socket.data.userId` is unset on the first packets → they key on the
  shared Render-proxy `handshake.address` (one abuser throttles all unauth
  sockets) or per-connection `socket.id` (a reconnect resets the bucket).
So the app's entire rate-limit layer is **advisory only** against anyone who
reads the source (it's a public repo).

**AU-INV-5 — Auth-cache and rate-limiter memory is bounded.**
*Enforced by:* cache **A** — 1000-entry ceiling, prune-expired-then-evict-oldest
on every write. **HOLDS.**
*`UNENFORCED` / failure mode (AU-3):* `InMemoryRateLimiter` has **no ceiling and
no sweep** — an expired bucket is overwritten only if the same key recurs;
otherwise it lives until process restart. Grows by one entry per distinct
`{ip|user}` key ever seen — a slow leak normally, a fast one under the
spoofed-key flood that AU-3/AU-4 make trivial (unbounded distinct keys → OOM on
512 MB).

**AU-INV-6 — Auth degrades predictably during a Supabase outage — it does not
fail every request open, and it does not amplify the outage.**
*Enforced by:* cache **A** rides out a blip (60 s cached uid), returns `null`
(not throw) on its 12 s timeout, and the in-flight dedup collapses a 9-request
page fan-out to one upstream call.
*`PARTIAL` / failure mode (AU-2 + AU-8):* **B**/**C** are uncached with **no
circuit-breaker on the auth path** (`requireAuth` / `getUserIdFromBearerToken`
don't pass `circuitBreakable`) → during a Supabase slowdown every `/api/social/*`
+ `/api/profile/*` + `/api/account` + `/api/tournaments/*` request makes its own
`/auth/v1/user` call and 401s — a thundering herd against Supabase exactly when
it is slow. A deploy restart empties cache **A** → the same cold-start herd for
A's routes (§1.3 T-18 class).

**AU-INV-7 — The client attaches a token only while the user intends to be
signed in, and a timed-out login never silently adopts another session.**
*Enforced by:* `signOut` calls `clearCachedSession()` **before** the network
round-trip + `clearLocalSupabaseAuthTokens()`; `apiFetch` on 401 refreshes once
then dispatches `rh:session-expired`; `authTimeoutSessionFallback` accepts a
post-timeout `getSession()` **only if `session.user.email` matches the submitted
email**, and alerts (`auth_timeout_stale_session`, `level: error`) on a mismatch.
*Failure mode:* a stale token attached after sign-out, or a login timeout
adopting a previous user's session. **HOLDS.**

**AU-INV-8 — There is one auth code path, so a change to token handling
(revocation window, outage behaviour, a nonce check) applies everywhere at once.**
*Enforced by:* nothing — **UNENFORCED (AU-8).** Three impls (A/B/C) with
divergent caching, timeout, circuit-breaker, and e2e-bypass behaviour.
*Failure mode:* a fix to AU-1 / AU-6 / AU-INV-6 made in one impl silently leaves
the other route families on the old behaviour; new routes pick an impl by
copy-paste. **§6.3 recommends consolidating B + C onto A.**

### Notes for Step 3

- **HOLDS today:** AU-INV-1, AU-INV-3 (fail-closed), AU-INV-5 (cache A only),
  AU-INV-7.
- **The real exposure is AU-INV-4** — the whole rate-limit layer is bypassable,
  and the fix (§6.3 AU-3/AU-4) is cheap.
- **AU-INV-2 / AU-INV-6 / AU-INV-8** are entangled — see the AU-1 / AU-8
  write-ups in §6.3.

## 6.3 Gap list (risk-ranked)

Status: **CANDIDATE — written 2026-09-03, awaiting sign-off (→ D-13).**

**Scoring** (same axes as §1.3 / §2.3 / §3.3). *Severity* ∈ {data-corruption,
competitive-integrity, auth-bypass, player-visible-bug, cosmetic} — **plus
`abuse-enabling`** for this system (a control that fails to bound a deliberate
actor but is not itself an authz or integrity break). *Likelihood* is for the
**single Render instance** and current pre-marketing traffic. *Verdict* ∈
{**FIX NOW**, **POSTURE** (a design decision + a pre-conditions checklist, no
code now), **REVISIT IF SCALE**, **ACCEPT**}.

| ID | Gap | §6.1 ref | Severity | Likelihood (1 instance) | Blast radius | Verdict | Protects |
|---|---|---|---|---|---|---|---|
| **AU-3** | **No `trust proxy` → every IP-keyed rate limit is bypassable.** `requestIp()` reads `x-forwarded-for.split(',')[0]` (leftmost = client-settable; Render *prepends* the real IP but the client's spoofed value is still `[0]`). Affects `restApiLimit` (`/api` catch-all), `leaderboardLimit` (unbounded DB scans), **`adminLimit`** (the only bound on admin-secret brute-force), `cronLimit`. Also feeds AU-INV-5 — a spoofed-key flood grows the limiter map without bound. | §6.1.5, §6.1.10 AU-3 | **abuse-enabling** (→ competitive-integrity via unbounded leaderboard scans; → weakens admin brute-force bound; → memory) | **high** — one HTTP header, and the source is public | app-wide: every IP-keyed limit + the limiter's memory bound | **FIX NOW** — `app.set('trust proxy', 1)` (**Step 3: confirm Render is exactly 1 proxy hop first** — it normally is) + rewrite `requestIp()` to `return req.ip` (Express then resolves it past the client's spoofed prefix). ~5 lines + a test. | AU-INV-4, AU-INV-5 |
| **AU-4** | **`getUserIdFromAuthHeaderSync` decodes an unsigned JWT `sub` for rate-limit keys → every per-user limit is bypassable** by rotating a forged `{"sub":"<random>"}`. Endpoints: `accountDeleteLimit` (10/10 min on **irreversible account deletion**), `dailySubmitLimit` (Daily Fritz submit spam → `dailyFritzVerifier` CPU on a 0.1-CPU instance), `recordMatchLimit` (→ a Glicko rating-period recompute per call), `dailyFritzInitLimit`. **Not an authz bypass** — the handlers re-validate via impl A/B/C — but the protective intent of those four limits is fully defeated. | §6.1.3, §6.1.10 AU-4 | **abuse-enabling** (account-deletion abuse; verifier/DB load amplification on a tiny instance) | **high** — forging a JWT middle segment is trivial | the 4 per-user-keyed endpoints; on a 0.1-CPU / 512 MB box the daily-fritz + record-match amplification is a real availability risk | **FIX NOW** (bundle with AU-3) — after `trust proxy`, either (a) drop the `getUserId` arg on those four → key on `req.ip` (simple; the limits are generous enough that shared-NAT users are unaffected), or (b) make `createRateLimitMiddleware` `async` and key on the **verified** `getAuthenticatedUserId(req)` (falls back to IP for anon; reuses cache A which is already warm for authed traffic, so ~free). Prefer (b) for true per-user fairness; (a) if the async change is deemed too invasive. Delete `getUserIdFromAuthHeaderSync` once it has no callers. | AU-INV-4 |
| **AU-8** | **Three divergent server auth impls** (§6.1.1). B/C are uncached (a full `/auth/v1/user` round-trip per social / tournament / account request — latency + Supabase quota + outage amplification, AU-INV-6) and lack A's in-flight dedup, 12 s timeout, and e2e bypass. Any future change to token handling must be made 3× or the families drift; new routes copy whichever impl the author saw first. | §6.1.1, §6.1.10 AU-8 | **latent drift** → player-visible-bug (inconsistent outage behaviour) + abuse-amplification (B/C hammer upstream) | **medium** — a drift is realised the next time auth logic changes (AU-1, AU-INV-6) | inconsistent enforcement + outage behaviour across route families; blocks a clean AU-1 fix | **FIX NOW (Step 3) — consolidate B and C onto A.** *Recommendation, stated plainly:* extract A's core as `verifyBearerToken(token): Promise<string|null>` (cache + dedup + timeout), and: rewrite `socialAuth.requireAuth` as a thin `res`-writing wrapper over it; rewrite `tournamentAuth.getUserIdFromBearerToken` / `requireAuthUserId` as a wrapper that adds the `isValidUuid` check, keeping `rejectMismatchedPayloadUserId` / `getSocketUserId` at the call sites unchanged. **Why consolidate, not leave separate:** (1) it is the prerequisite for any AU-1 fix (a shortened TTL or a denylist must apply to social/tournament/account too, or those become the soft underbelly); (2) it removes B/C's per-request upstream call — measurable Supabase-quota + latency + outage-herd reduction on the most-polled routes (social feed, friends-with-presence, tournament hub); (3) A's e2e bypass is `NODE_ENV !== 'production'`-gated → harmless to extend. **Why the 60 s cache lag on the new B/C paths is acceptable:** social routes (feed/friends/presence) — immaterial; account-deletion — the user can only delete *their own* account and deletion is already the irreversible self-service action; tournament — System 1's `authorizeMatchParticipant` re-reads the match row and is the real gate there. ~10 call sites, mechanical. | AU-INV-6, AU-INV-8, AU-INV-2 |
| **AU-1** | **Token revocation lag.** (a) A client `signOut()` does **not** revoke the access-token JWT — a *captured* token works until its `exp` (~1 h, Supabase project default) regardless of sign-out; (b) cache A adds ≤60 s on top for A's route families. No push-invalidation, no denylist. | §6.1.2, §6.1.10 AU-1 | **auth-bypass** (a leaked/captured token has a longer useful life than a user expects) — **but requires a prior compromise** (XSS, shared device, the user's `localStorage`) | **low–medium** — no leak vector in-app today (HSTS, tight server CSP); the client CSP `'unsafe-inline'` + localStorage tokens is the realistic path, tracked for §13 | one account per captured token, for ≤ `min(JWT exp, last-check + 60 s)` | **POSTURE.** No live exposure to *fix* (needs a prior token compromise), but the window is longer than necessary. **Recommendation:** (1) cut cache A's success TTL **60 s → 15 s** (one constant; ~4× more upstream checks on a warm cache, still dedup'd — cheap, halves-plus the server-side lag); (2) **human action:** lower the Supabase project **JWT expiry** from 3600 s to e.g. 900 s (bounds the "signed-out token still works" window platform-wide; the client auto-refreshes, so no UX cost); (3) a server-side token **denylist** (populated on sign-out via a client `POST /auth/logout` + checked in `verifyBearerToken`) is the complete fix — **scale-gated**, only worth it once (2) isn't enough. Contingent on **AU-8** (the TTL cut + any denylist must land in the consolidated impl or B/C/account stay on the old behaviour). | AU-INV-2 |
| **AU-6** | **Admin-secret design (fail-closed today).** `ADMIN_SECRET` unset in prod → every admin endpoint 401s now. The design if it is ever set: `?admin_key=` query transport still accepted on `GET /api/daily-fritz/{metrics,health,events/:attemptId}` (→ access logs / `Referer` / history); POSTs read `req.body.adminKey`; the admin UI persists the entered secret to `sessionStorage`; one static shared secret; only the (spoofable, AU-3) `adminLimit` bounds brute-force. Blast radius if set + leaked: `reset-attempt` (wipe any user's Daily Fritz run), `invalidate` (kill a published challenge mid-day), `generate`, `ranking/process` (force a rating recompute for any user), `bot-matches/cleanup-stale` (force-forfeit any idle bot match), per-attempt event/user-id disclosure. | §6.1.4, §6.1.10 AU-6 | **auth-bypass** (of the admin boundary) — **but zero live exposure** (secret unset) | **n/a today**; the risk is a future operator setting a weak secret + the brittle transport | full Daily Fritz content control + cross-user rating/attempt manipulation + info disclosure | **POSTURE — "before you ever set `ADMIN_SECRET` in prod" checklist:** (1) **remove server-side `?? req.query.admin_key`** from the 3 GET endpoints — the client (`DailyFritzHealthAdminScreen`) already sends only the `x-admin-secret` header and migrates legacy `?admin_key=` out of the URL, so this is safe to delete outright (Step 3 can do just this part — it's a pure removal, testable, no behaviour change for the real client); (2) move the POST endpoints from `req.body.adminKey` to the same `x-admin-secret` header for one transport; (3) admin UI: **drop the `sessionStorage` persistence** — hold the entered secret in React state only, re-enter per session (one screen, infrequent use); (4) generate `ADMIN_SECRET` as ≥ 32 bytes of CSPRNG output; (5) consider whether these endpoints should be reachable from the public internet at all vs. an IP allowlist / a separate ops surface — the integrity-affecting ones (`reset-attempt`, `invalidate`, `ranking/process`) especially. | AU-INV-3 |
| **AU-5** | **Socket rate-limit key before auth.** First packets on a connection key on `handshake.address` (the shared Render-proxy IP for all unauthenticated sockets → one abuser trips the limit for everyone) or `socket.id` (unique per connection → a reconnect loop resets the bucket). `socket.data.userId` is only set after a handler runs. | §6.1.5, §6.1.10 AU-5 | **player-visible-bug** (a shared-bucket false 429, or a bypass via reconnect) | **medium** — needs a deliberate reconnect flood or a noisy shared-IP neighbour | pre-auth socket events (`room:create`, `room:join`, `presence:online`); gameplay events already require an authed + joined room | **REVISIT IF SCALE** — the pre-auth events have their own `failedRoomLookupLimiter` (MP-G3) and are cheap; the fix (a socket.io `trust proxy`-aware address, or always keying pre-auth packets on `socket.id`) is not urgent at current concurrency (`connectedSockets: 0` on `/ready`). Bundle with a future socket-scaling pass. | AU-INV-4 |
| **AU-2** | **Deploy restart resets every limiter + empties cache A.** A rate-limit burst timed across a deploy gets ~2× budget; cache A cold-starts a `/auth/v1/user` herd for authed traffic. | §6.1.5, §6.1.10 AU-2 | **cosmetic / minor player-visible-bug** | **high** (every deploy — ≥1/day per §2.3.2) but **immaterial** at current traffic | a few-second 2× window per deploy; a small cold-auth burst | **REVISIT IF SCALE** — a shared store (Redis / Upstash) for the limiter + token cache is the fix, and that is an upgrade-time change (same class as §2.1.1 / D-2 addendum / T-18 — everything in-process is lost on restart on the free tier). No action now. | AU-INV-5, AU-INV-6 |
| **AU-7** | **Recovery-token URL-fragment window.** A full `{access_token, refresh_token}` pair sits in `window.location.hash` between `parseSupabaseAuthHash` and `setSession` resolving — readable by any script on the page during that window. | §6.1.7, §6.1.10 AU-7 | **auth-bypass** (one account) — needs a malicious/compromised script already on the page during a ~sub-second window on a recovery-link click | **low** — `detectSessionInUrl: false` + immediate manual consume + clear-only-after-success already minimise it; requires an XSS coinciding with a password-recovery flow | one account | **ACCEPT** — standard OAuth-implicit-flow exposure, already well-mitigated; the residual is inherent to Supabase recovery-link handling. *(Improvement path, not now: `createClient({ auth: { flowType: 'pkce' }})` moves recovery to a code-exchange with no tokens in the URL — flag for a later client-auth pass if the client CSP hardening in §13 doesn't already reduce the XSS surface enough.)* | AU-INV-7 |

### Tier summary

- **FIX NOW (Step 3):** **AU-3 + AU-4** (`trust proxy` + drop the unverified-JWT
  rate-limit key — the whole rate-limit layer is currently advisory against a
  deliberate actor, and the fix is ~1 day) and **AU-8** (consolidate B+C onto A —
  removes the per-request upstream call on the most-polled routes and unblocks
  AU-1).
- **POSTURE (decision + pre-conditions, no code beyond the safe removals):**
  **AU-1** (cut cache TTL 60→15 s now; Supabase JWT-expiry + denylist are
  human-action / scale-gated) and **AU-6** (the "before you set `ADMIN_SECRET`"
  checklist; the `?admin_key=` query-param removal is a safe standalone Step-3
  item).
- **REVISIT IF SCALE:** AU-5, AU-2.
- **ACCEPT:** AU-7.

Nothing here is a live authz break. The one thing that is *currently* exploitable
by anyone reading the (public) source is the rate-limit bypass (AU-3/AU-4) —
which is why it is the FIX-NOW priority.

## 6.4 Checklist
- [x] Step 1 — auth/session/rate-limit current-state map — §6.1 — **RATIFIED D-12 (2026-09-03)**
- [x] Step 2 — invariants (§6.2 AU-INV-1..8) + risk-ranked gap list (§6.3 AU-1..AU-8) — **CANDIDATE, written 2026-09-03, awaiting sign-off → D-13**
- [ ] Step 3 — fixes + tests. Proposed scope: **AU-3 + AU-4** (`trust proxy` + rate-limit-key fix), **AU-8** (consolidate B/C onto A), **AU-6 partial** (delete server `?admin_key=` acceptance), **AU-1 partial** (cache A TTL 60→15 s). Human-action items surfaced separately: Supabase JWT expiry, `ADMIN_SECRET` provisioning checklist.

---

# System 7: `@racehorse/game-core` — the shared score oracle

Scope: the `packages/game-core` workspace — the domino engine (`applyMove`,
`getLegalMoves`, hand/game/set lifecycle), the Fritz AI policy
(`isOptimalOfficialFritzPlayForVersion`, `FRITZ_POLICY_VERSION`), every verifier
(`dailyFritzVerifier` re-play + Fritz-optimality, ghost `verifyPlayerMoveLog`,
puzzle-rush grading re-play), the deterministic deal generators, and the shared
DTO contracts (`dtoContracts` — re-exported by `server/src/{rooms,dailyPuzzle,dailyFritz}.ts`
and their client counterparts; `contractsDriftTypes.ts` is the compile-time drift
guard).

**In scope:** engine correctness + **determinism** (same inputs → same outputs,
client and server); version-pinning discipline — how a `GAME_RULES_VERSION` /
`FRITZ_POLICY_VERSION` / verifier bump is rolled out without retroactively
invalidating in-flight or historical attempts; the verifiers as the trusted score
oracle every mode relies on.
**Out of scope:** each mode's *use* of the engine (their own audits).

**Status:** **LIVE, load-bearing** — Ghost, Bot, Fritz Challenge, Daily Fritz,
Puzzle Rush, League and Matchmaking all trust its output. Highest leverage: one
audit benefits every mode built on top of it.

## 7.1 Current-state map
**Not started.** Step 1.

## 7.2 Invariants
**Not started.** Step 2.

## 7.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 7.4 Checklist
- [ ] Step 1 — engine + verifier + version-contract current-state map
- [ ] Step 2 — invariants + gap list → ratify (D-N)
- [ ] Step 3 — fixes + tests

---

# System 8: Ranking / Glicko-2 (cross-cutting integrity spine)

Scope: `server/src/ranking/**` — `glicko2.ts` (rating math), `periodService.ts` +
`cron.ts` (`startRankingCron` — rating-period processing), `insertRankedGameIdempotent.ts`
(the dedup pattern System 1 already reuses), `rankedGamePayload.ts`;
`http/routes/ranking.ts` (`/api/ranking/{profile,leaderboard,history,process}`);
the `commit_glicko` RPC (grant-locked in the 2026-09-01 sweep); `ranked_games`
(475 rows); client `ranking/` (Rating History) + `predictFritzGlickoUpdate.ts`.

**In scope:** the rating computation (correctness, determinism,
recomputability from `ranked_games` alone); the rating-period cron's
single-instance / restart behaviour; idempotency of `ranked_games` inserts (one
game → exactly one rating delta, ever); how every mode's game-over feeds it (via
`realtime/gameOverPersistence.ts`); the provisional-rating window.
**Out of scope:** each mode's decision of *whether* a game is ranked (their own
audits); the `commit_glicko` grant lockdown (done).

**Status:** **LIVE** — feeds every competitive mode's outcome; `ranking/` had 7
server commits in the last 60 days.

## 8.1 Current-state map
**Not started.** Step 1.

## 8.2 Invariants
**Not started.** Step 2.

## 8.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 8.4 Checklist
- [ ] Step 1 — rating math + cron + `ranked_games` idempotency current-state map
- [ ] Step 2 — invariants + gap list → ratify (D-N)
- [ ] Step 3 — fixes + tests

---

# System 9: Match runtime layer

Scope: `client/src/modules/**` (144 files, ~18.5k LOC — `bot-turn`, `player-turn`,
`replay`, `review`, `fritz`, `ghost`, `guided`, `match`, `daily` orchestration),
`client/src/match/**` (52 files, ~8.2k LOC — live-match UI, `preGameDraw`,
`recovery`, `session`, board rendering), `server/src/rooms.ts` +
`server/src/roomEvents.ts` + `server/src/realtime/gameOverPersistence.ts`; the
gameplay socket events (`game:action`, `game:start`, `game:rematch`,
`game:pregame_draw_pick`, `hand:ready`, `player:{ready,dragging}`).

**In scope:** the shared turn-execution / move-application / hand-transition /
game-over path that **every** match type runs through — client-side move
authoring, server-side `actUnlocked` / `withRoomGameplayLock`, the pre-game draw,
in-match recovery/hydration, `modules/` orchestration correctness.
**Already covered (do NOT re-audit):** System 1 (tournament game-over routing +
`roomKind`), System 2 (in-memory `Room` authority, seat binding, `game:action`
lock, disconnect grace, MP-1..MP-8 windows, MP-G4 game-over idempotency), System 3
(Daily Fritz command RPCs + verifier). **This system covers the remainder** — the
non-tournament / non-MP-specific runtime: bot-turn scheduling, the replay/review
engines, `modules/` orchestration, `rooms.ts` engine integration outside the
already-mapped MP windows. **Step 1 starts by drawing the covered-vs-remainder
line.**

**Status:** **LIVE, largest single code mass.** Partially de-risked by Systems
1–3.

## 9.1 Current-state map
**Not started.** Step 1 (start with the covered-vs-untouched map).

## 9.2 Invariants
**Not started.** Step 2.

## 9.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 9.4 Checklist
- [ ] Step 1 — covered-vs-remainder map, then current-state of the remainder
- [ ] Step 2 — invariants + gap list → ratify (D-N)
- [ ] Step 3 — fixes + tests

---

# System 10: Individual game modes not yet covered

Scope: **Ghost Mode** (`server/src/ghost/**`, `http/routes/ghost.ts` `/api/ghost/*`,
`ghost.sql`, `ghost_games` 406 rows — **LIVE**), **Play vs Fritz / bot**
(`server/src/bot/**`, `http/routes/botMatches.ts` `/bot-matches/local/*`,
`client/src/bot/**` — **LIVE**, flagship SP mode), **Fritz Challenge**
(`server/src/fritzChallenge.ts`, `http/routes/fritzChallenges.ts`,
`http/stores/fritzChallenge*`, `fritz_challenges.sql` — 17 challenges / 9
attempts, last 2026-08-04, **LOW USE**; RPCs already locked down in the sweep),
**Matchmaking / Quick Match** (`server/src/matchmaking/**` — the queue / pairing /
sim-bot-fallback logic, `queue:*` socket events — **LIVE**; `matchmaking_matches`
partly hardened by MP-G4/G5), **No Brainer / Practice Lab**
(`server/src/noBrainer/validator.ts`, `client/src/practice/**`, `/practice` route
— **SEMI-DEAD**, localStorage only, server untouched since 2026-02-26).

**In scope:** each mode's score authority + one-attempt/one-run semantics +
idempotent recovery + authz, same shape as Systems 1–3 — but **cheaper now**
because Systems 6–9 will have verified the auth / engine / ranking / runtime
underneath. Group or split into sub-audits (10a Ghost, 10b Bot, 10c Fritz
Challenge, 10d Matchmaking, 10e No Brainer) as makes sense in flight.
**Out of scope:** the shared spine (Systems 6–9).

**Status:** mixed — Ghost / Bot / Matchmaking LIVE, Fritz Challenge low-use, No
Brainer semi-dead. Each medium scope.

## 10.1 Current-state map
**Not started.** Step 1.

## 10.2 Invariants
**Not started.** Step 2.

## 10.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 10.4 Checklist
- [ ] Step 1 — per-mode current-state maps (decide sub-split here)
- [ ] Step 2 — invariants + gap lists → ratify (D-N, possibly one per sub-mode)
- [ ] Step 3 — fixes + tests

---

# System 11: Social / stats / account

Scope: `server/src/social/**` (11 files — feed, friends, presence, rivals, per-mode
+ global + weekly leaderboards, public profiles, `activityWriter.ts`),
`/api/social/*` + `/api/profile/*` routers, socket `presence:*` + `friend:invite`;
`server/src/stats/**` (`matchLog.ts`, `recordPublicMatch.ts`, `recordUserMatch.ts`,
`onlineWinStreak.ts`, `dedupeMatchRows.ts`), `http/routes/stats.ts`
(`/api/stats/record-match`, `/api/home/daily-summary`, `/api/mp-stats`);
`server/src/account/routes.ts` (`DELETE /api/account`); the shared
`realtime/gameOverPersistence.ts` game-over pipeline (Glicko + stats + activity +
matchmaking outcome); client `social/` + `friends/` + `stats/` + `screens/Settings*`.

**In scope:** activity-feed write idempotency + authz; the friends-request state
machine; presence correctness (stale `online`, `in_game` accuracy);
leaderboard-query integrity across `matches` / `ranked_games` / per-mode;
`matches` + the `data/matches.jsonl` match-log write idempotency (partly done —
MP-G4; the JSONL file is ephemeral on Render — §2.4.4); account-deletion cascade
completeness + what deliberately survives (`account/routes.ts` header); the
game-over pipeline's ordering / idempotency for its **non-MP** callers.
**Already covered:** MP-G4 (game-over side-effect idempotency for the MP path).

**Status:** **LIVE** — `activity_feed` 1041 rows (last 2026-09-02), `friends` 7
rows; `social/` had 6 server + 6 client commits in the last 60 days.

## 11.1 Current-state map
**Not started.** Step 1.

## 11.2 Invariants
**Not started.** Step 2.

## 11.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 11.4 Checklist
- [ ] Step 1 — social / stats / account / game-over-pipeline current-state map
- [ ] Step 2 — invariants + gap list → ratify (D-N)
- [ ] Step 3 — fixes + tests

---

# System 12: Progression & learning (client-only, low risk)

Scope: `client/src/journey/**` (64 files — Racehorse Journey campaign,
localStorage), `client/src/learn/**` + `client/src/learning/**` +
`client/src/training/**` (lessons, the how-to-play article, guided-match
recorder/annotator, the in-match coaching overlay — bundled content + localStorage
authoring), `client/src/analyzer/**` (GameReviewer post-game analysis —
localStorage).

**In scope:** a **light-touch pass only** — confirm there is genuinely no shared
server state and no competitive-integrity surface; spot-check the localStorage
schemas for corruption / migration hazards; note anything that unexpectedly
writes to Supabase or feeds a leaderboard.
**Out of scope:** deep correctness of the coaching / analysis logic (low-risk, not
integrity-bearing) — **do not over-invest relative to the actual risk.**

**Status:** **LIVE**, all client-only, no server routes, no shared state. Lowest
risk in the plan.

## 12.1 Current-state map
**Not started.** Step 1 (light).

## 12.2 Invariants
**Not started.** Likely a short list, or "none — client-only, no shared state".

## 12.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 12.4 Checklist
- [ ] Step 1 — light current-state pass (confirm no server state / no leaderboard feed)
- [ ] Step 2 — short invariant list + any gaps → ratify (D-N)
- [ ] Step 3 — fixes if any

---

# System 13: Remaining cross-cutting / infra

Scope: Supabase schema areas not yet RLS/grant-audited (`profiles`, `matches`,
`activity_feed`, `friends`, `ghost_profiles` / `ghost_games`, `verified_matches`,
plus whatever `league_*` survives System 5); admin/ops endpoints
(`/api/daily-fritz/{generate,invalidate,reset-attempt,metrics,health,events}`,
`/api/ranking/process`, `/league/run-*`, `/bot-matches/cleanup-stale` — each
`ADMIN_SECRET`-gated; `client/src/admin/`); telemetry / observability
(`operationalTelemetry.ts`, `sentryScrubbers.ts`, `client/src/debug/`, the
per-mode metrics tables); deploy / infra (Render free tier — spin-down + single
instance; Vercel client + prerender + `vercel.json` rewrites; `platform/health` +
`/ready` + `/ping`; `platform/gracefulShutdown.ts`).

**In scope:** run the anon + authenticated-role RLS probe (D-8 technique) against
every un-audited `public` table; confirm the admin-secret gate on every admin
endpoint + assess blast radius per endpoint; verify `assert_security_posture()`
coverage; make the Render / Vercel deploy posture explicit and system-wide
(currently only in System 1's T-17..T-19 accepted-risk notes).
**Out of scope:** each feature's own RLS (that feature's audit); the in-memory
rate limiter (System 6).

**Status:** partial — the `assert_security_posture()` weekly cron exists; several
core tables' RLS/grants are unverified.

## 13.1 Current-state map
**Not started.** Step 1.

## 13.2 Invariants
**Not started.** Step 2.

## 13.3 Gap list (risk-ranked)
**Not started.** Step 2.

## 13.4 Checklist
- [ ] Step 1 — RLS probe of every un-audited `public` table; admin-endpoint gate map; telemetry + deploy-posture map
- [ ] Step 2 — invariants + gap list → ratify (D-N)
- [ ] Step 3 — fixes + migrations (human applies)

---

# Appendix: Latent / dev-only — skip unless it becomes relevant

Not given a numbered system — the audit weight is not justified. Revisit only if
one becomes live or blocks a numbered system.

- **Spectator / Live Now** (`server/src/spectator/**` ~72 LOC, `client/src/live/**`,
  `LiveNowRoute`, socket `spectator:{join,leave,list}`) — feature-flagged **OFF**
  (`ENABLE_SPECTATOR_MODE` / `VITE_ENABLE_SPECTATOR_MODE` must be `'true'`; both
  default off). **Distinct from** `room:spectate` (the MP-G3 gap, System 2 — that
  one is always-on and was fixed). If spectator mode is ever enabled, it needs its
  own Step-1 audit first.
- **`client/src/devtools/**`** (10 files, ~3k LOC — calibration / fairness / tier
  / "feels rigged" audits, benchmarks) — dev-scratch, no shipped route, no commit
  since 2026-06-22. Delete or ignore.
- **E2E / debug routes** — `http/routes/e2eInspectRoute.ts` (`E2E_INSPECT=1`,
  hard-disabled in production), `http/routes/dailyFritzDebugDate.ts`,
  `server/src/testing/**`. Test-only, no prod surface. (`client/src/debug/` —
  global error handler / render profiler / web-vitals — is shipped infra, keep;
  it belongs to System 13's telemetry pass.)
- **Retired Daily Puzzle Ladder leftovers** — `server/src/dailyPuzzle*.ts`,
  `seedDailyPuzzleLadder.ts` / `checkDailyPuzzleLadder.ts` / `generatePuzzles.ts`,
  `client/src/dailyPuzzle/**`, `.github/workflows/gen-puzzles.yml`. Decommissioned
  (System 3, `56c0bb67`); tracked as DF-CAND-1b / DF-CAND-3 / DF-CAND-4. **`seedPuzzlePool.ts`**
  (backfills Puzzle Rush's `puzzle_pool` from `daily_puzzles`) is a real
  Puzzle-Rush dependency — do **not** delete it with the Ladder cleanup.

---

# Decisions log

| ID | Date | Decision | Reasoning |
|---|---|---|---|
| D-1 | 2026-08-31 | PRs #89, #90, #91 were opened **before** this plan existed. #91 in particular pre-implements fixes for gaps T-1, T-2, T-3, T-5, T-6. They are **not** merged. We will not merge #91 on its own judgement — its approach (a single `completeMatchIfNotCompleted` CAS, inline participant checks, a name-agnostic RLS migration) will be reviewed **against the ratified invariants and the §1.4 design** once those exist, then either adopted, adjusted, or superseded. Until then #91 stays open as a reference implementation, not a decision. | The plan's rule is audit → invariants → design → fix. #91 skipped to "fix". Rather than throw the work away or rubber-stamp it, it becomes an input to Step 3/4. |
| D-3 | 2026-08-31 | **T-INV-1..10 RATIFIED as written in §1.2.** Four open sign-off questions resolved: (a) **T-INV-3 conflict policy** — first-recorded outcome wins, later callers silently accept, log-only; *added requirement:* emit one structured `warn` log line (`tournament_match_winner_conflict`) whenever the `conflict=true` branch fires, so a genuine winner disagreement (which should be impossible if T-INV-2 + the state machine are correct) is visible/alertable in production without blocking on it. (b) **T-INV-4 score derivation** — the RPC computes the score pair itself for no-show/forfeit/bot cases rather than trusting the caller; removes the "client lied about the score" class of bugs. (c) **T-INV-7 one-live-match** — ship as a derived/asserted property, not a hard DB constraint; a structural constraint is more engineering than the risk justifies at current scale; escalate to a hard constraint only if `assertBracketConsistent` ever fires in practice (which would also mean Step 3's design missed something). (d) **Render instance count** — pending; treated as 1 by architecture until the human confirms. | The human reviewed the list line-by-line. Recording the *why* for each answer so a cold session does not re-open settled questions. |
| D-2 | 2026-08-31 | **Concurrency mechanism for match completion + bracket advancement = a Postgres transaction function (RPC).** Not `version`/CAS, not an in-process serialized funnel, not an app-side advisory lock. | The T-3/T-4 bug is fundamentally "8 non-atomic writes." One plpgsql function that locks the match row, validates the transition, and does completion + advancement + registration/tournament writes in a single transaction closes the race and the partial-write problem together, with no application-level locking to get wrong. It is **instance-count agnostic** — we have not ruled out running 2+ server instances, and an in-process funnel would silently break under that condition. This decision is what makes horizontal scaling safe later without redoing the work. Deployment is single-instance today (in-memory `rooms.ts` Map, no socket.io Redis adapter, existing "single-instance only" code comments); human to confirm the Render instance count but the architecture already requires 1. |
| D-2 addendum | 2026-08-31 | **Render confirmed = free tier ($0, 0.1 CPU, 512 MB). Free tier does not support scaling at all.** So the multi-instance question is not "currently 1" but **"structurally 1, not applicable until we move off free tier."** The RPC decision (instance-count agnostic) still stands and is still the right call — it means the eventual paid-tier / multi-worker move needs no rework of the concurrency model. But the in-process funnel alternative is now doubly ruled out. Separately: free-tier spin-down is a real liveness risk — see gaps T-17..T-19 and Decisions D-4. | Human read the Render dashboard. |
| D-7 | 2026-08-31 | **No-show reconciler / scheduler multi-instance = a boot-time singleton flag, not a lock.** Add `TOURNAMENT_SCHEDULER_ENABLED` (default `true`); `startTournamentScheduler` no-ops with a boot log line when false. When multi-instance ever happens, it's `true` on exactly one process (the dedicated worker, D-4 option e) and `false` on the web dynos. **`pg_try_advisory_lock` at the top of the tick was rejected** and the reason is preserved so it is not re-proposed: the server has no direct Postgres connection — every DB call is `supabaseFetch` → PostgREST over HTTP on a *different* pooled connection each time, so a session-scoped advisory lock releases the instant the first HTTP call's connection returns to the pool, before the tick's next call. Only `pg_try_advisory_xact_lock` works over PostgREST, and only inside one RPC. A lease/heartbeat table and an RPC-embedded xact lock were also rejected (machinery for a non-problem at 1 instance; unnecessary overlap with the §1.4.3 RPC work). | Schedulers are singletons even at large scale — you split them to a dedicated worker, not leader-elect them across N web instances. The RPC row locks (D-2) already make the completion path instance-agnostic; the scheduler only needs to know it's not the leader. Near-zero cost now (one `if` at startup), structurally moot on free tier. The reconciler's own logic is untouched. |
| D-6 | 2026-08-31 | **T-INV-6 reworded + re-ratified: "a round-N match enters `ready`/`in_progress` only after *both its feeder matches* (round N−1, match numbers 2M−1 and 2M) are `completed`/`bye`"** — not "the whole previous round". Client-impact check (§1.4.3): `tournament:round_completed` has no client listener; bracket view / "next match" / hub "waiting" / flow stepper / notifications / post-match nav are all per-match; the engine already dispatches human SF/Final on the two-feeder condition. **Also pulled forward from Step 4 (human's explicit direction):** replace `isPreviousRoundComplete` with `areFeederMatchesComplete(tournamentId, round, matchNumber)` in `canAutoSimulateBotOnlyMatch`; update the one engine test that asserted the strict rule. | The strict rule was an unexamined over-constraint. Only observable effect of relaxing: a fully-bot semifinal/final auto-simulates as soon as its two bot feeders finish instead of waiting for the human's half of the bracket — invisible to players (bracket-reveal spoiler logic hides non-human results beyond the player's current round). |
| D-5 | 2026-08-31 | **RPC surface = three functions, not one.** `complete_tournament_match` (owns T-INV-1,2,3,4,5,10), `promote_tournament_match(p_to_status)` (`waiting→ready` / `ready→in_progress`), `generate_tournament_bracket` (T-INV-8), plus three non-Node-facing helper functions (`_tournament_is_participant`, `_tournament_canonical_scores`, `_tournament_advance_target`). Rejected: a single `tournament_match_command(match_id, command, args jsonb)` dispatcher. | Three small auditable transactions with explicit per-function lock targets and typed signatures beat one `CASE`-on-action function with a fat `jsonb` arg and runtime shape checks. Bracket *generation* is a different concern from match *state* and gets a different deployable object. Shared logic goes in the helper functions. |
| D-8 | 2026-09-01 | **System 2 Step 1 RLS follow-up — authenticated-role SELECT question RESOLVED (not just queried).** Method: minted a real `authenticated`-role JWT via the service-key Auth admin API (create confirmed throwaway user → `grant_type=password` → JWT role/aud verified `authenticated` → user deleted; net-zero prod state). Probed both room tables as a non-participant authed user incl. a targeted `room_code=eq.<live room>` filter → **`content-range */0` every time**. Combined with the canonical DDL in `supabase/room_live_sessions.sql` / `supabase/room_match_logs.sql`: **`room_live_sessions` = deny-all-to-client** (`FOR ALL TO authenticated USING(false)`, no SELECT policy) ⇒ a participant **cannot** read their own live row ⇒ the unmasked `game_state` (opponent's hand) is **never** reachable by any client — `maskStateForRecipient` is not bypassable this way. **No competitive-integrity hole.** `room_match_logs` = `room_match_logs_select_own` (`FOR SELECT USING (auth.uid() = ANY(participant_user_ids))`) ⇒ a participant **can** read their own *terminal* archive rows — this is post-game data, per-match-private, and by design; Step 2 decides whether to keep it or route reads through the server. **CONFIRMED (2026-09-01):** the human ran `select policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('room_live_sessions','room_match_logs')` → exactly 3 rows, exact match to the DDL (`room_live_sessions_no_client_write` ALL/{authenticated}/false; `room_match_logs_select_own` SELECT/{public}/`auth.uid() = ANY (participant_user_ids)`; `room_match_logs_no_client_write` ALL/{public}/false). No `qual true`. `room_live_sessions` has no SELECT policy at all. **Authenticated-role SELECT question CLOSED — Step 2 unblocked.** | The concern was that an authed participant reading their own live row would leak the opponent's tiles mid-game. The deny-all policy on `room_live_sessions` closes it structurally. Recording the JWT-minting method so it is reusable for future authenticated-role RLS probes (same principle as the anon row-count check). |
| D-9 | 2026-09-01 | **System 2 Step 2 RATIFIED — §2.2 (MP-INV-1..19) + §2.3 (MP-G1..MP-G17, including the §2.3.2 verification-pass updates) as written.** The human reviewed the invariant list and the tiered gap list line-by-line and signed off. What is ratified: **19 invariants** across 8 domains (seat/identity 1–3, room-kind ACL 4–6, state authority & ordering 7–9, persistence/recovery 10–13, game-over integrity 14–17, disconnect/grace 18, anti-cheat posture 19), each with rule / enforcing-mechanism-today-or-`UNENFORCED` / failure-mode and grounded in an MP-1..MP-8 window or a §2.1.7 authz row; **17 gaps** tiered A (fix now: **MP-G1** unmanaged room-table schema, **MP-G3** `room:spectate` no room-kind check on a ranked-eligible private room, **MP-G4** game-over side-effect idempotency) / B (verify: MP-G6 `room_command_receipts`+`mp_authority_events` unapplied, MP-G2 grant revoke) / C (revisit if scale: MP-G5, MP-G7–MP-G13) / D (posture: MP-G14) / E (accept: MP-G15–MP-G17). **Residual notes recorded with the sign-off:** (a) **MP-INV-2** carries a known unclosed gap — two *guest* seats (`userId=null`) are distinguishable on reconnect only by username/hold, so a second guest with the room code + the first's display name can reclaim the seat; scoped to private-unranked play, tracked as **MP-G13 (Tier C)**, not blocking. (b) **MP-INV-19 is a posture decision, not a hard invariant** — move-log verification stays non-blocking for the match result; the ratified direction is to *add* a structured alert + per-user failure tracking in a later step (**MP-G14**), not to gate results on verification. (c) **MP-INV-12** holds (RLS confirmed, D-8) but the client write-grant revoke (**MP-G2**) and the unmanaged-schema fix (**MP-G1**) are still open — folded into one Step 3 migration. (d) **MP-G5** and **MP-G9** verdicts were changed by the §2.3.2 verification pass (G5 A→C on zero evidence + no measurement path; G9 ACCEPT→REVISIT on deploy-restart frequency) and are ratified as changed. **Step 3 scope (agreed):** Tier-A only — MP-G1, MP-G3, MP-G4 (MP-G2 folded into MP-G1). | The human reviewed the list line-by-line, same as D-3 for System 1. Recording the residual notes so a cold session does not treat MP-INV-2 / MP-INV-19 as fully closed, and does not re-litigate the G5/G9 downgrades. The Step-3 scope is deliberately narrow — the other tiers wait for their own pass. |
| D-10 | 2026-09-02 | **System 3 Step 2 RATIFIED — §3.2 (DM-INV-1..18) + §3.3 (DF-G1..DF-G5) as written.** The human signed off "as written — no changes". What is ratified: **18 invariants** across 6 domains (score authority 1–5, one-attempt/run-per-day 6–7, idempotent recovery & ordering 8–13, content integrity 14–16, authz 17–18), each rule / mechanism-today-or-`UNENFORCED`/`PARTIAL` / failure, grounded in a DM-1..DM-7 window or a §3.1.5 authz row; **5 gaps** — **DF-G1 + DF-G2 FIX NOW**, DF-G3/DF-G4 REVISIT IF SCALE, DF-G5 ACCEPT. Scope = the 2 active modes (Daily Fritz, Puzzle Rush); the retired Ladder is out (decommissioned, §3.1.4). **Two `verified-against-code` corrections already folded into §3.2/§3.3:** the Daily Fritz speed board **is** verification-gated (`isDailyFritzAttemptLeaderboardEligible`), and `daily_fritz_outbox` is projected by a **DB trigger**, not a Node drainer. **Residual notes recorded with the sign-off (Step-3 code trace, 2026-09-03):** (a) **DF-G1's mechanism was wrong** — `scheduleDailyFritzRecordGameVerification` has zero production callers (dead code from the reverted `b0a0a93c` advance-first design, caller removed in `d027d30d`); the record/next-hand routes verify synchronously and refuse-to-advance on transient failure. The real gap is a **stranded `status='started'` attempt with a complete set** (client crash / restart mid-`/complete`, no reaper). DF-G1's fix is a stranded-set boot sweep + periodic reaper (mirror `recoverTournamentMatches`), NOT re-running the dead async path, and it must never un-`reject` a hand (DM-INV-11). (b) **DF-G2's alert already exists** (`recordDailyFritzAdvanceWithoutVerification` → `Sentry.captureMessage(..., daily_fritz_alert:'verification_bypassed')`); the real residuals are per-user aggregation on that alert + `getDailyFritzStreak` not being verification-filtered. (c) **DF-G2 streak filter must keep `legacy_unverified` (pre-protocol) completions counting** — applying the full leaderboard predicate would retroactively zero real streaks; the filter only drops `rejected` / non-empty-`unverified_hands`. (d) **The POSTURE decision** (same as D-9 MP-INV-19): Daily Fritz verification stays non-blocking for `status='completed'` — a failed hand is `rejected` (off the board) but never blocks the player finishing. **Step 3 scope (agreed):** DF-G1 + DF-G2 only. | Human reviewed the list line-by-line, same as D-3 / D-9. Recording the Step-3 corrections so a cold session does not build a reaper around dead code or a duplicate alert, and does not apply the streak filter in a way that breaks legacy streaks. |
| D-4 | 2026-08-31 | **RESOLVED — external uptime monitor on `/ping` every 5 min; stay on Render free tier for now.** No existing pinger was found or recoverable, so the human is setting up a **new** one (UptimeRobot or similar) → `https://racehorse.onrender.com/ping` at 5-min intervals. No code change: verified the scheduler's `setInterval` runs independently once the process is alive, so keeping the process warm is the whole fix. **`/internal/tick` stays unbuilt and unneeded** unless a future D-4 revision moves the scheduler off the web process (options b/c/e below, not chosen). The human is also setting `SERVER_URL=https://racehorse.onrender.com` in Render (confirmed currently unset via `GET /ready`) so the dormant internal 10-min self-ping activates as a redundant second signal. Rejected for now: (b) Render Cron Job / GH Actions cron, (c) `/internal/tick` + cron, (d) paid always-on plan, (e) split worker dyno — all revisited at upgrade time. **Outcome (2026-08-31):** an UptimeRobot monitor already existed but was mis-typed as ICMP Ping (Render doesn't answer ICMP → 6.5 % uptime, useless). Re-typed to HTTP(s) → `/ping` @ 5 min; human verified 100 % uptime / no gaps over the observation window → **T-17 CLOSED**. `SERVER_URL` set + redeployed; human confirmed `GET /ready` → `SERVER_URL: true`, self-ping now active as a second signal. | Cheapest option that fully addresses the "process is asleep" problem at current scale. The residual risk (a crash/deploy/OOM leaves the process down until the next ≤5-min monitor hit) is accepted. |
| D-12 | 2026-09-03 | **System 6 §6.1 (Auth / session + rate limiting — current-state map) RATIFIED as written.** The human reviewed §6.1's 11 subsections and signed off "as written — no changes". What is ratified as an accurate map of what exists: **three divergent server auth impls** (`supabaseAuth.ts` A — cached 60 s + in-flight dedup + 12 s timeout + non-prod e2e bypass; `social/socialAuth.ts` B — uncached; `scheduledTournament/tournamentAuth.ts` C — uncached + uuid + payload-userId-match), all hitting `GET /auth/v1/user`; cache A's **1000-entry ceiling + ≤60 s revocation lag**; a client `signOut()` revokes only the refresh token (the access-token JWT lives to its `exp`); the **signature-unverified `getUserIdFromAuthHeaderSync`** used only for rate-limit keys; **`ADMIN_SECRET` unset in prod** (`/ready`-confirmed) → all admin endpoints fail-closed today; `InMemoryRateLimiter` with **no eviction ceiling** + **no `app.set('trust proxy')`**; socket auth per-action not per-connection; `e2eDevAuth` dead in prod (client `import.meta.env.DEV` + server `NODE_ENV !== 'production'`, both closed); CORS reflects any `*.vercel.app` with `credentials:true`; `/ready` discloses env-presence + load telemetry + release SHA. The **8 windows AU-1..AU-8** in §6.1.10 are the agreed candidate set for Step 2 ranking. Step 2 (§6.2 invariants + §6.3 gap list) proceeds. | Human reviewed §6.1 line-by-line, same as D-3 / D-9 / D-10 for the prior systems' Step-1/Step-2 sign-offs. Recording so a cold session treats §6.1 as the settled baseline and does not re-investigate. |
| D-11 | 2026-09-03 | **The "Everything else" catch-all (old System 4) is dissolved into leverage-ordered Systems 5–13**, based on the 2026-09-02/03 codebase inventory pass. Order: **5** Legacy League decommission (kill dead weight first) → **6** Auth/session + rate limiting → **7** `@racehorse/game-core` → **8** Ranking/Glicko → **9** Match runtime layer (the shared spine — de-risk before the modes on top of it) → **10** individual game modes (Ghost, Bot, Fritz Challenge, Matchmaking, No Brainer) → **11** Social/stats/account → **12** Progression & learning (client-only, light-touch) → **13** remaining cross-cutting/infra. Latent/dev-only surfaces (spectator flag-off mode, `devtools/`, e2e-inspect routes, retired Ladder files) go in an Appendix, not a numbered system. There is no System 4. | Leverage-first: a bug in the shared auth / engine / ranking / runtime layer costs once to fix and benefits every mode; a bug in one feature costs once and benefits one. Killing the dead League surface first removes ~2.5k LOC + a socket-handler set + 6 tables from every later system's blast-radius reasoning. The client-only progression/learning surfaces have no shared state and are explicitly de-prioritised so they don't absorb audit effort disproportionate to their risk. |

---

# Changelog

| Date | Change |
|---|---|
| 2026-08-31 | Document created. System 1 (Tournament) Step 1 current-state audit written. Steps 2+ open. Systems 2–4 stubbed. |
| 2026-08-31 | Added the "one step per session" rule to "How to use this document". Locked concurrency mechanism = Postgres RPC (D-2). Rewrote §1.2 as T-INV-1..10, framed as RPC/DB obligations, pending human sign-off. §1.4 now carries the locked decision only (state machine still TODO). |
| 2026-08-31 | Step 2 RATIFIED (D-3, four sign-off answers logged). T-INV-3 gains a structured-log requirement on the `conflict=true` branch. PR #91 merged early — added the ⚠ note to Current focus and §1.4.1 (assessed: `completeMatchIfNotCompleted` is superseded not conflicting; participant check duplicated; forfeit/room-join checks are authz not concurrency; RLS migration correct and independent). Step 3 started: §1.4.2 = match state machine — states, transitions, per-actor triggers, RPC rejection rules, and the near-simultaneous-caller lock walkthrough. Remaining Step 3 sub-tasks (one-vs-three RPCs, authz layer, reconciler multi-instance) not started. |
| 2026-08-31 | Infra check before continuing Step 3. Render confirmed free tier (0.1 CPU / 512 MB, spins down at 15 min idle) → D-2 addendum (structurally single-instance) + new **D-4** (open infra decision for the scheduler/reconciler liveness). Added §1.3 "infrastructure / liveness" tier: **T-17** (spin-down stalls scheduler + no-show reconciler; self-ping is conditional on `SERVER_URL` and can't revive a dead process), **T-18** (0.1 CPU / 512 MB marginal — timer drift, OOM, cold Supabase pool amplifies the stuck-bracket give-up), **T-19** (late/zero-width registration windows on wake). Evidence cited (commit `b49872ce` "post-wake API hangs", the boot catch-up tick comment, the ops-repair doc). §1.4.8 records that the RPC and the infra fix are orthogonal and both required. Step 3 continuation still paused. |
| 2026-08-31 | T-17 follow-up (before building any cron): **(a)** verified from code that `startTournamentScheduler`'s `setInterval` fires independently at 30 s once the process is alive (`bootstrapScheduledTournamentInfrastructure` runs inside `server.listen`) — so a plain uptime ping to `/ping` fully restores catch-up; `/internal/tick` is **not needed** unless D-4 moves the scheduler off the web process. **(b)** searched the repo for an existing external pinger — **no committed config**, `smoke-test.yml` is push-triggered not cron, and health routes don't log requests, so **cannot verify from the repo**. Two "T-17 follow-up" notes added to §1.3 listing exactly what the human must check (Render metrics, UptimeRobot/cron-job.org accounts, max-gap < 13 min, point it at `/ping` not `/healthz`). T-17 stays OPEN pending that check. No `/internal/tick` endpoint added. Step 3 continuation still paused. |
| 2026-08-31 | Human confirmed: no existing pinger; setting up a new external uptime monitor on `/ping` @ 5 min (option a). **D-4 RESOLVED** — external monitor, stay on free tier, `/internal/tick` unbuilt. Checked prod `GET /ready`: **`SERVER_URL` is NOT set** in Render (self-ping has been inert all along) — human is setting it as a second signal. `/ready` also shows `ADMIN_SECRET`, `CLIENT_URL`, `DAILY_PUZZLE_CRON_SECRET` unset — noted for a later env-hygiene pass, out of scope here. **T-17 → MITIGATED** (human owes first-hour steady-state verification before CLOSED). **T-18 + T-19 → ACCEPTED RISK** at current scale, revisit at upgrade. Step 3 continuation still paused. |
| 2026-08-31 | **T-17 → CLOSED.** Actual root cause identified: an UptimeRobot monitor **did** exist but was set to **ICMP Ping type**, which Render never answers → it showed "No Response" / ~6.5 % uptime and kept the instance warm zero percent of the time. (So the earlier "no pinger found" was half-right — the repo had no config *and* the external monitor was non-functional.) Fixed to **HTTP(s) type → `/ping` @ 5 min**; human verified **100 % uptime, no gaps, over the observation window**. Human also set `SERVER_URL=https://racehorse.onrender.com` in Render + redeployed and confirmed `GET /ready` → `recommendedEnv.SERVER_URL: true` (fresh deploy `67fb5dac…`, `uptimeSeconds` reset). **Both mitigations verified.** |
| 2026-08-31 | T-17 confirmations landed: `SERVER_URL: true` in `GET /ready` post-redeploy; doc caveats about "pending / cache lag" removed. Root cause stands as recorded — a **misconfigured monitor type (ICMP vs HTTP)**, not a missing pinger. No further action on T-17. |
| 2026-08-31 | **T-INV-6 reword — client-side impact check done** (§1.4.3). `tournament:round_completed` has **no client listener** (dead event). Bracket view, "next match" logic, hub-state "waiting", flow stepper, notifications, post-match nav — all **per-match**, none assume whole-round completion. The engine **already** dispatches human SF/Final on the two-feeder condition (`applyMatchResult` advancement tail); `isPreviousRoundComplete` only gates **bot-only** auto-sim, which the bracket-reveal spoiler logic hides from players anyway. **Reword is safe to ratify** — pending human OK. Authz-layer sub-task still NOT started. |
| 2026-08-31 | **T-INV-6 RE-RATIFIED (D-6)** to feeder-gating. Doc: merged PR #93; code (`isPreviousRoundComplete` → `areFeederMatchesComplete`): merged PR #94. §1.2 text updated; state-machine T-d guard updated. `isPreviousRoundComplete` → `areFeederMatchesComplete(tournamentId, round, matchNumber)` in `canAutoSimulateBotOnlyMatch` — **pulled forward from Step 4** at the human's explicit direction, its own PR, one engine test updated. **Step 3 sub-task: authz layer shape** (§1.4.5) — `authorizeMatchParticipant(userId, {matchId}|{roomCode}, opts)` returning `{ok, match} | {ok:false, code}` + `matchAuthzAck` / `matchAuthzHttpStatus` mappers, added to `tournamentAuth.ts`; signature + one call site (`tournament:attach_assigned_match`) shown. Replaces the duplicated inline gates in attach / `roomForfeit` / `roomSocketAttach`. Last Step 3 sub-task (reconciler multi-instance, moot on free tier) not started — stopping for human review. |
| 2026-08-31 | **Step 3 COMPLETE.** Reconciler multi-instance stance decided — **D-7**: singleton via a boot-time `TOURNAMENT_SCHEDULER_ENABLED` flag (default true), not a lock. `pg_try_advisory_lock` rejected + reason preserved (the server has no direct Postgres connection — PostgREST checks out a different pooled connection per call, so a session advisory lock releases before the tick's next call). Lease table and RPC-embedded xact lock also rejected. §1.4.6 written, T-16 + §1.4.3b→§1.4.6 updated, Step 3 checklist all `[x]`, Current focus flipped to "Steps 1–3 complete, Step 4 opens". **Step 4 begins next: review merged PR #91 against the ratified invariants + the RPC design — not started this session.** |
| 2026-08-31 | **Step 4 first sub-task DONE — merged PR #91 reviewed line-by-line** (§1.5.1). Every one of its 10 changes classified: **KEEP** (`MatchPatch` extract #1, `isTournamentRoomCode` #6, RLS migration #9), **SUPERSEDED** by the RPC/authz work (#2 `completeMatchIfNotCompleted`, #3 interface entry, #4 JS participant check, #5 CAS no-op, #7 forfeit check → authz, #8 room:join ACL → authz, #10 test mocks). **Zero conflicts** — nothing in #91 needs a fix before Step 4 code starts. Flagged: #5's already-completed no-op is silent + winner-agnostic (short of T-INV-3 conflict-explicit + D-3 log — the RPC closes it); #9's RLS migration is merged but there is **no CI migration runner**, so it may not be applied to prod (human to verify). Work list → §1.5.2 (PR-A RPCs, PR-B authz, PR-C flag). **Awaiting human sign-off on §1.5.2 sequencing before any code.** |
| 2026-08-31 | Gap **T-1 CLOSED** — human ran the RLS diagnostic against production: 0 client-writable policies, 0 client INSERT/UPDATE/DELETE grants to anon/authenticated, `relrowsecurity = true`. `2026-08-30_tournament_registration_rls_lockdown.sql` (merged in PR #91) is live. Registration `seed`/`status`/`placement` are now service-role-write-only. §1.3 T-1 row + §1.5.2 + Step 4 checklist updated. |
| 2026-08-31 | **Step 4 / PR-A — three match RPCs MERGED (PR #97).** `complete_tournament_match` / `promote_tournament_match` / `generate_tournament_bracket` + helpers (`_tournament_is_bot`, `_tournament_advance_target`, `_tournament_canonical_scores`); `security definer`, `service_role`-only. `applyMatchResult` shrunk from an 8-write orchestrator to a thin RPC caller; `finalizeCompletedTournament` renamed. #91's `completeMatchIfNotCompleted` CAS + JS participant check + CAS no-op deleted. `advance_target_missing` softened to a flagged soft-return (a raise would kill the reconciler tick). `inMemoryMatchRpc.testkit.ts` = faithful JS port for the unit suite (header points at the migration as source of truth). Verified on a real local pg16 (two-session `FOR UPDATE` race) + full server suite 1121 tests. Closes **T-2, T-3, T-4, T-7, T-8, T-9**. CI failure on the SQL-only push was a split-commit artifact (test files uncommitted), fixed by pushing the testkit commit — not a migration bug. |
| 2026-09-01 | **Step 4 / PR-B — participant authz layer MERGED (PR #98).** `authorizeMatchParticipant(userId, {matchId}\|{roomCode}, {allowCompleted?})` + `matchAuthzAck` / `matchAuthzHttpStatus` in `tournamentAuth.ts` (§1.4.5). Fresh match read every call; a fetch *throw* propagates (caller picks retry vs give-up — it is **not** swallowed as `match_not_found`). Consolidated three drifted inline gates: attach handler, `roomForfeit` (PR-91 #7), `roomSocketAttach` `room:join` ACL (PR-91 #8) — #91's fail-closed semantics preserved exactly (regex-shaped code with no bracket row → treated as ordinary private room, an intentional tradeoff). `isTournamentRoomCode` + `makeTournamentRoomCode` extracted to a dependency-free leaf `tournamentRoomCode.ts` (breaks the persistence-graph pull into the authz layer); `matchDispatch` re-exports. `tsc` clean, 1121 tests pass, `grep console.` clean across all 7 files. Closes **T-5, T-6**. Next: **PR-C** (`TOURNAMENT_SCHEDULER_ENABLED` flag) + T-11/T-12 cleanup, then Step 5. |
| 2026-09-01 | **Step 4 / PR-C — `TOURNAMENT_SCHEDULER_ENABLED` singleton gate MERGED (PR #99).** D-7 / §1.4.6. `config.tournamentSchedulerEnabled = getEnvBool('TOURNAMENT_SCHEDULER_ENABLED', true)`; `startTournamentScheduler` early-returns with a boot log line when false — gating the whole tick (registration open/close, scheduled-start dispatch, expired-tournament cancel), the no-show reconciler, and the seed fallback. `.env.example` documents it. Tests: config flag parsing (`false`/`0` disable) + scheduler does not tick/fetch/reconcile/seed when disabled. `tsc` clean, 1123 tests pass, `grep console.` clean. Closes gap **T-16**. **T-11 and T-12 deliberately NOT folded in** — the plan listed them "while doing PR-A/PR-B", that window passed; they are now standalone open tasks. Step 4 remaining: **T-11 / T-12 cleanup**, then **Step 5** (tests prove closure). |
| 2026-09-01 | **Step 4 / T-11 — DOWNGRADED + hardened (PR #101).** Analysis: PR-A/PR-B already neutralized the integrity concern — "masks T-6" is obsolete (T-6 closed at source by PR-B); intra-tournament "two active matches" is closed by PR-A's atomic completion RPC; the only residual is cross-tournament active-window overlap, whose newest-scheduled tie-breaker is a deliberate tested heuristic (`persistence.test.ts`). Shipped hardening: `humanJoinedAt(match, userId)` promoted to the top sort key ahead of `scheduled_start`; `filtered.length > 1` now `log.warn`s (message references T-11 / T-15) instead of silent. §1.3 T-11 row rewritten with the full why. `tsc` clean, 1124 server tests pass, `grep console.` clean. **Separately:** the long-standing uncommitted working-tree pile (share-card / rush-dossier redesign) was committed to `feat/share-card-dossier-redesign` → draft PR #100 so `main` is clean; `.superpowers/` + the local growth-assessment PDF added to `.gitignore`. **PR #100 was then closed + branch deleted** (2026-09-01) — 16 files, mixed scope, no design review, CI red; not pursued. Step 4 remaining: **T-12**, then **Step 5**. |
| 2026-09-01 | **Step 4 / PR-D — one room-kind classifier, T-12 CLOSED (PR #102).** `server/src/multiplayer/roomKind.ts` — `roomKind(room) → private \| matchmaking \| scheduled_tournament \| legacy_league` + `isScheduledTournamentRoom` / `isLegacyLeagueRoom` / `isAnyTournamentRoom`. Replaced 4 disagreeing ad-hoc predicates. `roomSession`'s `isTournamentRoom` (= `cfg.tournamentId`) → `isLegacyLeagueRoom(room)`, value-identical, with a **loud comment** on the game-over branch forbidding the widening to `isAnyTournamentRoom` (that branch is the sole path a played-to-completion scheduled-tournament result takes to the bracket). `shouldFinalizeTour` → `isLegacyLeagueRoom`. `resolveMpAuthoritySourceType` / `inferLiveSessionSourceType` reimplemented on `roomKind`. **Verified behavior change (own PR bullet):** `game:rematch` was blocked only for legacy-league rooms; traced that a crafted rematch on a scheduled-tournament room in the post-game-over cleanup window started a fresh game floating free of the (idempotency-protected) bracket — now blocked via `isAnyTournamentRoom`. Tests: `roomKind.test.ts` (precedence + helpers), `roomSession.gameOverRouting.test.ts` (scheduled→onGameOver / legacy→finalizer / private→onGameOver). `tsc` clean, 198 files / 1130 server tests, no new console/lint. **Step 4 COMPLETE.** Only **Step 5** (tests prove closure) remains for the tournament system. |
| 2026-09-01 | **Step 5 scoped + PR-E merged (PR #103).** Findings from a read-only pass: (1) "producers 1-3" splits into a CI in-memory-port test (proves Node orchestration handles a redundant producer — not DB serialization) and a local pg16 two-session `FOR UPDATE` test (the real serialization proof; PR-A's was thrown away). (2) The original "kill `applyMatchResult` mid-sequence" crash test is obsolete — PR-A made completion+elimination+advancement one transaction; reframed to "RPC committed, Node post-processing didn't" → recovery re-dispatches. (3) `assertBracketConsistent` did not exist — written from scratch. (4) T-1 is prod-verified + the migration self-asserts, but there is no regression / greenfield check. Split into **PR-E** (helper, CI), **PR-F** (concurrency + recovery harness, CI), **PR-G** (local pg16 script + committed RLS diagnostic `.sql`, not CI). Additions from review: helper also asserts no spurious `tournament_match_winner_conflict` log (D-3); PR-F's cold-wake catch-up runs ≥2 processing orders; PR-G stays in scope this pass. **PR-E (`assertBracketConsistent.testkit.ts`) merged** — T-INV-1/2/5/6/7/8/10 consequences + the D-3 log check, 12 unit tests, wired into `engine.test.ts`. `tsc` clean, 199 files / 1142 tests. §1.6 rewritten with the E/F/G plan. |
| 2026-09-01 | **Step 5 / PR-F merged (PR #104).** `concurrencyRecoveryHarness.test.ts` — 6 tests: redundant producers 1–3 on one match (same-winner ⇒ one completion / one advancement / 0 `tournament_match_winner_conflict` logs; conflicting-winner ⇒ first-recorded wins + one D-3 warn per disagreement with correct recorded/attempted ids), "RPC committed but Node crashed before dispatch" ⇒ `recoverTournamentMatches` dispatches the orphaned `ready` target, reconciler tick logs `tournament_advance_target_missing` and continues to the next match, cold-wake catch-up identical end-state across forward / reversed / shuffled orders (§1.4.8 addition #3). `vi.mock('../logger')` captures real output so the D-3 assertions are genuine (the `engine.test.ts` wiring from PR-E was a placeholder). **Scope boundary stated in the file header and PR body: proves Node orchestration, not Postgres `FOR UPDATE` — that is PR-G.** `tsc` clean, 200 files / 1148 tests, `grep console.` clean. Only **PR-G** remains before the tournament system is "closed". |
| 2026-09-01 | **Step 5 / PR-G merged (PR #106) — SYSTEM 1 (TOURNAMENT) CLOSED.** `scripts/tournament-db-verify.sh` + `scripts/tournament-db-verify/{shim,seed}.sql` — a hermetic local pg16 verification (own `initdb` in a temp dir, deleted on exit; aborts if `PGHOST`/`DATABASE_URL`/`SUPABASE_*_URL`/any arg points at a remote or Supabase target — proven). Four stages: greenfield apply of the curated 10-file tournament migration chain (the 2026-08-30 lockdown self-asserts); two-session `SELECT … FOR UPDATE` — session B blocks on A's row lock >= 1s then takes `applied:false`/`conflict:true`, bracket shows one completion + one advancement (**the Postgres-level proof PR-F structurally can't give — guards T-3/T-4**; the PR-A verification was thrown away); the three RLS registrations diagnostics clean on the fresh schema; `assert_security_posture()` 0 -> plant `disable row level security` -> 1 (names the table) -> re-enable -> 0. Plus `supabase/tests/rls_registrations_lockdown.sql` (paste-into-SQL-editor artifact) and `docs/ops/tournament-db-verify.md`. Not CI (no pg service / no migration runner — which is why it exists). Green locally 3x, no flake; the `FOR UPDATE` timing margin is sleep-based (flake = timing issue first, not a lock regression). **Steps 1–5 complete. The tournament hardening is done.** Next: System 2 (Multiplayer rooms) Step 1 audit — its own session, awaiting human sign-off. |
| 2026-09-01 | **System 2 (Multiplayer rooms) Step 1 — current-state audit §2.1 WRITTEN.** Structure agreed with the human first (10 subsections, reshaped around the in-memory-vs-DB-authority difference rather than following the System 1 template). §2.1.1 states the single-instance deployment as a **verified fact** (Render free tier, no adapter in `index.ts`, all room state process-local Maps, D-2 addendum) with a D-7-style revisit trigger — the whole concurrency analysis is scoped to in-process interleaving. §2.1.2–2.1.10: `Room` object + 4 backing tables (`room_live_sessions` + `room_match_logs` are **unmanaged schema, no migration** — flagged as the 3rd instance of System 1's "unmanaged schema / no posture check" pattern, RLS unverified → **Step 1 follow-up: human checks live-DB RLS before Step 2**); state writes; seat/`playerSeatId`↔`userId` binding via `resolveActorSeatId` + attach flow; concurrency windows MP-1..MP-8; the non-atomic 4-attempt game-over/forfeit side-effect chain; authz map (surfaced: `room:spectate` has no room-kind check; helper idempotency unverified); recovery (no boot sweep — lazy hydration only); move-log verification is hand-continuity-only + non-blocking. Gap candidates parked unranked in §2.3. §2.2–2.6 stubbed. Current focus + §2.7 checklist updated. **Stop — await human sign-off + the RLS follow-up before Step 2.** |
| 2026-09-01 | **System 2 Step 1 follow-up — `room_live_sessions` / `room_match_logs` RLS verified live; grep of committed §2.1 confirmed clean.** `git show HEAD:HARDENING_PLAN.md | grep` for `authorizeMatchParticipant` / `assertUnmaskedGameStateForPersistence` / `commitLifecycleAfterMutate` — all intact, no garbling in the committed file. **RLS probe (anon key, prod `fisfadjqllojdzibcdfx`, read-only):** `assert_security_posture()` → `hard_fail_count:0` (RLS enabled on every `public` table incl. both room tables); anon `SELECT room_live_sessions` / `room_match_logs` → HTTP 200 `content-range: */0` while service-role counts show **2458** / **1236** rows. **No anonymous read exposure — the "transcripts readable with the anon key" fear does not materialise.** Residuals recorded in §2.1.2 / §2.1.7 / §2.3: (a) authenticated-role `SELECT` policy text not readable via PostgREST — human to check in SQL editor whether a participant can read their own *live* row (unmasked `game_state` = opponent hand); (b) both tables carry the `client_write_grant_rls_on` advisory (anon+authenticated INSERT/UPDATE/DELETE grants, RLS-gated only — same advisory on 44 tables incl. `profiles`/`ranked_games`, not a hard fail; defence-in-depth revoke); (c) schema still unmanaged — no migration. **Side finding:** `room_command_receipts` → PostgREST `PGRST205` (not in schema cache) — migration may be unapplied to prod / table not REST-exposed; receipt store degrades to shell-embedded-only. Anon/authenticated **write** probes to prod were not run (auto-mode classifier blocked the mutating request — correct; needs human approval). §2.7 Step 1 follow-up checkbox flipped to done for the anon question, residual item added for the human. |
| 2026-09-01 | **System 2 Step 1 follow-up — authenticated-role SELECT RESOLVED (D-8).** Minted a genuine `authenticated`-role JWT (service-key admin API: create confirmed throwaway user → `grant_type=password` → JWT verified role/aud `authenticated` → user deleted; net-zero prod state). Non-participant authed probe: `room_live_sessions` full select **and** `?room_code=eq.<live room>` → `content-range */0`; `room_match_logs` → `*/0`. **No broad `TO authenticated USING(true)` policy on either table.** Found the canonical DDL — `supabase/room_live_sessions.sql` (only policy `room_live_sessions_no_client_write` = `FOR ALL TO authenticated USING(false)` — no SELECT policy ⇒ **participant cannot read own live row ⇒ unmasked `game_state`/opponent hand is unreachable by any client — no competitive-integrity hole**) and `supabase/room_match_logs.sql` (`room_match_logs_select_own` = `FOR SELECT USING (auth.uid() = ANY(participant_user_ids))` ⇒ participant **can** read own *terminal* archive rows — post-game, deliberate; Step 2 decides keep-vs-proxy). §2.1 "unmanaged schema / NONE" corrected: the DDL exists in `supabase/`, just not in `migrations/`. Residual: one `pg_policies` query to confirm prod == DDL (§2.7). **Follow-up item logged separately (§2.7, §2.3):** `room_command_receipts` → PGRST205 for anon *and service-role* ⇒ `2026-08-01_room_command_receipts.sql` likely unapplied to prod (idempotency degrades to `room_shell.actionReceipts` embedded-only) — same "reviewed migration unapplied" class as T-1 / ghost tables / commit_glicko, lower urgency. Current focus + §2.7 + §2.3 updated. **Step 2 may start once prod==DDL is confirmed or the probe evidence is accepted as sufficient.** |
| 2026-09-01 | **System 2 Step 1 follow-up — CLOSED.** Human ran the `pg_policies` query against prod: exactly 3 rows, **exact match to the repo DDL** — `room_live_sessions_no_client_write` (ALL / {authenticated} / qual `false` / wc `false`), `room_match_logs_select_own` (SELECT / {public} / qual `auth.uid() = ANY (participant_user_ids)` / wc null), `room_match_logs_no_client_write` (ALL / {public} / qual `false` / wc `false`). No `qual true` on any policy; `room_live_sessions` has no SELECT policy for any role and nothing for `anon` ⇒ RLS default-deny ⇒ service_role-only reads. **Authenticated-role SELECT question CLOSED — no competitive-integrity hole (participant cannot read own live `room_live_sessions` row / unmasked `game_state`).** `room_match_logs` participant-reads-own-terminal-rows confirmed deliberate — flagged for Step 2 keep-vs-proxy. §2.7 box checked, D-8 / Current focus / §2.3 updated to CONFIRMED. **System 2 Step 1 fully done — awaiting human sign-off for Step 2.** Still-open lower-urgency follow-up: `room_command_receipts` PGRST205 (migration likely unapplied to prod). New memory: `authenticated-rls-probe-technique` (the JWT-minting method). |
| 2026-09-01 | **RPC EXECUTE-grant sweep — started as an urgent check of `gauntlet_publish_day` / `gauntlet_close_day`, surfaced a LIVE gap in Daily Fritz.** Agent findings (via `assert_security_posture()` ADVISORY 2 + PostgREST OpenAPI; function bodies not readable from the agent session — `pg_get_functiondef` → `pg_catalog` → `PGRST106`): four admin-only content-lifecycle RPCs were `SECURITY DEFINER` + client-executable, no secret/auth param, no body guard (the codebase pattern for these is grant-only). **Human verified + fixed in prod (SQL editor):** `publish_daily_fritz_challenge` and `invalidate_daily_fritz_challenge` were **`anon` = true in prod** — `2026-08-01_daily_fritz_published_challenges.sql` revoked from `public`+`authenticated` but omitted `anon`, and Supabase grants EXECUTE to `anon` explicitly. **A live, real gap in a shipped feature** — an anonymous caller could publish/invalidate a Daily Fritz day out of schedule (no evidence of exploitation: content-addressed + `on conflict do nothing` + identity-conflict raise). `gauntlet_*` were preventive (mode scrapped/in-progress, not shipped, no MP connection). Fix = `revoke all … from public, anon, authenticated; grant execute … to service_role` for all four. **Post-fix verification (`has_function_privilege`):** <br>`gauntlet_close_day` — anon:false authenticated:false service_role:true<br>`gauntlet_publish_day` — anon:false authenticated:false service_role:true<br>`invalidate_daily_fritz_challenge` — anon:false authenticated:false service_role:true<br>`publish_daily_fritz_challenge` — anon:false authenticated:false service_role:true<br>**Repo sync:** `supabase/migrations/2026-09-01_content_lifecycle_rpc_execute_lockdown.sql` (self-asserting, all four real signatures, notes it supersedes the `anon`-omission in the 2026-08-01 file and that the fix is already live). 4th reviewed-SQL-drift instance. Block above rewritten to RESOLVED. Also logged deferred (System 3 pass): `fritz_challenge_*` REST/grant contradiction, `handle_new_user()` body review, `assert_security_posture()` follow-up queries b/c/d (incl. SECURITY DEFINER views — not covered by the current RPC). |
| 2026-09-01 | **System 2 Step 2 WRITTEN (§2.2 + §2.3) — CANDIDATE, no code.** §2.2: **MP-INV-1..19** across 8 domains — seat/identity binding (1–3), room-kind ACL (4–6), state authority & mutation ordering (7–9), persistence & recovery (10–13), game-over/result integrity (14–17), disconnect/grace (18), anti-cheat posture (19, an open decision not yet an invariant). Framing mirrors §1.2 but without a single sink: each invariant names rule / enforcing-mechanism-today-or-`UNENFORCED` / failure-mode, and is grounded in an MP-1..MP-8 window or a §2.1.7 authz row. Single-instance (§2.1.1) is stated as the precondition for all of them. §2.3: **MP-G1..MP-G17** risk-ranked (severity {data-corruption, competitive-integrity, auth-bypass, player-visible-bug, cosmetic} × single-instance likelihood × blast radius), tiered: **A — fix now in Step 3:** MP-G1 (room_live_sessions/room_match_logs unmanaged schema — 4th drift instance), MP-G3 (`room:spectate` no room-kind check — masked but board+scores+move-feed of a *ranked* private room, unthrottled by code), MP-G4 (game-over side-effect idempotency unverified for `appendMatch`/`recordPublicOnlineMatch`/`writeMatchActivity`/`recordMatchEnd` — T-3 analogue), MP-G5 (non-tournament terminal outcome last-writer-wins, MP-2). **B — verify now:** MP-G6 (`room_command_receipts` PGRST205 — likely unapplied to prod), MP-G2 (client write-grant revoke). **C — revisit if scale:** MP-G7 (MP-8 resurrect-after-delete), MP-G8 (MP-5 pre-game timer), MP-G9 (no boot recovery sweep — likely accept), MP-G10 (MP-3 attach not lock-serialized), MP-G11 (MP-4 grace callback past guards), MP-G12 (MP-1 rematch/abandon polls status not promise), MP-G13 (two-guest reconnect ambiguity). **D — posture:** MP-G14 (move-log verification non-blocking + hand-continuity-only — recommend keep non-blocking + add alert + per-user tracking). **E — accept:** MP-G15 (MP-6 coalescing), MP-G16 (MP-7 spectator torn read), MP-G17 (`room_match_logs` participant-reads-own-terminal — deliberate). **§2.3.1** gives a plain real-gap-or-covered verdict on every §2.1.7 authz row (the human asked specifically re `room:spectate` — REAL GAP; spectator discovery limited to matchmaking — NOT a gap; private `room:join` code-only — NOT a gap, but guest reconnect ambiguity broken out as MP-G13; `room:abandon_match` auth requirement — NOT a gap). §2.7 Step 2 box checked, Current focus updated. **Awaiting human line-by-line sign-off → will be logged as D-9 (mirroring D-3). Step 3 (§2.4) does not start until then.** |
| 2026-09-01 | **System 2 Step 2 verification pass (§2.3.2) — 3 claims checked against code/prod before sign-off; 2 verdicts changed.** (1) **MP-G3** — CONFIRMED in code: ranked eligibility is `a.userId && b.userId && !fritzActivityCtx` in `persistGameOverOnce` only — no matchmaking-origin / room-kind gate — so a 2-authed-user private room is fully rated (Glicko + `ranked_games`), and `room:spectate` has no room-kind check and accepts an unauthenticated spectator. Correction: my "no rate limit" claim was wrong (`room:spectate` 30/min + 5-failed-lookup block) — likelihood medium→low–medium, vector is a leaked code not a scan; severity (competitive-integrity) + verdict (FIX NOW / Tier A) stand. (2) **MP-G5** — NOT measurable from here: `mp_authority_events` (`2026-08-20_mp_authority_events.sql`) is `PGRST205`/unapplied to prod (new MP-G6 sub-finding), funnel is stdout-only, and a `room_match_logs` scan for `abandoned`+`gameOver=true` = 0 rows against ~88 human matches. Likelihood medium→low, **Tier A → Tier C (REVISIT IF SCALE)**. (3) **MP-G9** — restarts are deploy-driven and frequent (`main` commits on 20/21 days, up to 58/day; prod uptime ~5.6 h, ≥1 restart today; free-tier idle spin-down mitigated but deploy restarts not; Render crash logs not visible here). Residual = stranded `room_live_sessions` rows with no reaper; tournament covered by System 1's reconciler. **ACCEPT → REVISIT IF SCALE**; Step 3 add a periodic stale-live-session reaper. Tier A is now MP-G1/MP-G3/MP-G4. §2.3.2, the MP-G3/G5/G6/G9 rows, Current focus, and §2.7 updated. **Sign-off still pending.** |
| 2026-09-01 | **System 2 Step 2 SIGNED OFF (Decisions D-9) + Step 3 started (§2.4, Tier-A scope).** Human ratified MP-INV-1..19 and MP-G1..MP-G17 (incl. the §2.3.2 changes) line-by-line. D-9 records residuals: MP-INV-2 has an unclosed guest-reconnect gap (MP-G13); MP-INV-19 is a posture decision, not a hard invariant (move-log verification stays non-blocking; add alert + per-user tracking = MP-G14). §2.2 / §2.3 status flipped CANDIDATE→RATIFIED. **Step 3 §2.4 written for the 3 Tier-A gaps only** (MP-G1, MP-G3, MP-G4; MP-G2 folded into MP-G1): §2.4.1 the only real concurrency is the `persistGameOverOnce` 4-attempt retry (verified: steps 4/5/6 re-run ungated; step 8 `insertRankedGameIdempotent` already gates Glicko + game-over-path `recordMatchEnd`); §2.4.2 **wrote** `supabase/migrations/2026-09-01_room_tables_schema_and_grant_lockdown.sql` (codifies the `supabase/*.sql` DDL for both room tables, `revoke insert/update/delete/truncate ... from anon, authenticated` + `revoke select` on `room_live_sessions`, keeps `authenticated` SELECT on `room_match_logs` for `room_match_logs_select_own` / MP-G17, self-asserting; DDL+policy parts already live in prod, the grant revoke is the only real change and is NOT yet applied); §2.4.3 MP-G3 decision — **private rooms blocked from spectate outright** (no participant-relationship infra, no evidence of use; revisit via an opt-in `RoomConfig.spectatable` flag) **+ spectate requires auth** — concrete `roomKind`-based gate + ack codes `auth_required`/`not_spectatable` specified; §2.4.4 MP-G4 — one rule (*every game-over side-effect idempotent on `sourceMatchId`*): `appendMatch` stable-id + dedup-on-read (+ note: the JSONL file is ephemeral, a table would be better — later stats pass), `recordPublicOnlineMatch` partial unique index on `metadata->>'roomMatchId'` + `resolution=ignore-duplicates`, `writeMatchActivity` new `activity_feed.dedupe_key` column + partial unique index + `${sourceMatchId}:${userId}:${type}` key, `recordMatchEnd` conditional PATCH `status=eq.in_progress` (first-terminal-wins — also fixes the matchmaking half of MP-G5). MP-G3/G4 code + the sibling `…_gameover_sideeffect_idempotency.sql` migration are Step 4. **No application code changed.** Current focus + §2.7 updated. |
| 2026-09-01 | **System 2 Step 4 — Tier-A code shipped (§2.4.6). No prod migration applied.** Implemented §2.4.3/§2.4.4 exactly as designed, 7 files: **MP-G3** — `registerRoomSpectateHandlers.ts` gate (`auth_required` before `leaveExistingSocketRooms`; `not_spectatable` via `roomKind` after the `abandonedAt` check — private blocked unless `config.spectatable`, which was added to `RoomConfig`; failed-lookup limiter untouched, asserted). **MP-G4** — `appendMatch` (caller passes `id: sourceMatchId`; returns existing entry on dup; `computeWeeklyAwards` dedup backstop), `recordPublicOnlineMatch` (`Prefer: resolution=ignore-duplicates`, SELECT kept as fast-path), `writeActivity`/`writeMatchActivity` (optional `dedupeKey` → `dedupe_key` body field + ignore-duplicates; `sourceMatchId` threaded from `gameOverPersistence.ts`) **+ `writeForfeitActivity`** (same-family 1-line extension, flagged), `recordMatchEnd` (conditional PATCH `?id=eq.<id>&status=eq.in_progress` — first-terminal-wins, fixes matchmaking half of MP-G5). **Migration** `supabase/migrations/2026-09-01_gameover_sideeffect_idempotency.sql` (`matches_room_match_id_uidx` partial unique on `(metadata->>'roomMatchId')`; `activity_feed.dedupe_key` + `activity_feed_dedupe_key_uidx`; self-asserting) — **pg16-verified** (applies clean + idempotent; `ON CONFLICT DO NOTHING` dedups both tables; null keys unconstrained), same as the room-tables migration earlier. `tsc -b` clean (server+client); **full server suite 204 files / 1173 tests pass**; new tests: `matchLog.test.ts`, `recordPublicMatch.test.ts`, `matchmaking/recordMatchEnd.test.ts`, `activityWriter.test.ts` +2; updated `registerRoomSpectateHandlers.test.ts` (+4 gate tests), `spectateSeatPreservation.test.ts`; server lint identical (74 pre-existing errors, 0 new). §2.4 status DESIGN→IMPLEMENTED, §2.4.6 added, §2.5 opened with the "apply in prod" checklist item, §2.7 Steps 3+4 checked, Current focus updated. **Neither migration applied to prod — MP-G1/MP-G2/MP-G4 close only after the human runs them in the SQL editor.** |
| 2026-09-01 | **System 2 — both Tier-A migrations applied to prod (human, SQL editor). MP-G1 / MP-G2 / MP-G4 CLOSED.** Both returned "Success. No rows returned" (self-assert `do` blocks passed → no `raise exception`). Agent verified read-only: `assert_security_posture()` → `hard_fail_count:0` and the `client_write_grant_rls_on` advisory **no longer lists** `public.room_live_sessions` or `public.room_match_logs` (both were flagged before); anon `INSERT` into `room_match_logs` → `HTTP 401 / 42501 permission denied for table` (grant-layer denial, was RLS-layer). Migration 2's `create unique index matches_room_match_id_uidx` built without error ⇒ **`public.matches` had zero duplicate `metadata->>'roomMatchId'` values** — the pre-fix double-write never actually occurred in prod (consistent with MP-G5's 0-evidence finding). §2.3 Tier-A header + MP-G2 row + §2.5 + §2.7 Step 4 + Current focus updated to CLOSED. **MP-G3 is code-only (`37054fda`) and deploys with the next release.** Remaining System 2: Step 5 (tests prove closure); MP-G6 (Tier B); Tiers C–E. |
| 2026-09-01 | **System 2 MP-G6 (Tier B) verified — both tables CONFIRMED absent from prod; fix migration written.** `room_command_receipts` and `mp_authority_events` return `PGRST205` for **service_role** (not just anon), are absent from the PostgREST OpenAPI spec (while `room_live_sessions`/`room_match_logs` are present → schema cache is current), and leave no trace in `assert_security_posture()` (server-side, reads pg_catalog). Both source migrations exist + are committed (`2026-08-01_room_command_receipts.sql` @ `5947dd36`; `2026-08-20_mp_authority_events.sql` @ `420be2b7`) — **never applied** (no CI migration runner; 5th/6th drift instance after T-1 / ghost tables / commit_glicko / content-lifecycle RPCs / the room tables). Effects: `withGameActionIdempotency` runs degraded to `room_shell.actionReceipts` embedded-only (silent; a shell trim under a reconnect storm could drop a receipt); the durable `mp.authority` funnel is dead (stdout-only telemetry — why MP-G5 was unmeasurable). **Not a stale/environment-specific PGRST205** — re-confirmed live 2026-09-01, three independent signals agree. Wrote `supabase/migrations/2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql` — creates both tables + the `mp_authority_funnel_metrics` view, **corrects the originals**: (a) explicit `revoke all from anon,authenticated` + `grant all to service_role` on `room_command_receipts` (original relied on Supabase defaults); (b) **drops the `event` CHECK** on `mp_authority_events` (hard-coded 14 names, the server emits 18 incl. `private_game_over_persist_*` / `private_disconnect_auto_act_*`, and the insert is best-effort → a stale CHECK silently drops telemetry). Self-asserting, `to_regclass` + RLS + grant checks. **pg16-verified**: applies clean + idempotent; the funnel table accepts the previously-rejected event names. Added "never applied / superseded" header notes to both original files. §2.3 MP-G6 row + §2.7 + Current focus updated from "likely unapplied" to **CONFIRMED absent, fix written, awaiting human prod-apply**. SQL + expected output printed to the human. **Not applied to prod by the agent.** |
| 2026-09-01 | **System 2 MP-G6 — CLOSED + LIVE.** Human applied `2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql` in the SQL editor (self-assert `do` block passed → no `raise exception`). Agent verified against prod (read-only + a service-role insert/delete round-trip): (1) `select to_regclass(...)` → `room_command_receipts` / `mp_authority_events` / `mp_authority_funnel_metrics` all non-NULL; (2) PostgREST OpenAPI spec now lists all 3; (3) `service_role` GET on all 3 → `HTTP 200 content-range */0` (was `PGRST205`); (4) `assert_security_posture()` → `hard_fail_count:0`, neither table flagged, `advisory_count` unchanged at 70 ⇒ RLS enabled + no `client_write_grant_rls_on` (i.e. no anon/authenticated write grant); (5) anon GET **and** INSERT on both → `HTTP 401 / 42501 permission denied for table`; (6) `service_role` INSERT → `201` on both (incl. `mp_authority_events` with `event='private_game_over_persist_succeeded'`, which the *original* migration's CHECK would have rejected — the CHECK-drop works), test rows `DELETE`d (`204`), both tables back to `*/0`. **No deploy required** — `roomCommandReceiptStore` / `mpAuthorityEventStore` already POST to these endpoints; they were silently swallowing `PGRST205` and are now writing for real. §2.3 MP-G6 row, §2.7, Current focus → CLOSED + LIVE. **All Tier-A + Tier-B System 2 gaps done. Next: System 2 Step 5.** |
| 2026-09-01 | **System 2 Step 5 — first pass DONE (§2.6).** Scoped (per the human) to the invariants whose enforcement *changed this session*: **MP-INV-6** (spectate gating, MP-G3) + **MP-INV-15** (idempotent game-over side-effects, MP-G4/MP-G6), plus a focused MP-INV-1..3 base check. Built `mpSideEffectStore.testkit.ts` — a faithful in-memory port of what the two MP-G4 migrations add (partial unique indexes `matches_room_match_id_uidx` / `activity_feed_dedupe_key_uidx`, `recordMatchEnd`'s conditional `PATCH ?status=eq.in_progress`), wired as the `supabaseFetch` + `node:fs` mock so the **real** helpers run against it (System 1 analogue: `inMemoryMatchRpc.testkit.ts`). `mpInvariantHarness.test.ts` — **13 tests**, each naming the invariant + the assertion that maps to its rule (table in §2.6.1): unauth spectate rejected before `socket.join`/`leaveExistingSocketRooms`; private room `not_spectatable` unless `config.spectatable`; matchmaking/tournament/legacy still allowed; the side-effect tail run twice → `jsonl` 1 line / `matches` 1 row / `activity_feed` 2 rows (not 4); the **real `persistGameOverOnce` retry loop** (attempt 1 throws at `completeGhostGame`, attempt 2 succeeds) re-runs steps 4/5/6 and still writes each sink once; `recordMatchEnd` game-over-then-forfeit → first terminal write wins; seat-migrated stale socket can't `resolveActorSeatId`; redundant reconnects don't grow `room.players`; 3rd identity into a full room throws. **No pg16 script** (§2.6.3 — no real-row-lock claim in MP-INV-1..19; the MP-G4 DB guarantee was already verified against real Postgres via the pg16 apply + prod `ON CONFLICT` / DELETE round-trip). `tsc -b` clean (server + client); **full server suite 205 files / 1186 tests pass** (+1 file / +13); server lint identical (74 pre-existing errors, 0 new). §2.6 written, §2.7 Step 5 + Current focus updated. **System 2 Steps 1–5 done for the Tier-A/B scope; remaining = Tiers C–E.** |
| 2026-09-02 | **Cross-cutting security follow-up sweep (read-only) — 1 confirmed gap, 3 safe.** Investigated the 3 deferred items. **(1) `handle_new_user()` — SAFE.** `after insert on auth.users` trigger; body only `insert into profiles (id, username) values (new.id, …) on conflict (id) do nothing` — id is `NEW.id`, no param, unforgeable, can't overwrite. `returns trigger` ⇒ not PostgREST-exposed (`/rpc/handle_new_user` absent; `PGRST202` for anon + service_role) and not directly callable in SQL (`0A000`). ADVISORY-2 flag is a false positive; same clears the other trigger fns. **(2) `fritz_challenge_*` RPCs — CONFIRMED GAP (auth-bypass, 7th drift instance).** The "PGRST202/not exposed" reading was a wrong-shape call. Live anon probes: `claim_fritz_challenge_opponent`, `advance_fritz_challenge_hand`, `start_fritz_challenge_attempt`, `record_fritz_challenge_game`, `get_or_create_fritz_challenge_hand`, `create_fritz_challenge_invite`, `commit_fritz_challenge_attempt_command`, `start_fritz_challenge_attempt_command` **all execute for `anon`** (`200` / business-logic errors, not `42501`) — while `authenticated` gets `42501 permission denied` (backwards ACL). All `SECURITY DEFINER`, **none has an `auth.uid()` check**; the `revoke … from public, authenticated` in `supabase/fritz_challenges.sql` + `2026-08-02_fritz_challenge_authority_primitives.sql` never reached prod. Concrete unauthenticated writes: hijack an open challenge's `opponent_user_id`; overwrite a victim's attempt `result`/scores/receipts. Mitigant: needs a target UUID out-of-band (the tables deny anon reads, `*/0` — ids not enumerable; challenge ids travel in share links). Likelihood low–medium, no evidence of exploitation. **Not fixed** — scoped for a later pass (revokes + body `auth.uid()` guards on ~8 fns, mirroring commit_glicko + the gauntlet RPCs' internal `Authentication required`; also probe `commit_daily_fritz_attempt_command`). **(3) posture b/c/d — b + c confirmed no gap** (`hard_fail_count:0` ⇒ no RLS-disabled `public` table ⇒ no inert policies; no `SECURITY DEFINER` fn with mutable `search_path`). **d — no gap found:** every repo `create view` is `with (security_invoker = true)`, and anon **and** authenticated both get `42501 permission denied for view` on all `*_metrics` views; one optional SQL-editor query (`pg_class.reloptions` for `relkind='v'`) would make it fully definitive. Findings block added before "# System 1"; Current focus updated. Nothing fixed — investigation only. |
| 2026-09-02 | **Cross-cutting sweep follow-through — posture (d) fully closed; fritz RPC lockdown migration written.** **(d):** the PostgREST OpenAPI spec exposes exactly 7 `public` views (`daily_fritz_*_metrics`, `fritz_challenge_{funnel,failure}_metrics`, `mp_authority_funnel_metrics`); live probe — **anon → 401, authenticated → 403, service_role → 200 on all 7**. No client role can `SELECT` any view ⇒ no RLS-bypass-via-view is possible regardless of `security_invoker`. Marked **FULLY CLOSED** (not "no gap found"). **Item 2 fix:** tamper audit first (service-role read) — `fritz_challenges` 17 rows all `open`, `fritz_challenge_attempts` 9 rows all `started`/g1h0/`final_score` null → **zero exploitation history**. Follow-up probe found `commit_daily_fritz_attempt_command` + `start_daily_fritz_attempt_command` **also anon-callable** (Daily Fritz, live feature) → gap is **10 functions**. Wrote `supabase/migrations/2026-09-02_fritz_challenge_rpc_lockdown.sql`: PART A `revoke … from public, anon, authenticated` + `grant … to service_role` for all 10 (`to_regprocedure` skip-guard); PART B `_assert_fritz_rpc_server_only()` (raises unless `auth.role()` = `service_role` / NULL) called first in the 7 fns with a single-source repo body (5 `fritz_challenges.sql` + 2 `2026-08-02_…` command RPCs), body verbatim; 3 body guards deferred (`create_fritz_challenge_invite` prod-only body; `commit_daily_fritz_attempt_command` / `start_daily_fritz_attempt_command` need the exact current body). Self-asserting. Added `auth.role()` to `scripts/tournament-db-verify/shim.sql`. **pg16-verified:** clean + idempotent, all 7 → anon:f/authenticated:f/service_role:t, guard raises `role=anon` / passes `service_role`+internal. **Not applied to prod — human call.** |
| 2026-09-02 | **Posture (d) DIRECTLY CONFIRMED closed.** Human ran the `pg_class.reloptions` view query → exactly 7 `public` views, **every one `["security_invoker=true"]`** (`daily_fritz_{funnel,failure,retention,event}_metrics`, `fritz_challenge_{funnel,failure}_metrics`, `mp_authority_funnel_metrics`). **No `SECURITY DEFINER` view exists** — matches the OpenAPI-spec view list exactly, and all 7 already deny anon (401) + authenticated (403). (d) upgraded from "no gap found" to fully closed on direct evidence. Residual (coverage, not a gap): extend `assert_security_posture()` to check for `SECURITY DEFINER` views. |
| 2026-09-02 | **Item 2 — `2026-09-02_fritz_challenge_rpc_lockdown.sql` APPLIED TO PROD (human, SQL editor) — CLOSED + LIVE.** Agent verified read-only, same style as MP-G3 / MP-G6: **(1) anon probe, all 10 functions → `HTTP 401 / 42501 permission denied for function`** (was `200`): `claim_fritz_challenge_opponent`, `advance_fritz_challenge_hand`, `start_fritz_challenge_attempt`, `record_fritz_challenge_game`, `get_or_create_fritz_challenge_hand`, `create_fritz_challenge_invite`, `commit_fritz_challenge_attempt_command`, `start_fritz_challenge_attempt_command`, `commit_daily_fritz_attempt_command`, `start_daily_fritz_attempt_command`. **(2) authenticated** (throwaway JWT) on 2 → `403 / 42501`. **(3) service_role** on 4 (incl. the guarded PART-B fns `claim_*`, `advance_*`, `start_*_command`) → `200` with normal business errors (`[]` / `unsupported_command` / `challenge_not_found`), **no permission error** — app unaffected, `_assert_fritz_rpc_server_only()` passes for service_role. **(4) `assert_security_posture()`** → `hard_fail_count:0`; **none of the 10 (nor `_assert_fritz_rpc_server_only`) still flagged `securitydefiner_client_executable`** (all were, before) ⇒ anon + authenticated confirmed to have no EXECUTE on all 10; `advisory_count` 76→60 across the session. Still flagged (separate, lower priority): the `gauntlet_*` client-facing RPCs (by-design client-callable, internal auth guards, scrapped feature) + the `returns trigger` false positives. **8th drift instance closed.** §"Cross-cutting…" block + Current focus + Net line updated to CLOSED + LIVE. |
| 2026-09-02 | **System 2 Tiers C/D/E — verification pass (§2.3.3).** The Tier-A/B gaps were code-verified in Step 5; the Tier C/D/E rows were still §2.1 initial reads. Traced each against the code, read-only. **Nothing escalates to Tier A/B.** **MP-G12 reclassified Tier C → Tier E:** the §2.1.5 audit claim ("rests on status polling, not awaiting the promise") is wrong — `game:rematch` → `waitForActiveGameOverPersist` (`roomSession.ts:685`) does `return await pending` on `room.activeGameOverPersist`; the pre-assignment window is handled by an `idle`-status reject. The recommended Step-3 fix is already shipped. **MP-G7 record corrected:** `finalizeAndDeleteLiveRoomSession` bypasses the `inFlightPersistByRoomCode` single-flight and doesn't await in-flight writes; the freshness fence (`validateLiveRoomHydrationRow:565`, status↔`game_state` consistency) rejects a resurrected **game-over** row but **not** an **abandon** one (`status='playing'`+`gameOver=false` self-consistent; `abandonedAt` lives only in `room_shell` and is overwritten) → verdict Tier C holds but the "fence rejects it" reasoning was half wrong; the tombstone guard is the real fix. **MP-G10 confidence low-med → low** (could not construct a duplicate-seat failure for one identity — the post-hydration branch is fully synchronous; `resolveActorSeatId` + `joinRoom` cap bound it). **MP-G8 / MP-G11 / MP-G13 / MP-G15 / MP-G16 / MP-G17 confirmed as classified** (MP-G8: `serializeRoomShell` genuinely omits `preGameDraw`; MP-G11: the `stillConnected`→`act` path is synchronous, a reconnect can't interleave unless the gameplay lock is held; MP-G13: `identityMatchesReconnectSeat` matches two `userId=null` guests by username — private+unranked only; MP-G16: `projectMultiplayerRoomForSpectators` doesn't mutate `room.state`). **MP-G5 + MP-G14** note that MP-G6 made `mp_authority_events` live → MP-G5's race is now measurable, MP-G14's failure event is now durably recorded (residual: no alert, no per-user aggregation). §2.3.3 written; MP-G5/G7/G10/G12/G14 rows + Current focus updated. Nothing fixed — verification only. |
| 2026-09-02 | **System 3 (Daily modes) Step 1 — current-state audit §3.1 WRITTEN.** Mapped Daily Fritz, Puzzle Rush, Daily Puzzle Ladder: topology (§3.1.1 — HTTP routes on the single Render process, `getAuthenticatedUserId` at every write, all DB via service-role `supabaseFetch`), per-mode data model + score-authority model (§3.1.2–§3.1.4), authz map (§3.1.5), 7 concurrency windows DM-1..DM-7 (§3.1.6), recovery/idempotency prior art (§3.1.7), 7 parked gap candidates (§3.1.8). **Key findings:** (a) **Puzzle Rush is clean** — server-authoritative, RLS deny-all **and** grants revoked from clients, engine-replay verdict at `/complete` with over-report→`invalidated`, idempotent; but never shipped to players (26 rows). (b) **Daily Fritz** — heavily engineered (event journal `daily_fritz_events` w/ unique `idempotency_key`, transactional-command RPCs `start/commit_daily_fritz_attempt_command` now service-role-only, `dailyFritzVerifier` re-plays the transcript through `@racehorse/game-core` incl. Fritz-policy optimality, `expected_revision` CAS, immutable published challenges). **Verification is non-blocking** ("recorded as unverified, never refused") and the speed leaderboard (`status=eq.completed order by completed_at`) doesn't filter verification — DF-CAND-2 (MP-G14 analogue). (c) **Daily Puzzle Ladder — CONFIRMED LIVE competitive-integrity gap (DF-CAND-1):** `daily_puzzle_attempts` / `daily_puzzle_slot_results` carry `insert_own`/`update_own` RLS → an authenticated client `POST /rest/v1/daily_puzzle_attempts` with its own `user_id` + `total_score: 999999` / `puzzles_completed: 5` → **HTTP 201, row created** (CHECK constraints only bound `>=0` / `<=5`), sorts to the top of `daily_puzzle_attempts_leaderboard_idx`; `update_own` also inflates a legit attempt. Verified with a throwaway account (row + user deleted). The server's `validateDailyPuzzleSubmission` engine-replay is simply bypassed. Same class as T-1. Anon (no JWT) correctly `42501`. **Likely Tier A.** Also parked: DF-CAND-3 (legacy `daily_puzzle_scores`/`_submissions`/`_completions` — in prod, not in repo, unverified RLS), DF-CAND-4 (`daily_puzzles` in-place v1→v2→ladder migration + dead `admin@example.com` policy + no per-attempt content fence), DF-CAND-5 (`withDailyFritzAttemptLock` in-process only), DF-CAND-6 (outbox/async-verify drainer liveness on the free-tier process), DF-CAND-7 (the 3 grant-locked-but-body-unguarded fritz/daily-fritz RPCs from 2026-09-02). §3.2 / §3.3 stubbed. Current focus + Sequencing updated. **Stop — await human sign-off on §3.1 before Step 2.** |
| 2026-09-02 | **System 3 §3.1 SCOPE CORRECTION — Daily Puzzle Ladder is retired, not an active mode.** Human: "it's Daily Fritz and Puzzle Rush only now." Reconciled read-only. **Server routes:** `registerDailyPuzzleRoutes(app)` still called (`index.ts:607`) — `/api/daily-puzzle/{today,start,submit-slot,complete,leaderboard}` + warm cron all **mounted**, rate limits still wired. **Client:** `appRoutePath.ts` still maps `/daily` + `/daily/leaderboard`; `AppRoutes.tsx:117-122` still dispatches `<DailyRoute>` / `<DailyPuzzleLeaderboardRoute>` (the 5-slot `DailyPuzzleScreen`). **But** `client/src/puzzleRush/dailyPuzzleIsRush.test.ts` is an explicit regression guard — the Home "Daily Puzzle" card routes straight to `puzzleRush`, Single Player hub + ladder hub have no door to `'daily'`, "no live surface should send a player there"; `DailyRoute` is referenced only by the URL dispatcher. `api.ts` still has the five calls but only the unlinked screen invokes them. **Prod writes:** `daily_puzzle_attempts` last `updated_at` = `2026-08-20T16:00`, `daily_puzzle_slot_results` last `completed_at` = `2026-08-20T16:00` — **zero writes since 2026-08-20** (the day `2026-08-20_puzzle_rush_daily_official.sql` "Puzzle Rush becomes the Daily Puzzle" landed); `rush_runs` active through `2026-09-02`. **RLS unchanged** (`insert_own`/`update_own` still on both tables). **Verdict: case (b) — reachable but unlinked.** Not case (a) (routes + `/daily` URL + RLS all live; DF-CAND-1 re-verified working). Not case (c) (Puzzle Rush is its own schema `rush_runs`, not a rename of `daily_puzzle_attempts` — the change was UI positioning, no data migration). **DF-CAND-1 still exploitable**: an authenticated `POST /rest/v1/daily_puzzle_attempts` still lands and still sorts onto the URL-reachable `/daily/leaderboard` — severity drops (no players directed there, no legit scores since Aug 20) but the gap is open. Corrected: Current focus, §3.1.1 (reconciliation block + table), §3.1.3 (Puzzle Rush IS the live Daily Puzzle, not "unshipped"), §3.1.4 heading + gap text, §3.1.5, DM-5, DF-CAND-1, Sequencing line. **Step 2/3 decision framed: decommission (drop routes + tables) vs. lock the RLS — decommission preferred.** No code/migration changes — audit correction only. |
| 2026-09-02 | **DF-CAND-1 — Daily Puzzle Ladder DECOMMISSIONED (one commit; migration pending human apply).** Human confirmed no pending client release re-links it and `racehorse.onrender.com` is the only `/api/daily-puzzle/*` consumer. Extra finding during the cut: the Home command center still wired the ladder in (`homeDataLoaders.loadDailyPuzzle` → `/api/daily-puzzle/today` on every home load; `homePrimaryAction.ts` / `homeActivityTimeline.ts` emit `route: 'daily'` next-move/timeline branches) — `dailyPuzzleIsRush.test.ts` had only guarded the Home *card* + hub + solo routes. **Server:** removed `registerDailyPuzzleRoutes` + 3 `/api/daily-puzzle/*` rate-limit mounts + nightly `scheduleDailyPuzzleLadderWarmup`; deleted `http/routes/dailyPuzzle.ts` (+ `/api/cron/daily-puzzle-ladder-warm`) + its forgery test; trimmed `scheduled/dailyWarmup.ts` (+ its test). **Client:** removed `/daily` + `/daily/leaderboard` (route table, `AppRoutes` branches, `DailyRoute`/`DailyPuzzleLeaderboardRoute`, prerender entries, `vercel.json` rewrites); `useHomeCommandCenter` no longer fetches the ladder (`model.daily.puzzle` pinned `unavailable`). Left the now-unreachable `route: 'daily'` branches in `homePrimaryAction`/`homeActivityTimeline` in place (gated on `status==='ready'` which can't happen) rather than churn personalization tests — parked as **DF-CAND-1b** (delete those + `client/src/dailyPuzzle/**`). **DB:** `supabase/migrations/2026-09-02_daily_puzzle_ladder_decommission.sql` drops the 4 `insert_own`/`update_own` policies + `revoke insert,update,delete,truncate` from `anon`/`authenticated` on `daily_puzzle_attempts` / `_slot_results`; tables stay in `public` as **read-only historical** (`select_own` + service-role SELECT kept — `socialProfile.ts` + `homeCompletionDates.ts` still read pre-Aug-20 rows). Self-asserting; **pg16-verified clean + idempotent** (only `select_own` remains; `authenticated` INSERT=f / SELECT=t; `anon` UPDATE=f; `service_role` SELECT=t; 2 seeded historical rows preserved). Not touched: `daily_puzzles`, `daily_puzzle_scores`/`_submissions`/`_completions` (DF-CAND-3/4). Full `tsc -b` clean; client vitest 1482/1482, server 1183/1183; client lint 401/401 (budget); server lint unchanged (74→71 pre-existing errors). **Migration NOT applied to prod DB — human runs it in the SQL editor. Not pushed.** |
| 2026-09-02 | **System 3 (Daily modes) Step 2 — invariants §3.2 + risk-ranked gap list §3.3 WRITTEN (CANDIDATE, no code).** Scoped to the 2 active modes (Daily Fritz, Puzzle Rush); retired Ladder excluded. **§3.2: DM-INV-1..18** across 6 domains — score authority (1–5), one-attempt/run-per-day (6–7), idempotent recovery & ordering (8–13), content integrity (14–16), authz (17–18) — each rule / enforcing-mechanism-today-or-`UNENFORCED`/`PARTIAL` / failure-mode, grounded in a DM-1..DM-7 window or a §3.1.5 authz row. **§3.3: DF-G1..DF-G5** risk-ranked. **Two §3.1 audit claims corrected against code:** (1) the Daily Fritz speed board **IS** verification-gated — `buildDailyFritzLeaderboard` applies `.filter(isDailyFritzAttemptLeaderboardEligible)` (`verification_status==='verified'` + empty `unverified_hands`); the raw PostgREST query isn't, the consumer is. (2) `daily_fritz_outbox` is projected by an **AFTER INSERT DB trigger** (`project_daily_fritz_outbox_event()`), **not** a Node `setInterval` drainer — no liveness risk (DM-INV-13). **The real gaps:** **DF-G1 (FIX NOW)** — `scheduleDailyFritzRecordGameVerification` is a fire-and-forget bare promise; a restart in the async-verify window strands a hand permanently unverified ⇒ a legitimate Daily Fritz run is silently and permanently absent from the daily board with no recovery (analogue of System 1's `recoverTournamentMatches` / MP-G9). **DF-G2** — `getDailyFritzStreak` is not verification-filtered (streak inflation, minor) + no alert on `verification_failed` (POSTURE decision, same stance as MP-INV-19: keep non-blocking, add alert + per-user aggregation). **DF-G3** — `withDailyFritzAttemptLock` in-process only; traced — the `expected_revision` CAS + `daily_fritz_attempt_operations` unique keep ledger integrity airtight without it; residual is a CAS-conflict surfacing as an error to a racing tab instead of replaying the cached op (REVISIT IF SCALE). **DF-G4** — 2 daily-fritz command RPCs grant-locked (verified live) but PART-B body-guard deferred; defence-in-depth only (REVISIT IF SCALE). **DF-G5** — Puzzle Rush `/complete` no lock + unconditional finalize PATCH; deterministic replay ⇒ no corruption (ACCEPT). **DF-CAND-1 dropped (RESOLVED/decommissioned); DF-CAND-1b / DF-CAND-3 / DF-CAND-4 stay parked (not integrity risks).** §3.4 checklist added; Step-2 boxes checked; Current focus updated. **Awaiting human line-by-line sign-off → Decisions D-10 (mirroring D-3 / D-9). Step 3 does not start until then.** |
| 2026-09-02 | **System 3 Step 2 RATIFIED (D-10) + Step 3 IMPLEMENTED (DF-G1 + DF-G2). Not pushed.** Human signed off §3.2 / §3.3 "as written". **Two mechanism corrections from a full call-site trace, recorded with D-10 (§3.2 header):** (1) `scheduleDailyFritzRecordGameVerification` / `runDailyFritzRecordGameVerification` have **zero production callers** — dead code from the reverted `b0a0a93c` advance-first design (caller removed in `d027d30d`). Nothing schedules async re-verification; the record/next-hand routes verify synchronously and refuse-to-advance on transient infra failure. DF-G1's real gap: a **stranded `status='started'` attempt with a complete set** (client crash / restart mid-`/complete`, no reaper). (2) DF-G2's `verification_failed` alert **already exists** (`recordDailyFritzAdvanceWithoutVerification` → `Sentry.captureMessage(..., daily_fritz_alert:'verification_bypassed')`); the residuals are per-user aggregation + the streak filter. **DF-G1 fix:** `server/src/dailyFritzStrandedRecovery.ts` — `recoverStrandedDailyFritzAttempts()` (boot sweep 20 s after listen + 15-min `setInterval`, wired in `index.ts`), mirrors `recoverTournamentMatches`. Lists `daily_fritz_attempts?status=eq.started&started_at=lt.<now-30min>` (bounded 100), and per attempt under `withDailyFritzAttemptLock`: re-fetch, skip if not `started` (raced) or set not complete (mid-play), else finalize via the new shared **`applyDailyFritzAttemptFinalization`** (extracted verbatim from `/complete` — `dailyFritzAttemptFinalize.ts`; `/complete` now calls it, behaviour-preserving). Transactional attempts use `commitDailyFritzAttemptCommand('finalize_verified_attempt')`; non-transactional `upsertDailyFritzAttempt` + a journaled `attempt_completed`. Always journals `recovery_succeeded` / `recovery_failed`, `invalidateDailyFritzLeaderboard`, `incrementDailyFritzMetric('attempt_completed')`. Idempotent; never promotes a `rejected` run (writes `legacy_unverified`). **N = 30 min**: a best-of-3 set is ~5–15 min and the client fires `/complete` at set end; the reaper only touches attempts whose set is already complete, so 30 min is a wide margin around the client's own retry loop (seconds), not a guard against an active player. **DF-G2 fix:** `getDailyFritzStreak` selects `result` and filters through new `isDailyFritzAttemptStreakEligible` (drops `rejected` + non-empty `unverified_hands`; **keeps `legacy_unverified`** so pre-protocol streaks aren't retroactively zeroed — deliberately weaker than the leaderboard predicate). New `countRecentDailyFritzVerificationFailures(userId, {days:7})` in the event store; `recordDailyFritzAdvanceWithoutVerification` includes `userRecentVerificationFailures` in the existing Sentry alert and escalates `warning`→`error` + tag `verification_bypassed_repeat` at ≥ `DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD` (3). Verification stays non-blocking for `status='completed'` (D-10 POSTURE). **Tests (18 new):** `dailyFritzStrandedRecovery.test.ts` (7), `dailyFritzStreakFilter.test.ts` (8), `dailyFritzVerificationRepeatOffenderAlert.test.ts` (3); + `countRecent…` mock added to the 2 full-replacement `dailyFritzEventStore` mocks. **Full suite green: server 207 files / 1200 tests, client 216 / 1482; `tsc -b` clean (client + server); server lint unchanged (71 pre-existing errors, 0 new); client lint at budget.** §3.2 / §3.3 status → RATIFIED; §3.4 Step-3 boxes checked; D-10 logged; Current focus updated. **Not pushed — awaiting human review of the Step-3 implementation; also still pending: apply `2026-09-02_daily_puzzle_ladder_decommission.sql`.** DF-G3 / DF-G4 (REVISIT IF SCALE) and DF-G5 (ACCEPT) not touched. |
| 2026-09-01 | **System 2 Tier-A code DEPLOYED to prod + MP-G3 smoke-verified live.** Prod was 3 commits behind `origin/main` and 10 behind local `main` (prod release `a93eea1e`). `origin/main` had also advanced 1 (PR #107, puzzle-rush client CSS) — rebased the 10 local commits onto it (clean, disjoint files; hashes changed, code commit `e2ad401b`→`37054fda`, HEAD `1eca7d83`→`907435df`), `tsc -b` re-checked clean, pushed `origin main adfd3836..907435df`. Note: the 10 pushed commits include **2 pre-session HARDENING_PLAN.md-only doc commits** (`6e0e8fb6`/`abd6976e`, ex-`b8bf3754`/`b0e14411`) — git can't push the session range without its ancestors; no code, no build impact. Render auto-deployed within ~1 min; `/ready` confirms `release: 907435df`, `uptimeSeconds` reset. **MP-G3 smoke-tested against live prod** via a `socket.io-client` script (repo `node_modules`): (1) unauth `room:spectate` → `{ok:false, error:"auth_required"}`; (2) `room:create` a throwaway private room (non-UUID smoke userId), authed `room:spectate` on it → `{ok:false, error:"not_spectatable"}`; (3) unauth `room:spectate` on the real room → `auth_required` (auth check is first). Cleanup: service-key `DELETE room_live_sessions?room_code=eq.<code>` (204, the room had persisted a `lobby` row with empty `participant_user_ids` since the smoke userId isn't a uuid) + `room_match_logs` (204), verified gone. **MP-G3 CLOSED + LIVE.** All 4 Tier-A gaps (MP-G1/G2/G3/G4) are now closed in prod. Current focus / §2.3 / §2.5 / §2.7 updated. Next: System 2 Step 5 or MP-G6. |
| 2026-08-31 | **Step 3 sub-task: RPC surface decided (D-5) — three functions** (`complete` / `promote` / `generate`) + 3 helpers, not one dispatcher. §1.4.3 written with signatures, lock targets, callers, and the rationale. Also surfaced that **T-INV-6 is over-strict as ratified** — bracket correctness needs a match's two direct feeders complete, not the whole previous round; and that's already structurally enforced by `complete_tournament_match`'s conditional advancement. Reworded proposal in §1.4.3 flagged for human re-ratification (not silently changed). Next sub-task (authz layer shape) NOT started — stopping for human review. |
| 2026-09-03 | **Plan restructured (D-11).** Old "System 4: Everything else" dissolved into leverage-ordered **Systems 5–13**, based on the 2026-09-02/03 codebase inventory pass. Scaffolds written for each (scope in/out, live-vs-dead status from the inventory, empty §X.1/§X.2/§X.3 + a §X.4 checklist stub). New **Appendix** for latent/dev-only surfaces (spectator flag-off mode, `devtools/`, e2e-inspect routes, retired Ladder files) — "skip unless relevant". New **"Continuing this plan"** section at the end (workflow, house rules, deploy facts, ambiguity resolution) written for a cold session. Sequencing list expanded to 1–13; Current focus + D-11 added. **System 5 (Legacy League) live/dead check (this pass, needs human confirmation):** looks **DEAD in prod** — `fixtures`/`leagues`/`league_members` last written 2026-04-29, `fixture_match_results` 2026-04-05, `league_bots` 2026-04-01, `player_league_history` 0 rows; **no** `client/src` HTTP call to `/league/*` and **no** league / `tournament:create` / `tournament:join` socket emitter; routes + legacy `tournament:*` socket handlers + admin `/league/run-*` jobs all still registered in `index.ts` but unreachable from the client; `finalizeTournamentMatchHook` only fires for a room with a legacy `cfg.tournamentId`, which nothing creates; no scheduler keeps a league alive; last *feature* commit predates the April 2026 overhaul. Likely: decommission (mirror the Ladder). No code changed — planning only. |
| 2026-09-03 | **System 5 (Legacy League / Legacy Tournament) — CLOSED (decommissioned). Not pushed.** Step 1 re-verified the dead-in-prod read (§5.1): all 6 `league_*` tables untouched since April 2026 (`fixture_match_results` last 2026-04-05, `league_bots` 2026-04-01, `player_league_history` 0 rows, no fixture ever `completed`, no `live_room_code` ever set); **zero** client HTTP calls to `/league/*` and **zero** client `tournament:{create,join,add_bot,remove_bot,start}` socket emitters; the legacy handlers were already gated behind `ENABLE_LEGACY_TOURNAMENTS` (default `false`, off in prod → `finalizeTournamentMatchHook` permanently `null`); no other system depends on the hook (System 1's scheduled-tournament path explicitly does not route through it); no FK from outside the `league_*` cluster; the 9 league imports in `index.ts` were already dead (imported, not wired). **Removed:** `registerLeagueRoutes` + `registerLegacyTournamentHandlers` + `finalizeTournamentMatchHook` + the 2 `initRoomSession` dep wirings + the 3 `/league` rate-limit `app.use` mounts (`index.ts`); deleted `server/src/league/**` (forfeit/history/results/rollover/schedule/service/state), `server/src/legacyTournament/**` (handler + test), `server/src/http/routes/league.ts`, `supabase/league.sql`; removed the `gameOverPersistence.ts` live-fixture branch (`recordLeagueLiveResult` import + the per-game-over `/rest/v1/fixtures?live_room_code=eq.<code>` query — always empty in prod) + its 2 tests + the `mpInvariantHarness.test.ts` league mock; removed `config.enableLegacyTournaments`; updated the now-inert `legacy_league` comments in `roomLivePersistence.ts` / `roomSession.ts`. **Parked:** `roomKind.ts`'s `'legacy_league'` classification + `isLegacyLeagueRoom` + the `!legacyLeagueRoom` / `case 'legacy_league':` guards — System 1/2 ratified (D-9 / PR #102), permanently unreachable (nothing sets `config.tournamentId`), safe to strip later. **Migration** `supabase/migrations/2026-09-03_legacy_league_decommission.sql` — **DROP** all 6 `league_*` tables `cascade` (**not** archived: zero remaining readers in `server/src` + `client/src`, ~200 rows of abandoned test-season state, no display surface — contrast the Ladder which was archived because live paths still read `daily_puzzle_attempts`). Self-asserting `to_regclass` check; **pg16-verified** (apply `league.sql` → migration drops all 6 → self-assert passes; pass 2 idempotent no-op). **NOT applied to prod DB — human runs it.** Full suite green: **server 206 files / 1188 tests, client 216 / 1482**; `tsc -b` clean (client + server); client lint at budget; **server lint 233→217 problems / 71→68 errors** (deleting `league/` removed pre-existing lint errors; 0 new). §5.1–§5.4 filled in, System 5 marked CLOSED in Current focus + Sequencing. **Next: System 6 (Auth / session + rate limiting) Step 1.** |
| 2026-09-03 | **System 6 (Auth / session + rate limiting) Step 1 — current-state map §6.1 written (no fixes). Not pushed.** 11 subsections: (6.1.1) **three divergent server auth impls** — `supabaseAuth.ts` (cached 60 s, in-flight dedup, 12 s timeout, non-prod e2e bypass; used by daily-fritz/puzzle-rush/ghost/stats/bot-matches/socket), `social/socialAuth.ts` `requireAuth` (uncached, per-request upstream call; `/api/social/*` + `/api/profile/*` + `/api/account`), `scheduledTournament/tournamentAuth.ts` (uncached + uuid check + payload-userId-match; `/api/tournaments/*`) — all hit `GET /auth/v1/user`. (6.1.2) cache **A** — sha256(token) key, 1000-entry ceiling (expiry-then-oldest eviction), **≤60 s revocation lag**; a client `signOut()` revokes only the refresh token, the access-token JWT stays valid upstream to its `exp` (~1 h). (6.1.3) **`getUserIdFromAuthHeaderSync` decodes the JWT `sub` with NO signature/exp check** — used only for rate-limit keys, so a forged `sub` bypasses the per-user limits on `record-match` / `account-delete` / daily-fritz init+submit (not an authz bypass — handlers re-validate). (6.1.4) **`ADMIN_SECRET` is unset in prod** (`/ready` → `recommendedEnv.ADMIN_SECRET: false`) → `isAdminSecret` fail-closed → **every admin endpoint un-callable today**; design is a single static secret, `timingSafeEqual` compare, but `?admin_key=` query transport on 3 GETs + entered-secret in the admin-UI React state; blast radius per endpoint tabulated (Daily Fritz `reset-attempt`/`invalidate`/`generate`, `ranking/process`, `bot-matches/cleanup-stale`, per-attempt event disclosure). (6.1.5) **`InMemoryRateLimiter` — no size ceiling, no sweep** (slow leak per distinct key); **no `app.set('trust proxy')`** → `x-forwarded-for[0]` client-controlled → every IP-keyed HTTP limit bypassable; full HTTP + socket rule tables mapped (post-System-5); `middleware/rateLimiter.ts` `apiGeneralLimiter` is dead code. (6.1.6) **no socket connect-time auth** — identity per-action via a client `authToken` field. (6.1.7) client session lifecycle — Supabase client (`persistSession`/`autoRefreshToken`, tokens in `localStorage`), `sessionToken.ts` in-memory cache, `apiFetch` 401→refresh→retry-once, `signOut` clears the cached token first, `authTimeoutSessionFallback` email-match gate, `recoveryHash` consume-then-clear + the `location.hash` token window, `isAdminUser` = `VITE_ADMIN_EMAIL` (UI-only). (6.1.8) **`e2eDevAuth` confirmed dead in prod** — client gate `import.meta.env.DEV` + server gate `NODE_ENV !== 'production'` (prod is `production`), same posture as System 5's `ENABLE_LEGACY_TOURNAMENTS`. (6.1.9) CORS reflects **any `*.vercel.app`** with `credentials:true` (impact limited by the Bearer-token model); server CSP tight, client CSP has `'unsafe-inline'` + open `img-src`/`connect-src`; `/ready` discloses env-presence + load telemetry + the release SHA. (6.1.10) **8 windows AU-1..AU-8** (revocation lag / restart-resets-limiter / IP-key spoof / forged-sub / socket-key / admin-secret brittleness / recovery-hash window / three-impl drift). (6.1.11) reusable prior art. §6 status + Sequencing + Current focus updated. **Stop — await human review of §6.1 before Step 2.** |
| 2026-09-03 | **System 6 §6.1 RATIFIED (D-12) + Step 2 (§6.2 invariants / §6.3 gap list) written — CANDIDATE, no code.** **§6.2: AU-INV-1..8** — verified-identity (HOLDS, rests on `getUserIdFromAuthHeaderSync` never being wired to authz), bounded revocation (PARTIAL — AU-1), admin fail-closed (HOLDS today — AU-6), limits-bound-a-deliberate-actor (**UNENFORCED** — AU-3/AU-4/AU-5), bounded memory (cache A HOLDS, limiter UNENFORCED — AU-3), outage resilience (PARTIAL — B/C uncached + no circuit breaker — AU-2/AU-8), client attaches token only when intended (HOLDS), one auth code path (**UNENFORCED** — AU-8). **§6.3: AU-1..AU-8** risk-ranked with an added `abuse-enabling` severity band. **FIX NOW: AU-3** (`app.set('trust proxy', 1)` — confirm Render's hop count first — + `requestIp → req.ip`; every IP-keyed limit is currently spoofable via `X-Forwarded-For`) **+ AU-4** (drop the unsigned-JWT-`sub` rate-limit key → key on `req.ip` or an async verified-uid; every per-user limit — incl. account-deletion, Daily-Fritz-verifier-load — is bypassable by forging `sub`; ~1 day combined) **+ AU-8** (consolidate `socialAuth` B + `tournamentAuth` C onto `supabaseAuth` A via a shared `verifyBearerToken`, keeping C's uuid/payload-match wrapper — removes a per-request `/auth/v1/user` round-trip on the most-polled routes and is the prerequisite for any AU-1 fix; ~10 mechanical call sites). **POSTURE: AU-1** (cut cache A TTL 60→15 s now — one constant; the "signed-out JWT still works ~1 h" part needs a Supabase project JWT-expiry change [human] + optionally a server denylist [scale-gated]) **+ AU-6** (admin surface fail-closed today; concrete "before you ever set `ADMIN_SECRET`" checklist — (1) delete server-side `?? req.query.admin_key` on the 3 GET endpoints [safe standalone Step-3 removal — client already header-only], (2) one header transport, (3) drop the admin-UI `sessionStorage` persistence, (4) ≥32-byte CSPRNG secret, (5) consider IP allowlist for the integrity-affecting endpoints). **REVISIT IF SCALE: AU-5** (socket key before `socket.data.userId` is set), **AU-2** (restart resets limiter/cache — needs a shared store, upgrade-time). **ACCEPT: AU-7** (recovery-token URL-fragment window — already well-mitigated; PKCE flow is the improvement path). §6.4 updated; D-12 logged; §6 status + Sequencing + Current focus updated. **Awaiting human line-by-line sign-off on §6.2 / §6.3 → D-13. Step 3 does not start until then.** |

---

# Continuing this plan

*Written for a fresh agent session with no prior context. Read this, then `## Current focus`, then the Sequencing list.*

## 1. Where you are

- **`## Current focus`** (top of this file) is kept accurate at all times — read it first.
- The **Sequencing list** (§"How to use this document") is the running order. **The next system to work is the first one in that list not marked CLOSED / passed-through.** Systems 1–3 are done. System 4 does not exist (dissolved — D-11). Systems 5–13 are **scaffolds only**: scope + in/out + a live-vs-dead status guess from the 2026-09-02/03 inventory + empty §X.1/§X.2/§X.3. Each begins at its own **Step 1** when work reaches it.
- Do **not** skip ahead or work several systems at once. One system, one step, then stop.

## 2. The workflow every system follows

1. **Step 1 — Current-state map** (`§X.1`). Read-only. Map every state read/write, every authz check (present *or missing*), every concurrency window, every recovery/reconnect path, and any existing idempotency prior art that's reusable. **No fixes. No invariants.** Write it into `§X.1`. **Stop and wait for the human to review it.**
2. **Step 2 — Invariants + risk-ranked gap list** (`§X.2` / `§X.3`). Each invariant: *rule / the mechanism that enforces it today (or `UNENFORCED` / `PARTIAL`) / the failure mode if it breaks* — grounded in a specific window or authz row, not a vague area. Then risk-rank every gap: severity (`data-corruption` > `competitive-integrity` > `auth-bypass` > `player-visible-bug` > `cosmetic`) × likelihood **judged for the single Render instance** × blast radius; verdict ∈ **FIX NOW** / **VERIFY** / **POSTURE** / **REVISIT IF SCALE** / **ACCEPT**. **Stop.** The human reviews line-by-line and **ratifies as a Decision `D-N`** (mirror D-3 / D-9 / D-10 — record residual notes so a later session does not re-litigate settled points).
3. **Step 3 — Fix** the agreed scope (usually the FIX-NOW gaps only). Design first if the change is structural (a §X.4 state-machine section, like §1.4 / §2.4). **Add tests that prove each invariant the fix protects** — "looks fixed" is never done.
4. **Commit.** Reference the commit / PR / test file in the checklist item. **Do not push** unless the human explicitly tells you to — committing locally is the default. **Never apply a database migration to prod:** write it, verify it on a throwaway local pg16 (`scripts/tournament-db-verify/` shim + apply twice for idempotency), and hand it to the human to run in the Supabase SQL editor.
5. **Report back plainly** — what shipped, what's still open, what the human must do next (migrations to apply, pushes to authorise). No hedging; if tests failed, say so with the output.

## 3. House rules (these have held through Systems 1–3 — keep them)

- **Audit-first, no fixes** until Step 1–2 are written down and the invariants are ratified with the human.
- **Verify every claim against the actual code and against prod** — never trust a function name, a comment, or an earlier section of this doc. System 3 found *two ratified gap mechanisms were wrong* on a full call-site trace (`scheduleDailyFritzRecordGameVerification` was dead code with zero callers; the `verification_bypassed` Sentry alert already existed). Both were corrected openly.
- **Correct the record openly.** When an earlier claim turns out wrong, say so — in Current focus, in the section, or as a dated correction note (see the §3.2 header, §3.1.1 "Scope correction", the D-10 residual notes). Do **not** quietly rework around a wrong claim.
- **Prod database writes are the human's.** The agent writes + pg16-verifies migrations; the human applies them. This exists because there is **no CI migration runner** — the recurring "drift" bug (8 instances found: T-1, ghost tables, `commit_glicko`, content-lifecycle RPCs, room tables, `room_command_receipts`, `mp_authority_events`, fritz RPCs) is *reviewed lockdown SQL that was written in-repo but never applied to prod*. Always verify a migration's **live** state; never assume file == reality.
- **Never push** without an explicit instruction.
- **Prod probing is read-only.** Service-role REST key (`server/.env`) for row counts / recency / OpenAPI membership; the **D-8 technique** (mint a throwaway `authenticated`-role JWT via the service-key `/auth/v1/admin` API, probe, `DELETE` the user) for authenticated-role RLS checks. `pg_policies` / `pg_catalog` are unreachable via PostgREST — those need the human's SQL editor.

## 4. When scope is ambiguous

The **2026-09-02/03 codebase inventory pass** is the source of truth for *what exists* — every server/client top-level area, every `index.ts` route / socket handler / scheduler, every prod table's live-or-dead status as of that date. It is summarised across the System 5–13 scope blocks and the Appendix. If a system's Step 1 turns up something the inventory missed or got wrong, that's expected — note the correction and adjust the scope (the "investigation reveals the scope was wrong — say so, don't quietly expand" rule).

## 5. Deploy / prod facts a cold session needs

- **Render free tier, structurally single-instance** ($0, 0.1 CPU, 512 MB — no scaling on free tier). Spins down at 15 min idle; mitigated by an UptimeRobot HTTP ping on `/ping` @ 5 min (T-17, D-4). **Deploy restarts are frequent.** Everything held in process memory — the rate limiter, all in-memory locks (`withRoomGameplayLock`, `withDailyFritzAttemptLock`), the `Room` maps, any fire-and-forget task — is **lost on restart**. This is the single most recurring gap class; DB constraints (CAS, partial unique indexes, advisory locks inside RPCs) are the real cross-restart guard.
- **Prod app:** `https://racehorse.onrender.com`. `GET /ready` reports the release commit + `uptimeSeconds`. Render auto-deploys on a push that changes server or client code (doc-only pushes do not trigger a deploy).
- **Supabase** project `fisfadjqllojdzibcdfx`. PostgREST exposes the `public` + `graphql_public` schemas only. `PGRST205` ≈ table absent; `PGRST202` ≈ function-signature mismatch; `42501` ≈ permission denied (grant layer) or RLS-policy violation.
- **CI:** GitHub Actions on push to `main` — Server Validation + Client Validation (typecheck / lint / vitest / Playwright e2e) + an MP soak + a prod smoke test. Run vitest from `client/` and `server/` separately (root has no config). Client lint fails a `--max-warnings` budget (currently 401), not on errors. `tsc -b` is the real client typecheck (not `-p client/tsconfig.json`).
- **`assert_security_posture()`** — a service-role RPC + weekly GH Actions cron (`security-posture.yml`, Mondays) that flags RLS-disabled `public` tables and SECURITY DEFINER functions with mutable `search_path`. Check its output when doing any RLS work.
