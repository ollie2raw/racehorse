# Racehorse Hardening Plan

A persistent, cross-session plan to bring the tournament and multiplayer systems
up to a standard comparable to how chess.com or Miniclip (8 Ball Pool) would run
them — scoped realistically to a solo founder + AI-agent team, pre-marketing.

**This document is the source of truth.** Any agent or person picking this up
cold should read the "How to use this document" section, then the "Current
focus" line, then the section for the system in progress.

---

## Current focus

**Tournament (System 1) → Steps 1–5 COMPLETE, closed. System 2 (Multiplayer rooms) → Step 1 SIGNED OFF 2026-09-01. Step 2 (§2.2 MP-INV-1..19 + §2.3 MP-G1..MP-G17) **SIGNED OFF / RATIFIED 2026-09-01 (Decisions D-9)** incl. the §2.3.2 verification-pass changes; residual notes in D-9 (MP-INV-2 guest-reconnect gap → MP-G13; MP-INV-19 = posture not hard invariant → MP-G14). **Step 3 (§2.4) IN PROGRESS — Tier-A scope only (MP-G1, MP-G3, MP-G4; MP-G2 folded in).** MP-G1 migration `supabase/migrations/2026-09-01_room_tables_schema_and_grant_lockdown.sql` **written** (codifies live DDL + revokes client write grants + self-asserts; grant revoke not yet applied to prod). MP-G3 (private rooms blocked from spectate + auth required) and MP-G4 (every game-over side-effect idempotent on `sourceMatchId`) **designed in §2.4.3/§2.4.4** — code applied in Step 4. No application code touched. Tier-A verification-pass results (§2.3.2): MP-G3 confirmed (private 2-authed-user rooms are fully ranked; spectate has no room-kind check + accepts an unauthenticated socket); MP-G5 A→C (0 evidence, `mp_authority_events` telemetry table not in prod); MP-G9 ACCEPT→REVISIT (restarts deploy-driven, ~daily in active dev). RLS follow-up RESOLVED 2026-09-01: `room_live_sessions` / `room_match_logs` RLS ON; anon reads nothing (*/0 vs 2463/1237 rows); authenticated non-participant reads nothing (genuine `authenticated` JWT probe, incl. targeted `room_code=eq.<live room>` → */0). **`pg_policies` confirmed against prod (human ran it 2026-09-01)** — exactly 3 rows, matching `supabase/room_live_sessions.sql` / `supabase/room_match_logs.sql`: `room_live_sessions_no_client_write` (ALL / {authenticated} / `false`) = deny-all-to-client, **participant CANNOT read own live row — unmasked `game_state` never exposed, no competitive-integrity hole**; `room_match_logs_select_own` (SELECT / {public} / `auth.uid() = ANY(participant_user_ids)`) + `room_match_logs_no_client_write` (ALL / {public} / `false`) = participant-can-read-own-TERMINAL-rows, writes denied (post-game data, flag in Step 2). **Authenticated-role SELECT question CLOSED.** Separate lower-urgency follow-up still open: `room_command_receipts` returns PGRST205 → migration likely unapplied to prod (§2.7).**

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
  **MP-G1 / MP-G2 / MP-G4 CLOSED; MP-G3 deploys with the next release.**
  `tsc -b` clean; full server suite 204 files / 1173 tests pass; new
  idempotency + spectate-gate unit tests; server lint no new problems.
  Deferred as designed: the retry-from-step-1 structure, the private-room
  `room_match_logs` first-terminal latch (MP-G5, Tier C). **Next: System 2
  Step 5 (tests prove closure) or MP-G6 (Tier B verify).**

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

Audit-first, one system at a time:

1. **Tournament** ← in progress
2. **Multiplayer rooms**
3. **Daily modes** (Daily Fritz / Puzzle Rush / Daily Puzzle Ladder)
4. **Everything else** (legacy league/tournament, social, ranking, spectator…)

