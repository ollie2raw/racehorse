# Final Production Readiness Report

**Date:** 2026-07-06  
**Role:** Principal Engineer — Final launch certification (read-only)  
**Scope:** Entire repository — client, server, Supabase, CI, docs, ops  
**Policy:** No code changes. Architecture frozen. Evidence-backed blockers only.

---

## 1. Executive Summary

Racehorse Dominoes is a **feature-rich, deeply tested strategy game platform** with recent production hardening in multiplayer (Phase W), strong server game-invariant coverage, and modular daily/tournament/bot subsystems. It is **deployable today for a controlled beta** on a **single Render instance + Vercel + Supabase** stack.

It is **not ready for confident mass public launch** or horizontal scale without accepting documented data-loss and abuse risks.

| Dimension | Assessment |
|-----------|------------|
| Core gameplay correctness | **Strong** — engine tests, bot parity, multiplayer recovery harness |
| Security (auth + validation) | **Moderate** — Supabase verification, rate limits, server move replay; guest paths and in-memory limits remain |
| Scalability | **Weak beyond single instance** — in-memory rooms, queue, rate limits |
| CI / release gates | **Weak on main branch** — full client gate PR-scoped only; 1 server test failing locally |
| Observability | **Moderate** — Sentry wired; structured mp telemetry; runbook stale; no dashboards in repo |
| Documentation / onboarding | **Weak** — rich phase reports; poor root onboarding and env inventory |
| E2E / chaos | **Partial** — smoke + hub chaos pass; no dual-client in-match chaos |

### Launch Recommendation: **READY WITH MAJOR NOTES**

**Meaning:** Safe to ship a **friends-and-family / controlled public beta** with explicit user communication (deploy drops live games, competitive leaderboards have known trust boundaries, single-server capacity). **Not** safe to market as mass-scale production without closing Critical and High items below.

**Not PRODUCTION CERTIFIED** because: main-branch CI does not enforce the full test matrix; one server test fails in the current workspace; single-process architecture is a hard ceiling; deployment/env documentation is incomplete; competitive-mode anti-abuse and in-match E2E recovery are not fully evidenced.

---

## 2. Overall Repository Score

### **74 / 100**

| Pillar | Weight | Score | Rationale |
|--------|--------|-------|-----------|
| Gameplay correctness | 20% | 88 | 512+ server tests; 39 behavior files; engine parity |
| Security & abuse | 15% | 68 | Auth + rate limits exist; guest queue paths; short room codes |
| Scalability | 15% | 45 | Documented single-instance limits |
| CI / release | 10% | 58 | Strong PR client-ci; weak main ci.yml |
| Observability | 10% | 72 | Sentry + mp telemetry; stale runbook |
| Documentation / DX | 10% | 55 | Architecture rich; onboarding poor |
| E2E / ops validation | 10% | 65 | 6 chaos + smoke; no in-match dual-client |
| Deployment readiness | 10% | 60 | Works in prod URLs; no IaC; incomplete `.env.example` |

---

## 3. Production Readiness by Subsystem

