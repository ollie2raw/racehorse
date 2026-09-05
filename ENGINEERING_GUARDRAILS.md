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

**Known limitation, stated plainly:** `supabase/policy-manifest.json`
currently pins 4 tables (`ranked_games`, `rating_periods`,
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

**Enforcement — NOT YET BUILT.** Today this is caught only by manual
audit during a `HARDENING_PLAN.md` system pass (as GC-3b, RK-3, and RT-2
all were), not by anything automatic. No lint rule, dependency-cruiser
rule, or CI check currently flags a new local reimplementation of logic
that already exists in `@racehorse/game-core` or another shared module.
A real mechanism would need to be more specific than "duplicate code" —
e.g. a `dependency-cruiser` or ESLint rule forbidding client modules from
re-implementing functions with the same *name and shape* as an exported
`@racehorse/game-core` function, or a periodic structural diff between
`client/src/ranking/glicko2.ts` and `server/src/ranking/glicko2.ts` (the
same idea as this guardrail's own policy-manifest diff, applied to code
instead of policies). Not designed or built yet.

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

**Enforcement — NOT YET BUILT.** Both known instances were fixed in place
(§8.3 Step 3), but nothing stops a *third* direct-insert call site from
being added tomorrow. No ESLint `no-restricted-imports`/`no-restricted-
syntax` rule currently forbids `supabaseFetch('/rest/v1/ranked_games', ...)`
outside `insertRankedGameIdempotent.ts` itself. A real mechanism: an
ESLint rule (or a `dependency-cruiser` forbidden-path rule, matching the
pattern already used elsewhere in this repo for the verifier-file import
boundary, GC-4) that flags any string literal matching
`/rest/v1/ranked_games` in a `supabaseFetch`/`fetch` call outside
`insertRankedGameIdempotent.ts`. Not designed or built yet.

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

**Enforcement — NOT YET BUILT.** No mechanism currently catches a
verifier function being called with different strictness options from
different call sites without an accompanying comment explaining why. A
real mechanism would need to be specific to this shape — e.g. an ESLint
rule requiring every call to a function whose signature includes an
"options" bag with a `strict*`/`*Continuity`-style boolean to be
accompanied by an inline comment, or (cheaper, and arguably more honest)
a single source-of-truth default: make `strictHandContinuity` the
function's default (`= true`) rather than an opt-in per call site, so a
new call site is strict *unless it deliberately opts out* — inverting who
carries the burden of "did anyone remember to keep these in sync." Not
designed or built yet; worth deciding which of these two shapes before
either is built.

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

**Closes:** SA-6 (`HARDENING_PLAN.md` §11.1.5 / D-20). `bot_match_pending`
— an out-of-band table, added directly to prod and only later
reverse-engineered into a checked-in migration
(`2026-05-12_bot_match_pending_greenfield_baseline.sql`) — referenced
`profiles(id)` with no `ON DELETE` action at all (defaulting to
`RESTRICT`), while every other player-owned table in the schema
correctly cascades from `auth.users`. Confirmed live, not just read from
the DDL: `DELETE /api/account` (`account/routes.ts`) 500'd with a raw
`23503` Postgres error for any user with an unresolved (`resolved: false`)
pending match row — the normal state for up to 30 minutes after starting
*any* local bot/Ghost/Fritz match. Fixed same day, out of band from the
normal audit sequence, given the live/user-facing severity (same urgency
class as GC-5/RK-0) — `2026-09-05_bot_match_pending_cascade_delete.sql`,
pg16-verified against a disposable local Postgres instance before being
handed off for prod application.

**Enforcement — NOT YET BUILT.** SA-6 was caught by a manual, targeted
account-deletion-flow read during a `HARDENING_PLAN.md` system pass, the
same way RK-0/RK-3/RT-2 were each caught by a manual pass over their own
respective areas — nothing automatic flagged `bot_match_pending` as an
outlier before that. **Proposed mechanism, not yet built** (mirroring
Guardrail #1's own shape almost exactly): a script analogous to
`checkPolicyManifest.ts` — call it `checkCascadeDeleteCompleteness.ts` —
that queries `pg_constraint` (via a new read-only, `service_role`-only RPC
the same shape as `list_rls_policy_manifest()`, since `pg_constraint` is a
system catalog PostgREST cannot reach directly) for every foreign-key
constraint whose target is `public.profiles(id)` or `auth.users(id)`, and
fails the build if any such constraint's `confdeltype` is anything other
than `'c'` (cascade) — the exact column this session's own live pg16 test
of the SA-6 fix confirmed changes from `RESTRICT`'s default to `'c'` once
a migration adds the cascade action. A constraint that genuinely needs a
different behavior (e.g. `matches.winner_user_id`'s deliberate
`on delete set null`, which is not a `user_id`/`player_id`-shaped
ownership FK in the same sense — it's "this match happened, the player is
gone," not "this row belongs to the player") would need an explicit
allow-list entry with a recorded reason, the same honest
partial-coverage-by-design pattern `policy-manifest.json` already uses
for unpinned tables. Run on the same CI schedule as the policy-manifest
job (`.github/workflows/security-posture.yml`, Mondays 09:00 UTC + manual
dispatch) once built. Not designed further than this, and not built.
