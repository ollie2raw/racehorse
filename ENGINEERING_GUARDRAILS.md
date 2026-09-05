# Engineering Guardrails

`HARDENING_PLAN.md` records what we found and decided, system by system.
This document records what now actually *prevents* the same bug **classes**
from recurring — so a future change doesn't need a fresh manual audit to
catch them again.

**Format:** one section per guardrail. Each states the rule, cites the
`HARDENING_PLAN.md` finding(s) that proved it necessary, and describes the
**real enforcement mechanism** — a CI check, a lint rule, a test — never
just stated intent. A guardrail with no enforcement yet is marked
**NOT YET BUILT** rather than implied to exist. Don't add a section here
for something we merely *decided to be careful about* — that belongs in
`HARDENING_PLAN.md`'s decisions log instead. A section only belongs here
once there's a mechanism, or an explicit plan to build one.

---

## 1. RLS/policy assertions

**Rule:** every RLS policy on a client-reachable table must be checked
against an expected, checked-in shape (roles, cmd, `qual`, `with_check`) —
not just "RLS is enabled" or "a policy exists with a reassuring name."

**Closes:** RK-0 (`HARDENING_PLAN.md` §8.1.7 / decisions log). A policy
literally named `"Service role can insert ranked games"` was scoped `to
public`, not `to service_role` — RLS was enabled, a policy existed, the
name asserted the right thing, and it was still a live, unauthenticated,
zero-skill exploit (forge a win for any player, inflate any rating). The
pre-existing `assert_security_posture()` check (built after an earlier
migration-drift incident) did not catch it, because it deliberately treats
"RLS on + a client write grant" as advisory-only, trusting the policy
predicates without ever inspecting them. RK-0 was found only because a
human ran a manual `select * from pg_policies` in the SQL editor.

**Enforcement — BUILT:**
- `supabase/migrations/2026-09-04_policy_manifest_rpc.sql` — a read-only,
  `service_role`-only RPC (`list_rls_policy_manifest()`) exposing
  `pg_policies` for the `public` schema over PostgREST (which cannot
  otherwise reach system catalogs).
- `server/scripts/checkPolicyManifest.ts` — fetches the live policy rows
  via that RPC and diffs them against `supabase/policy-manifest.json`.
  Extra, missing, or mismatched policies on a **pinned** table fail the
  build (`process.exitCode = 1`); a table with live policies but no
  manifest entry is reported as "unpinned" (visible in the run output) but
  does not fail — an honest, incremental-coverage design, not a claim that
  the whole schema is covered. The diff logic (`diffPolicyManifest`) is a
  pure function, tested independently of any live database connection.
- `.github/workflows/security-posture.yml`'s `policy-manifest` job runs
  `npm run check:policy-manifest --prefix server` on the same schedule as
  `assert_security_posture()` (Mondays 09:00 UTC + manual dispatch).
- **Negative test, not just "the script runs":**
  `server/src/checkPolicyManifestDiff.test.ts` reproduces the exact RK-0
  drift shape (a policy's live `roles` silently changed from
  `["service_role"]` to `["public"]`) against a fixture manifest and
  asserts the diff reports it — plus missing-policy, unexpected-policy,
  and role-order-doesn't-spuriously-fail cases.

**`matches` added 2026-09-05 as a direct result of a System 13 finding**
(`HARDENING_PLAN.md` §13.1.2): `matches_insert_participant`'s live
`with_check` permitted a registered-vs-registered win/loss forgery — a
policy that looked correctly scoped (require the caller to be a named
participant) and wasn't (nothing stopped a full forged claim against a
real other user), the exact RK-0 failure shape this guardrail exists to
catch structurally. Fixed same day
(`supabase/migrations/2026-09-05_matches_insert_guest_only.sql`,
pg16-verified) and pinned immediately rather than left to a future
manual pass — closing the loop this guardrail is meant to close: the
next accidental widening of this exact policy now fails CI automatically
instead of requiring another RK-0-style manual audit to catch it.