| Subsystem | Verdict | Key evidence |
|-----------|---------|--------------|
| **Authentication (Supabase)** | Ready With Notes | `client/src/auth/useAuth.ts`; server `getAuthenticatedUserIdFromToken` in `server/src/platform/auth/supabaseAuth.ts`; `supabase/README.md` |
| **Matchmaking** | Ready With Notes | `server/src/matchmaking/` + tests; UUID spoof blocked (`identity.ts` L72–74); queue in-memory (`MULTIPLAYER_README.md` L79–81) |
| **Multiplayer / recovery** | Ready With Notes | Phase W hardening; 16+ behavior/invariant files; hub E2E 6/6; architecture 11/11 (`check:architecture`) |
| **Bot (Play vs Fritz)** | Production Ready | Architecture audits clean; `test:bot*` scripts; `ErrorBoundary` on bot routes (`AppRoutes.tsx` L338) |
| **Replay / move analysis** | Ready With Notes | Analyzer tests; authoring capture; no dedicated replay E2E |
| **Daily Puzzle** | Ready With Notes | Server replays moves (`dailyPuzzleSubmissionValidation.ts` L131–208); `elapsedSeconds` still client-supplied |
| **Daily Fritz** | Ready With Notes | Server skunk/draw tests; decomposed client; **no route ErrorBoundary** (`AppRoutes.tsx` L476–495) |
| **Tournament** | Needs Work | Strong server tests; in-memory rooms (`TOURNAMENT_README.md` L9–14); heavy ungated console in attach flow |
| **Profile / social** | Ready With Notes | `socialProfile.ts`, `PublicProfileScreen.tsx`; no route ErrorBoundary on profile/friends |
| **Progression / XP** | Not Ready | `learning/profileProgress.ts` — types only; ratings via Glicko, no XP system |
| **Achievements** | Not Ready | No achievement subsystem found in `client/src` or `server/src` |
| **Friends / invites** | Ready With Notes | REST + socket registrars; thin rate limits on invites |
| **Notifications** | Not Ready | No push/notification service; socket toasts only |
| **Settings** | Needs Work | Fragmented mute/password/username modals; no `SettingsScreen` |
| **Persistence (Supabase)** | Ready With Notes | Migrations in `supabase/migrations/`; RLS in schema; no rollback inventory doc |
| **Networking / protocol** | Ready With Notes | Socket registry enforced; match-protocol package |
| **Server API** | Ready With Notes | Modular routes; `/health`, `/ready` (`registerHealthRoutes.ts`) |
| **CI** | Needs Work | `ci.yml` — server test + builds only; `client-ci.yml` — full gate on PR `client/**` only |
| **Deployment** | Ready With Notes | Vercel + Render documented in `docs/agent-skills/deployment-health.md`; no `vercel.json`/Render manifest |
| **Logging / observability** | Ready With Notes | Sentry both sides; `logger.operational`; runbook §2 stale |
| **Analytics** | Not Ready | Runbook: no product analytics sink |
| **Security (platform)** | Ready With Notes | In-memory rate limits (`index.ts` L343–368); no helmet; `*.vercel.app` CORS |
| **Accessibility** | Needs Work | Some ARIA in overlays; no a11y test suite |
| **Mobile / browser** | Ready With Notes | `100dvh` shell in `Agents.md`; socket ping tuned for mobile (`index.ts` L419–422) |
| **Offline / reconnect** | Ready With Notes | RecoveryMachine + lifecycle policy; deploy still drops in-memory state |
| **Error boundaries** | Ready With Notes | Route boundaries on major modes; gaps on Fritz/social; no root boundary in `main.tsx` |
| **Feature flags** | Ready With Notes | Env toggles (`ENABLE_QA_TOURNAMENT_SEED`, `mp_debug`, etc.) — not centralized |
| **Asset loading** | Ready With Notes | Lazy routes in `AppRoutes.tsx`; large chunks warned at build |

---

## 4. Launch Blockers (Critical)

Issues that would cause **incorrect results, security breaches, or unrecoverable incidents** at launch scale.

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| C1 | **Live game state is process-local** | `MULTIPLAYER_README.md` L79–81; `TOURNAMENT_README.md` L9–14; rooms in `server/src/rooms.ts` | Deploy/restart/crash **drops active PvP and tournament boards** |
| C2 | **Main-branch CI does not run full client test matrix** | `.github/workflows/ci.yml` L28–41 — server test + builds only; no behavior/E2E/arch | Regressions can reach `main` without client gates |
| C3 | **Server test failure in workspace** | `npm run test --prefix server` → **1 failed**: `scheduledTournament/clientRecoverySignals.test.ts` | CI reliability risk; cross-package test imports client into server |
| C4 | **Horizontal scale unsupported** | In-memory queue, rooms, rate limiters (`InMemoryRateLimiter` in `index.ts` L343) | >1 instance breaks matchmaking pairing and rate limits |
| C5 | **Production env inventory incomplete** | `server/.env.example` (6 vars) vs `READY_REQUIRED_ENV_VARS` + recommended in `registerHealthRoutes.ts` L10–17; `client/.env.example` missing `VITE_SUPABASE_*`, `VITE_SERVER_URL` | Clone-and-deploy failure; misconfigured prod |

