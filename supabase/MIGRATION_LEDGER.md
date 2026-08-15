# Supabase migration ledger

This document is the human-readable companion to the machine-readable source of truth, [`migration-ledger.json`](./migration-ledger.json). The order below is application order; filename sorting is not authoritative.

Validate the ledger and this document together with:

```bash
npm run check:migrations
```

Apply it only to a disposable database first:

```bash
DATABASE_URL='postgresql://...' node scripts/apply-migration-ledger.mjs
```

The runner uses `psql`, stops on the first SQL error, and executes `supabase/verify-application-schema.sql` after the final migration. It refuses a production-looking URL unless `ALLOW_PRODUCTION_MIGRATION=true` is explicitly set. Production application still requires the human approval checklist in `IMPLEMENTATION_CHECKLIST.md`.

## Status and schema-source policy

- This ordering is `LOCALLY-VERIFIED` by static contract checks. It is **not** proof that the ledger has been applied to PostgreSQL; database application is currently `CODE-COMPLETE, NOT LOCALLY-VERIFIED (blocked: no database target)`.
- Base files establish a fresh database in the exact order below.
- Timestamped files are the durable historical upgrade path and run after all base files, in the exact order below.
- New deployed changes must be added as timestamped migrations. Do not rewrite an already-applied migration to repair production.
- A base file may contain a consolidated snapshot of objects also introduced by historical migrations. On a fresh database, the base definition is created first and the later migration's final `ALTER`, `CREATE OR REPLACE`, or replacement constraint wins. On an existing database, only unapplied timestamped migrations should run; base files must not be rerun as upgrades.
- `supabase/daily_puzzle.sql` is destructive because it drops `daily_puzzles`. It is fresh-install-only.

## Base files — fresh database only

| Order | File | Purpose |
|---:|---|---|
| 1 | `supabase/schema.sql` | Core profiles, rankings, stats, ranked-game support, and shared application schema. |
| 2 | `supabase/friends.sql` | Friend relationships, accepted/pending social state, and related policies. |
| 3 | `supabase/ghost.sql` | Ghost profiles/games and ghost-mode persistence additions. |
| 4 | `supabase/league.sql` | League persistence and policies. |
| 5 | `supabase/daily_puzzle.sql` | Destructive fresh-install baseline for the original Daily Puzzle publication table. |
| 6 | `supabase/daily_puzzle_v2.sql` | Daily Puzzle v2 publication columns, indexes, and policies. |
| 7 | `supabase/daily_puzzle_ladder_v1.sql` | Ladder publications, attempts, slot results, indexes, and policies; its historical completed-count constraint is superseded later. |
| 8 | `supabase/daily_fritz.sql` | Consolidated Daily Fritz runs, attempts, events, publications, authority primitives, views, and policies baseline. |
| 9 | `supabase/verified_matches.sql` | Verified single-player match records required by transactional Daily Fritz completion. |
| 10 | `supabase/fritz_challenges.sql` | Fritz Challenge records, attempts, hands, policies, and legacy RPC baseline. |
| 11 | `supabase/room_live_sessions.sql` | Durable live multiplayer room snapshots. |
| 12 | `supabase/room_match_logs.sql` | Archived terminal multiplayer room logs. |

## Timestamped migrations — fresh and historical databases

| Order | Migration | Purpose |
|---:|---|---|
| 1 | `supabase/migrations/2026-05-13_matchmaking.sql` | Add matchmaking match persistence. |
| 2 | `supabase/migrations/2026-05-14_scheduled_tournaments.sql` | Add scheduled tournament tables, indexes, and policies. |
| 3 | `supabase/migrations/2026-05-14_auto_seed_tournaments.sql` | Add scheduled tournament seed-window functions. |
| 4 | `supabase/migrations/2026-05-16_tournament_cadence_30_minutes.sql` | Replace tournament cadence with a 30-minute schedule. |
| 5 | `supabase/migrations/2026-05-16_tournament_match_dispatch_fields.sql` | Add tournament dispatch and deadline fields. |
| 6 | `supabase/migrations/2026-05-16_tournament_registration_placements.sql` | Add registration placement data. |
| 7 | `supabase/migrations/2026-05-16_zz_tournament_bot_fill.sql` | Add tournament bot-fill state and functions. |
| 8 | `supabase/migrations/2026-05-17_tournament_registration_close_2_minutes.sql` | Replace registration timing with the final two-minute close policy. |
| 9 | `supabase/migrations/2026-06-17_ranked_games_source_idempotency.sql` | Add source-bound idempotency to ranked games. |
| 10 | `supabase/migrations/2026-06-30_commit_glicko_game_update_rpc.sql` | Add the transactional Glicko update RPC. |
| 11 | `supabase/migrations/2026-07-31_daily_fritz_events.sql` | Add the durable Daily Fritz event journal and initial metrics projection. |
| 12 | `supabase/migrations/2026-08-01_daily_fritz_published_challenges.sql` | Add immutable, versioned Daily Fritz publications and mutation guards. |
| 13 | `supabase/migrations/2026-08-01_daily_fritz_command_primitives.sql` | Add attempt revisions, durable operations, verified hands/games, and outbox primitives. |
| 14 | `supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql` | Add transactional Daily Fritz start and commit RPCs. |
| 15 | `supabase/migrations/2026-08-01_daily_fritz_canonical_telemetry.sql` | Replace/extend Daily Fritz outbox projection and operational views with the canonical taxonomy. |
| 16 | `supabase/migrations/2026-08-02_daily_fritz_finalize_instant_skunk.sql` | Replace command completion logic to finalize instant-skunk attempts transactionally. |
| 17 | `supabase/migrations/2026-08-02_daily_fritz_outbox_attempt_scope.sql` | Replace outbox idempotency with attempt-scoped uniqueness. |
| 18 | `supabase/migrations/2026-08-02_fritz_challenge_authority_primitives.sql` | Add Challenge revisions, durable operations, verification records, outbox, and command RPCs. |
| 19 | `supabase/migrations/2026-08-02_fritz_challenge_canonical_telemetry.sql` | Add canonical Challenge event projection and operational views. |
| 20 | `supabase/migrations/2026-08-02_multiplayer_live_room_authority.sql` | Add multiplayer room CAS and durable command-receipt primitives. |
| 21 | `supabase/migrations/2026-08-03_fritz_challenge_recipient_invites.sql` | Add designated Challenge recipients and acceptance enforcement. |
| 22 | `supabase/migrations/2026-08-06_daily_puzzle_five_slot_ladder.sql` | Widen Daily Puzzle publication/current/slot indexes from three to five. |
| 23 | `supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql` | Widen `puzzles_completed` from `0..3` to the final `0..5` constraint. |
| 24 | `supabase/migrations/2026-08-06_daily_puzzle_canonical_telemetry.sql` | Add durable Daily Puzzle lifecycle/failure telemetry and projections. |
| 25 | `supabase/migrations/2026-08-06_fritz_challenge_lifecycle_telemetry.sql` | Add Challenge create/join lifecycle telemetry projection. |
| 26 | `supabase/migrations/2026-08-06_multiplayer_durable_invites.sql` | Add durable, expiring, idempotent private multiplayer invitations. |
| 27 | `supabase/migrations/2026-08-07_multiplayer_operational_events.sql` | Add durable fleet-wide multiplayer lifecycle, failure, and latency events. |
| 28 | `supabase/migrations/2026-08-08_daily_puzzle_telemetry_taxonomy_v2.sql` | Extend Daily Puzzle telemetry with canonical verification, conflict, retry, review, and leaderboard events. |

