# Racehorse Deployment Health Skill

Use this whenever pushing to production, changing environment variables, changing migrations, debugging Vercel/Render/Supabase issues, or investigating why production works differently than localhost.

## Goal

Keep Racehorse production deploys safe, predictable, and recoverable.

Racehorse production depends on:
- Vercel frontend
- Render Node backend
- Supabase database
- Supabase migrations
- Socket.io
- UptimeRobot keepalive

## Core principles

1. Vercel frontend can deploy successfully while Render backend is broken.
2. Render backend can deploy successfully while Supabase schema is missing a migration.
3. Supabase migrations must be applied before production code depends on them.
4. Cold starts can make the app look broken temporarily.
5. User-facing copy should say “Waking up game server,” not technical deploy/env errors.
6. Never assume production is healthy just because one platform says Ready.
7. Always verify frontend, backend, API, socket, and database together.

## Required pre-push checks

Before pushing production-impacting work, run:

git status --short
git diff --stat
npm run build --prefix server
npm run test --prefix server
npm run build --prefix client

Also check:
- Are migrations included?
- Are new env vars required?
- Are untracked files imported?
- Are Vercel and Render both building from main?
- Is Render branch set to main?
- Is Vercel branch set to main?

## Production health checklist

After deploy, verify:

1. Vercel latest deployment is Ready.
2. Vercel commit hash matches pushed commit.
3. Render latest deployment is Live.
4. Render commit hash matches pushed commit.
5. Backend health works:
   https://racehorse.onrender.com/ping
6. Key API works:
   https://racehorse.onrender.com/api/tournaments/upcoming
7. Frontend loads:
   production Vercel URL
8. Socket connects from frontend.
9. Daily Fritz loads.
10. Daily Puzzle / ladder loads.
11. Quick Match does not show backend unreachable after warmup.
12. Tournament page loads upcoming/current tournaments.

## Render cold start rules

If backend is slow/unreachable:
- First check /ping.
- Wait up to 60 seconds.
- Retry.
- Check Render logs if still failing.
- Do not assume frontend code is broken until backend health is verified.

User-facing copy should say:
“Waking up game server… The game server is starting up. This can take up to 60 seconds.”

Do not show:
- VITE_SERVER_URL
- Node server
- Render
- deploy instructions
- env var names

## Supabase migration rules

If a change adds or modifies:
- tables
- columns
- enum/check constraints
- functions
- seed logic
- tournament cadence/timing
- policies

Then:
1. Create a migration file.
2. Include it in the commit.
3. Say whether it must be applied manually in Supabase.
4. Verify production rows if needed.

Useful verification queries should be included in final report.

## Env var rules

If code requires a new env var:
- list exact name
- list where it must be set: Vercel, Render, or both
- say whether frontend env var needs VITE_ prefix
- say whether redeploy is required
- do not expose secrets in logs or screenshots

## Common failure patterns

Watch for:
- Vercel build fails because App.tsx imports uncommitted file
- Render build fails because server TypeScript/version mismatch
- Render runtime fails because missing env var
- Supabase query fails because migration not applied
- frontend points to wrong VITE_SERVER_URL
- backend CORS/socket origin rejects Vercel domain
- UptimeRobot keeps /ping warm but socket/API still fails
- old stale DB rows make production look broken

## Debug commands

Local:
git status --short
git diff --stat
npm run build --prefix server
npm run test --prefix server
npm run build --prefix client

Backend:
curl https://racehorse.onrender.com/ping
curl https://racehorse.onrender.com/api/tournaments/upcoming

Ports:
lsof -i :3001
kill <PID>
cd /Users/olivermorid/racehorse-dominoes/server
npm run dev

Frontend:
cd /Users/olivermorid/racehorse-dominoes/client
npm run dev

Browser cleanup:
localStorage.clear()
sessionStorage.clear()
location.reload()

## Final report format

Deployment Health Review

Change being deployed:
...

Frontend status:
...

Backend status:
...

Supabase/migration status:
...

Env vars:
...

Health checks:
...

Risks:
...

Manual verification:
...

Rollback notes:
...