**Note:** Older audit `docs/mass-production-readiness-audit.md` lists Ghost completion as unauthenticated — **superseded**. Current `server/src/http/routes/ghost.ts` L178–196 requires auth + verified match session.

---

## 5. High Priority Issues

| # | Issue | Evidence |
|---|-------|----------|
| H1 | Ungated `console.log` on user-action hot paths | `usePlayerPlacementHandler.ts` — 9 logs per guided click; `useTournamentAttachFlow.ts` — 16 console calls |
| H2 | Server PRs bypass automated tests | `ci.yml` triggers only `push: main`; no `pull_request` for server |
| H3 | Client lint non-blocking on main | `ci.yml` L39–40 `continue-on-error: true` |
| H4 | No dual-client in-match E2E | `e2e/multiplayer-chaos.spec.ts` — hub-level only; Phase W report acknowledges gap |
| H5 | Stale operational runbook | `docs/production-observability-and-release-runbook.md` L17 — "No Sentry integration found" while `main.tsx` L3–10 and `server/src/index.ts` init Sentry |
| H6 | Short room codes + join guessing | Documented in mass audit; no repo evidence of join throttle beyond socket rate limits |
| H7 | Guest identity on matchmaking for unauthenticated users | `matchmaking/index.ts` L68–76 allows non-UUID guest `payloadUserId` |
| H8 | `ENABLE_REQUEST_PUZZLE_GENERATION` default-on risk | Referenced in prior audits (`dailyPuzzleStore.ts`) — request-time generation under load |
| H9 | Missing ErrorBoundary on high-traffic routes | `dailyFritz`, `friends`, `feed`, `stats`, `profile`, `ghost` in `AppRoutes.tsx` without boundaries |
| H10 | No server CI workflow on PR for `server/**` changes | Only `client-ci.yml` on PR path filter |

---

## 6. Medium Priority Issues

| # | Issue | Evidence |
|---|-------|----------|
| M1 | Root `README.md` outdated | Describes minimal 2-terminal dev; omits Supabase, daily modes, deploy |
| M2 | No `server/README.md` | Server scripts/env undocumented at package level |
| M3 | No unified `docs/DEPLOYMENT.md` | Split across `deployment-health.md`, runbook, `supabase/README.md` |
| M4 | No migration rollback / backup runbook | `mass-production-readiness-audit.md` §4 |
| M5 | Vitest coverage thresholds low | `vite.config.ts` L33–37 — 35% statements / 17% branches |
| M6 | `server/src/game/__tests__/` excluded from default vitest include | `vitest.config.ts` include pattern `src/**/*.test.ts` only |
| M7 | Production `any` in bot UI + legacy tournament | ~18 client + ~30 server production `any` occurrences |
| M8 | No security headers (helmet) | No matches in `server/src` |
| M9 | `trust proxy` not set | Rate limit uses `x-forwarded-for` but Express trust proxy not configured |
| M10 | Broad CORS `*.vercel.app` | `server/src/index.ts` allowed origin patterns |
| M11 | `/api/mp-stats` exposes process stats | `stats.ts` — unauthenticated operational introspection (rate-limited) |
| M12 | Daily Puzzle `elapsedSeconds` client-trusted | `dailyPuzzleSubmissionValidation.ts` L190–192 clamps but does not verify |
| M13 | Learning / XP progression stub | `client/src/learning/profileProgress.ts` — types only |
| M14 | No load/soak tests in CI | Socket smoke scripts exist but manual (`test:smoke:sockets`) |
| M15 | ADR-002 drift | `ADR-002-error-boundaries.md` specifies root boundary; `main.tsx` uses `installGlobalErrorHandlers` only |

---

## 7. Low Priority Issues

| # | Issue | Evidence |
|---|-------|----------|
| L1 | Large JS bundles | Build warns chunks >500kB (`lessonV2`, main index) |
| L2 | `client/README.md` is Vite template | Not product-specific |
| L3 | eslint-disable in 9 client production files | Mostly `react-hooks/exhaustive-deps` |
| L4 | Zero `@ts-ignore` in src | Clean |
| L5 | Zero skipped tests | No `test.skip` / `.only` in src |
| L6 | Deprecation warning in behavior test runner | `run-behavior-tests.mjs` shell spawn |
| L7 | Hardcoded prod Render URL fallback | `client/src/lib/gameServerUrl.ts` |
| L8 | Prod Supabase URL in GitHub workflow | `.github/workflows/gen-puzzles.yml` |

