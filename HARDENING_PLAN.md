# Racehorse Hardening Plan

A persistent, cross-session plan to bring the tournament and multiplayer systems
up to a standard comparable to how chess.com or Miniclip (8 Ball Pool) would run
them — scoped realistically to a solo founder + AI-agent team, pre-marketing.

**This document is the source of truth.** Any agent or person picking this up
cold should read the "How to use this document" section, then the "Current
focus" line, then the section for the system in progress.

---

## Current focus

**Tournament → Step 3 (state machine design): IN PROGRESS.**

- Step 1 (current-state audit): COMPLETE — §1.1, §1.3.
- Step 2 (invariants): **RATIFIED 2026-08-31** (Decisions D-3). T-INV-1..10 in
  §1.2 are the agreed list. Concurrency mechanism = Postgres transaction
  function RPC (D-2).
- Step 3 (state machine / concurrency design): match state machine (§1.4.2) +
  RPC surface decision (§1.4.3, D-5 = three functions) done — **awaiting human
  review**. Also flagged: **T-INV-6 needs a small re-wording** (over-strict as
  ratified — see §1.4.3). Remaining sub-tasks: **authz layer shape** (next),
  reconciler multi-instance (moot on free tier). Still one-step-per-session.
- **Infra / liveness (2026-08-31): D-4 RESOLVED, T-17 CLOSED.** Render = free
  tier (0.1 CPU / 512 MB, 15-min idle spin-down). Root cause of the stalls: an
  UptimeRobot monitor existed but was mis-typed as ICMP (Render ignores it).
  Re-typed to HTTP(s) → `/ping` @ 5 min; human verified 100 % uptime / 1 h.
  `SERVER_URL` set + redeployed for the internal self-ping as a second signal.
  **T-18 + T-19 = ACCEPTED RISK** at current scale, revisit at paid-tier
  upgrade. `/internal/tick` not built (unneeded). Orthogonal to the RPC work
  (§1.4.4).
- Step 4 (refactor): not started. First sub-task = review merged PR #91
  against the ratified invariants + RPC design (§1.4.x).

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