**Do not start refactoring a system until its audit (steps 1–3 below) is written
down and its invariants are ratified with the human.** We never fix based on
vibes or memory.

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
> Deferred to System 4. Flagged here only so a future agent does not confuse the
> two — `types.ts` even carries a comment about it.

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
> part of this system's work; worth a look during System 4 / a general
> env-hygiene pass.

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
> league (`server/src/league/**`, `legacyTournament/`) is System 4; §2.1 notes
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
| `matchmaking_matches` | `2026-05-13_matchmaking.sql` ✔ | matchmaking pairing + outcome; `recordMatchEnd` writes `status`/`winner_id`/rating deltas on game-end/forfeit | (see migration) | (verify in Step 1 follow-up alongside System 4 matchmaking) |

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

**Status 2026-09-01: all three CLOSED.** MP-G1/MP-G2/MP-G4 — code `e2ad401b` +
both migrations applied to prod and verified. MP-G3 — code `e2ad401b`, deploys
next release.


| ID | Gap | Location | Severity | Likelihood (1 instance) | Blast radius | Verdict | Protects |
|---|---|---|---|---|---|---|---|
| **MP-G3** | `room:spectate` has **no room-kind check** (`registerRoomSpectateHandlers.ts` — `getRoom(code)` + `!abandonedAt`, then a `maskStateForRecipient(state, null)` snapshot; the spectator socket may be **unauthenticated** — `resolveSocketIdentity` returns `userId:null` and is not rejected). Any socket with a 5-char code spectates a **private** room and sees board, scores, hand counts, and the move feed (not hands). **Confirmed in code (2026-09-01 verification pass):** ranked eligibility is decided *solely* by `a.userId && b.userId && !fritzActivityCtx` in `persistGameOverOnce` (`gameOverPersistence.ts` ~199, ~233) — **not** by matchmaking origin, no room-kind flag — so a private room with two logged-in players **is** fully rated (Glicko-2 → `profiles`, `ranked_games`, `recordPublicOnlineMatch`). A spectator relaying the live board to one player is real rating manipulation. | `multiplayer/registerRoomSpectateHandlers.ts`; `realtime/gameOverPersistence.ts` | competitive-integrity + info-exposure | **low–medium** — enumeration *is* throttled (`room:spectate` 30/min/socket + a 5-failed-lookup/60s block on `room:join`+`room:spectate`, `index.ts` ~647), so the vector is an **obtained/shared/leaked code** (Discord, stream, link) + a watcher, not a brute-force scan | one private room per leaked code | **FIX NOW** — premise confirmed, fix is cheap (room-kind gate + require the spectator to be an invited/known party), per-incident impact is ladder-rating manipulation | MP-INV-6 |
| **MP-G4** | Game-over side-effect helpers **`appendMatch` / `recordPublicOnlineMatch` / `writeMatchActivity` / `recordMatchEnd`** have **unverified idempotency**. The whole §2.1.6 sequence is retried up to 4× from step 1, so any failure at step ≥4 replays the earlier network writes. Direct analogue of System 1's **T-3**. | `gameOverPersistence.ts` §2.1.6 steps 4/5/6/10; `matchmaking/persistence.ts` `recordMatchEnd` | data-corruption | medium–high (steps 4/5/6 are network calls; a single transient failure triggers the replay) | cumulative — every match that hits a partial failure double-writes stats / a dup activity post / a second matchmaking outcome (fresh rating delta) | **FIX NOW** | MP-INV-15 |
| **MP-G1** | **`room_live_sessions` / `room_match_logs` schema is unmanaged** — canonical DDL sits in `supabase/room_live_sessions.sql` / `room_match_logs.sql` but there is **no migration**. 4th instance of the documented "reviewed SQL never applied / prod silently diverges" root cause (T-1, ghost tables, commit_glicko, the content-lifecycle RPCs). | `supabase/*.sql` vs `supabase/migrations/` | process / latent-drift | high that it bites again on the next RLS or column change | any future room-table schema change | **FIX NOW** (cheap — the DDL exists; also folds in MP-G2) | MP-INV-12 |

### Tier B — verify against prod now (cheap), fix if confirmed