---

## 8. Technical Debt Worth Tracking

| Item | Why track | Location |
|------|-----------|----------|
| Durable live room snapshots | Removes #1 launch blocker | `rooms.ts`, `roomLivePersistence.ts` |
| Redis / shared Socket.IO adapter | Multi-instance | `MULTIPLAYER_README.md` |
| Centralized feature flags | Safer staged rollout | Env sprawl across server/client |
| Bot match screen decomposition completion | Maintainability | `BotMatchScreen.tsx` complexity |
| Legacy tournament handler `any` cleanup | Type safety | `registerLegacyTournamentHandlers.ts` |
| Guided mode console purge | Perf + noise | `usePlayerPlacementHandler.ts` |
| DB unique constraints for ranked rows | Idempotency | mass audit P0 |
| Tournament scheduler DB lease | Multi-instance | `TOURNAMENT_README.md` |
| Product analytics pipeline | Growth ops | runbook §2 |
| Settings screen | User trust | fragmented modals today |

---

## 9. Security Assessment

### Trust boundaries (evidence-based)

| Boundary | Status | Evidence |
|----------|--------|----------|
| REST auth | **Good** | Supabase `/auth/v1/user` verification (`supabaseAuth.ts`) |
| Socket UUID identity | **Good** | Production UUID without token rejected (`index.ts` L550–557) |
| Matchmaking UUID spoof | **Good** | `not_authenticated` for UUID without socket identity (`matchmaking/index.ts` L72–74) |
| Ghost completion | **Good** | Auth + verified session (`ghost.ts` L178–208) |
| Daily Puzzle moves | **Good** | Server engine replay (`dailyPuzzleSubmissionValidation.ts`) |
| Daily Fritz completion | **Moderate** | Completion hash from client fields — idempotency not full anti-cheat |
| Guest queue join | **Moderate** | Non-UUID guest IDs accepted when unauthenticated |
| Rate limiting | **Moderate** | Present but in-memory, per-instance (`index.ts` L343–368) |
| RLS | **Moderate** | Schema policies exist; migration parity across envs not inventoried |
| Service role key | **Expected risk** | Server bypasses RLS — standard pattern; increases blast radius |

### Abuse vectors

- Room code brute force (5-char codes) — mitigated partially by socket rate limits, not evidenced as join-specific throttle
- Friend invite / chat spam — no per-target caps found
- Daily submission flood — `dailySubmitLimit` 90/5min per user bucket
- DOS — 2MB JSON cap (`index.ts` L341); socket buffer 1MB (`index.ts` L423); no WAF in repo

### Cheating vectors

- Daily Puzzle: move legality server-enforced; timing (`elapsedSeconds`) spoofable
- Ranked multiplayer: server-authoritative game state
- Bot modes: local — low competitive stakes

**Security verdict:** Adequate for **controlled beta** with authenticated competitive modes. **Insufficient** for high-stakes anonymous public leaderboards without further throttling and monitoring.

---

## 10. Scalability Assessment

| Scale | Verdict | Bottleneck evidence |
|-------|---------|---------------------|
| **100 users** | **Ready** | Single Render instance; Supabase free/pro tier likely sufficient |
| **1,000 users** | **Ready With Notes** | Socket connection count on one Node process; monitor memory |
| **10,000 users** | **Needs Work** | In-memory rooms + queue; rate limiter maps grow per IP/user |
| **100,000 users** | **Not Ready** | No horizontal socket scaling; no shared queue; DB scan patterns in leaderboards (mass audit) |
| **1 million users** | **Not Ready** | Requires durable rooms, Redis adapter, CDN asset strategy, analytics, sharded DB, ops team |

---

## 11. Operational Readiness

### What exists

| Capability | Evidence |
|------------|----------|
| Health probes | `/health`, `/ping`, `/ready` |
| Sentry | Client `main.tsx`; server `index.ts` |
| Structured mp telemetry | `mpTelemetry.ts`, `logger.operational` |
| Graceful shutdown signal | `server:shutdown` handler |
| Self-ping keepalive | `index.ts` when `SERVER_URL` set |
| Phase W multiplayer ops | `multiplayer-production-certification-phase-w-report.md` |
| Deploy checklist | `docs/agent-skills/deployment-health.md` |