**T-INV-6 — Round gating.**
A round-*N* match may only leave `waiting` (to `ready`/`in_progress`) after
every round-(*N*−1) match of that tournament is `completed` or `bye`.
*Enforced by:* the promote-to-ready path is also an RPC (or the same one) that
checks the previous round inside the transaction; `RAISE EXCEPTION` otherwise.

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
| **T-1** | Client can INSERT/UPDATE its own `scheduled_tournament_registrations` row via the anon Supabase client, including `seed`, `status`, `placement`. `seed` decides the double-no-show tiebreak (`selectHigherSeedWinner`); `placement` is read back verbatim by `/api/tournaments/history` and `/:id/result`. | RLS policies `str_insert_self`, `str_update_self` in `2026-05-14_scheduled_tournaments.sql` | Self-assigned tournament placement / seed. Direct integrity breach. *(PR #91 migration addresses; unmerged, pre-audit — Decisions D-1.)* |
| **T-2** | `applyMatchResult` writes `params.winnerId` to `winner_id` with no check that it is a participant. Non-participant winner ⇒ `loserId` computes to `null` ⇒ nobody eliminated ⇒ a stranger advances into the next round as a real entrant. | `engine.ts` `applyMatchResult` (~466–489, `main`) | Corrupt bracket, wrong champion. *(PR #91 adds guard; unmerged.)* |
| **T-3** | Match completion is a read-then-write (`if (match.status === 'completed') return;`) with no DB-level CAS. Producers 1–3 (§1.1.3) can each pass the read and each run the completion + advancement sequence, second winner overwriting the first, bracket advanced twice. | `engine.ts` `applyMatchResult` (~465–551, `main`) | Double advancement, wrong winner carried forward, loser un-eliminated. *(PR #91's `completeMatchIfNotCompleted` addresses this one window; unmerged.)* |
| **T-4** | Bracket advancement (`applyMatchResult` steps 1–8, §1.1.4) is multi-statement with no transaction. Crash/overlap between steps leaves: match `completed` but winner never advanced; or next match with one slot filled and stale `status`; or loser eliminated but match not completed. | `engine.ts` `applyMatchResult` | Stuck bracket requiring manual DB repair (`docs/ops/tournament-apply-match-result-repair.md` already exists — evidence this happens). |
| **T-5** | `room:join` has no tournament-assignment ACL on `main`. Room code is guessable from the public bracket. An unassigned client takes the empty seat; on game over their `userId` becomes `winner_id` and advances. | `multiplayer/roomSocketAttach.ts` (`main`) | Bracket hijack by a non-participant. *(PR #91 adds the ACL; unmerged.)* |
| **T-6** | `roomForfeit` on `main` has no participant check: `winnerUserId = match.player1_id === uid ? player2 : player1`. A `null`/guest/non-participant leaver forfeits the match **to player1**. | `multiplayer/roomForfeit.ts` (~130, `main`) | A player who never left loses their match. *(PR #91 fixes; unmerged.)* |
| **T-7** | `generateBracket` idempotency is a read-then-write (`existingMatches.length > 0` early return) before 7 inserts. Two overlapping calls (two scheduler ticks; scheduler + a manual trigger) both pass the check; the `unique` constraint then rejects the duplicate inserts and `closeRegistrationAndStart` throws — tournament stuck in `registration_open`, never starts. | `engine.ts` `generateBracket` (~293–296) | Liveness: tournament fails to start. Integrity is saved by the unique constraint. |
| **T-8** | `updateRegistrationStatus` (eliminated/active/winner) is last-write-wins with no ordering guard. If a match is re-resolved (T-3/T-4) or the no-show reconciler and a real game-over disagree, a player's status can flip (`eliminated` → `active`, or a loser marked `winner`). | `engine.ts` (multiple call sites) | Wrong "you're still in" / "you won" state shown to players and written to history. |

### player-visible-bug

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-9** | No-show / forfeit / game-over all emit `tournament:match_completed` with `winnerSource` hard-coded to `'game_over'` in one branch regardless of the real source (`applyMatchResult` line ~497: `params.winnerSource ?? (params.byeWalkover ? 'game_over' : 'game_over')`). | `engine.ts` `applyMatchResult` emit block | Client shows "you lost" instead of "opponent didn't show" / "opponent forfeited". |
| **T-10** | `reconcileExpiredReadyMatches` runs off a 30 s poll. A match can sit `ready` up to ~30 s past `ready_deadline_at` before no-show resolves; two ticks overlapping a slow Supabase call can both enter the loop for the same match. | `scheduler.ts` tick + `engine.reconcileExpiredReadyMatches` | Delayed resolution; compounds T-3. |
| **T-11** | `fetchActiveAssignedMatchForUser` returns *the latest* of multiple `ready`/`in_progress` matches for a user when there is more than one — masking T-6 rather than preventing it, and can point a reconnecting player at the wrong match. | `persistence.ts` `fetchActiveAssignedMatchForUser` (~377 sort) | Player re-attaches to the wrong game after reconnect. |
| **T-12** | Two "tournament room" concepts: `cfg.tournamentId` (legacy league) vs `room.scheduledTournamentMatchId` (scheduled). `roomSession.broadcastStateUpdate` gates the game-over persist on `!isTournamentRoom` where `isTournamentRoom = Boolean(cfg.tournamentId)`. Reserved scheduled-tournament rooms are created **without** `cfg.tournamentId`, so they fall through the "private match" branch and are only re-routed to the tournament path *inside* `persistGameOverOnce`. Fragile; a future change to that gate silently breaks tournament result persistence. | `multiplayer/roomSession.ts` (~719, 736) + `matchDispatch.ts` (~139) | Latent: tournament results silently not persisted if the gate logic changes. |

### cosmetic / lower-risk

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-13** | `emitToUserIds` iterates **all** connected sockets for every emit (O(sockets) per event, several per completion). | `engine.ts` `emitToUserIds` | Fine at current scale; O(n²)-ish under load. |
| **T-14** | Heavy `log.info` on hot read paths (`fetchActiveAssignedMatchForUser` logs full candidate list every call; `registerTournamentAttachHandlers` logs `'accepted'` twice). | `persistence.ts`, `registerTournamentAttachHandlers.ts` | Log volume / cost. |
| **T-15** | No metric / alert on invariant violations (double advancement, `winner_id` not a participant, "no target match for advancement" warn). Detection is by reading logs after a player complains. | whole system | No early warning. |
| **T-16** | `scheduler.ts` no-show reconciliation is single-instance with only a code comment as the guard against multi-instance double-resolution. | `scheduler.ts`, `engine.reconcileExpiredReadyMatches` | Blocks horizontal scaling; silent double-resolution if scaled without the lease/lock. Note: **structurally moot on Render free tier** (D-2 addendum) — can't scale anyway. Keep for when we upgrade. |

### infrastructure / liveness — NOT fixed by the RPC design

Added 2026-08-31 after confirming Render = **free tier, 0.1 CPU / 512 MB,
spins down after 15 min of no inbound HTTP**. These are a **different failure
class** from the concurrency gaps: the RPC makes writes atomic, but a
transaction function is irrelevant if **the process is not running to call it**,
and a cold Supabase connection pool on 0.1 CPU makes even the RPC call slow and
timeout-prone.

| ID | Gap | Location | Risk |
|---|---|---|---|
| **T-17** — **CLOSED 2026-08-31** | **Free-tier spin-down stalled the scheduler and the no-show reconciler.** While the instance was spun down (no player connected, no HTTP), the `scheduler.ts` 30 s `setInterval` did not run — registration/bracket/dispatch/no-show all frozen until an inbound request cold-started a fresh instance, whose boot tick then caught up (status-guarded) but **late**. **Root cause of "no pinger":** an UptimeRobot monitor *did* exist but was configured as **ICMP Ping type**, which Render does not answer — it read "No Response" / ~6.5 % uptime and kept nothing warm. **Fix:** monitor changed to **HTTP(s) type → `https://racehorse.onrender.com/ping`, every 5 min**. Confirmed by the human: **100 % uptime, no gaps, over the following hour.** At 5-min cadence the instance never reaches Render's 15-min idle timeout, so the process stays alive and the 30 s tick runs continuously (verified: the tick needs only a live process, not a triggering request). **Second signal:** human reports `SERVER_URL=https://racehorse.onrender.com` set in Render + redeployed to activate the internal 10-min self-ping — *agent re-check of `GET /ready` still showed `SERVER_URL: false` (likely WebFetch's 15-min cache or deploy propagation lag); human to confirm it flips to `true`.* Primary closure rests on the confirmed HTTP monitor, not the self-ping. **Residual (accepted):** a process killed by deploy / crash / OOM stays down until the next ≤ 5-min monitor hit restarts it — bounded and acceptable. | `scheduler.ts`, external UptimeRobot monitor, Render plan | Closed by: UptimeRobot HTTP monitor on `/ping` @ 5 min (human-configured, outside repo) — 100 % uptime verified over 1 h. |
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
`SERVER_URL=https://racehorse.onrender.com` + redeployed as a second signal
(agent's `/ready` re-check still `false` — WebFetch cache / deploy lag; human
to confirm). Closure rests on the confirmed HTTP monitor.

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
| Registrations RLS lockdown migration (`2026-08-30_…`) | **Independent and correct.** Pure RLS; this *is* T-INV-9 / closes Gap T-1. No relationship to the RPC. | **Keep.** Verify it has actually run against production (merged ≠ applied — confirm the deploy ran the migration). |

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

### 1.4.2 Match state machine (Step 3 deliverable — awaiting human sign-off)

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
| T-d | `waiting` → `ready` | S (QF, at/after `scheduled_start`) **or** advancement tail (SF/Final, when the *second* feeder fills the last slot) | `promote_tournament_match` RPC (S) / `complete_tournament_match` RPC (advancement) | Guard: tournament `in_progress`, `now ≥ scheduled_start`, **every round-(N−1) match `completed`/`bye`** (T-INV-6), both player ids non-null. The Node dispatch layer then reserves the room + sets `ready_at`/`ready_deadline_at`. |
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

### 1.4.3 RPC surface — one vs. three (Step 3 sub-task, 2026-08-31)

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

**T-INV-6 correction (found while designing this):** the invariant as written
in §1.2 ("every round-(N−1) match `completed`/`bye`") is **stricter than
bracket correctness requires**. A round-N match only needs its **two direct
feeder matches** complete — SF1 (fed by QF1+QF2) can legitimately start while
QF3/QF4 are still playing. And that two-feeder condition is **already
structurally enforced** by `complete_tournament_match`'s advancement step
(`status = CASE WHEN <other slot> filled THEN 'ready' ELSE 'waiting'`). So:
- `promote_tournament_match` does **not** need a previous-round gate — SF/Final
  reach `ready` only via the completion RPC's conditional advancement, and
  round-1 has no previous round.
- **T-INV-6 should be reworded** to "a round-N match enters `ready`/`in_progress`
  only after both its feeder matches are `completed`/`bye`" — needs human
  re-ratification (small change, flagged in the message, not silently edited).
- The current code's `isPreviousRoundComplete` (whole-round check in
  `dispatchScheduledStartMatches` / bot-resolve) is a harmless conservative
  over-check; can be relaxed to the two-feeder condition or left as-is.

### 1.4.3b Still TODO after this (next Step 3 sub-tasks — NOT started)

- **The authz layer shape (§1.5)** — signature + one example call site for
  human review before applying to all 16 gaps. ← **next sub-task**
- **No-show reconciler multi-instance** (Gap T-16) — proposed: keep it
  single-instance-assumed but add `pg_try_advisory_lock` at the top of the tick
  so 2+ instances can't both scan/reconcile; defer a full lease table. Note:
  **structurally moot on free tier** (D-2 addendum) — carry for the upgrade.
- **`abandoned` match state?** — whether a match stranded past the tournament
  active window needs an explicit state rather than being left in
  `ready`/`in_progress` under a `cancelled` tournament.

### 1.4.4 How the RPC design interacts with the liveness gaps (T-17..T-19)

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

**TODO — after 1.4.** Each step will name the gap(s) it closes and the test
that proves it.

## 1.6 Test plan

**TODO — after 1.4.** Must include:
- A concurrency harness that fires producers 1–3 (§1.1.3) at one match
  simultaneously and asserts T-INV-1 (one completion), T-INV-2 (valid winner),
  T-INV-3 (idempotent/conflict-explicit), T-INV-5 (one advancement).
- A crash-injection test that kills `applyMatchResult` between each step and
  asserts recovery restores a consistent bracket.
- An invariant-assertion helper (`assertBracketConsistent(tournamentId)`) run
  at the end of every engine test.
- RLS tests proving the client cannot write `seed`/`placement`/`status`.

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

### Step 3 — State machine / concurrency design (IN PROGRESS)
- [x] Concurrency mechanism chosen and logged in Decisions — D-2
- [x] PR #91 (merged early) assessed against D-2 + invariants — §1.4.1
- [x] Match state machine drawn (states, transitions, trigger authority per producer) — §1.4.2 (shown to human 2026-08-31)
- [x] RPC rejection behaviour for invalid transitions specified — §1.4.2
- [x] `SELECT ... FOR UPDATE` lock targets identified + near-simultaneous-caller walkthrough — §1.4.2
- [x] One RPC vs. three decided — **three** (`complete` / `promote` / `generate`) + helpers — §1.4.3, Decisions D-5 (shown to human 2026-08-31; also surfaced a T-INV-6 wording fix for re-ratification)
- [ ] Authz-layer shape chosen — signature + one example call site shown to human — §1.5 ← **next sub-task**
- [ ] Multi-instance stance for the no-show reconciler chosen (note: moot on free tier)

### Step 4 — Refactor (not started; gated on Steps 2–3)
- [ ] T-1 …
- [ ] T-2 …
- [ ] T-3 …
- [ ] T-4 …
- [ ] T-5 …
- [ ] T-6 …
- [ ] T-7 …
- [ ] T-8 …
- [ ] T-9 …
- [ ] T-10 …
- [ ] T-11 …
- [ ] T-12 …
- [ ] T-13..T-16 (lower priority)
- [x] T-17 — **CLOSED** — UptimeRobot HTTP monitor on `/ping` @ 5 min (root cause was a mis-typed ICMP monitor; fixed to HTTP(s)). 100 % uptime verified over 1 h by the human. `SERVER_URL` set as a second signal (self-ping); `/ready` verification of that pending. — D-4, changelog 2026-08-31
- [ ] T-18, T-19 — **ACCEPTED RISK at current scale** (D-4 / §1.3). Not fixed now; revisit at paid-tier upgrade.

### Step 5 — Tests prove closure
- [ ] Concurrency harness (producers 1–3 → one match)
- [ ] Crash-injection / recovery test
- [ ] `assertBracketConsistent` helper wired into engine tests
- [ ] RLS write-denial tests for registrations

---

# System 2: Multiplayer rooms

**Not started.** Begins after System 1 Steps 1–3 are complete. Scope preview:
`server/src/multiplayer/**`, `server/src/rooms.ts`, `server/src/realtime/**`,
room lifecycle / seat allocation / reconnection / abandon / forfeit /
move-log verification / spectator attach.

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
| D-5 | 2026-08-31 | **RPC surface = three functions, not one.** `complete_tournament_match` (owns T-INV-1,2,3,4,5,10), `promote_tournament_match(p_to_status)` (`waiting→ready` / `ready→in_progress`), `generate_tournament_bracket` (T-INV-8), plus three non-Node-facing helper functions (`_tournament_is_participant`, `_tournament_canonical_scores`, `_tournament_advance_target`). Rejected: a single `tournament_match_command(match_id, command, args jsonb)` dispatcher. | Three small auditable transactions with explicit per-function lock targets and typed signatures beat one `CASE`-on-action function with a fat `jsonb` arg and runtime shape checks. Bracket *generation* is a different concern from match *state* and gets a different deployable object. Shared logic goes in the helper functions. |
| D-4 | 2026-08-31 | **RESOLVED — external uptime monitor on `/ping` every 5 min; stay on Render free tier for now.** No existing pinger was found or recoverable, so the human is setting up a **new** one (UptimeRobot or similar) → `https://racehorse.onrender.com/ping` at 5-min intervals. No code change: verified the scheduler's `setInterval` runs independently once the process is alive, so keeping the process warm is the whole fix. **`/internal/tick` stays unbuilt and unneeded** unless a future D-4 revision moves the scheduler off the web process (options b/c/e below, not chosen). The human is also setting `SERVER_URL=https://racehorse.onrender.com` in Render (confirmed currently unset via `GET /ready`) so the dormant internal 10-min self-ping activates as a redundant second signal. Rejected for now: (b) Render Cron Job / GH Actions cron, (c) `/internal/tick` + cron, (d) paid always-on plan, (e) split worker dyno — all revisited at upgrade time. **Outcome (2026-08-31):** an UptimeRobot monitor already existed but was mis-typed as ICMP Ping (Render doesn't answer ICMP → 6.5 % uptime, useless). Re-typed to HTTP(s) → `/ping` @ 5 min; human verified 100 % uptime / no gaps over 1 h → **T-17 CLOSED**. `SERVER_URL` set + redeployed for the self-ping second signal (`/ready` confirmation pending). | Cheapest option that fully addresses the "process is asleep" problem at current scale. The residual risk (a crash/deploy/OOM leaves the process down until the next ≤5-min monitor hit) is accepted. |

---

# Changelog

| Date | Change |
|---|---|
| 2026-08-31 | Document created. System 1 (Tournament) Step 1 current-state audit written. Steps 2+ open. Systems 2–4 stubbed. |
| 2026-08-31 | Added the "one step per session" rule to "How to use this document". Locked concurrency mechanism = Postgres RPC (D-2). Rewrote §1.2 as T-INV-1..10, framed as RPC/DB obligations, pending human sign-off. §1.4 now carries the locked decision only (state machine still TODO). |
| 2026-08-31 | Step 2 RATIFIED (D-3, four sign-off answers logged). T-INV-3 gains a structured-log requirement on the `conflict=true` branch. PR #91 merged early — added the ⚠ note to Current focus and §1.4.1 (assessed: `completeMatchIfNotCompleted` is superseded not conflicting; participant check duplicated; forfeit/room-join checks are authz not concurrency; RLS migration correct and independent). Step 3 started: §1.4.2 = match state machine — states, transitions, per-actor triggers, RPC rejection rules, and the near-simultaneous-caller lock walkthrough. Remaining Step 3 sub-tasks (one-vs-three RPCs, authz layer, reconciler multi-instance) not started. |
| 2026-08-31 | Infra check before continuing Step 3. Render confirmed free tier (0.1 CPU / 512 MB, spins down at 15 min idle) → D-2 addendum (structurally single-instance) + new **D-4** (open infra decision for the scheduler/reconciler liveness). Added §1.3 "infrastructure / liveness" tier: **T-17** (spin-down stalls scheduler + no-show reconciler; self-ping is conditional on `SERVER_URL` and can't revive a dead process), **T-18** (0.1 CPU / 512 MB marginal — timer drift, OOM, cold Supabase pool amplifies the stuck-bracket give-up), **T-19** (late/zero-width registration windows on wake). Evidence cited (commit `b49872ce` "post-wake API hangs", the boot catch-up tick comment, the ops-repair doc). §1.4.4 records that the RPC and the infra fix are orthogonal and both required. Step 3 continuation still paused. |
| 2026-08-31 | T-17 follow-up (before building any cron): **(a)** verified from code that `startTournamentScheduler`'s `setInterval` fires independently at 30 s once the process is alive (`bootstrapScheduledTournamentInfrastructure` runs inside `server.listen`) — so a plain uptime ping to `/ping` fully restores catch-up; `/internal/tick` is **not needed** unless D-4 moves the scheduler off the web process. **(b)** searched the repo for an existing external pinger — **no committed config**, `smoke-test.yml` is push-triggered not cron, and health routes don't log requests, so **cannot verify from the repo**. Two "T-17 follow-up" notes added to §1.3 listing exactly what the human must check (Render metrics, UptimeRobot/cron-job.org accounts, max-gap < 13 min, point it at `/ping` not `/healthz`). T-17 stays OPEN pending that check. No `/internal/tick` endpoint added. Step 3 continuation still paused. |
| 2026-08-31 | Human confirmed: no existing pinger; setting up a new external uptime monitor on `/ping` @ 5 min (option a). **D-4 RESOLVED** — external monitor, stay on free tier, `/internal/tick` unbuilt. Checked prod `GET /ready`: **`SERVER_URL` is NOT set** in Render (self-ping has been inert all along) — human is setting it as a second signal. `/ready` also shows `ADMIN_SECRET`, `CLIENT_URL`, `DAILY_PUZZLE_CRON_SECRET` unset — noted for a later env-hygiene pass, out of scope here. **T-17 → MITIGATED** (human owes first-hour steady-state verification before CLOSED). **T-18 + T-19 → ACCEPTED RISK** at current scale, revisit at upgrade. Step 3 continuation still paused. |
| 2026-08-31 | **T-17 → CLOSED.** Actual root cause identified: an UptimeRobot monitor **did** exist but was set to **ICMP Ping type**, which Render never answers → it showed "No Response" / ~6.5 % uptime and kept the instance warm zero percent of the time. (So the earlier "no pinger found" was half-right — the repo had no config *and* the external monitor was non-functional.) Fixed to **HTTP(s) type → `/ping` @ 5 min**; human verified **100 % uptime, no gaps, over 1 h**. Human also set `SERVER_URL=https://racehorse.onrender.com` in Render + redeployed for the internal self-ping as a second signal — agent's `GET /ready` re-check still returned `SERVER_URL: false` (WebFetch 15-min cache or deploy lag); human to confirm it flips to `true`. Closure rests on the confirmed HTTP monitor. |
| 2026-08-31 | **Step 3 sub-task: RPC surface decided (D-5) — three functions** (`complete` / `promote` / `generate`) + 3 helpers, not one dispatcher. §1.4.3 written with signatures, lock targets, callers, and the rationale. Also surfaced that **T-INV-6 is over-strict as ratified** — bracket correctness needs a match's two direct feeders complete, not the whole previous round; and that's already structurally enforced by `complete_tournament_match`'s conditional advancement. Reworded proposal in §1.4.3 flagged for human re-ratification (not silently changed). Next sub-task (authz layer shape) NOT started — stopping for human review. |
