# Review stuck at "Analyzing 0 / 50" with the sweep on (2026-11-06)

## What was reported

`REVIEW_SWEEP_ENABLED=true` is set on Render and `/health` shows `"reviewSweep": true` (release includes #493). A Play vs Fritz game still shows "Analyzing game… 0 / 50 decisions" on the result card, and Game Review shows every move as "ANALYZING…". It never moves. So the flag was necessary but is not the whole cause.

## What I could and could not verify

I have no access to Render's environment, logs or the production database. Everything below about production is inferred from the code and the symptoms. I reproduced the failure mode locally by giving the sweep a store whose claim function fails exactly as PostgREST reports a missing function (`reviewCompletionWorker.missingFunction.test.ts`). I could not run a PostgREST server here, so I did not execute the SQL migrations against a database in this pass.

## The path a review takes, and where it can stall

1. The card enqueues a job (`POST /api/review-completion-jobs`). The row is written to `review_completion_jobs` and acknowledged. If the sweep is on, the enqueue "kicks" a sweep.
2. The sweep (`sweepReviewCompletionJobs`) lists claimable jobs with the database function `list_claimable_review_completion_jobs`, claims one with `claim_review_completion_job_v2`, renews its lease with `renew_review_completion_lease` and writes each result with `checkpoint_review_completion_job`.
3. Each position is searched in a worker thread (`server/workers/reviewSearchWorker.cjs`, which requires the built `@racehorse/review-engine`).
4. The card polls `GET /api/review-completion-jobs/:id` every 3-5 s and shows `scored / total`.

If step 2's first claim fails, the job sits at `pending` with 0 scored forever, and nothing looks wrong to the player. Before this PR that failure was caught in `sweepOnce`, logged at warn as "sweep pass failed — will retry", and never surfaced anywhere.

## Most likely cause (not proven)

`claim_review_completion_job_v2` and `renew_review_completion_lease` exist only in `supabase/migrations/2026-10-01_review_completion_worker_isolation.sql`. The owner applies SQL by hand, and that migration came out of the Sept 30 / Oct 1 outage work (#319 / #320). If it was never applied to production, the code merged with it (the store calls `claim_review_completion_job_v2` unconditionally) would fail every claim with PostgREST `PGRST202 Could not find the function`, which matches the symptom exactly: accepted, never claimed, 0 / N.

Other things that produce "0 / N" and what they would look like after this PR:

| Cause | Shows on `/health` `reviewSweepStatus` |
|---|---|
| A review function is missing (migration not applied) | `lastErrorCode: "rpc_missing"`, `database.missing` lists the functions |
| A table or column is missing | `lastErrorCode: "schema_missing"` |
| The service role cannot execute the functions (`2026-09-24_review_completion_rpc_permissions.sql` not applied) | `lastErrorCode: "permission_denied"` |
| The search worker thread cannot start (review-engine not built on deploy, worker file missing) | `lastErrorCode: "worker_failed"`; the job then fails after 5 attempts with exponential backoff, so the card ends at "Unavailable" rather than staying queued |
| The sweep is running but slow | `lastTickAt` recent, `lastErrorCode: null`, job `stage: "running"` |
| The sweep never ran | `ticks: 0`, `lastTickAt: null` |

## Environment variables on the review path

Only these are read from the environment; every other review setting is a constant in `packages/review-engine`.

| Variable | Default when unset | Effect |
|---|---|---|
| `REVIEW_SWEEP_ENABLED` | off | Must be exactly `true` or no sweep runs. |
| `REVIEW_COMPLETION_STORE` | durable (Supabase) | Only `memory` is special; never set it in production. |
| `REVIEW_COMPLETION_REQUIRE_DURABLE` | n/a | `1` makes a missing Supabase config fatal outside production. |
| `REVIEW_WORKER_MAX_OLD_GEN_MB` | 256 | Memory ceiling of the search worker thread. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | none | Required; production refuses the memory store. |

Constants (not env): lease 60 s, heartbeat 20 s, sweep interval 15 s (idle backoff 120 s), one decision at a time, 5 attempts per job with 30 s doubling backoff up to 15 min, 180 s per position.

There is no second "worker enable" flag, concurrency variable or cron switch that is off by default. The sweep is scheduled at boot when `REVIEW_SWEEP_ENABLED=true`.

## What this PR changes

- **`/health` now has `reviewSweepStatus`:** `ticks`, `lastTickAt`, `lastJobId`, `lastErrorCode`, `lastErrorDetail`, `lastErrorAt`, and `database` (the boot probe: `ok`, `missing[]`, `checkedAt`). Error codes only, never raw error text.
- **A boot probe** calls each review database function once with arguments that match no job (a nil UUID), so a missing function is named in the log and on `/health` within seconds of a deploy. It cannot change a row.
- **The sweep logs failures at error with the migration to apply**, not at warn as "will retry".
- **The job route reports `stage`** (`queued`, `running`, `complete`, `failed`), `waitingMs`, and `sweepError` (the last sweep error code, when it is newer than the job).
- **The card says "Queued" until a pass holds the job**, then "Analyzing". After 90 s with no progress it says the review is taking longer than expected and offers "Try again" (it re-kicks the sweep); when the server reports a setup error it says there is a setup problem on our side and that nothing is wrong with the game. Review Game and Skip stay available.
- **A stalled job is polled every 15 s** instead of every 3-5 s, since every poll reads the job row.

## Owner checklist

1. Deploy this PR, then open `https://racehorse.onrender.com/health` and read `reviewSweepStatus`.
2. If `database.missing` is not empty or `lastErrorCode` is `rpc_missing` / `schema_missing` / `permission_denied`: in the Supabase SQL editor apply, in this order, whichever of these are not applied yet (each is additive and safe to run twice):
   - `supabase/migrations/2026-09-23_review_completion_jobs.sql`
   - `supabase/migrations/2026-09-23_review_completion_jobs_claim_rpc.sql`
   - `supabase/migrations/2026-09-24_review_completion_rpc_permissions.sql`
   - `supabase/migrations/2026-10-01_review_completion_worker_isolation.sql`
3. Wait up to two minutes (the sweep ticks every 15 s), play a short game, and watch the card go Queued, then Analyzing with the count climbing. Reload `/health`: `ticks` should be growing and `lastErrorCode` should stop changing.
4. If `lastErrorCode` is `worker_failed`: check the Render build log ran the server's `npm run build` (its `prebuild` builds `@racehorse/game-core` and `@racehorse/review-engine`) and that `server/workers/reviewSearchWorker.cjs` is in the deployed files.
5. Keep watching `/ping` during reviews for the first day; if it slows, set `REVIEW_SWEEP_ENABLED=false` (the kill switch is unchanged).

## A note on 50 versus 51 decisions

The result card counts non-forced decisions (`totalDecisions - forcedCount`, 50 here), while Game Review's progress line counts every captured decision in its batch (51, including one forced move). Both are correct for what they count; they use different definitions. Not changed here.
