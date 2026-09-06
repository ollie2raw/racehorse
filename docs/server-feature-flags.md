# Server feature flags — manifest & convention

**Scope:** server-side runtime toggles read from `process.env` at boot (or per
call). This is **documentation + a light convention**, not a flag-management
system — there is no registry object, no admin UI, no dynamic reload. A flag is
just an env var read through `getEnvBool` / a small `is…Enabled()` helper.

**Why this doc exists:** `docs/guardrail-5-staging-canary-scoping.md` (§1.4, §4)
found that the *pattern* for gating risky server logic behind a default-OFF
runtime toggle already works well here — `RANKED_GAMES_*_COLUMN_ENABLED` is the
proof — but it's applied ad hoc, with no shared list and no removal discipline,
so rollout flags tend to outlive their purpose. This manifest is the shared
list; the convention below is the discipline.

---

## Convention

### When to add a flag

Add a default-OFF runtime flag when shipping either of:

1. **Server logic that depends on a migration not yet applied everywhere** — so a
   server running *ahead of* the migration doesn't 500 on every request that
   hits the new column/table/RPC. (Render is single-instance today, but this
   still matters across the deploy→migration ordering window, and will matter
   more if we ever go multi-instance.)
2. **A materially new code path in a high-stakes handler** — `record-game`,
   `/start`, ranked-rating writes, forfeit resolution, anything that writes
   `ranked_games` / tournament state / verified-match rows. The old path stays;
   the flag lets you flip the new one off in seconds without a redeploy if it
   misbehaves in prod.

Do **not** add a flag for: cosmetic changes, pure refactors with no behaviour
delta, debug logging (those are their own category — see below), or anything you
would not actually want the ability to toggle live.

### The worked example — `RANKED_GAMES_OUTCOME_COLUMN_ENABLED`

`server/src/ranking/rankedGamePayload.ts`. New `outcome` column on `ranked_games`
(persists the authoritative forfeit sign for the deferred rating path). The flag:

- **defaults OFF** — `process.env.RANKED_GAMES_OUTCOME_COLUMN_ENABLED === 'true'`,
  so a server deployed before the migration lands doesn't send an unknown column
  and 500 every ranked insert;
- **is inert for correctness when OFF** — the inline rating path passes `outcome`
  in memory regardless, so the forfeit sign is right either way; the flag only
  governs whether the *deferred* path can recover it from the row;
- **has a docstring explaining the ordering hazard it exists for.**

That is the shape to copy. The one thing it's missing is the last step — see
"When to remove."

### When to enable in prod

After the deploy is confirmed healthy (`/healthz`, `/ready`, smoke test green),
and for a migration-gate flag after the migration is confirmed applied
(`/ready` reports schema availability for the Daily Fritz authority flag; for
others, a recent-row sample or a direct catalog check). Enabling is a **separate
step from the deploy**, done deliberately.

### When to remove

**A rollout / migration-gate flag is temporary. It gets deleted** once its
condition is permanently true everywhere:

- migration applied to prod (and any future environments are built from
  migrations, so they'll have it too) → delete the flag, make the code path
  unconditional, drop the env var from `.env.example` and the platform config.

Give every rollout flag a **`remove-when:`** line in its docstring / this
manifest at creation. A flag with no removal condition is either mis-categorised
(it's actually a permanent operational toggle — say so) or it's going to rot.

**Permanent** toggles (debug logging, the scheduler singleton gate, the
`SOFT_GAME_INVARIANTS` safety valve, unfinished-feature gates) are fine to keep
indefinitely — they're marked **permanent** in the table, not **remove-when**.

### Observability

Where a flag's state matters operationally, expose it. Precedent:
`isDailyFritzTransactionalAuthorityEnabled()` is surfaced in the health-route
authority probe (`registerHealthRoutes.ts`) alongside `schemaAvailable`, so
`/ready`-style checks can see both the flag and whether the migration it gates
is actually present.

---

## Manifest

`default` is the value with the env var unset. `prod` = believed state in the
live Render env — **not verifiable from the repo**; a human confirms against the
Render dashboard. `?` = unknown from the repo.

### Rollout / migration-gate (temporary — should carry a remove-when)

| Flag | Reads at | Gates | default | prod | remove-when |
|---|---|---|---|---|---|
| `DAILY_FRITZ_TRANSACTIONAL_COMMANDS` | `dailyFritzAuthorityFeature.ts` → ~10 Daily Fritz route/store files | transactional authority commands for Daily Fritz record-game / next-hand / completion / stranded-recovery; select-column shape; canonical telemetry writes | `false` | ? | docstring says "enable after all four `2026-08-01_daily_fritz_*` migrations applied" — but that's an *enable*-when, not a *remove*-when. Migrations are checked in and ~5 weeks old. **remove-when:** confirm applied in prod → make unconditional, delete the helper + `.env.example` line. |
| `RANKED_GAMES_SOURCE_COLUMNS_ENABLED` | `rankedGamePayload.ts` | writes `source_type` / `source_match_id` on `ranked_games` inserts; **also the gate for the `on_conflict=player_id,source_match_id` dedup guard** in `insertRankedGameIdempotent()` | `false` | **ON** (HARDENING_PLAN.md §8.1.3: "confirmed live in prod via a recent-row sample") | **OVERDUE.** The migration is long applied and the flag is ON in prod; it now only gates a code path that's always taken. **Finding — see below.** remove-when: now. |
| `RANKED_GAMES_OUTCOME_COLUMN_ENABLED` | `rankedGamePayload.ts` | writes the `outcome` column on `ranked_games` (deferred rating path recovers forfeit sign from the row) | `false` | ? | docstring explains the *why* but **never states a remove-when**. Same migration era as its sibling above. **Finding — see below.** |

### Permanent operational toggles (keep — not rollout flags)

| Flag | Reads at | Gates | default | why permanent |
|---|---|---|---|---|
| `TOURNAMENT_SCHEDULER_ENABLED` | `config.ts` | scheduled-tournament scheduler tick + no-show reconciler **on this process** | `true` | multi-instance singleton control (D-7 / HARDENING §1.4.6). Stays `true` until a dedicated scheduler worker is split out, then `false` on web dynos. Structurally moot at 1 instance but correct to keep. |
| `SOFT_GAME_INVARIANTS` | `game/invariants.ts`, `platform/gameCoreConsistency.ts` | log-don't-block on game-state corruption (GC-9) | `false` | emergency safety valve. `smoke-test.yml` actively asserts it is **not** `true` in prod. Keep as an operator escape hatch. |
| `ENABLE_STARTUP_FRITZ_WARMUP` | `scheduled/dailyWarmup.ts` | run the Daily Fritz warmup on server boot (vs. on the scheduled tick only) | `false` | operational choice, clearly documented "off by default in production". Permanent. |
| `TOURNAMENT_SCHEDULER_ENABLED` sibling: `ROOM_CLEANUP_GRACE_MS` (int, not bool) | `config.ts` | grace period before an empty room is cleaned up | `0` | tuning knob, not a feature gate. |

### Debug / audit (keep — verbose-logging toggles, off in prod)

`MP_DRAW_AUDIT`, `MP_DEBUG` / `DEBUG_MP`, `MATCHMAKING_DEBUG`,
`DEBUG_SETUP_STRIKE`. All default `false`, all pure logging/diagnostics, all
permanent by nature. Not rollout flags; no remove-when.

### Feature-enable gates (feature is unfinished / not GA — flag-off is the correct state)

| Flag | Reads at | Gates | default | note |
|---|---|---|---|---|
| `ENABLE_SPECTATOR_MODE` (server) / `VITE_ENABLE_SPECTATOR_MODE` (client) | `spectator/spectatorFeature.ts` / `client/src/config/spectatorModeFeature.ts` | spectator mode | `false` | spectator UI is "preview only, not wired" (`docs/multiplayer-private-games-source-of-truth-audit.md`). Flag-off is correct. remove-when: feature is finished + GA'd → make unconditional or delete. Low priority while the feature is incomplete. |
| `ENABLE_REQUEST_PUZZLE_GENERATION` | `config.ts` | on-demand puzzle-generation endpoint (vs. cron-only) | `false` | operational; probably permanent (guards an expensive endpoint). Treat as permanent unless someone decides the endpoint should always be open. |

### Test / dev / CI only (not prod flags — do not appear in the Render env)

`DAILY_FRITZ_MEMORY_STORE` (hard-guarded `NODE_ENV !== 'production'`),
`DAILY_FRITZ_TEST_FIXTURES_ENABLED` (same guard), `MP_PRIVATE_CERT_MODE`,
`MATCHMAKING_DEV_MODE`, `E2E_DAILY_FRITZ_USER_ID`, `E2E_INSPECT`,
`ENABLE_QA_TOURNAMENT_SEED`, `QA_ALLOW_NONLOCAL_STAGING`, `QA_TOURNAMENT_USER_ID`.
Test scaffolding. Out of scope for the rollout-flag convention.

---

## Findings from this pass (logged, not fixed — per the pass's scope)

1. **`RANKED_GAMES_SOURCE_COLUMNS_ENABLED` is a stale rollout flag.** The
   migration is long applied and the flag is ON in prod (HARDENING §8.1.3). It
   now gates only a code path that is always taken in production, and — because
   the same flag also gates the `on_conflict` dedup guard in
   `insertRankedGameIdempotent()` — a server that came up with the env var
   *unset* would silently lose ranked-insert idempotency. The safe end state is
   to make the `source_type`/`source_match_id` write + the dedup `on_conflict`
   unconditional and delete the flag. **This is the "flag nobody plans to
   remove" instance the scoping doc predicted.** Own scoped change; interacts
   with HARDENING §8.1.3's open work on the two bypass call sites — probably
   bundle with that.
2. **`RANKED_GAMES_OUTCOME_COLUMN_ENABLED` has no remove-when.** Sibling of #1,
   same migration era. The docstring documents the ordering hazard but never
   says when the flag should die. Needs: confirm prod state, confirm migration
   applied, then same treatment as #1.
3. **`DAILY_FRITZ_TRANSACTIONAL_COMMANDS` has an *enable*-when but no
   *remove*-when.** "Enable after the four `2026-08-01` migrations" is written
   down; "then delete the flag" is not. The migrations are checked in and weeks
   old — likely applied. Needs a prod-state confirmation and a removal decision.
4. **`ENABLE_SPECTATOR_MODE` has no remove-when**, but this is low-stakes: the
   spectator feature is genuinely unfinished, so the flag-off state is correct
   and the flag is doing its job. Revisit when spectator mode is actually built.

None of these are bugs today (Render is single-instance and the flags are set
correctly in that one env). They are rot risk: a flag whose removal nobody owns,
and (for #1 specifically) a default that is *unsafe* if the env var is ever
lost.

---

## Not built in this pass (deliberate non-goals)

- A `config.featureFlags.*` namespace / a flag registry object. The scoping doc
  sized Option B as "documentation + a light convention," not new machinery.
  `RANKED_GAMES_*` still read `process.env` directly rather than going through
  `config` — folding them in is a reasonable small follow-up but wasn't done
  here to keep the change purely additive.
- A `check:architecture` manifest-completeness / stale-flag invariant (fail the
  build when a flag is past its remove-when, or when a `process.env.*_ENABLED`
  read exists with no manifest row). That would be real logic and a real test —
  it's a legitimate Step-2 if the convention proves worth enforcing, but it's
  exactly the "flag-management system" this pass was told not to build.
