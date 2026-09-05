# Guardrail #5 — staging / canary before 100% prod: Step-1 scoping

**Date:** 2026-09-05
**Status:** read-only investigation. No code, no migrations, no config changes.
**Trigger:** `ENGINEERING_GUARDRAILS.md` §5 — "a change should be verifiable
against a smaller, lower-stakes slice of traffic or environment before it
reaches every player at once." Marked **NOT YET BUILT AT ALL**; never scoped.

This doc exists so the scoping doesn't get lost (the way
`ranked_games.opponent_id` nearly did). It is decision-support, not a build
plan — **stop after reading, decide direction, then a separate Step-2 scopes
whatever is greenlit.**

---

## 1. Current deploy reality — confirmed, not assumed

### 1.1 What deploys, on what, from where

| | Server | Client |
|---|---|---|
| Platform | Render (`racehorse.onrender.com`) | Vercel (`playracehorse.com`) |
| Tier | **Free** — $0, 0.1 CPU / 512 MB, spins down at 15 min idle (mitigated by an UptimeRobot HTTP ping on `/ping` @ 5 min — T-17 / D-4). **Structurally single-instance**; free tier cannot horizontally scale. | Hobby / free (no evidence of a paid plan in-repo). |
| Deploy trigger | **Render's own Git integration**, auto-deploy on push to `main` that changes server *or* client code (doc-only pushes don't deploy). Confirmed by `HARDENING_PLAN.md` §5 and by `smoke-test.yml`'s "Wait for Vercel + Render to finish deploying" step. No `render.yaml` in the repo — deploy config lives in the Render dashboard, not IaC. | **Vercel's own Git integration**, auto-deploy on push to `main`. `vercel.json` at repo root (rewrites + headers/CSP). `.vercel/project.json` is present but **mislinked** — `projectName: "racehorse-server"` for what is the client SPA config; stale from a 2026-08-15 link, gitignored, harmless but worth a cleanup. |
| CI relationship | GitHub Actions `ci.yml` runs on **push to `main` AND `pull_request` → `main`** (full server + client validation, Playwright e2e, MP soak). CI is **not** the deploy mechanism — Render/Vercel deploy independently off their Git hooks. `smoke-test.yml` runs *after* a `main` push, sleeps 90 s, then curls prod `/healthz` `/ready` `/api/daily-fritz/today` + the live CSP header. **That is post-deploy detection, not a pre-deploy gate.** | same |
| Branch protection | Cannot be read from the repo. CI *runs* on PRs; whether a passing check is *required* to merge is a GitHub setting. Recent history (this plan's own commits, plus direct pushes `c29814bd..feefdb97`) shows **mostly direct-to-`main`**, with PRs used occasionally (#93/#94/#99/#107 in `HARDENING_PLAN.md`). |

### 1.2 Built-in pre-prod / rollout features already available on the current tiers

- **Vercel preview deployments — almost certainly already being produced, just
  not used as a gate.** When a Vercel project is connected via Git integration
  (which this one is — `.vercel/` link + no `npx vercel` in CI), Vercel builds a
  **preview deployment for every push to every non-production branch and every
  PR**, on **all tiers including Hobby**, at no extra cost. Each gets a unique
  immutable URL and (for PRs) a bot comment with that URL + a Lighthouse/checks
  summary. **What is NOT configured:** any expectation that a human opens the
  preview URL and exercises it before merge; any automated smoke against the
  preview URL; branch protection requiring it.
  → **Action item to confirm (human, ~2 min in the Vercel dashboard):** is the
  GitHub integration connected, are preview deployments enabled, do PRs get the
  preview comment? If yes, most of the client-side half of this guardrail is
  "turn on a habit," not "build infrastructure."
- **Vercel instant rollback** — "promote" any previous deployment to production
  from the dashboard/CLI, all tiers. Client rollback is genuinely one click and
  loses nothing (static assets; no server state).
- **Vercel percentage / canary rollout ("Rolling Releases")** — **not available
  on Hobby.** Pro/Enterprise only. Not an option here without a plan upgrade.
- **Render preview environments** — Render *does* have "Preview Environments"
  (per-PR ephemeral copies of a service) but they are a **paid-plan feature**
  and require `render.yaml`. Not available on free tier.
- **Render percentage rollout** — none. Render deploys are all-or-nothing per
  service; a new deploy replaces the running instance.

### 1.3 What a rollback looks like today if a bad deploy reaches prod

**Client (Vercel):** promote the previous deployment. Instant, stateless, safe.
Documented in `docs/production-observability-and-release-runbook.md` §4.

**Server (Render):** redeploy the previous commit (dashboard "Rollback to this
deploy", or push a revert). This is a **full process restart**, and on the free
tier's single in-memory instance that means **everything process-local is lost**:
the rate limiter, every in-memory lock (`withRoomGameplayLock`,
`withDailyFritzAttemptLock`), the `Room` maps for every live multiplayer game,
any fire-and-forget task, the tournament scheduler's in-process timers. Live
multiplayer games in progress are dropped (documented as a known beta limitation
in the runbook's "Live-Game Deploy Policy"). Rollback time is a Render build +
boot (~1–3 min) plus the ~15 s cold Supabase pool warm-up.

**Migration-involved rollback:** the runbook explicitly says *"Do not roll back
schema blindly if new rows may rely on new columns"* — i.e. a server rollback
after a migration is **not clean** and needs per-case judgement. This is exactly
the scenario the `RANKED_GAMES_*_COLUMN_ENABLED` flags were invented to make
survivable (server can run ahead of *or* behind the migration without failing).

### 1.4 Feature-flag maturity today (relevant to Option B)

Not "nothing," but uneven:

- **Server: a real, working runtime-toggle pattern already exists.**
  `server/src/config.ts` has `getEnvBool(KEY, default)` read once at boot into a
  frozen `config` object. Live toggles today: `TOURNAMENT_SCHEDULER_ENABLED`,
  `MP_DRAW_AUDIT`, `MP_DEBUG`/`DEBUG_MP`, `MATCHMAKING_DEBUG`,
  `ENABLE_REQUEST_PUZZLE_GENERATION`, `ENABLE_STARTUP_FRITZ_WARMUP`,
  `SOFT_GAME_INVARIANTS`, `DAILY_FRITZ_TRANSACTIONAL_COMMANDS`,
  `RANKED_GAMES_SOURCE_COLUMNS_ENABLED`, `RANKED_GAMES_OUTCOME_COLUMN_ENABLED`.
  The last two are **precisely the "gate new logic behind a runtime toggle
  defaulting OFF so a server running ahead of a migration doesn't 500"** pattern
  (`server/src/ranking/rankedGamePayload.ts:50,61` — the docstring says so
  outright). This is the generalizable pattern; it is currently applied
  ad hoc, per-need, with no manifest and no removal discipline (a flag added for
  a migration rollout tends to stay forever — e.g. `RANKED_GAMES_*` are still
  read from `process.env` directly, not folded into `config`).
- **Client: much thinner.** `PIVOTAL_REVIEW_WIZARD_ENABLED = false` is a
  **hardcoded `const`** in `matchRuntimeTypes.ts` — the "beta-gate flag file"
  the plan refers to is literally a source constant you edit and redeploy. Plus
  a couple of build-time env reads (`VITE_ENABLE_SPECTATOR_MODE`,
  `import.meta.env.PROD` for Sentry). No runtime client flags, no remote config.
  The client cannot toggle anything without a rebuild + redeploy.

**Verdict on "could the beta-gate pattern generalize":** the *server* one
already has — `RANKED_GAMES_*` is the proof. It's not too ad hoc to build on; it
just wants light formalization (a `config.featureFlags.*` namespace, a one-line
manifest comment per flag with "added for / remove when", and a rule that
migration-gate flags get deleted after the migration is confirmed everywhere).
The *client* `const` pattern does not generalize to a gate — it's redeploy-bound
— but the client rarely has the "risky new logic path" problem the server does.

---

## 2. Three concrete options — what each actually requires on *this* codebase

### Option A — Vercel preview deployments as a real pre-prod gate for client changes

**Likely state:** "already there, not used as a gate" — confirm §1.2 first.

**What it requires here:**
1. Confirm the Vercel↔GitHub integration is connected and previews are on
   (dashboard, ~2 min). Fix the mislinked `.vercel/project.json` while there.
2. A convention: client-affecting changes go through a PR, and the PR author (or
   reviewer) opens the preview URL and runs the relevant slice of the runbook's
   "Manual QA Gates" (§4) against it before merge. Zero code.
3. *(Optional, small)* extend `smoke-test.yml` into a PR-triggered job that curls
   the Vercel preview URL for the PR (the URL is available via the Vercel
   GitHub deployment status / the `vercel-deployment` context) and re-runs the
   same static checks it already does against prod — CSP header present, key
   routes return HTML not 500, `/assets` cache headers. ~30 lines of workflow
   YAML, no app code.
4. *(Optional, larger)* point the existing Playwright e2e suite at the preview
   URL on PRs instead of (or in addition to) the local dev server. The suite
   exists (`client/e2e`), already runs in CI against a local build; retargeting
   it at a live preview URL is a config change + secret wiring, not new tests.

**What it does NOT cover:** anything server-side. A client preview still talks to
**production** Render + **production** Supabase (there's one server, one DB), so
a client change that drives a bad server interaction is only "caught" to the
extent the preview exercise happens to hit it — against real prod data.

**Cost:** ~0 (habit + optional ~30 lines YAML). **Risk added:** none.

---

### Option B — formalize the server feature-flag pattern for gating new server logic

**What it requires here:**
1. A `config.featureFlags` namespace (or keep flat) — move `RANKED_GAMES_*` and
   friends behind `getEnvBool` into the frozen `config` object so every flag is
   read one way, in one place, at boot. ~1 file.
2. A manifest: a short block comment / `docs/feature-flags.md` listing each flag,
   default, "added for", and "remove-when" (migration confirmed / feature GA'd).
3. A convention: **new server logic that (a) depends on a not-yet-universal
   migration, or (b) is a materially new code path in a high-stakes handler
   (`record-game`, `/start`, rating writes, forfeit resolution) ships behind a
   flag defaulting OFF**, is enabled in prod as a separate step after the deploy
   is confirmed healthy, and the flag is deleted once stable.
4. *(Optional)* a `check:architecture` invariant that flags older than N days /
   past their "remove-when" condition fail the build — prevents the graveyard.

**What it does NOT cover:** it's a **staged-enable** mechanism, not a
**staged-audience** one — on a single free-tier instance, flipping the flag
still hits 100% of traffic at once. It shrinks the *time* a bad path is live
(you can flip it off in seconds without a redeploy) and the *blast radius in
code* (the old path still exists), but not the *fraction of users exposed*.

**Cost:** ~half a day to formalize + ongoing discipline. **Risk added:** minor —
a flag read is a branch; a mis-defaulted flag is its own footgun (mitigated by
"default OFF, enable deliberately").

---

### Option C — a second Render service as a server-side canary

**What it requires here:**
1. **A second Render web service** off the same repo, tracking `main` (or a
   `canary` branch). Free tier → it also spins down (so it's only "warm" when
   something pings it, i.e. it needs its own uptime ping); realistically a
   **Starter plan (~$7/mo, human to confirm current Render pricing) for
   always-on**. So: **real recurring cost**, first money this project spends.
2. **A DB decision, and neither answer is free of pain:**
   - *Same Supabase project:* the canary writes to **production tables**. A bad
     canary deploy corrupts real data. Defeats most of the point.
   - *Shadow Supabase project:* a second free Supabase project, its schema kept
     in sync by replaying `supabase/migrations/*`. Now you own **schema drift
     between two environments** (the exact failure class behind AD-1/SA-6 —
     see §3), plus seeding it with enough realistic data to exercise anything,
     plus keeping RLS/RPCs/`assert_security_posture()` mirrored. This is a
     standing maintenance burden.
3. **Env-var duplication:** `SUPABASE_URL/KEY`, `SENTRY_DSN` (separate canary
   project or it pollutes prod issues), `CLIENT_URL`, `SERVER_URL`, all the
   `*_ENABLED` flags, CORS origins — a second full env set to keep aligned.
4. **A traffic story:** nothing sends users to the canary. You'd either
   (a) manually smoke it after each deploy (then it's just a slower Option A for
   the server, against a fake DB), or (b) build routing to send a small % of
   real users to it — which needs a proxy / edge middleware Racehorse doesn't
   have and Vercel Hobby won't do percentage-route.
5. **Client CSP:** `connect-src` in `vercel.json` is pinned to
   `racehorse.onrender.com` — a canary host means a CSP edit (and a client
   redeploy) to even let the browser talk to it.

**Cost:** ~$7+/mo + meaningful setup + **permanent** two-environment maintenance.
**Risk added:** a second environment to drift, a second thing to break, and (if
same-DB) a new way to corrupt prod.

---

## 3. What each option would — and would not — have caught

Run against the three post-hardening incidents. **Two of the three are schema
drift, one is timing. None is "a new code path is subtly wrong," which is the
only class a canary is actually good at.**

### AD-1 (2026-09-06) — `ghost_*` / `matches` FK on-delete actions were NO ACTION, not the CASCADE/SET NULL every reference file claimed. `DELETE /api/account` 500'd for nearly every established player.

- **Option A (client preview):** **No.** Not a client bug; and account deletion
  isn't in the client QA gate list.
- **Option B (feature flag):** **No.** Nothing new was being *added* — the drift
  had existed in prod's applied DDL for months. No new code path to gate.
- **Option C (server canary):** **No, either way.**
  - Same-DB canary: identical schema → identical drift → no differential signal.
  - Shadow-DB canary: built from `supabase/migrations/*`, which are the
    *aspirational* files the applied prod DDL never matched — the shadow would
    have the *correct* CASCADE and the bug would be invisible there. It would
    have actively *hidden* AD-1.
- **What did catch it:** Guardrail #6's `list_cascade_delete_manifest()` RPC
  run against **prod's live `pg_constraint`**. A live-catalog assertion, not an
  environment.

### SA-6 (2026-09-05) — `bot_match_pending` referenced `profiles(id)` with no `ON DELETE` action; `DELETE /api/account` 500'd for anyone with an unresolved local match (normal for 30 min after starting *any* bot/Ghost/Fritz match).

- **Option A:** **No** — server + schema.
- **Option B:** **Partial, at best.** `bot_match_pending` was an *out-of-band*
  table added directly to prod, then reverse-engineered into a migration. If the
  discipline "new table → migration → verify FK actions" had been in force it
  might have been caught at creation — but that's a *migration-verification*
  discipline (Guardrail #1 territory), not a feature-flag one.
- **Option C:** **No**, same reasoning as AD-1 — same-DB sees the same bug with
  no signal; shadow-DB built from the (later-written, also-wrong) migration
  wouldn't reproduce it.
- **What did catch it:** reproducing `DELETE /api/account` live, then Guardrail
  #6's manifest check.

### DF-STALE-1 (2026-09-05) — a day-ahead pre-generated `daily_fritz_published_challenges` row stamped `FRITZ_POLICY_VERSION = 2` was stranded when an unrelated same-day deploy bumped the constant to 3 before the run date rolled over. Every `/start` 500'd.

- **Option A:** **No** — the failure is in the server `/start` path.
- **Option B:** **Marginal.** The *fix* (`dailyFritzStartRoute.ts` — reuse the
  published challenge, don't re-verify) could have shipped behind a flag; but
  the *bug* was a bare `FRITZ_POLICY_VERSION` bump with no gate, and the version
  bump wasn't the kind of change anyone would think to flag. A flag on the
  *reuse* logic doesn't prevent the incident; it just makes the eventual fix
  reversible.
- **Option C:** **Only under narrow conditions.** If the canary got the deploy
  first *and* someone (or a synthetic monitor) exercised `/start` on it during
  the window between the version bump and the run-date rollover, the 500 would
  show up there first. That requires the canary to have `/start` traffic
  (synthetic or real) and the timing to line up. Possible; not reliable.
- **What did catch it / would catch it next time:** the outage itself (real
  players), then Guardrail #7's `checkPublishedArtifactFreshness.ts` — a
  proactive check that runs the serving path's own validity oracle against
  future-dated rows, in `security-posture.yml`. Again: an assertion, not an
  environment.

### Summary table

| Incident | Class | Option A | Option B | Option C | What actually caught it |
|---|---|---|---|---|---|
| AD-1 | schema drift (prod DDL ≠ docs) | no | no | **no** (hides it) | live-catalog check (G#6) |
| SA-6 | schema gap (out-of-band table) | no | partial* | no | live repro + G#6 |
| DF-STALE-1 | temporal staleness of a version-stamped artifact | no | marginal | narrow/unreliable | outage, then proactive freshness check (G#7) |

\* "partial" only in the sense that a *migration* discipline would have helped —
not the feature-flag discipline itself.

**The pattern:** every real incident this plan has had was caught (or is now
prevented) by a **check that runs an assertion against live prod state** —
Guardrails #1, #6, #7. Not by a second environment. A canary is built for
"the new feature's happy path is broken," and this project's failure history is
overwhelmingly "the schema isn't what we think it is" and "a version constant
moved under a cached artifact."

---

## 4. Recommendation

**Cost-to-risk-reduction ranking for a small live product on free/cheap tiers:**

### Do now (near-zero cost, real value): Option A, minimally.
1. **Confirm** Vercel preview deployments are on and PRs get the preview comment
   (human, dashboard). Fix the mislinked `.vercel/project.json`.
2. **Adopt the habit:** client-affecting changes go via PR; open the preview and
   run the relevant runbook QA slice before merge. This is the one genuine
   "smaller slice before 100%" that this stack gives you for free.
3. **Optionally** add a PR-triggered workflow that curls the preview URL for the
   same static assertions `smoke-test.yml` already makes against prod (~30 lines).
   Retargeting Playwright e2e at the preview URL is a reasonable phase-2.

### Do opportunistically (low cost, ongoing discipline): Option B, light version.
- Fold the existing `process.env` flags (`RANKED_GAMES_*` especially) into the
  `config` object; write a one-screen `docs/feature-flags.md` manifest with
  "remove-when" per flag.
- **Convention, not tooling:** materially new logic in a high-stakes server
  handler, or logic depending on a not-yet-universal migration, ships behind a
  default-OFF flag and is enabled as a post-deploy step. The pattern is proven
  (`RANKED_GAMES_OUTCOME_COLUMN_ENABLED`); this just makes it the default reflex.
- This is a **staged-enable** safety valve (flip off in seconds, no redeploy),
  explicitly *not* a staged-audience one. Worth having for exactly that.

### Do NOT build now: Option C (server canary).
- **~$7+/mo of real recurring cost** (first spend on this project), plus a
  permanent two-environment maintenance burden (schema sync, env sync, seed
  data, RLS/RPC mirroring, CSP edits).
- **Would not have caught a single one of AD-1 / SA-6 / DF-STALE-1** — and for
  the two schema-drift incidents a shadow-DB canary would have actively *masked*
  the bug.
- No traffic-routing story on Vercel Hobby; without it, a canary is just a
  slower manual smoke against a fake database.
- **Revisit trigger:** move off Render free tier (multi-instance becomes real),
  **or** sustained load where "a bad deploy is live for 90 s before the smoke
  test fails it" is a material number of affected sessions — call it **~50+
  concurrent users at peak or ~1 deploy/day with real live-multiplayer usage**.
  Until then the blast radius of "bad deploy → smoke test red in ≤2 min → roll
  back" is small enough that the canary's cost/complexity isn't justified.

### The honest meta-point
The money and effort this guardrail would consume is **better spent where this
project's incidents actually come from**: pre-apply / post-apply migration
verification against the live catalog (Guardrails #1/#6 — largely done) and
proactive staleness detection for version-stamped artifacts (Guardrail #7 —
done). Guardrail #5 as "build a canary environment" is solving a problem this
codebase has not actually had. Guardrail #5 as "use the free Vercel preview you
already have as a gate, and make the proven server-flag pattern a reflex" is
cheap, proportionate, and closes the realistic version of the gap.

**Guardrail #5 verdict: not worth building a staging/canary *environment* at
this scale. Adopt Option A (habit + confirm the free feature) and Option B
(light formalization of the existing flag pattern) instead. Revisit the
environment question at the scale triggers above.**

---

## 5. Follow-ups if any direction is greenlit (Step 2 scope, not done here)

- **A:** human confirms Vercel preview state; fix `.vercel/project.json`; decide
  whether the PR-smoke workflow and/or Playwright-against-preview are in scope.
- **B:** enumerate every current `process.env.*_ENABLED` read, design the
  `config.featureFlags` shape, write the manifest, decide whether a stale-flag
  `check:architecture` invariant is worth it.
- **C:** only if greenlit despite the recommendation — price a Render Starter
  service, decide same-DB vs shadow-DB, scope the schema-sync mechanism.
- Unrelated small hygiene surfaced here: `.vercel/project.json` mislink;
  `RANKED_GAMES_*` flags read directly from `process.env` instead of `config`;
  the runbook's "Apply migrations in staging first" line is aspirational (no
  staging exists) and should be reworded to match reality.
