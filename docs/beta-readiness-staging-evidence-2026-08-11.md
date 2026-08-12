# Controlled-beta staging evidence — 2026-08-11

Environment: isolated Supabase staging project, local release-candidate server,
no production writes. Secrets and user data are intentionally omitted.

## Database ledger and authority

- New-format Supabase publishable/secret keys authenticated successfully with
  the existing REST/Auth scripts.
- Read-only production schema introspection was limited to approved ranking
  objects and `bot_match_pending`; no row data or writes were performed.
- Greenfield replay after the final ranking correction: **34/34 files applied**.
- PostgreSQL: **17.6**. Verification: **38 tables, 4 views, 16 functions**;
  missing tables/functions/columns/views: **none**.
- Ranked conflict target is now an unconditional unique index on
  `(player_id, source_match_id)`. Direct PostgREST proof: first insert returned
  one row in **223 ms**, identical replay returned zero rows in **208 ms**, and
  one authoritative row remained.
- Concurrent Daily Fritz CAS proof: exactly one writer committed revision 2,
  the other returned `stale_revision`, replay returned `replayed:true`, and the
  attempt remained `abandoned` at revision 2.

## Authenticated journeys

- Daily Fritz best-of-three: passed; two games (7 and 6 hands), 15 unique
  operation receipts, `/start` detected `needs_completion`, completion replayed,
  and a later start returned completed. 43 HTTP calls; max **1,410 ms**.
- Daily Puzzle five-slot ladder: passed; five unique slot rows, reload after
  every slot retained progress, completion replayed, and the final result was
  retrievable. 28 HTTP calls; max **1,205 ms**.
- Multiplayer restart/hydration (single room): passed; sequence 2 persisted,
  first post-restart join returned `hydrated`, second returned
  `already_in_memory`, seats were preserved, and sequence 4 persisted.
- Fritz Challenge database authority (two users): passed claim replay, two
  attempts, canonical get-or-create hand, duplicate hand CAS (`[1,0]` for each
  participant), and two completed attempt rows. The current RC does not expose
  the Challenge HTTP journey; branch inclusion remains a release-owner decision.

## Soak and restart evidence

- Daily Fritz authority: **25/25**, 0% errors; elapsed p50 **15.902 s**, p95
  **16.207 s**, p99/max **16.532 s**.
- Daily Puzzle authority: **25/25**, 25 authoritative slot rows, 0% errors;
  p50 **5.560 s**, p95/p99/max **5.740 s**; request p95 **2.067 s**.
- Multiplayer process-restart chaos: **25/25 before restart** and **25/25 after
  restart**, 0% errors. Before-restart p50 **7.953 s**, p95 **8.204 s**, max
  **8.272 s**. After-restart p50 **2.822 s**, p95 **3.934 s**, max **3.996 s**;
  all first joins hydrated sequence 2, all seats were preserved, and all durable
  rows advanced to sequence 4.
- Socket regression suite: **32/32** over two repetitions, zero errors;
  approximate p50 **0.94 s**, p95 **8.88 s**, max **9.54 s**.
- A zero-think-time full-game experimental load produced 22/25 completions and
  exposed stale synthetic-driver projections. It is not counted as a release
  pass; restart chaos above is the authoritative durability/load gate.

## Seven-day content

Manual publish plus independent REST readback returned **35 published rows**:
five slots for each date from 2026-08-11 through 2026-08-17. Every day had slot
indexes `1,2,3,4,5`; hand sizes followed the intended short-to-master curve.

## Health and monitoring

- `/health`: `ok:true`.
- `/ready`: `ok:true`; Supabase **182 ms**; room logs, Daily Fritz events,
  transactional Daily Fritz authority, and the five-slot ladder all healthy.
- No `SENTRY_DSN` or `VITE_SENTRY_DSN` is present in staging. Delivery is
  therefore **deferred safely**, not verified. To close it, provide separate
  staging server and browser DSNs, set release tags, redeploy both artifacts,
  and authorize one deliberate captured test exception from each.

## Release-candidate repository gate

- Server baseline: **103 test files, 582 tests passed**.
- Client baseline: **143 test files, 977 tests passed**. These are the actual
  test-discovery totals on this candidate; no tests were rounded up to the
  older planning estimate.
- Focused database/ranking regression gate: **18/18 tests passed**.
- Focused multiplayer durability gate: **4 files, 35/35 tests passed**.
- Server and client production builds passed, both multiplayer smoke scripts
  passed `node --check`, and `git diff --check` passed.
- The client build retained pre-existing warnings for a circular bot chunk,
  an unsupported CSS property (`room: recovery`), mixed dynamic/static
  `displayNames` imports, and a chunk larger than 500 kB. None was introduced
  by this release-candidate change set; they remain follow-up build hygiene.

## Explicit open items

1. Challenge HTTP/client branch inclusion is not decided in this candidate.
2. Ranking RLS/grants still allow overly broad `anon`/`authenticated`
   privileges behind permissive write policies; intentionally not changed.
3. The production-derived `bot_match_pending` table also has RLS disabled and
   broad grants; preserved for schema parity and requires a separate security
   decision.
4. Startup puzzle warmup logged one transient 8-second Supabase timeout during
   concurrent publication. Manual retry/readback completed all 35 rows, but
   alerting should watch warmup failures.

Rollback procedure: `docs/beta-rc-rollback-runbook.md`.