**Known limitation, stated plainly:** `supabase/policy-manifest.json`
currently pins 5 tables (`matches`, `ranked_games`, `rating_periods`,
`room_live_sessions`, `room_match_logs`) — every entry seeded from a
live, human-run `pg_policies` query or a decisions-log-recorded live
confirmation (D-8, RK-0), never guessed. The rest of the schema's policies
are live but unpinned — visible in every CI run's "unpinned tables" line,
not silently uncovered. Extending coverage means running the same query
for more tables and adding them, the same way these four were added.

---

## 2. No second implementation of shared logic

**Rule:** logic that must agree between two runtimes (client vs. server,
or two client code paths) lives in exactly one place — a shared package or
a single function — never reimplemented locally "for now."

**Closes:** the class of bug behind GC-3b (`HARDENING_PLAN.md` §7.3 — the
client's `botEngine.ts`/`openEndsGeometry.ts` re-implement board geometry
outside `@racehorse/game-core` rather than importing it), RK-3 (§8.3 —
`client/src/ranking/glicko2.ts` is a hand-maintained duplicate of the
server's Glicko-2 math, confirmed drifted on forfeit-outcome handling),
and RT-2's root cause (§9.1.14/§9.3 — the Ghost move-log builders
duplicated the "loop once per real draw" logic already correctly written
for the Daily Fritz transcript path a few lines away, and were never kept
in sync when that logic was hardened).

**Enforcement — BUILT (narrowed; see scope note):**
- `client/scripts/checkArchitectureInvariants.ts`'s **INV-16 — Shared
  Rating-Constant Parity**. A pure helper (`findDriftedRatingConstants`)
  diffs the `export const` declarations of `client/src/ranking/glicko2.ts`
  against `server/src/ranking/glicko2.ts`: every constant the client
  exports must be declared on the server with a byte-identical right-hand
  side. A client-only rating constant, or a value that drifted on one
  side, fails the build. This is the "periodic structural diff between the
  two glicko2 files" this section always proposed — the same idea as
  Guardrail #1's policy-manifest diff, applied to code.
- **Runs in CI** via the existing `check:architecture` step in
  `.github/workflows/ci.yml` (client job) — no new job, same aggregate
  verifier as INV-01…INV-15.
- **Negative test:** `client/scripts/checkArchitectureInvariants.test.ts`
  reproduces the RK-3 drift shape (`FRITZ_RATING` bumped on the client
  only), the client-only-constant shape, and the two clean cases
  (all-match, server-superset-is-fine) — asserting the diff catches the
  first two and stays silent on the rest.
- Verified against the repo as it stands: **0 drifted constants** — the
  two files carry the same 15 constants with identical values today.

**Scope narrowing, stated plainly.** INV-16 covers the *constant table*
half of the glicko2 pair, not the full guardrail. Two deliberate cuts:
- **The function bodies are not checked.** `computeGlicko2` and friends
  legitimately differ between the two files (RK-3: the client omits the
  server's forfeit-outcome override; the client exports a smaller function
  set). A body-hash or "same name and shape" check fails on the code as it
  stands today — it cannot be turned on without either false positives or
  first reconciling RK-3, which is a parked decision (§8.3). The constant
  table is the highest-signal slice that *is* clean, and a bumped Fritz
  rating or default RD is the most likely future drift.
- **The Ghost move-log ↔ Daily Fritz transcript pair (RT-2) is not
  covered here.** That was a semantic drift in "reconstruct omitted forced
  draws" logic between `server/src/ghost/verifier.ts` and
  `server/src/dailyFritzVerifier.ts` — two verifiers that are deliberately
  different in structure and evolve independently. No cheap static check
  catches a logic drift there without false positives or constant
  low-signal churn. It belongs with **Guardrail #4** (verifier-strictness
  parity, still NOT YET BUILT), which is about those same two single-player
  verifiers agreeing — fold RT-2's structural coverage into whichever
  shape #4 lands as.

The general case — "any client reimplementation of an exported
`@racehorse/game-core` function" (GC-3b) — is still not built; it needs a
mechanism more specific than "duplicate code" and hasn't been designed.

---