| ID | Gap | Location | Severity | Verdict | Protects |
|---|---|---|---|---|---|
| **MP-G6** | **Unapplied MP-adjacent migrations.** (a) `room_command_receipts` → `PGRST205` for anon *and service-role* (`2026-08-01_room_command_receipts.sql` likely unapplied) → `withGameActionIdempotency` silently degrades to the `room_shell.actionReceipts` embedded snapshot only; a shell-trim during a reconnect storm could drop a receipt and a replayed `game:action` double-applies. (b) **`mp_authority_events` → `PGRST205` too** (`2026-08-20_mp_authority_events.sql` unapplied) — found in the 2026-09-01 verification pass; the durable private-match funnel is dead, telemetry is `console.info`-to-stdout only (blast radius for MP-G5's measurability). Same drift class as T-1 / ghost tables / commit_glicko / the content-lifecycle RPCs. | `roomCommandReceiptStore`, `mpAuthorityEventStore`, `probeRoomCommandReceiptsTable` | player-visible-bug (latent, silent) + lost observability | **VERIFY NOW** (`select to_regclass(...)` + grants + `pg_publication` for both); apply if missing. `room_command_receipts` is already its own §2.7 follow-up; add `mp_authority_events`. | MP-INV-15 |
| **MP-G2** — **CLOSED 2026-09-01** | Client `INSERT/UPDATE/DELETE` grants existed on both room tables (RLS-gated only). | room-table grants | none today | **DONE** — `2026-09-01_room_tables_schema_and_grant_lockdown.sql` applied to prod; `assert_security_posture()` no longer flags either table, anon `INSERT` → `42501 permission denied for table`. | MP-INV-12 |

### Tier C — theoretical at current scale; revisit when traffic / instance count changes

| ID | Gap | Window | Severity | Why it's low now | Verdict | Protects |
|---|---|---|---|---|---|---|
| **MP-G5** | **Non-tournament terminal outcome is last-writer-wins.** `abandonedAt` and `state.gameOver` are both terminal; the later `persistRoomMatchLog` / `recordMatchEnd` overwrites (`on_conflict=match_id`). A rage-quit at the score screen, or a disconnect-timeout racing a real finish (MP-2), records the wrong terminal status / blames the wrong player. Tournament rooms are covered (RPC + `tournamentForfeitApplyStatus`); private/matchmaking are not. | MP-2 | player-visible-bug + minor data-corruption | **low, and not precisely measurable from here** (see §2.3.2): the purpose-built durable telemetry (`mp_authority_events`, `2026-08-20_mp_authority_events.sql`) is **not applied to prod** (`PGRST205`) so the intended signal path is dead; the funnel `console.info` lines go only to Render stdout (no query API here); `room_match_logs` (`on_conflict=match_id`) collapses a race to one row, but a scan for `status='abandoned' AND summary->>gameOver='true'` returned **0 rows**. Base rate: ~88 human-v-human matches ever, ~45 archived `abandoned` — the abandon *rate* is high but the overlap *window* (both terminal paths firing within the seconds `persistGameOverOnce` runs) is narrow, and nothing indicates it has fired. | one match's archive + matchmaking outcome + rating delta | **REVISIT IF SCALE** (was Tier A / FIX NOW — downgraded 2026-09-01 after finding 0 evidence and no measurement path). Step 3: a "first terminal outcome wins" latch for private/mm (mirror `tournamentForfeitApplyStatus`) whenever the terminal-outcome path is touched. | MP-INV-14 |
| **MP-G7** | Debounced `persistLiveRoomSessionNow` already in flight to PostgREST lands **after** `finalizeAndDeleteLiveRoomSession` → resurrects a terminal row with `status='playing'`. | MP-8 | player-visible-bug | needs an in-flight write at the exact finalize instant; the freshness fence should reject the stale hydration; next finalize re-deletes | **REVISIT IF SCALE** — Step 3 if cheap: a short-lived tombstone / `deleted_at` guard so a late upsert no-ops | MP-INV-11 |
| **MP-G8** | `preGameDrawTimer` is in-memory; a restart during the (seconds-long) pre-game high-draw window strands the room pre-start until a client re-triggers. | MP-5 | player-visible-bug | tiny window; client re-trigger recovers it | **REVISIT IF SCALE** — Step 3 if cheap: persist a `preGameDrawDeadline`, or fall back to immediate start on hydrate | MP-INV-13 |
| **MP-G9** | **No boot-time live-room recovery sweep.** A restart drops every in-memory `Room`; rooms recover **lazily** when a player reconnects and re-hydrates from `room_live_sessions`. If **neither** player of an in-progress match reconnects, the match is stranded — no archive, no result, no rating applied — and there is **no periodic stale-live-session reaper** to clean it up. Tournament rooms are covered separately by System 1's `reconcileExpiredReadyMatches`. | §2.1.8 | player-visible-bug ("my ranked game vanished with no result"); **not** corruption (the freshness fence rejects a stale hydration cleanly) | **restarts are more frequent than a dedicated box** (§2.3.2): deploy-driven, `main` took commits on 20 of the last 21 days (bursty — up to 58/day); prod is on `a93eea1e` (committed 11:36 PT) with `uptimeSeconds ≈ 20360` (~5.6 h) ⇒ ≥1 restart today. Free-tier *idle* spin-down is mitigated (T-17 pinger) but deploy restarts are not; Render crash logs aren't visible from here. Lazy hydration does handle the common case (someone reconnects). | **REVISIT IF SCALE** (was ACCEPT — upgraded 2026-09-01: restart frequency is real, currently more a heavy-dev artifact than a prod steady-state one). Step 3: pair with a **periodic stale-`room_live_sessions` reaper** (resolve/abandon a live row untouched for N minutes) rather than a boot sweep; document the lazy-hydration rationale in §2.4. | MP-INV-13 |
| **MP-G10** | `attachSocketToTrackedRoom` is **not lock-serialized** — the step 7/8/9 branch selection (reconnect-by-userId / hold-reclaim / new-seat) is a read-then-act on roster state. Two attach attempts for one identity (double-click reconnect, duplicate tab) can race. | MP-3 | player-visible-bug (double-allocated / zombie seat) | low–medium; mitigations exist (`inFlightHydrationByRoomCode`, migrate-before-teardown, `resolveActorSeatId` ownership check, step-8 reclaim) — but the branch choice itself isn't atomic | **REVISIT IF SCALE** — Step 3: consider a per-room attach lock (cheap, removes the class) | MP-INV-1, MP-INV-2, MP-INV-3 |
| **MP-G11** | A disconnect-grace timer callback already past its `stillConnected` + turn guards can still auto-`act` in the instant the player reconnects. | MP-4 | player-visible-bug | one turn; tight window between guard check and the locked `act` | **REVISIT IF SCALE** — Step 3 if cheap: re-check seat ownership *inside* the locked `act` the callback schedules | MP-INV-18 |
| **MP-G12** | Rematch / abandon vs the in-flight game-over persist is ordered by **polling `gameOverPersistStatus`**, not by awaiting the promise. A `game:rematch` or `room:abandon_match` mid-persist rests on the status being observed in time. | MP-1 | player-visible-bug (double-archive / a fresh game before persist settles) | low — the status gate covers the common path; `activeGameOverPersist` promise exists but isn't awaited here | **REVISIT IF SCALE** — Step 3: await the persist promise instead of polling | MP-INV-14, MP-INV-15 |
| **MP-G13** | **Two guest seats are indistinguishable on reconnect** — the roster match is `userId` **or** username/hold, and both guests have `userId=null`. A second guest who knows the room code and the first guest's display name can reclaim their seat. | §2.1.4 step 8 | auth-bypass (narrow) | low — private + unranked context, needs code + known display name | **REVISIT IF SCALE** — Step 3 if cheap: bind a guest seat to a per-connection hold token, not the username | MP-INV-2 |

### Tier D — anti-cheat posture decision (Step 2)

| ID | Question | Recommendation |
|---|---|---|
| **MP-G14** | Move-log verification is **non-blocking and hand-continuity-only**, run once at game-over; a failure suppresses Glicko but not the result or the `room_match_logs` archive (§2.1.9). Is that the right bar for a rated ladder? | Keep it non-blocking for the *result* (don't deny a legitimately-won game over a transcript hiccup), but in Step 3 add: (a) a **structured alert** on verification failure (the D-3 `*_conflict` pattern) so it's visible in prod, not just telemetry; (b) **per-user tracking** so repeated failures for one account surface. Not a code change this step — logged as MP-INV-19's resolution target. |

### Tier E — accept, no action

| ID | Item | Why accept |
|---|---|---|
| **MP-G15** | MP-6 — `nextHandStartsByRoom` coalescing map is in-memory; a rollback after an uncertain flush deliberately leaves `nextHandReady` populated for retry. | Deliberate design; the retry is the correct behaviour. |
| **MP-G16** | MP-7 — spectator publish can do a torn read of `room.state` while `act` mutates it. | Feeds only the read-only, masked spectator projection; the sequence-skip drops stale snapshots. Cosmetic. |
| **MP-G17** | `room_match_logs` participant-reads-own-**terminal**-rows (RLS `room_match_logs_select_own`). | Post-game, per-match-private data, readable only by a participant of that match. Deliberate and confirmed (§2.7 / D-8). Re-classify to a Tier-C item only if a concrete "why should the client not have this" emerges — none identified. |

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

Implemented exactly as designed above. **No prod migration applied.**

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

**Tier-A slice CLOSED 2026-09-01 (see §2.4.6).** MP-G1, MP-G2, MP-G3, MP-G4
implemented + tested; **both migrations applied to prod 2026-09-01 and verified**
(`assert_security_posture()` no longer flags the room tables; anon writes get a
grant-layer `42501`; both idempotency indexes built clean — `matches` had no
`roomMatchId` duplicates). MP-G3 is code-only and deploys with the next release.
The rest of §2.5 (Tiers B–E, deeper concurrency) is a later pass.

- [x] **MP-G3 — CLOSED (code).** Spectate room-kind gate + auth requirement —
  `e2ad401b`. Deploys with the next release (no migration).
- [x] **MP-G4 — CLOSED.** Idempotent game-over side-effect sinks (4 helpers +
  `2026-09-01_gameover_sideeffect_idempotency.sql`) — code `e2ad401b`; migration
  **applied to prod 2026-09-01** (self-assert passed; `matches` had 0 duplicate
  `roomMatchId` values, so `matches_room_match_id_uidx` built clean).
- [x] **MP-G1 + MP-G2 — CLOSED.** `2026-09-01_room_tables_schema_and_grant_lockdown.sql`
  **applied to prod 2026-09-01.** Verified: `assert_security_posture()` no longer
  flags either room table under `client_write_grant_rls_on`; anon `INSERT` →
  `42501 permission denied for table` (grant-layer denial, not just RLS).
- [ ] MP-G6 (Tier B) — verify `room_command_receipts` / `mp_authority_events` in prod
- [ ] Tiers C–E — later

## 2.6 Test plan

**Not started.** Step 5.

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
- [ ] **FOLLOW-UP ITEM (own line, lower urgency) — two MP migrations likely
  unapplied to prod (→ §2.3 MP-G6).** PostgREST returns `PGRST205` for both
  `public.room_command_receipts` (`2026-08-01_room_command_receipts.sql`) **and**
  `public.mp_authority_events` (`2026-08-20_mp_authority_events.sql`, found in the
  2026-09-01 Step 2 verification pass) — for anon *and* service-role. Effects:
  `withGameActionIdempotency` silently degrades to the `room_shell.actionReceipts`
  embedded snapshot only; the durable `mp.authority` funnel is dead (telemetry is
  `console.info`-to-stdout only — this is why MP-G5's frequency can't be
  measured). Same drift class as T-1 / ghost-tables / commit_glicko / the
  content-lifecycle RPCs. Verify in SQL editor
  (`select to_regclass('public.room_command_receipts'), to_regclass('public.mp_authority_events');`
  + grants / `pg_publication`), apply if missing.
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
  MP-G3 + MP-G4 code shipped (7 files, `e2ad401b`). `tsc -b` clean; full server
  suite 204/1173 pass; new idempotency + spectate-gate unit tests; server lint
  no new problems. **Both SQL migrations applied to prod 2026-09-01 and
  verified** (posture advisory cleared; anon write → grant-layer 42501; both
  idempotency indexes built clean). **MP-G1 / MP-G2 / MP-G4 CLOSED.** MP-G3
  deploys with the next release.
- [ ] Step 5 — Tests prove closure (§2.6)

---

# System 3: Daily modes

**Not started.** Daily Fritz, Puzzle Rush, Daily Puzzle Ladder — run
integrity, score authority (server-authored), leaderboard writes, share-result
verification, the async verification outbox.

---

# System 4: Everything else

**Not started.** Legacy league/tournament (`server/src/tournament/`,
`legacyTournament/`, `http/routes/league.ts` — decide: keep, wall off, or
delete), social/activity writer, ranking (Glicko) idempotency, spectator
registry.

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
| D-4 | 2026-08-31 | **RESOLVED — external uptime monitor on `/ping` every 5 min; stay on Render free tier for now.** No existing pinger was found or recoverable, so the human is setting up a **new** one (UptimeRobot or similar) → `https://racehorse.onrender.com/ping` at 5-min intervals. No code change: verified the scheduler's `setInterval` runs independently once the process is alive, so keeping the process warm is the whole fix. **`/internal/tick` stays unbuilt and unneeded** unless a future D-4 revision moves the scheduler off the web process (options b/c/e below, not chosen). The human is also setting `SERVER_URL=https://racehorse.onrender.com` in Render (confirmed currently unset via `GET /ready`) so the dormant internal 10-min self-ping activates as a redundant second signal. Rejected for now: (b) Render Cron Job / GH Actions cron, (c) `/internal/tick` + cron, (d) paid always-on plan, (e) split worker dyno — all revisited at upgrade time. **Outcome (2026-08-31):** an UptimeRobot monitor already existed but was mis-typed as ICMP Ping (Render doesn't answer ICMP → 6.5 % uptime, useless). Re-typed to HTTP(s) → `/ping` @ 5 min; human verified 100 % uptime / no gaps over the observation window → **T-17 CLOSED**. `SERVER_URL` set + redeployed; human confirmed `GET /ready` → `SERVER_URL: true`, self-ping now active as a second signal. | Cheapest option that fully addresses the "process is asleep" problem at current scale. The residual risk (a crash/deploy/OOM leaves the process down until the next ≤5-min monitor hit) is accepted. |

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
| 2026-09-01 | **System 2 — both Tier-A migrations applied to prod (human, SQL editor). MP-G1 / MP-G2 / MP-G4 CLOSED.** Both returned "Success. No rows returned" (self-assert `do` blocks passed → no `raise exception`). Agent verified read-only: `assert_security_posture()` → `hard_fail_count:0` and the `client_write_grant_rls_on` advisory **no longer lists** `public.room_live_sessions` or `public.room_match_logs` (both were flagged before); anon `INSERT` into `room_match_logs` → `HTTP 401 / 42501 permission denied for table` (grant-layer denial, was RLS-layer). Migration 2's `create unique index matches_room_match_id_uidx` built without error ⇒ **`public.matches` had zero duplicate `metadata->>'roomMatchId'` values** — the pre-fix double-write never actually occurred in prod (consistent with MP-G5's 0-evidence finding). §2.3 Tier-A header + MP-G2 row + §2.5 + §2.7 Step 4 + Current focus updated to CLOSED. **MP-G3 is code-only (`e2ad401b`) and deploys with the next release.** Remaining System 2: Step 5 (tests prove closure); MP-G6 (Tier B); Tiers C–E. |
| 2026-08-31 | **Step 3 sub-task: RPC surface decided (D-5) — three functions** (`complete` / `promote` / `generate`) + 3 helpers, not one dispatcher. §1.4.3 written with signatures, lock targets, callers, and the rationale. Also surfaced that **T-INV-6 is over-strict as ratified** — bracket correctness needs a match's two direct feeders complete, not the whole previous round; and that's already structurally enforced by `complete_tournament_match`'s conditional advancement. Reworded proposal in §1.4.3 flagged for human re-ratification (not silently changed). Next sub-task (authz layer shape) NOT started — stopping for human review. |