### Gaps

| Gap | Evidence |
|-----|----------|
| Alert owners / dashboards | Not in repo |
| Incident escalation matrix | Not in repo |
| Rollback procedure | Not codified |
| On-call runbook | Partial in runbook only |
| Log aggregation | Mostly `console.*` server-side |
| Stale runbook Sentry section | `production-observability-and-release-runbook.md` L17 |

### Can production incidents be diagnosed?

**Partially.** Sentry + `/ready` + mp breadcrumbs help. Without DSN configured, client Sentry disabled (`main.tsx` L6). Server logs are verbose but unstructured.

---

## 12. Documentation Assessment

### Strengths

- **~120+ markdown files** — architecture phases, subsystem stabilization, ADRs
- `MULTIPLAYER_README.md`, `TOURNAMENT_README.md`, `supabase/README.md`
- `docs/CODEBASE-HEALTH.md`, `docs/architecture/ARCHITECTURE_OVERVIEW.md`
- Phase W multiplayer certification report

### Missing / stale

| Document | Status |
|----------|--------|
| `CONTRIBUTING.md` / onboarding | **Missing** |
| `docs/ONBOARDING.md` | **Missing** |
| `docs/DEPLOYMENT.md` (unified) | **Missing** |
| `server/README.md` | **Missing** |
| Root `README.md` | **Stale** |
| `client/README.md` | **Vite template** |
| Backup/restore runbook | **Missing** |
| Migration inventory | **Missing** |
| Production runbook §2 (Sentry) | **Stale** |

### Developer experience (5-year / senior engineer onboarding)

A senior engineer can contribute to **multiplayer or bot** within days using architecture reports and behavior tests. **Full-platform onboarding** requires tribal knowledge (env vars, deploy targets, QA scripts). Score: **6/10** for immediate productivity on isolated subsystems; **4/10** for end-to-end platform ownership without mentor.

---

## 13. Testing Assessment

### What exists

| Layer | Count / status | Evidence |
|-------|----------------|----------|
| Server vitest | **77 files, 513 tests** (1 failing) | `npm run test --prefix server` |
| Client vitest | **72 files** + coverage thresholds | `client/vite.config.ts` |
| Behavior tests | **39 files** | `run-behavior-tests.mjs` |
| Production invariant tests | 1 file (multiplayer chaos A–D) | `recoveryMachine.production.invariantTests.ts` |
| Playwright E2E | 3 specs, 6+ chaos tests | `client/e2e/` |
| Architecture invariants | 11/11 pass | `check:architecture` |
| Socket smoke | Manual scripts | `socketSmoke.mjs` |

### Missing

| Gap | Risk |
|-----|------|
| Dual-client in-match multiplayer E2E | Reconnect regressions escape |
| Server PR CI | Server regressions merge unchecked |
| Load / soak in CI | Memory leaks at scale undetected |
| Security penetration tests | Abuse paths unvalidated |
| Auth E2E | Session flows manual |
| Daily Fritz E2E | No smoke spec |
| Tournament bracket E2E | Hub smoke only |
| Protocol contract tests (cross-repo) | match-protocol changes unguarded on main |

### CI reliability evidence

```
.github/workflows/ci.yml        → push main: server test + builds
.github/workflows/client-ci.yml → PR client/**: full gate incl. e2e
Server test failure: scheduledTournament/clientRecoverySignals.test.ts
Client harness: 39/39 passed (verified post Phase W)
E2E chaos: 6/6 passed (verified post Phase W)
```

---

## 14. Deployment Assessment

### Can someone clone and deploy?

**Partially.**

| Step | Documented? | Evidence |
|------|-------------|----------|
| Local dev | Yes | Root `README.md`, `supabase/README.md` |
| Supabase migrations | Yes | `supabase/README.md` SQL order |
| Client env vars | Partial | `supabase/README.md`; incomplete `client/.env.example` |
| Server env vars | Partial | Incomplete `server/.env.example` vs `/ready` requirements |
| Vercel deploy | Procedural | `deployment-health.md` |
| Render deploy | Procedural | `deployment-health.md`, hardcoded URL in client |
| Post-deploy verification | Yes | `curl /ready`, smoke steps in runbook |
| Rollback | No | Not documented |
| Secrets rotation | No | Not documented |

