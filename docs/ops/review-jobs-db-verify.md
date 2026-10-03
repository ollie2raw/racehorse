# review-jobs-db-verify

`scripts/review-jobs-db-verify.sh` is a **local-only** check of the review completion job RPCs, in particular `2026-10-01_review_completion_worker_isolation.sql`. It follows the same prod-safety boundary as `tournament-db-verify.sh`:
- It spins its own throwaway pg16 instance in a temp directory and deletes it on exit.
- It never reads `.env` files or Supabase URLs.
- It aborts (exit 2) if `PGHOST`, `DATABASE_URL` or a `SUPABASE_*_URL` points anywhere remote.

It is not in CI, because CI has no Postgres service.

```
brew install postgresql@16   # once
bash scripts/review-jobs-db-verify.sh
```

Exit 0 with `ALL CHECKS PASSED` means success.

## What it checks
1. **Greenfield apply.** The `review_completion_jobs` chain applies cleanly. Pre-fix `pending`/`running` jobs are retired as `failed_fatal` / `pre_isolation_outage`, and `complete` jobs are untouched.
2. **Due check at claim time.**
   - A job listed by a sweep and then pushed out (`next_attempt_at` moved forward) before the claim lands is **not** claimed. This is the 2026-10-01 `43da2288` re-claim.
   - A job with a live lease is not claimed, even by its own token.
3. **Claim effects.** A due job's claim sets attempt +1, generation +1, `lease = now + 60s` and `next_attempt_at = now + lease + backoff`.
4. **Backoff and attempt cap.** Backoff goes 30s, 60s, 120s, … and caps at 900s. At the attempt cap the job becomes `failed_fatal` / `max_attempts_exceeded` and is not claimed.
5. **Lease renewal fencing.** `renew_review_completion_lease` succeeds only with the matching token and generation, and only on a non-terminal job.
6. **Concurrent claims.** Two sessions claiming the same job serialize on the row lock: B blocks on A, and exactly one claim is recorded.
7. **Stale checkpoints.** A checkpoint from a superseded generation is rejected.
8. **Grants.** The new RPCs are executable by `service_role` only.
