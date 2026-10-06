# B4: a separate free Supabase project for dev, agents and e2e

Goal: production's database holds real players only, and nothing that runs
on a laptop, in a worktree or in an agent session can reach production keys.
Cost: $0. The dev project goes in a **new, separate free organization**
(`racehorse-dev`), because Supabase's free quotas (egress, database size, log
ingestion) are per organization: a dev project inside production's
organization would spend production's 5 GB of egress.

Who does what: **you** do the dashboard and key handling (steps 1, 2, 5, 6);
**I** can do the repo-side work you approve (step 7). Nothing in this doc has
been done yet.

---

## 0. Why (what writes to production today)

Every row below currently lands in production, because the local
`server/.env` and `client/.env` / `client/.env.local` hold production
`SUPABASE_URL` / keys (project ref `fisf…`):

| Source | What it writes to production |
|---|---|
| Local `npm run dev` (server + client), every worktree that copies `.env` | Rooms, `room_live_sessions` (≈ 360 dead guest rows a week), match logs, games |
| Agents using the e2e auth bypass (`E2E_DAILY_FRITZ_USER_ID`, non-production servers) | Daily Fritz attempts, ghost/Fritz completions, under one fixed user id |
| `server/scripts/multiplayerProcessRestartChaos.ts`, `authenticatedMultiplayerJourney.ts`, `dailyFritzAuthoritySoak.ts` | Throwaway auth users at `@racehorse-test.invalid` (618 exist today) |
| `client/.env.qa.local` QA account | Plays as a real account in production |
| Playwright e2e against a local server | Same as local dev |

CI is separate (§6): `gen-puzzles.yml` writes puzzles to production **on
purpose** and stays; `security-posture.yml` only reads; the Daily Fritz soak
is manual and targets the deployed server by design.

---

## 1. Create the dev project (you, dashboard)

1. Supabase dashboard → organization menu → **New organization**, named
   `racehorse-dev`, plan **Free**. Then, inside **that** organization →
   **New project**.
   - Name `racehorse-dev`, same region as production.
   - Save the database password in your password manager.
   - **Do not create it inside production's organization.** Supabase's
     billing docs: "The quota is applied to your entire organization,
     independent of how many projects you launch within that organization",
     and "Each organization has its own subscription"
     ([billing-on-supabase](https://supabase.com/docs/guides/platform/billing-on-supabase),
     read 2026-10-05). A separate organization gets its own free quota.
   - You may have two active free projects in total, as "two Free Plan
     organizations with one project each, or one Free Plan organization with
     two projects" (same page). Production plus this one is two. If another
     free project of yours is active anywhere, pause it first.
2. **Authentication → Providers → Email:** turn **off** "Confirm email" (dev
   accounts have no inboxes; this also avoids the 2-emails-an-hour limit).
3. **Authentication → URL Configuration:** Site URL `http://localhost:5173`,
   and add `http://localhost:5173/**` to Redirect URLs.
4. **Project Settings → API:** note the dev **Project URL**, **anon key** and
   **service_role key**. These are the only keys that go into local files from
   now on.
5. **Connect** (top bar) → copy the **session pooler** connection string for
   both projects. Keep them in the password manager, not in files.

## 2. Copy production's schema to dev (you, terminal; read-only on production)

Use a schema dump of production, not a replay of `supabase/migrations/`.
Production has documented drift from the migration files (missing tables,
unapplied functions; see `docs/ops/tournament-v2-preflight.md` §1), so a
replay would build a different database from the one the app actually runs
on.

Check versions first: in production's SQL editor run `select version();`.
`pg_dump` must be the same major version or newer. This machine has
`pg_dump` 16; if production says 17, `brew install postgresql@17` (free) and
use `/opt/homebrew/opt/postgresql@17/bin/pg_dump`.

In a terminal (the URLs are pasted at the prompt, not saved anywhere):

```sh
read -rs PROD_DB_URL   # paste production's session-pooler URL, press Enter
read -rs DEV_DB_URL    # paste dev's session-pooler URL, press Enter

# 1. Schema only, public schema, keeping grants and RLS policies (read-only on prod, ~1 MB)
pg_dump "$PROD_DB_URL" --schema-only --schema=public --no-owner \
  -f /tmp/racehorse-public-schema.sql

# 2. Reference data the app needs to render (read-only on prod, ≈ 10–15 MB egress)
pg_dump "$PROD_DB_URL" --data-only --no-owner \
  -t public.puzzle_pool -t public.daily_puzzles \
  -t public.daily_fritz_runs -t public.daily_fritz_published_challenges \
  -f /tmp/racehorse-reference-data.sql

# 3. Apply to dev
psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/racehorse-public-schema.sql
psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/racehorse-reference-data.sql

# 4. Clean up the copies and the variables
rm /tmp/racehorse-public-schema.sql /tmp/racehorse-reference-data.sql
unset PROD_DB_URL DEV_DB_URL
```

If step 3 errors on a `public` schema "already exists" line, re-run it with
the first `CREATE SCHEMA public` statement removed. Errors about the
`supabase_admin` role are harmless with `--no-owner`. Send me any other error.

Check in dev's SQL editor: `select public.assert_security_posture();` should
return `hard_fail_count: 0`, the same as production.

**Going forward, every new migration is applied to dev first, then
production.** There is still no migration runner, so both are pastes into the
SQL editor. Tournament v2 Phase 1's migrations will be tested on dev before
you apply them to production.

## 3. Create dev accounts (you or me, after step 4)

- Sign up your own dev account through the local app (no confirmation
  needed).
- For the e2e bypass: create one dev user (dashboard → Authentication → Add
  user, "Auto confirm"), and put its id in `E2E_DAILY_FRITZ_USER_ID` in the
  local `server/.env`.
- Recreate the QA account in dev and update `client/.env.qa.local` with the
  dev credentials.

## 4. Env vars to change (local files only)

| File | Variable | New value |
|---|---|---|
| `server/.env` | `SUPABASE_URL` | dev Project URL |
| `server/.env` | `SUPABASE_SERVICE_KEY` | dev service_role key |
| `server/.env` | `E2E_DAILY_FRITZ_USER_ID` (add if used) | dev user id from §3 |
| `server/.env` | `ENABLE_QA_TOURNAMENT_SEED`, `QA_TOURNAMENT_USER_ID`, `QA_ALLOW_NONLOCAL_STAGING` | dev values, or remove |
| `client/.env` and `client/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | dev URL and anon key |
| `client/.env.local` | `VITE_SERVER_URL` | Only if it's set to the Render URL: remove it (local dev already defaults to `http://localhost:3001`, `client/src/lib/gameServerUrl.ts`) |
| `client/.env.qa.local` | `DAILY_FRITZ_QA_*` | the dev QA account |
| every worktree (`../racehorse-dominoes-*`) | the same files | copy the dev versions; delete any old production copies |

Unchanged: Render's and Vercel's environment variables (production keeps its
own keys), and `server/.env.local` (Vercel KV tokens, unused by the code).

Check after switching: run the app locally, then in **production's** SQL editor
`select count(*) from public.room_live_sessions where created_at > now() - interval '1 day';`
should stop growing while you play locally. In **dev's** editor the same query
should grow.

## 5. Keep production keys away from agents (you)

The secret that matters is the **service_role key** (it bypasses RLS). The
anon key ships in the client bundle and is public by design.

1. **Production service_role key lives in exactly three places:** Render's
   environment, GitHub Actions secrets, and your password manager. Not in any
   file under the repo, a worktree, `~/Downloads` or a shell profile.
2. After §4, **rotate production's service_role key** (dashboard → Project
   Settings → API → JWT / API keys → roll). The old one has sat in local files
   that agents could read, so assume it's exposed. Then update Render's
   `SUPABASE_SERVICE_KEY` and the GitHub `SUPABASE_SERVICE_KEY` secret.
   Rolling the JWT secret also changes the anon key, so update Vercel's
   `VITE_SUPABASE_ANON_KEY` and redeploy the client. Check which kind of
   rotation your dashboard offers before you start: the newer separate API
   keys can be rotated one at a time.
