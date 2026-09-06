# Server lint — backlog & CI-enablement blockers

**Date:** 2026-09-05. **Status:** tracked item, not scheduled.
**Found:** incidentally, during RK-8 work — `server` lint is not run in CI.

## The situation

`ci.yml` runs **client** lint (`npm run lint --prefix client`) and CSS lint,
but has **no server-lint step**. `server`'s lint script also doesn't currently
pass:

```jsonc
// server/package.json
"lint": "ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts --max-warnings 9999"
```

`--max-warnings 9999` is effectively "warnings don't matter" — but `npm run lint`
in `server/` still **exits non-zero today** because of 64 lint *errors* (mostly
`no-console`). ESLint has no `--max-errors` knob, so unlike the client's stable
`--max-warnings 401` budget, the server error count cannot simply be pinned as a
regression budget and wired into CI as-is.

## Current violation count (2026-09-05, after the 4 trivial fixes below)

`ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts` →

| Severity | Count | Rule breakdown |
|---|---|---|
| **error** | **64** | `no-console` ×64, across 27 files |
| **warning** | **149** | `@typescript-eslint/no-unused-vars` ×143 · `@typescript-eslint/no-explicit-any` ×6 |

### `no-console` errors by file (the 64)

CLI-tool files where `console` is arguably the correct output mechanism
(`seed:daily-ladder`, `check:daily-ladder`, `gen:puzzles:legacy` in
`server/package.json` run these) — ~22 of the 64:

```
10  src/seedDailyPuzzleLadder.ts
 6  src/generatePuzzles.ts          (also imported as a library by seedPuzzlePool.ts)
 2  src/checkDailyPuzzleLadder.ts
 2  src/seedPuzzlePool.ts
 2  src/dailyPuzzleLadderPublish.ts
```

Genuine server library / route / multiplayer code — ~42 of the 64, each a
judgment call (deliberate diagnostic? PII risk? should be structured `log.*`?
— `docs/production-observability-and-release-runbook.md` §1 flags exactly this):

```
 6  src/index.ts                    (startup diagnostics)
 5  src/multiplayer/roomCommandReceiptStore.ts
 5  src/platform/gracefulShutdown.ts
 3  src/shared/verifiedSinglePlayerMatch.ts
 3  src/stats/recordUserMatch.ts
 2  src/http/stores/dailyPuzzleStore.ts
 2  src/multiplayer/registerRoomChatEmoteHandlers.ts
 2  src/multiplayer/roomMatchLogPersistence.ts
 1× each: game/invariants.ts, http/routes/{botMatches,ghost,puzzleRush,stats}.ts,
 http/stores/dailyFritzStore.ts, matchmaking/{persistence,simBot}.ts,
 multiplayer/{drawAudit,mpAuthorityTelemetry,registerRematchPregameHandlers}.ts,
 platform/auth/supabaseAuth.ts, social/activityWriter.ts, stats/recordPublicMatch.ts
```

## Why this is not a same-day fix

- The 64 `no-console` need **triage**, not a sweep: some are legit CLI output,
  some are deliberate startup/shutdown diagnostics, some are genuine "should be
  `log.*`" — and some may be PII-leak candidates the observability runbook
  already flagged. Fixing them blind in a lint-sweep with no other context is
  exactly what the runbook and this project's review discipline warn against.
- The 143 `no-unused-vars` warnings are their own sweep. Not urgent (warnings),
  but real.
- **Config-policy questions to resolve first** (do not decide unilaterally in a
  lint pass):
  - `server/.eslintrc.json` has `no-console: "error"` flat; the **client** uses
    `no-console: [error, { allow: [...] }]` (permits `console.warn`/`error`).
    Matching the client convention would clear some server errors legitimately.
  - `server/.eslintrc.json` already has an `overrides` block turning
    `no-console: off` for `scripts/**` (a server-root `scripts/` dir). The CLI
    entrypoints above live in `src/`, not `scripts/` — an analogous `src/`
    override (or moving/renaming them) is a judgment call, not mechanical.

## What it takes to enable server lint in CI

1. Decide the `no-console` rule config (match client's `allow` list) and the
   CLI-file override policy.
2. Triage + fix / disable the remaining `no-console` errors → **0 errors**.
3. Then either:
   - set `server/package.json` `lint` to `--max-warnings 149` (pin the current
     warning count as a budget, mirroring the client's `--max-warnings 401`), and
   - add to `ci.yml` client job (or a new server-lint step in the server job),
     mirroring the client wiring:
     ```yaml
     - name: Lint TS/JS (server)
       run: npm run lint --prefix server
     ```
4. Optionally schedule the 149 `no-unused-vars` cleanup to ratchet the budget
   down.

**Explicitly NOT done in the RK-8-adjacent pass that found this:** no CI step
was added, because wiring it today would either (a) fail CI immediately on the
64 errors, or (b) require downgrading rules / an arbitrarily permissive
threshold to paper over them — both rejected. The 4 trivial, context-free
errors (below) were fixed; everything else is deferred to a scoped pass.

## Fixed in the finding pass (2026-09-05)

| Rule | Count | Files |
|---|---|---|
| `prefer-const` | 3 | `dailyFritzVerifier.ts:227`, `multiplayer/roomSocketAttach.ts:295`, `rooms.ts:1125` — all three `let`s ESLint-verified as never reassigned; `let`→`const`, behaviour-neutral |
| `no-empty` | 1 | `multiplayer/disconnectGrace.ts:253` — empty `catch {}` → `catch { /* comment */ }` |

Remaining after these: **64 errors / 149 warnings** (the table above already
reflects the post-fix state).