## 3. Idempotent writes only for anything feeding a rating/leaderboard

**Rule:** any code path that inserts a row feeding a competitive rating or
leaderboard (`ranked_games`, and anything with the same shape in the
future) must go through the idempotent insert wrapper
(`insertRankedGameIdempotent()`, `on_conflict=player_id,source_match_id` +
`ignore-duplicates`) — never a bare `supabaseFetch` POST.

**Closes:** RK-1 / RK-2 (`HARDENING_PLAN.md` §8.3) —
`fritzMatchLifecycle.ts`'s disconnect-loss recorder and
`ghost/service.ts`'s Fritz-branch completion both POSTed directly to
`ranked_games`, bypassing the idempotency wrapper; RK-2 specifically was
reachable through `gameOverPersistence.ts`'s retry-on-any-throw wrapper,
meaning an already-successful insert could be silently re-run by an
unrelated later failure in the same call.

**Enforcement — BUILT:**
- `client/scripts/checkArchitectureInvariants.ts`'s **INV-17 — Idempotent
  ranked_games Writes**. A pure helper
  (`findNonIdempotentRankedGamesWrites`) scans every non-test file under
  `server/src/` for a `supabaseFetch`/`fetch` call that targets
  `/rest/v1/ranked_games` **with `method: 'POST'`** — anywhere except
  `server/src/ranking/insertRankedGameIdempotent.ts` itself. Any hit fails
  the build and prints the offending call. Comments are stripped before
  the scan, so a `ranked_games` mention in prose (e.g.
  `account/routes.ts`'s deletion note) can't trip it.
- **Runs in CI** via the existing `check:architecture` step in
  `.github/workflows/ci.yml` (client job — the aggregate verifier already
  walks `server/src/`, as INV-11/INV-13 do).
- **Negative test:** `client/scripts/checkArchitectureInvariants.test.ts`
  reproduces the RK-1 shape (a direct `supabaseFetch<Row[]>('/rest/v1/
  ranked_games', { method: 'POST', … })` in a lifecycle file) and asserts
  it's caught; plus the wrapper-is-exempt case, the GET-read-is-fine case,
  and the comment-only-mention case.
- Verified against the repo as it stands: **0 flagged files** — the only
  POST to `ranked_games` today is the wrapper's own two call sites.

**Deviation from the spec above, stated plainly.** This section originally
called for flagging "any string literal matching `/rest/v1/ranked_games`
in a `supabaseFetch`/`fetch` call." Taken literally that also flags the
legitimate **GET** reads (`periodService.ts`, `http/routes/ranking.ts`,
`privateMatchResult.ts`) and the account-deletion cascade `DELETE` —
false positives. INV-17 is therefore scoped to **POST** (the insert verb),
which is the actual RK-1/RK-2 failure mode; reads and the deletion cascade
are not rating-feeding inserts and stay out of scope. An ESLint
`no-restricted-syntax` rule was the doc's other suggested shape — a
structural script was chosen instead because it lands in the same CI
verifier as Guardrails #1, #2, and #6 and needs no server-side lint step
(server lint does not run in CI today).

**Known limitation, stated plainly:** `findNonIdempotentRankedGamesWrites`
is a literal-string match — it fires only on a `supabaseFetch`/`fetch`
call where `/rest/v1/ranked_games` appears as a string literal *and*
`method: 'POST'` appears as a literal in the same call. A call that
computes the path (`` `/rest/v1/${table}` ``, a `RANKED_GAMES_PATH`
constant, a helper that appends the REST prefix) or that supplies the
method from a variable or expression (`method: verb`, `method: isInsert ?
'POST' : 'PATCH'`) would not be caught. This is the same shape of gap as
Guardrail #1's "pinned tables only" and Guardrail #6's "FKs that actually
target those two tables only" — the check covers the direct, obvious form
that RK-1/RK-2 actually took, not every syntactic way the same POST could
be expressed. A reviewer still has to catch an obfuscated insert; the
check catches the copy-paste one.

---

## 4. Verification-strictness parity across call sites

**Rule:** when the same verifier function is called from multiple sites
with different option flags (e.g. `strictHandContinuity`), that asymmetry
must be a **recorded, justified decision**, not a silent accident of one
call site being hardened and its sibling never revisited.

**Closes:** RT-2's actual shape (`HARDENING_PLAN.md` §9.3) —
`gameOverPersistence.ts`'s live-room call to `verifyPlayerMoveLog` passed
`{ strictHandContinuity: true }`; `http/routes/ghost.ts`'s standalone-mode
call passed no options at all (silently lenient) — not because standalone
mode had a different, still-valid reason for the leniency, but because
that call site was simply never updated when the live-room one was
tightened. The leniency's own doc comment claimed "legacy-only," which a
live-traffic replay check (root-causing RT-2) proved false — the gap was
still producing real, current mismatches.

**Design decision — the inverted default, not the comment rule.** Of the
two shapes this section weighed, the comment-requiring lint rule only
forces an asymmetry to be *documented*, not *corrected* — and a
rubber-stamp comment satisfies it while explaining nothing. RT-2 already
carried a doc comment ("legacy-only") and it was simply wrong. Inverting
the default flips who carries the burden: a call site is strict unless it
*visibly, deliberately* opts out with `{ strictHandContinuity: false }`,
which is a far more reviewable act than silently omitting an options bag.

**Enforcement — BUILT:**
- **The default is inverted.** `verifyPlayerMoveLog`
  (`server/src/ghost/verifier.ts`) now resolves
  `options.strictHandContinuity ?? true` — an omitted option means strict.
  `VerifyPlayerMoveLogOptions`'s doc comment states the inversion and that
  leniency is opt-out only. Both production call sites
  (`gameOverPersistence.ts`, `http/routes/ghost.ts`) already passed
  `{ strictHandContinuity: true }` explicitly, so this is behaviour-neutral
  for live traffic (RT-2's fix had already tightened the lagging call
  site). One test that deliberately exercises the legacy lenient path
  (`verifier.test.ts`, "collapsed two-draw turn") was updated to pass
  `{ strictHandContinuity: false }` explicitly — making its intent visible,
  which is the whole point.
- `client/scripts/checkArchitectureInvariants.ts`'s **INV-18 —
  Strict-by-Default Verifier Options**. A pure helper
  (`findLenientDefaultStrictnessOptions`) reads each pinned verifier file
  (`STRICT_DEFAULT_VERIFIERS`, currently just `verifyPlayerMoveLog`) and
  fails the build if the option resolves to a lenient default (`?? false` /
  `= false`) **or** has no explicit strict default at all (an option read
  with no `?? true` is implicitly lenient). This is the actual guardrail —
  the default alone is a convention a refactor could quietly flip back;
  INV-18 makes it stick.
- **Runs in CI** via the existing `check:architecture` step, same
  aggregate verifier as INV-01…INV-17.
- **Negative test:** `client/scripts/checkArchitectureInvariants.test.ts`
  covers the `?? true` and `{ = true }` accept cases, the `?? false`
  reject, the no-explicit-default reject, and the "not fooled by a
  `{ strictHandContinuity: false }` in a doc comment" case.
- Verified against the repo as it stands: **INV-18 passes** (1 verifier
  pinned, strict default present).

**Scope, stated plainly.** Only `verifyPlayerMoveLog.strictHandContinuity`
matches the `strict*`/`*Continuity` boolean-option shape today — a
full-repo scan of every exported `verify*` function turned up no other.
`verifyDailyFritzHand.requireStateDigests`
(`server/src/dailyFritzVerifier.ts`) is the RT-2-adjacent sibling flagged
in Guardrail #2's write-up. It is a different shape (`require*`, not
`strict*`/`*Continuity`) and it is **deliberately not added to
`STRICT_DEFAULT_VERIFIERS`** — investigated to conclusion 2026-09-05:

- **The asymmetry is real and RT-2-shaped.** `fritzChallenges.ts:407` and
  `:515` call `verifyDailyFritzHand` with no `requireStateDigests`; the
  Daily Fritz path pins it to `true` via the authority contract it writes
  at `/start` (`dailyFritzStartRoute.ts`, read back in
  `dailyFritzVerificationGlue.ts:640`). Root cause is a **copy-paste** —
  the Fritz-Challenge routes reuse the verifier but never ported the
  contract mechanism — not a considered "challenges don't need digests"
  decision. Nothing in the code justifies the gap.
- **Zero live exposure.** The Fritz-Challenge feature has never shipped
  past challenge-link generation: 17 `fritz_challenges` rows all `open`, 9
  `fritz_challenge_attempts` all `started` with `result: null`, one test
  account, last activity 2026-08-04. No hand has ever been verified through
  `:407`/`:515` in production. There is no "26/299"-style number to report
  because the denominator is zero.
- **Not independently exploitable even if activated as-is.** The server
  reconstructs authoritative state from `initialState` + transcript and
  enforces engine legality (`applyGameCommand`), Fritz policy parity
  (`chooseOfficialFritzDecisionForVersion` + `sameDecision`), actor
  ownership and mandatory-draw reconstruction regardless of digests, and
  derives the score from its own terminal state. `requireStateDigests` is
  defence-in-depth (earlier, cleaner `fritz_state_mismatch` diagnostics),
  not the sole gate. A present `preStateDigest` is still checked against
  the server recompute unconditionally (`dailyFritzVerifier.ts:404`).