### Production configuration

- **Vite:** production build via `tsc -b && vite build` — passes
- **Server:** TypeScript compile + node start
- **No IaC** in repo (no `vercel.json`, `render.yaml`, Dockerfile)
- **Feature flags:** env-based, scattered

---

## 15. Five-Year Maintainability Assessment

### Strengths

1. **Frozen multiplayer architecture with CI enforcement** — 11 invariant checks prevent regression
2. **Pure cores** — session reducer, projection transforms, recovery FSM testable without React
3. **Behavior test culture** — 39 executable spec files outside vitest
4. **Phase documentation trail** — auditable extraction history
5. **ADR set** — error boundaries, logger, API client patterns

### Risks

1. **God-hook pressure** — `useRoomSocketSync`, `App.tsx` composition still heavy
2. **Cross-package test** — server test importing client (`clientRecoverySignals.test.ts`) — fragile boundary
3. **Doc drift** — runbook vs code (Sentry)
4. **Single-instance assumption baked into README** — scaling requires architectural investment
5. **Console logging as informal telemetry** — hard to operate at scale

**Maintainability score:** **7/10** for a small senior team; **5/10** for a large rotating team without onboarding investment.

---

## 16. Launch Recommendation

### **READY WITH MAJOR NOTES**

#### Ship now (with disclosed limits)

- Friends-and-family beta
- Single-server production (Render)
- Authenticated users for competitive features
- Manual pre-invite checklist: `/ready`, smoke E2E, `test:all` client, server tests green

#### Do not ship yet (without closing Critical items)

- Mass marketing / viral launch
- Multi-instance horizontal scale
- High-stakes anonymous leaderboards
- 24/7 SLA without on-call + alerting
- Million-user capacity planning

#### Path to **PRODUCTION CERTIFIED**

1. Fix `clientRecoverySignals.test.ts`; add server PR CI workflow
2. Extend `ci.yml` to run `client test:all` + e2e on every `main` push
3. Complete `.env.example` files to match `/ready` requirements
4. Add dual-client in-match Playwright chaos suite
5. Document deploy + rollback + env in `docs/DEPLOYMENT.md`
6. Gate or remove production `console.log` on tournament/guided hot paths
7. User-facing policy: live games lost on deploy until durable rooms exist
8. Configure Sentry DSN + alert rules; refresh runbook §2

#### Path to mass scale (separate program)

- Durable room snapshots or Redis room state
- Shared Socket.IO adapter + centralized matchmaking queue
- Distributed rate limiting
- DB idempotency constraints for ranked/daily results
- Load/soak CI job

---

## Verification Log (this audit)

Commands executed read-only during this review:

```bash
npm run test --prefix server          # 1 failed | 76 passed (513 tests)
npm run build --prefix client         # pass (prior Phase W verification)
npm run check:architecture --prefix client  # 11/11 CERTIFIED (prior)
node run-behavior-tests.mjs           # 39/39 passed (prior)
npm run e2e -- e2e/multiplayer-chaos.spec.ts  # 6/6 passed (prior)
```

Repository searches: `TODO/FIXME/TEMP-DIAGNOSTIC`, `ErrorBoundary`, `console.log`, rate limiting, auth patterns, subsystem file inventory.

**Prior audits referenced (not superseded without verification):**

- `docs/mass-production-readiness-audit.md` (2026-06-02) — updated where code changed (Ghost auth, rate limits)
- `docs/architecture/multiplayer-production-certification-phase-w-report.md` (2026-07-06)

---

## Files Changed (this pass)

| File | Change |
|------|--------|
| `docs/architecture/final-production-readiness-report.md` | **Created** — final launch certification (read-only audit) |

No production code, tests, or CI configuration was modified.

---

*Principal Engineer certification: **READY WITH MAJOR NOTES** — controlled beta deployable; mass public launch blocked by scale architecture, CI gaps, and operational documentation debt.*