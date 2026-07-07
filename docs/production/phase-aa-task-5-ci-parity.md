# Phase AA — Task 5: Align Main CI With Production Gates

**Date:** 2026-07-06  
**Scope:** CI/workflow configuration only — no application code changes  
**Architecture:** Frozen

---

## 1. Current CI gap (pre-fix)

| Workflow | Trigger | What ran |
|----------|---------|----------|
| `client-ci.yml` | PR touching `client/**` | **Full client production gates** |
| `ci.yml` | Push to `main` | **Reduced subset** |

### PR gates (`client-ci.yml`)

- Typecheck
- ESLint + Stylelint
- Dependency boundaries (`check:deps`)
- Multiplayer architecture (`check:multiplayer-arch`, `check:multiplayer-cycles`)
- Socket event registry (`check:socket-registry`)
- Architecture invariants (`check:architecture`)
- Vitest coverage (`test:coverage`)
- Behavior tests (`test:all`)
- Playwright E2E (`e2e`)
- Production build (`build`)
- Bundle size check (`size-check`)

### Main gates (`ci.yml` — before)

- Server tests
- Server build
- Client build only
- Client lint with **`continue-on-error: true`** (warnings-only, non-blocking)

### Missing from main

| Gate | Risk if skipped on main |
|------|-------------------------|
| Client typecheck | Type errors can land on `main` |
| Lint / lint:css | Style and correctness drift |
| Architecture / deps / socket registry | Multiplayer and module-boundary regressions |
| Tests + behavior tests | Logic regressions undetected until next PR |
| Playwright E2E | Integration/smoke failures on `main` |
| Bundle size check | Production bundle budget violations |

Phase Z certification flagged this as **Medium** risk: *"Main CI weaker than PR CI"*.

---

## 2. Root cause

`client-ci.yml` and `ci.yml` were **independently authored** with different triggers:

- PR client changes → comprehensive `client-ci.yml`
- `main` push → legacy `ci.yml` focused on server validation + minimal client build

There was **no composition** between workflows, so merges to `main` (including server-only PRs that skipped client path filters) never ran the client production gate suite.

---

## 3. Workflow changes

### Strategy

**Reuse `client-ci.yml` as a reusable workflow** — single source of truth for client gates. No duplicated step lists.

- **PRs:** unchanged — `client-ci.yml` still triggers on `pull_request` with `paths: client/**`
- **`main`:** `ci.yml` orchestrates `server` job + calls `client-ci.yml` via `workflow_call`

### `.github/workflows/client-ci.yml`

Added:

```yaml
workflow_call:
```

Enables invocation from `ci.yml` without adding a separate `push: main` trigger (which would duplicate client CI runs).

### `.github/workflows/ci.yml`

**Before:** monolithic job with server + partial client steps.

**After:** two jobs:

| Job | Contents |
|-----|----------|
| `server` | `npm ci`, `npm run test`, `npm run build` (server prefix) |
| `client` | `uses: ./.github/workflows/client-ci.yml` — full PR-equivalent gate suite |

**Removed from main:**

- Redundant `client build` (covered inside reusable client CI, twice for size-check as before)
- Non-blocking `client lint` (`continue-on-error: true`)

---

## 4. Files changed

| File | Change |
|------|--------|
| `.github/workflows/client-ci.yml` | Added `workflow_call` trigger |
| `.github/workflows/ci.yml` | Split into `server` + reusable `client` job; removed partial client steps |

**Unchanged:** `.github/workflows/gen-puzzles.yml` (scheduled puzzle generation — unrelated).

---

## 5. New main branch guarantees

Every push to `main` now runs:

### Server (`ci.yml` → `server` job)

- Vitest suite (`npm run test --prefix server`) — 513 tests including recovery signals
- TypeScript build (`npm run build --prefix server`)

### Client (`ci.yml` → `client` job → `client-ci.yml`)

Same gates as a client PR:

| Category | Command |
|----------|---------|
| Types | `npm run typecheck` |
| Lint | `npm run lint`, `npm run lint:css` |
| Architecture | `check:deps`, `check:multiplayer-arch`, `check:multiplayer-cycles`, `check:socket-registry`, `check:architecture` |
| Tests | `test:coverage`, `test:all` |
| E2E | Playwright (`npx playwright install chromium --with-deps && npm run e2e`) |
| Build | `npm run build` |
| Bundle budget | `npm run size-check` |

**Net effect:** Code on `main` cannot diverge from PR production safety standards for client or server validation.

---

## 6. Runtime / tradeoff discussion

### E2E on every `main` push

**Decision:** Include full Playwright E2E on `main` (parity with PR).

**Rationale:**

- E2E already runs on client PRs; skipping on `main` was the original gap.
- `main` is the release integration branch — smoke coverage belongs here.
- Playwright runs Chromium only (not full cross-browser matrix).

**Cost:** Main CI wall-clock increases roughly to **PR client CI duration + server tests** (~15–25 min typical, depends on runner). Acceptable for a production integration branch.

### PR path filter unchanged

PRs touching **only** `server/**` still do **not** trigger `client-ci.yml`. That is unchanged PR behavior per scope ("Preserve existing PR behavior").

**Tradeoff:** A server-only PR could merge without client gates, but the subsequent **`main` push runs full client CI**, catching client regressions before they persist on the integration branch.

**Alternative considered:** Run client CI on all PRs regardless of paths — rejected as scope expansion beyond main parity.

### Duplicate build on client job

`client-ci.yml` still runs `npm run build` twice (build step + size-check). Pre-existing; not changed in this task to avoid unrelated CI churn.

---

## 7. Verification performed

| Check | Result |
|-------|--------|
| YAML syntax (`ruby -ryaml`) | **Pass** — `client-ci.yml`, `ci.yml`, `gen-puzzles.yml` |
| Client CI script names in `package.json` | **Pass** — all 13 referenced scripts exist |
| Server test script | **Present** — `npm run test` in `server/package.json` |
| Application code changes | **None** |

Local full CI replay not executed (would duplicate ~20 min GitHub runner work); script resolution and YAML validity confirmed.

---

## 8. Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Longer `main` CI runtime | Low | Expected; parallel `server` + `client` jobs |
| Reusable workflow permission issues | Low | Same-repo `uses:` — no cross-org tokens |
| Server-only PR merges without client PR CI | Info | Full client gates run immediately on `main` push |
| Flaky E2E blocks `main` | Medium | Same risk as PR; monitor and quarantine flakes separately |
| Double workflow trigger | None | Avoided by `workflow_call` only (no `push` on `client-ci.yml`) |

**Overall:** Low risk. Closes the Phase Z certification gap without changing runtime application behavior.

---

## 9. Related references

- `PRODUCTION_READINESS_CERTIFICATION.md` — item 7: Main CI weaker than PR CI
- Phase AA Task 1–4 — bundle, lazy-load, recovery fixes validated by gates now enforced on `main`