- **Flipping the shared default is still wrong** regardless: Daily Fritz
  has deliberate lenient paths (`dailyFritzStartRoute.ts:294`
  `stateDigestRequired: !hasExistingEvidence`;
  `dailyFritzVerificationGlue.ts:293` `stateDigestRequired: false` in
  `pinAuthorityContractFromVerifiedTranscript`) for attempts that predate
  the authority contract. An unconditional `?? true` would strict-fail
  those resumes for real traffic (D-17 precedent).

Tracked as the sixth parked pool in `HARDENING_PLAN.md`'s "actual
remaining work" list. Fix when the feature is next touched: pass
`requireStateDigests: true` at the two call sites (justified by that
route's own hard current-client gate at `fritzChallenges.ts:281`), or port
the authority-contract pinning into its `/start`.

---

## 5. Staging/canary before 100% prod

**Rule:** a change should be verifiable against a smaller, lower-stakes
slice of traffic or environment before it reaches every player at once.

**Closes:** nothing yet — this is a structural gap, not a finding from a
specific `HARDENING_PLAN.md` row. It's listed here because every fix in
every system this plan has covered has shipped the same way: merge to
`main` → CI green → deploy → 100% of prod traffic, immediately. A bad fix
(or a bad migration, or a bad guardrail) has no smaller blast radius to
land in first.

**Enforcement — NOT YET BUILT AT ALL.** No code today ships anywhere but
straight to 100% prod. There is no staging environment, no canary/
percentage rollout, no feature-flag-gated deploy path, on either the
Render (server) or Vercel (client) side of this project. Flagged
explicitly as a known gap, not a false "coming soon" — building this is a
real infrastructure project (a second Render service + environment, or a
feature-flag system, or both), not a script, and hasn't been scoped.

---

## 6. Account-deletion cascade completeness

**Rule:** every table with a `user_id`/`player_id`-shaped foreign key
referencing `profiles(id)` or `auth.users(id)` must specify
`on delete cascade` — no exceptions without a recorded reason (a real
retention/audit requirement, written down, not just an omission that
happens to compile).

**Closes:** SA-6 (`HARDENING_PLAN.md` §11.1.5 / D-20) and **AD-1**
(`HARDENING_PLAN.md`, "Finding 2026-09-06" / D-24 — found by this
guardrail's own first prod run).

SA-6: `bot_match_pending` — an out-of-band table, added directly to prod
and only later reverse-engineered into a checked-in migration
(`2026-05-12_bot_match_pending_greenfield_baseline.sql`) — referenced
`profiles(id)` with no `ON DELETE` action at all (`confdeltype 'a'` /
NO ACTION, which blocks the delete exactly as `RESTRICT` would), while
every other player-owned table cascaded from `auth.users`. Confirmed live,
not just read from the DDL: `DELETE /api/account` (`account/routes.ts`)
500'd with a raw `23503` for any user with an unresolved pending match row
— the normal state for up to 30 minutes after starting *any* local
bot/Ghost/Fritz match. Fixed same day
(`2026-09-05_bot_match_pending_cascade_delete.sql`, pg16-verified).

AD-1: the same class, wider blast radius, found the moment this check first
ran against prod. `ghost_games.user_id` and `ghost_profiles.user_id` were
NO ACTION, not the `CASCADE` that `supabase/ghost.sql` and
`account/routes.ts`'s docstring both assert; `matches.winner_user_id` and
`matches.loser_user_id` were NO ACTION, not the `SET NULL` that
`supabase/schema.sql`, the same docstring, *and* ratified invariant SA-INV
(D-20) all describe. The applied DDL had never matched any of them — the
reference files are aspirational, and SA-6's own fix migration had
"spot-checked `ghost_profiles` against canonical DDL" against exactly that
wrong source. Result: `DELETE /api/account` 500'd for any user with a
Ghost profile, a Ghost game, or a completed multiplayer match — nearly
every established player. Reproduced live, fixed by
`2026-09-06_account_deletion_cascade_ghost_matches.sql` (pg16-verified,
human-applied, then re-verified live: check green, Ghost-cascade and
`matches`-SET-NULL both confirmed by follow-up query).

**Enforcement — BUILT:**
- `supabase/migrations/2026-09-05_cascade_delete_manifest_rpc.sql` — a
  read-only, `service_role`-only RPC (`list_cascade_delete_manifest()`)
  exposing `pg_constraint` over PostgREST (which cannot otherwise reach
  system catalogs). Returns one row per FK whose referenced table is
  `public.profiles` or `auth.users`: owning table, constraint name,
  constrained column(s), referenced table, referenced column(s), and
  `confdeltype` (`'c'` = CASCADE, `'r'` = RESTRICT, `'n'` = SET NULL,
  `'d'` = SET DEFAULT, `'a'` = NO ACTION). Same posture as
  `list_rls_policy_manifest()`: `SECURITY DEFINER`, pinned `search_path`,
  EXECUTE revoked from `anon`/`authenticated`/`public`, self-asserting
  lockdown block. pg16-verified.
- `server/scripts/checkCascadeDeleteCompleteness.ts` — fetches the live FK
  rows via that RPC and checks each: `confdeltype` must be `'c'`, unless
  the `(table, columns)` pair is in `supabase/cascade-delete-allowlist.json`
  with a recorded reason **and** the allow-listed `confdeltype` matches
  live exactly (an allow-listed FK whose live action drifts is a
  `wrong_action` finding — e.g. a `SET NULL` exception silently becoming
  `RESTRICT`). An allow-list entry that matches no live FK is a
  `stale_allowlist_entry` finding — a dropped/renamed constraint can't
  hide a regression behind it. Any finding fails the build
  (`process.exitCode = 1`). The diff logic (`diffCascadeDeleteManifest`)
  is a pure function, tested independently of any live database.
- `.github/workflows/security-posture.yml`'s `cascade-delete-completeness`
  job runs `npm run check:cascade-delete --prefix server` on the same
  schedule as the `policy-manifest` job (Mondays 09:00 UTC + manual
  dispatch).
- **Negative test, not just "the script runs":**
  `server/src/checkCascadeDeleteCompletenessDiff.test.ts` reproduces the
  exact SA-6 shape (a bare ownership FK, `confdeltype 'a'` — verified
  against pg16 that a clause-less FK yields `'a'`, not `'r'`) and asserts
  the diff catches it as `missing_cascade`; plus the explicit-`RESTRICT`
  variant, the allow-listed-exception-doesn't-fail case, the
  allow-listed-but-drifted case (`SET NULL` → `RESTRICT`), the
  stale-allow-list-entry case, and column-order insensitivity.

**Allow-list — the 5 recorded exceptions** (`supabase/cascade-delete-allowlist.json`),
each investigated with SA-6-level rigor (`SET NULL` cannot block a delete,
and each is a deliberate per-column choice in its own defining migration,
not an oversight):
- `matches.winner_user_id` / `matches.loser_user_id` (`SET NULL`) — a
  completed PvP match is a historical result record shared with the
  opponent; the opponent's match history survives one player's deletion.
  The exception this guardrail's write-up always named; ratified SA-INV /
  D-20.
- `fritz_challenges.opponent_user_id` (`SET NULL`) — the challenge is
  owned by `creator_user_id` (which cascades); the opponent is an invited
  participant, not the owner. Behaviorally verified live 2026-09-05:
  deleting the opponent leaves the creator's challenge intact with a null
  opponent.
- `daily_fritz_events.user_id` / `fritz_challenge_events.user_id`
  (`SET NULL`) — append-only telemetry logs. Their `attempt_id` /
  `challenge_id` FKs cascade, so a deleted user's attempt-linked events
  are removed via that chain; `user_id` SET NULL only anonymizes events
  with no attempt linkage (pre-attempt funnel telemetry). The same
  migrations set the sibling FKs to cascade explicitly.

**Known limitation, stated plainly:** the allow-list is `(table, columns)`
keyed and covers exactly the 5 FKs above; every other FK targeting
`profiles`/`auth.users` must cascade or the build fails. The check reads
only FKs that actually target those two tables — `text` columns that used
to be FKs (`scheduled_tournament_matches`'s player/winner columns, after
`2026-05-16_zz_tournament_bot_fill.sql`) and orphaned bare-uuid columns
(`ranked_games.opponent_id`) are outside its reach by design, the same way
`ranked_games`'s own account-deletion note in `account/routes.ts` already
documents. Those are a separate, non-blocking concern (an orphaned id that
no longer resolves to a profile), not the deletion-blocking concern this
guardrail exists for.

---

## 7. Version-stamped published artifacts: reuse, don't re-derive

**Rule:** a version-stamped artifact that is published ahead of its effective
date and frozen (content-addressed, immutable) must be **reused as-is** by the
serving path — never re-derived from the version constants that happen to be
live at serve time — and something must proactively detect a pre-generated
artifact that will fail on its effective date, on the day the invalidating
change ships rather than the day the calendar reaches it.

**Closes:** DF-STALE-1 (`HARDENING_PLAN.md`, "Incident 2026-09-05" / D-23). A
`daily_fritz_published_challenges` row was pre-generated a day ahead stamped
`FRITZ_POLICY_VERSION = 2`; an unrelated same-day deploy bumped the constant to
3 before the run date rolled over. `dailyFritzStartRoute.ts` then rebuilt the
challenge package under the *current* constant on every `/start`, and
`publish_daily_fritz_challenge`'s identity-conflict guard rejected the
re-derived v3 digest against the frozen v2 row — a `500` on every `/start` for
the day, even though the dealt hands were byte-identical. New bug class:
temporal staleness of a version-stamped published artifact, invalidated by an
unrelated later change.

**Enforcement — BUILT (both halves):**

**Behavioural half — reuse-first serving, pinned by INV-19:**
- The fix shipped for `/start` in `f37cf0ef`
  (`dailyFritzStartRoute.ts` fetches the already-published challenge and reuses
  it; `publishDailyFritzChallenge` is never called when a row exists). The same
  latent shape was then fixed in `scheduled/dailyWarmup.ts` (the nightly
  pre-generation, which re-visits [today, tomorrow] and so re-published each
  date under whatever constants were live — `warmOneDailyFritzRun` now
  `getDailyFritzPublishedChallenge`-first; also switched `Promise.all` →
  `Promise.allSettled` so one date's failure no longer skips the sibling) and
  in `dailyFritzAdminRoutes.ts` (`/invalidate` reuses an existing row instead
  of a materialising re-publish that would conflict on drift; `/generate`, the
  one deliberate non-reuse publish, now 409s cleanly on a pre-existing frozen
  row instead of letting the RPC 500 opaquely).
- `client/scripts/checkArchitectureInvariants.ts`'s **INV-19 —
  Reuse-First Published-Challenge Writes**. A pure helper
  (`findUnguardedPublishChallengeCallers`) fails the build if any non-test
  module calls `publishDailyFritzChallenge(` without also referencing
  `getDailyFritzPublishedChallenge` in the same file. Coarse (file-level, like
  INV-11/INV-13) on purpose: a new fourth call site added without the reuse
  check fails CI instead of waiting for a second incident. Runs in the existing
  `check:architecture` CI step. **Negative test:**
  `checkArchitectureInvariants.test.ts` covers the unguarded-caller flag, the
  reuse-first pass, the definition-module exemption, the no-call pass, and the
  test-file exemption. Verified against the repo: **3 caller files, all
  guarded** (`dailyFritzStartRoute.ts`, `scheduled/dailyWarmup.ts`,
  `dailyFritzAdminRoutes.ts`).

**Proactive half — `server/scripts/checkPublishedArtifactFreshness.ts`:**
- For every future-dated (`run_date >= today`) `daily_fritz_published_challenges`
  row it runs **the same validity oracle the serving path runs** —
  `toDailyFritzPublishedChallenge` + `assertValidDailyFritzPublishedChallenge` —
  and cross-checks that a `live` challenge has a matching `live`
  `daily_fritz_runs` row. Findings:
  - `unservable` (**fails the build**) — the stored row does not survive
    validation: `content_digest` no longer matches its `package`, a column
    disagrees with the package, `fritz_policy_version` has dropped below the
    current *min-supported* floor (GC-6 tolerates supported prior versions —
    only supported ones), `fritz_policy_contract` no longer resolves, a wrong
    generation / rules / seed / verifier / transcript-protocol stamp, malformed
    hand slots. Any of these 500s every `/start` once the calendar reaches it.
  - `orphaned_run` (**fails the build**) — a `live` future challenge whose run
    row is missing or itself `invalidated` (`/start` 409s).
  - `stale_tolerated` (**INFO, never fails**) — a `fritz_policy_version` behind
    current but still supported. The reuse-first path absorbs this; reported so
    the drift is visible on bump day. This is the DF-STALE-1 scenario itself.
  - `missing_published_row` (**WARN, never fails**) — a future `live` run with
    no published challenge yet (a warmup gap); `/start` self-heals by publishing
    on first call.
- `.github/workflows/security-posture.yml`'s `published-artifact-freshness` job
  runs `npm run check:published-freshness --prefix server` on the same schedule
  as the `policy-manifest` and `cascade-delete-completeness` jobs.
- The pure diff (`diffPublishedArtifactFreshness`) is tested independently of
  any live database (seven cases: clean, `stale_tolerated` non-failing, digest
  corruption, below-floor policy version, missing run, invalidated run,
  `missing_published_row` non-failing).
- **Verified against prod:** the check runs clean (exit 0). It correctly
  reports the still-present DF-STALE-1 row (`daily-fritz:2026-09-05:r2:s1`,
  `fritz_policy_version 2` vs current 3) as **`info:stale_tolerated`** — visible
  but not failing, because the shipped reuse-first fix makes it servable.

**Scope, stated plainly.** Daily Fritz's `daily_fritz_published_challenges` is
the only instance of the pre-generate → publish → serve-later pipeline in the
codebase. Puzzle Rush / daily-puzzle select live at run start (`config_version`
is a leaderboard tag, never re-verified). Scheduled tournaments pre-seed
brackets idempotently but stamp no version constant that is re-derived and
hard-compared. The **Fritz Challenge** feature has the identical class shape and
worse (its `/start` hard-equals the current `FRITZ_POLICY_VERSION`, no tolerance
path, and every open challenge row is already unstartable) — but its routes are
**unmounted dead code on `main`** (`HARDENING_PLAN.md`, FC-DEAD-1), so INV-19
and this detector are deliberately scoped to Daily Fritz; if the feature is
revived, the tolerance path is part of that revival, not this guardrail.