3. **GitHub:** a workflow on any branch pushed to this repo can read
   repository secrets, and agents push branches. Move `SUPABASE_SERVICE_KEY`
   and `SUPABASE_URL` into a GitHub **Environment** named `production` with
   **required reviewer: you** and "deployment branches: `main` only". Then only
   `gen-puzzles.yml`, `security-posture.yml` and the manual soak reference it
   (`environment: production`). A branch with a modified workflow can't
   read it without your approval.
4. **Vercel CLI:** it's logged in on this machine and `vercel env pull` writes
   environment variables to a file. Keep the production service_role key out of
   Vercel entirely (the client needs only the anon key). Confirm with `vercel
   env ls` that no `SUPABASE_SERVICE_KEY` exists in the `racehorsedoms` or
   `racehorse-server` projects.
5. **Claude Code guard** (`~/.claude/settings.json`, or the project's
   `.claude/settings.json`) as a second line of defence:

   ```json
   {
     "permissions": {
       "deny": [
         "Bash(vercel env pull:*)",
         "Bash(vercel env add:*)",
         "Read(~/.config/racehorse-prod/**)"
       ]
     }
   }
   ```

   Deny rules are a speed bump, not a vault: §5.1–5.3 are the real protection.

## 6. CI after the switch (you)

| Workflow | Keeps production? | Note |
|---|---|---|
| `gen-puzzles.yml` | Yes | Production job by design; via the `production` environment |
| `security-posture.yml` | Yes | Read-only posture check; via the `production` environment |
| `daily-fritz-authority-soak.yml` | Manual only | Targets the deployed server; creates throwaway users in production. Run it only deliberately, or point `base_url` at a dev-backed server |
| `ci.yml`, `smoke-test.yml` | No production keys today | Unchanged |

## 7. Repo-side guards (me, $0, needs your approval)

Proposed as one small PR after the dashboard steps:

- The server refuses to start with `NODE_ENV !== 'production'` when
  `SUPABASE_URL` contains the production project ref (an env
  `PRODUCTION_SUPABASE_REF`, read only for this check), with a clear message.
- Scripts that create auth users (chaos, journey, soak) refuse the production
  ref unless run with an explicit `--allow-production` flag.
- `.env.example` files document the dev-project setup.

## 8. Things that change for you

- Local leaderboards, history and friends are empty in dev (no production
  data). Reference data (puzzles, Daily Fritz challenges) comes over in §2.
- The dev project pauses after a week without traffic. Resume it from the
  dashboard (free).
- Its egress, database size and log ingestion count against the
  `racehorse-dev` organization's own free quota, not production's.
- The restart chaos script for storage fix S1 runs against **dev**, never
  production. It creates and deletes throwaway users wherever `SUPABASE_URL`
  points.
