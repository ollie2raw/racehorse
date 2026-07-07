# Phase AA — Task 6: Production Regression Guards for Lazy Loading

**Date:** 2026-07-06  
**Scope:** Automated guardrails only — no gameplay, API, or runtime behavior changes  
**Architecture:** Frozen

---

## 1. Problem

Phase AA Tasks 2–3 removed accidental `lesson-v2` (~1.3 MB) and `analyzer` (~277 kB pre-fix) loading from standard Fritz entry. Those guarantees existed only in:

- Manual bundle inspection
- Phase AA markdown reports
- Developer discipline

A future static import (e.g. `import { analyzeMoveLog } from './analyzer'`) could silently regress production entry cost with no CI failure.

---

## 2. Root cause

Lazy-load boundaries were **behavioral conventions** without enforced checks in:

- `npm run check:*` scripts
- Playwright network assertions
- Documented chunk ownership

---

## 3. Protections added

### A. Static + dist boundary script

**`client/scripts/checkBotMatchLazyBoundaries.mjs`**

| Check | Method |
|-------|--------|
| Source graph | BFS static imports from `src/bot/BotMatchScreen.tsx`; fail on runtime paths into `learn/lessonV2` or `analyzer/` |
| Dist chunks | After build, scan `BotMatchScreen-*.js`, `bot-guided-*.js`, `bot-hand-lifecycle-*.js` for `from"./lesson-v2-` or `from"./analyzer-` |
| Allowed | `import()` dynamic references, `__vite__mapDeps` lazy metadata, `import type` |

**npm script:** `check:bot-match-lazy` → `node scripts/checkBotMatchLazyBoundaries.mjs --dist`

**Unit tests:** `scripts/checkBotMatchLazyBoundaries.test.ts` (URL/chunk pattern helpers)

### B. Playwright network regression

**`client/e2e/bot-match-lazy-chunks.spec.ts`**

| Scenario | Assertion |
|----------|-----------|
| Standard Fritz entry | No `lesson-v2` or `analyzer` script requests after Start Match |
| Guided V2 | `lesson-v2` / `lessonV2.ts` request appears; optional interactivity check when shell mounts |

**Helper:** `client/e2e/helpers/chunkRequests.ts` (shared URL matchers with boundary script)

### C. Bundle chunk ownership documentation

**`docs/production/bundle-chunk-ownership.md`** — intentional chunk purposes, load triggers, and guard cross-reference.

### D. CI wiring

**`.github/workflows/client-ci.yml`** — new step after build + size-check:

```yaml
- name: Bot match lazy-load boundaries
  run: npm run check:bot-match-lazy
```

---

## 4. Files changed

| File | Change |
|------|--------|
| `client/scripts/checkBotMatchLazyBoundaries.mjs` | **New** — source graph + dist chunk boundary checker |
| `client/scripts/checkBotMatchLazyBoundaries.test.ts` | **New** — vitest for checker helpers |
| `client/e2e/bot-match-lazy-chunks.spec.ts` | **New** — network regression scenarios |
| `client/e2e/helpers/chunkRequests.ts` | **New** — request tracking helpers |
| `client/package.json` | `check:bot-match-lazy` script |
| `client/vite.config.ts` | Include `scripts/**/*.test.ts` in vitest |
| `.github/workflows/client-ci.yml` | Lazy boundary CI step |
| `client/playwright.config.ts` | Optional `PLAYWRIGHT_SKIP_WEBSERVER` for preview-based runs |
| `docs/production/bundle-chunk-ownership.md` | **New** — chunk ownership reference |
| `docs/production/phase-aa-task-6-regression-guards.md` | **New** — this report |

---

## 5. Verification results

| Command | Result |
|---------|--------|
| `npm run build --prefix client` | **Pass** |
| `npm run check:bot-match-lazy --prefix client` | **Pass** |
| `npm run size-check --prefix client` | **Pass** (BotMatchScreen 167 kB / 244 kB) |
| `npm run typecheck --prefix client` | **Pass** |
| `npm run test --prefix server` | **Pass** (513/513) |
| `npx vitest run scripts/checkBotMatchLazyBoundaries.test.ts` | **Pass** (3/3) |
| `npx playwright test e2e/bot-match-lazy-chunks.spec.ts` | **Pass** (2/2) |

---

## 6. What CI will now catch

| Regression | Failing gate |
|------------|--------------|
| Static `lessonV2` import in bot-match eager graph | `check:bot-match-lazy` (source) |
| Static `analyzer` import in eager dist chunks | `check:bot-match-lazy` (dist) |
| Standard Fritz fetches `lesson-v2-*.js` at entry | Playwright network test |
| Standard Fritz fetches `analyzer-*.js` at entry | Playwright network test |
| Guided V2 stops loading lesson runtime | Playwright guided scenario |
| BotMatchScreen chunk budget blow-up | `size-check` (existing) |

---

## 7. Risk assessment

| Risk | Severity | Notes |
|------|----------|-------|
| Source BFS misses dynamic-only regressions | Low | Dist chunk scan catches production static imports |
| E2E uses dev server; chunk URLs differ from prod | Low | Helpers match both `/src/learn/lessonV2.ts` and `lesson-v2-*.js` |
| Fritz mount error boundary in some local envs | Info | Network assertions run before optional interactivity check; existing smoke tests share same mount fragility |
| False positive on `game-reviewer` chunk | None | Analyzer matcher excludes `game-reviewer`; only `analyzer-*` engine chunk is forbidden on standard entry |
| `check:bot-match-lazy` requires prior build | Info | CI runs after build step; script errors clearly if `dist/` missing |

**Overall:** Low risk. Guardrails are additive; no application code changed.

---

## 8. Remaining gaps (out of scope)

- Playwright does not yet assert `analyzer` loads **after** post-game review open (would need full match-to-game-over flow).
- Server-only PRs still skip client CI until `main` push (Task 5 compromise).
- `game-reviewer` eager load on standard Fritz (~64 kB UI shell) is documented but not network-gated.

---

## 9. Related references

- [bundle-chunk-ownership.md](./bundle-chunk-ownership.md)
- [phase-aa-task-2-lesson-v2-lazy-load.md](./phase-aa-task-2-lesson-v2-lazy-load.md)
- [phase-aa-task-3-analyzer-lazy-load.md](./phase-aa-task-3-analyzer-lazy-load.md)
- [phase-aa-task-5-ci-parity.md](./phase-aa-task-5-ci-parity.md)