## Overlapping definitions and final authority

| Structure | Defined or changed in | Fresh database winner | Historically migrated database winner |
|---|---|---|---|
| Ghost tables/profile fields | `schema.sql`, then `ghost.sql` | `ghost.sql` runs second and supplies the final idempotent ghost additions. | Apply `ghost.sql` only if it is part of the environment's documented baseline; do not rerun `schema.sql`. |
| Daily Puzzle publication | `daily_puzzle.sql`, `daily_puzzle_v2.sql`, `daily_puzzle_ladder_v1.sql` | The three base files run in order; ladder/v2 additions are final before timestamped migrations. | Existing environments use their historical setup plus unapplied timestamped migrations; `daily_puzzle.sql` must never be rerun because it drops the table. |
| Daily Puzzle slot bounds | `daily_puzzle_ladder_v1.sql`, five-slot ladder migration, five-slot completion migration | Migration 22 wins slot/current-index bounds; migration 23 wins `puzzles_completed` with `0..5`. | Migrations 22 then 23 are the authoritative upgrade. The final completed-count definition is migration 23, lines 10–12. |
| Daily Puzzle telemetry vocabulary | canonical telemetry migration, telemetry-taxonomy-v2 migration | Migration 28's expanded event constraint, failure index, and failure view win. | Migration 28 is the additive authority upgrade after migration 24. |
| Daily Fritz events/metrics | `daily_fritz.sql`, migrations 11 and 15 | The canonical telemetry migration's replacement views/projections win. | Migrations 11 then 15 are the audit trail; migration 15 is final. |
| Daily Fritz publications | `daily_fritz.sql`, migration 12 | Migration 12's immutable/versioned definition and guards win where it alters or replaces the baseline. | Migration 12 is authoritative. |
| Daily Fritz command authority | `daily_fritz.sql`, migrations 13–17 | The timestamped sequence wins: primitives → transactional RPCs → canonical telemetry → instant-skunk replacement → attempt-scoped outbox. | The same timestamped sequence is authoritative; base SQL is not rerun. |
| Fritz Challenge base/authority | `fritz_challenges.sql`, migrations 18, 19, 21, and 25 | Timestamped authority, telemetry, recipient, and lifecycle definitions win over legacy base RPCs. | Migrations 18 → 19 → 21 → 25 are authoritative. |
| Multiplayer live-room persistence | `room_live_sessions.sql`, migration 20 | Base table first; migration 20's revision/CAS/receipt additions win. | Migration 20 is the authority upgrade; runtime enablement must remain gated until application is proven. |
| Tournament seed/registration timing functions | migrations 3, 4, and 8 | Later `CREATE OR REPLACE` definitions win; migration 8 contains the final two-minute registration-close behavior. | Highest applied migration in the ordered chain wins; after full application, migration 8 is final. |

Overlapping base definitions are convenience baselines, not a second migration history. The timestamped files remain the only supported upgrade path for deployed databases.

## Ordering constraints that lexical sorting gets wrong

- Daily Fritz: published challenge → command primitives → transactional commands → canonical telemetry → instant-skunk finalization → outbox attempt scope.
- Daily Puzzle: five-slot index widening → five-completion constraint repair → canonical telemetry.
- Challenge Mode: authority primitives → canonical telemetry → recipient acceptance → lifecycle telemetry.
- Multiplayer: base live-room table → room authority/CAS → durable invites → operational events.

`scripts/validate-migration-ledger.mjs` enforces required dependency pairs, requires every SQL migration to appear exactly once, and requires this document to name every ledger entry.

## Rollback policy

There is no general automatic down runner. Every new migration must include or reference a guarded manual rollback. Application flags do not revert schema. Before production application, record disposable apply evidence, schema verification output, rollback instructions, and explicit human approval in `IMPLEMENTATION_CHECKLIST.md`.
