# Racehorse Dominoes — Production Readiness Certification (Phase Z)

**Audit type:** Repository-wide, read-only production readiness certification  
**Scope:** Full stack — client, server, CI, observability, security, mobile, accessibility  
**Excluded:** Architecture redesign review, design-system / cosmetic UI audit  
**Date:** 2026-07-06  
**Architecture status:** Frozen — no code modifications during this audit

> **Note on data layer:** The audit brief references Firebase/Firestore. This repository uses **Supabase** (Postgres + Auth) on the client (`@supabase/supabase-js`) and server (`supabaseFetch`, service key). All data-layer findings below reference Supabase, not Firebase.

---

## 1. Executive Summary

Racehorse Dominoes is **engineering-mature enough for a controlled production beta with thousands of registered users**, provided operators accept **single-instance live-room semantics**, configure **Sentry + env vars correctly**, and treat **mobile performance and accessibility** as known gaps.

The repository demonstrates **strong production discipline** in several areas:

- **CI depth on client PRs:** typecheck, lint, dependency-cruiser (including multiplayer architecture invariants), vitest coverage (35% statement floor), behavior tests, Playwright E2E, production build, and bundle size gate (`client-ci.yml`).
- **Error capture:** Sentry on client (`main.tsx`) and server (`server/src/index.ts`), global `error` / `unhandledrejection` handlers (`debug/globalErrors.ts`), process-level handlers with Sentry on server.
- **Route-level resilience:** `ErrorBoundary` on bot, ghost, daily puzzle, journey, tournament, and multiplayer surfaces (`AppRoutes.tsx`); app-shell boundary in `App.tsx`.
- **Multiplayer recovery:** formal recovery machine, socket event bus with detach/cleanup, join-ack coordinator, lifecycle hidden-tab recovery, MP telemetry breadcrumbs (`mpTelemetry.ts`).
- **Server-side trust:** socket queue identity uses authenticated `socket.data.userId`, not client payload (`server/src/matchmaking/identity.test.ts`); daily puzzle submissions validated server-side (`validateDailyPuzzleSubmission`); admin routes gated by `ADMIN_SECRET` with constant-time compare (`adminSecret.ts`).
- **Operational endpoints:** `/health`, `/ping`, `/ready` with Supabase probe, socket/room counts, release metadata (`registerHealthRoutes.ts`).

**Blocking or high-severity gaps for unrestricted production at scale:**

| Gap | Evidence |
|-----|----------|
| **Bundle size CI currently fails** | `npm run size-check`: `BotMatchScreen` **278 kB** exceeds **244 kB** limit |
| **Massive Learn/Bot chunk** | Production build: `lessonV2-*.js` **1,319 kB** (gzip 57 kB) — latent parse cost on low-end devices |
| **Live multiplayer rooms are process-local** | `server/src/rooms.ts` — `const rooms = new Map<RoomCode, Room>()`; deploy/restart drops in-flight games |
| **No product analytics sink** | `docs/production-observability-and-release-runbook.md` L18; no gtag/PostHog/etc. in codebase |
| **Accessibility incomplete** | Sparse `prefers-reduced-motion` (3 matches); modals lack systematic focus trap |
| **1 failing server test** | `scheduledTournament/clientRecoverySignals.test.ts` — recovery signal called 1× not 2× |
| **Main CI lighter than PR CI** | `ci.yml` on `main` push: server test + client build only — no client E2E/size-check on main |

### Final certification

# **READY WITH NOTES**

Racehorse is **not** `NOT READY` — the error-handling, testing, and server validation posture support real users. It is **not** `PRODUCTION READY` or `WORLD-CLASS` without resolving bundle regression, documenting live-room deploy risk, hardening observability configuration, and closing mobile/a11y gaps.

---

## 2. Scorecard

| Dimension | Score | Summary |
|-----------|------:|---------|
| **Overall Production Readiness** | **64 / 100** | Strong test/CI/recovery; bundle regression + scale limits hold score down |
| **Performance** | **55 / 100** | Lazy routes good; BotMatch + lessonV2 chunks heavy; 12 global CSS imports |
| **Reliability** | **71 / 100** | Recovery machine, boundaries, Sentry; in-memory rooms; 1 server test fail |
| **Security** | **67 / 100** | Server auth/validation solid; client admin UI gate; per-instance rate limits |
| **Accessibility** | **40 / 100** | Partial ARIA; no focus-trap standard; reduced-motion rarely honored |
| **Mobile** | **56 / 100** | `100dvh`/safe-area present; large JS/CSS payload risks Safari/Android |
| **Maintainability** | **68 / 100** | Excellent PR CI; `App.tsx` 1,607 lines; 600 ESLint warnings allowed |

---

## 3. Performance Audit

### 3.1 Bundle size (production build evidence)

Build output (`npm run build`, 2026-07-06):

| Chunk | Size (min) | Gzip | Risk |
|-------|----------:|-----:|------|
| `index-*.js` (main) | 642.55 kB | 197.85 kB | Large initial parse on mobile |
| `index-*.js` (secondary) | 110.61 kB | 30.67 kB | — |
| `BotMatchScreen-*.js` | **284.54 kB** | 79.59 kB | **Exceeds CI limit** |
| `lessonV2-*.js` | **1,319.94 kB** | 56.62 kB | Huge module graph; gzip masks parse cost |
| `vendor-charts-*.js` | 396.62 kB | 116.34 kB | recharts — `RatingHistoryPage.tsx` |
| `vendor-supabase-*.js` | 170.74 kB | 45.35 kB | Expected |
| `vendor-socket-*.js` | 41.21 kB | 12.87 kB | Expected |
| `AppRoutes-*.js` | 73.31 kB | 16.36 kB | Within 200 kB gate |

**Size-check result (`npm run size-check`):**

```
✓ AppRoutes: 72kB (limit 195kB)
❌ BotMatchScreen: 278kB exceeds 244kB limit
✓ index: 627kB (limit 684kB)
```

Vite warns chunks > 500 kB. `vite.config.ts` manualChunks splits recharts, supabase, socket, confetti — good, but **BotMatchScreen** and **lessonV2** are not isolated behind stricter gates.

### 3.2 Code splitting / lazy loading

**Positive:** `AppRoutes.tsx` uses `React.lazy` for **25** route surfaces (home, solo hub, bot, Fritz, ghost, daily modes, stats, friends, tournament, learn, journey, etc.) with `Suspense` + `ScreenLoader`.

**Partial:** `lessonV2` is dynamically imported in some paths (`AppRoutes.tsx` L213, L261) but **statically imported** across guided/bot modules (`useGuidedLessonBoot.ts`, `resolveInitialBotMatchState.ts`, `useAuthoringCapture.ts`, etc.), producing the 1.3 MB chunk tied to bot match.

**Negative:** `App.tsx` (1,607 lines) eagerly imports multiplayer runtime, socket bus, tournament session, and match CSS — central orchestration re-renders propagate widely.

### 3.3 React render optimization

| Signal | Evidence |
|--------|----------|
| `useMemo` / `useCallback` / `React.memo` | **~90+ files** use memoization hooks; `Board.tsx` has 17 `useMemo`/`useCallback` |
| Render profiler | `debug/renderProfiler.ts` — DEV-only via `localStorage RENDER_PROFILE=1` |
| StrictMode | `main.tsx` L39 — double invocation in development |
| Context providers | `MultiplayerRuntimeProvider` wraps app shell (`App.tsx` L1514–1605); narrow second context `MultiplayerConnectionContext` |

**Risk:** God-component `App.tsx` holds extensive state and refs; any top-level state change can cascade. No evidence of systematic `React.memo` on heavy leaves (Board, match HUD).

### 3.4 Effects and main-thread work

| Pattern | Evidence | Assessment |
|---------|----------|------------|
| Web Worker | `useDailyPuzzleValidatorWorker.ts` — puzzle validation off main thread; terminates on unmount | ✅ Good |
| Timers / rAF | **70+ files** reference `setInterval`/`setTimeout`/`requestAnimationFrame` | ⚠️ Requires discipline; many have cleanup `return () =>` |
| Canvas / confetti | `canvas-confetti` in vendor chunk (10.68 kB) | Low risk |
| Recharts | 396 kB vendor chunk | ⚠️ Only needed on rating history — already chunked |

### 3.5 CSS / layout performance

- `main.tsx` loads **12 global stylesheets** before route CSS (tokens, walnut-live, board index, match HUD, etc.) — increases initial style recalculation cost.
- `100dvh` + `overflow: hidden` on shell (`index.css`, `App.css`) — correct viewport lock; reduces accidental scroll thrashing.
- Animation-heavy CSS across match/learn modes — GPU/compositing load on mid-tier phones.

### 3.6 Image optimization

- Limited `loading="lazy"` usage (~11 TSX/CSS image references).
- Home/solo modes use CSS background art (`RacehorseHomeArt.css`) — no responsive `srcset`/WebP pipeline evident.
- **No** centralized image CDN or build-time format conversion.

### 3.7 Supabase client efficiency

- Single shared client (`lib/supabase.ts`) with `persistSession` + `autoRefreshToken`.
- `useAuth.ts` — `onAuthStateChange` with `subscription.unsubscribe()` on cleanup (L455–489).
- Profile/bootstrap calls use explicit timeouts (`PROFILE_REQUEST_TIMEOUT_MS` 5000, `AUTH_REQUEST_TIMEOUT_MS` 15000) — avoids indefinite hangs.
- **No realtime channel subscriptions** found in client grep — reduces listener leak surface vs. heavy Firestore listener apps.

---

## 4. Memory Audit

### 4.1 Socket lifecycle

| Mechanism | Evidence |
|-----------|----------|
| Detach on re-attach | `socketEventBus.ts` `attachSocketEventBus` — calls existing detach before re-register; `socket.offAny` + per-event `off` (L611–650) |
| Disconnect on reconnect | `useMultiplayerConnection.ts` — `oldSocket.disconnect()` (L380), explicit disconnect paths (L430, L498) |
| Ping timer | `SocketWithPing.__mpPingTimer` typed — implies interval cleanup responsibility in connection hook |

### 4.2 Workers and observers

| Resource | Cleanup |
|----------|---------|
| Validator worker | `useDailyPuzzleValidatorWorker.ts` L115–123 — `terminate()`, reject pending |
| ResizeObserver | `useResponsiveHandTileSize.ts` — test asserts `removeEventListener` |
| Board observer | `Board.tsx` L816 — `observer.disconnect()` |

### 4.3 Maps and telemetry caps

- `mpTelemetry.ts` — `MP_TELEMETRY_EPISODE_MAP_MAX_SIZE = 50`; evicts oldest episode keys.
- `socketEventBus` — fingerprint ring buffer (reset in tests); production dedup structures bounded by design.

### 4.4 Remaining memory risks

| Risk | Evidence |
|------|----------|
| Long-lived `App.tsx` refs | Many `useRef` maps across multiplayer/tournament — depend on explicit teardown on mode exit |
| `localStorage` growth | Guided authoring, journey, pivotal review, match recovery keys — unbounded user content in browser |
| Learn lesson data in memory | `lessonV2` chunk + runtime lesson graphs for guided bot |
| Server `rooms` Map | Grows with concurrent rooms; cleared only on `deleteRoom` or process exit — no TTL sweep documented in `rooms.ts` excerpt |

**No systematic leak** was found in socket attach/detach paths; risk is **accumulation under long sessions** (localStorage, episode maps) rather than classic orphaned listeners.

---

## 5. Error Handling Audit

### 5.1 Client global handling

```typescript
// debug/globalErrors.ts
window.addEventListener('error', ...)
window.addEventListener('unhandledrejection', ...)
// + module-import failure recovery via sessionStorage one-shot reload
```

- Logs via `logger.error` → **Sentry.captureException** always on errors.
- Stale deploy chunk recovery (`rh:module-import-recovery` in `sessionStorage`) — production-deploy mismatch mitigation.

### 5.2 React boundaries

| Location | Context label |
|----------|---------------|
| `App.tsx` | App shell |
| `AppRoutes.tsx` | bot-match, daily-puzzle, journey, tournament, multiplayer |
| `LiveMatchScreen.tsx` | Board subtree |
| `BotMatchBoardStage.tsx` | Board stage |

`DefaultErrorFallback.tsx` — user-facing recovery (Try again / Return home); stack trace **DEV-only**.

### 5.3 Auth and API failures

- `useAuth.ts` — timeouts on profile upsert, sign-out, session bootstrap; continues without blocking on `ensureProfile` failure (warn + proceed).
- `dailyFritz/api.ts`, `dailyPuzzle/api.ts` — detect HTML responses (misconfigured `VITE_SERVER_URL`) with explicit error messages.
- `resolveGameServerUrl()` — warns once in PROD if `VITE_SERVER_URL` missing; falls back to hardcoded Render URL for known Vercel hosts.

### 5.4 WebSocket / multiplayer failures

- Recovery machine with terminal join error detection (`isTerminalJoinError`).
- Join-ack coordinator with timeout telemetry (`joinAckTimeout` counter).
- Resync queue with stale-episode drops (telemetry counters in `mpTelemetry.ts`).
- Post-game exit contract (`postGameExit.ts`) — tested (`postGameExit.test.ts`).

### 5.5 Server failures

- Express JSON body limit 2 MB (`index.ts` L341).
- `unhandledRejection` / `uncaughtException` → Sentry + structured console (`index.ts` L721–728).
- `validateRecordUserMatchInput` — schema validation before stats writes.
- `validateDailyPuzzleSubmission` — server-side puzzle validation with tests.

### 5.6 Recoverability assessment

| Failure class | Recoverable? | Gap |
|---------------|-------------|-----|
| React render throw | ✅ Boundary + fallback | Message claims "progress saved" without verifying |
| Stale JS chunk after deploy | ✅ One-shot reload | — |
| Socket disconnect | ✅ Recovery machine | Exhaustion path needs ops runbook |
| Supabase down | ⚠️ Partial | `/ready` fails; client modes degrade unevenly |
| Server restart mid-match | ❌ | In-memory rooms lost |
| Auth token expired | ✅ Supabase auto-refresh | — |
| Daily submit invalid | ✅ Server rejection | Client must surface reason clearly |

---

## 6. Security Audit

### 6.1 Trust model

| Layer | Posture | Evidence |
|-------|---------|----------|
| Socket identity | Server trusts `socket.data.userId` after auth handshake | `identity.test.ts` rejects payload spoofing |
| REST auth | `getAuthenticatedUserId` validates token via Supabase `/auth/v1/user` | `supabaseAuth.ts` L30–70 |
| Rate-limit key | `getUserIdFromAuthHeaderSync` decodes JWT `sub` **without signature verify** | Used only for rate-limit bucket key (`index.ts` L346–351), not authorization |
| Game moves | Server-side handlers validate room membership | Multiplayer handler tests |
| Daily puzzle scores | Server recomputes/validates | `dailyPuzzleSubmissionValidation.ts` |
| Admin mutations | `isAdminSecret(req.body?.adminKey)` vs `ADMIN_SECRET` | `adminSecret.ts` constant-time compare |

### 6.2 Client-side security concerns

| Issue | Evidence | Severity |
|-------|----------|----------|
| Admin UI gate | `isAdmin` = email matches `VITE_ADMIN_EMAIL` (`useAuthSession.ts` L45–48) | **Medium** — UI-only; server must enforce (does for admin API) |
| Debug surfaces in prod | `VITE_DEBUG_DAILY_FRITZ`, `VITE_DEBUG_BOT_MATCH`, `VITE_FAIRNESS_LOG` | **Low–Medium** — expose diagnostics if env mis-set |
| `mp_telemetry=1` in localStorage | `logger.ts` L24 — enables console operational logs in PROD | **Low** — noisy, not secret |
| Hardcoded production server URL | `gameServerUrl.ts` L17 — `racehorse.onrender.com` | **Low** — coupling; not a secret |
| Supabase anon key in client | Expected; RLS must protect data | Depends on Supabase policies (not fully audited here) |
| Secrets in repo | Service key server-only (`supabaseUtils.ts`); no keys in client bundle | ✅ |

### 6.3 Storage

**localStorage / sessionStorage** used in **45+ client files** for: match recovery, guest identity, mute preference, guided authoring, journey progress, pivotal review, bot debug flags, email verification pending, module-import recovery.

**Risks:** XSS could exfiltrate recovery tokens and guest identity; no encryption at rest. Standard web threat model — depends on CSP and dependency hygiene.

### 6.4 CORS and rate limiting

- CORS: configurable `CORS_ALLOWED_ORIGINS` + `CLIENT_URL` (`index.ts` L295–337).
- Rate limits: in-memory `InMemoryRateLimiter` — **per server instance**, not distributed; resets on restart; acceptable for single-instance beta, **weak at multi-instance scale**.

### 6.5 Cron / backdoor endpoints

- `DAILY_PUZZLE_CRON_SECRET` for cron routes (`dailyPuzzleStore.ts` L101–108).
- `ADMIN_SECRET` for Fritz invalidation, ranking process, league jobs.
- No evidence of undocumented admin routes without secret checks in sampled handlers.

---

## 7. Accessibility Audit

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Keyboard navigation | Partial | Buttons/modals inconsistent; board tile selection is pointer-first |
| Focus management | Weak | `primitives/Modal.tsx` — Escape only; **no focus trap** |
| ARIA | Partial | `ScreenLoader` `role="status"`; some screens rich in `aria-*` (e.g. `DailyFritzHubView` 28 matches, `MatchmakingScreen` 31) |
| Dialog semantics | Partial | `role="dialog"` + `aria-modal` on primitive Modal only; auth/leave/game-over overlays vary |
| Contrast | Not machine-verified | Dark-theme product; no automated contrast CI |
| Reduced motion | **Poor** | **3** `prefers-reduced-motion` matches in entire client |
| Semantic HTML | Mixed | Layout div-heavy; some landmarks via components |
| Screen readers | Unverified | No axe/playwright a11y suite in CI |

**Production impact:** Playable for many users; **not compliant** for accessibility-sensitive deployments or store policies requiring WCAG conformance.

---

## 8. Mobile Readiness Audit

| Area | Evidence | Assessment |
|------|----------|------------|
| Viewport | `100dvh`, `overflow-x: hidden` (`index.css`, `App.css`) | ✅ |
| Safe areas | `env(safe-area-inset-*)` in `App.css` (27 references) | ✅ |
| Orientation | `rotate-phone-overlay` z-index 3000 (`App.css`) | ✅ Prompt exists |
| Touch targets | Mixed — some 32px close buttons (`Modal.css` L57–58) | ⚠️ Below 44px HIG guideline |
| Overscroll | Shell `overflow: hidden` | ✅ Reduces rubber-banding |
| Keyboard (virtual) | Limited `visualViewport` handling found | ⚠️ Input-heavy auth modals may clip |
| Safari | HashRouter (`main.tsx`) — avoids server path issues on static host | ✅ |
| Android | No Android-specific code paths | Neutral |
| Performance | 642 kB + route chunks on cellular | ⚠️ First interactive delay on 3G |

---

## 9. Observability Audit

### 9.1 What exists

| Signal | Implementation |
|--------|----------------|
| Crash reporting | Sentry client (`main.tsx` L3–10, PROD + DSN); server (`index.ts` L4–10) |
| Structured logger | `utils/logger.ts` — error→Sentry; operational→breadcrumb |
| MP telemetry | `mpTelemetry.ts` counters + `logger.operational` |
| Socket trace | `debug/socketTrace.ts` attached to global errors |
| Health | `/health`, `/ping`, `/ready` with Supabase latency, socket/room counts |
| Release tagging | `VITE_APP_VERSION`, `RENDER_GIT_COMMIT`, `/health` release field |
| Render profiling | DEV-only `RENDER_PROFILE` localStorage flag |

### 9.2 Gaps

| Gap | Evidence |
|-----|----------|
| Product analytics | None implemented — runbook L18 "Plan only" |
| Sentry requires DSN env | Disabled if unset (`enabled: import.meta.env.PROD && Boolean(DSN)`) |
| Server logs largely `console` | Not structured JSON; noisy socket logs per runbook |
| No RUM / Web Vitals | No LCP/FID/CLS collection |
| Client board debug | Gated by env flags — good — but no centralized prod sampling |
| Alerting | Not in repo — operational concern |

**Verdict:** Incidents **can be diagnosed** if Sentry + `/ready` monitoring are configured; **product funnel issues cannot** without analytics.

---

## 10. Developer Experience Audit

### 10.1 Scripts (`client/package.json`)

| Category | Commands |
|----------|----------|
| Build | `build`, `typecheck`, `preview` |
| Test | `test`, `test:all`, `test:coverage`, extensive `test:bot:*`, `test:recovery-machine` |
| Quality | `lint`, `lint:css`, `check:deps`, `check:multiplayer-arch`, `check:architecture`, `check:socket-registry` |
| E2E | `e2e`, `e2e:ui`, `e2e:headed` |
| Perf | `size-check` |
| QA | `qa:journey-content`, `qa:daily-fritz:hand-lifecycle` |

### 10.2 CI matrices

| Workflow | Trigger | Scope |
|----------|---------|-------|
| `client-ci.yml` | PR touching `client/**` | Full gate including E2E + size-check |
| `ci.yml` | Push to `main` | Server test + client build; lint continue-on-error |

### 10.3 Documentation

- `docs/production-observability-and-release-runbook.md` — operational (partially superseded by Sentry integration).
- `Agents.md` — product/engineering rules.
- `ARCHITECTURE-BLUEPRINT.md` — architecture reference.
- No single `CONTRIBUTING.md` onboarding doc found at repo root.

### 10.4 Test coverage posture

- Client vitest thresholds: **35% statements, 17% branches** (`vite.config.ts`) — floor is low but enforced.
- Server: **512/513 tests pass**; **1 failure** in `clientRecoverySignals.test.ts`.
- E2E: smoke (home, solo, daily, Fritz, tournament) + `multiplayer-chaos.spec.ts`.

### 10.5 Production build

- Client: `tsc -b && vite build` — succeeds; size-check **fails** on BotMatchScreen.
- Server: `tsc` compile to `dist/`.
- ESLint: `--max-warnings 600` — tolerates significant warning debt.

---

## 11. Technical Debt (Production-Impact Only)

| Debt | Production impact |
|------|-------------------|
| BotMatchScreen bundle over CI limit | **Blocks green PR CI** for client |
| `lessonV2` 1.3 MB chunk | Slow bot/guided cold start on mobile |
| `App.tsx` 1,607-line orchestrator | Regression risk; hard-to-isolate perf bugs |
| In-memory `rooms` Map | **Data loss on deploy**; caps horizontal scale |
| In-memory rate limiter | Uneven protection multi-instance |
| Client `isAdmin` email check | Misleading security if confused with server auth |
| 600 ESLint warnings budget | Latent bug classes slip through |
| Main-branch CI skips client E2E/size-check | Regressions can land on `main` |
| 1 failing server recovery test | Tournament tab-visibility recovery may be incomplete |
| No product analytics | Cannot measure drop-off at scale |
| DefaultErrorFallback "progress saved" | Overpromises without verification |

---

## 12. Top 50 Production Risks

| # | Risk | Severity | Evidence |
|---|------|----------|----------|
| 1 | BotMatchScreen bundle exceeds CI limit | **High** | `size-check` exit 1 |
| 2 | `lessonV2` 1.3 MB chunk | **High** | Vite build output |
| 3 | Live rooms lost on server restart | **High** | `rooms.ts` in-memory Map |
| 4 | No horizontal room scaling | **High** | Same |
| 5 | Sentry disabled without DSN | **High** | `main.tsx` `enabled` guard |
| 6 | No product analytics | **Medium** | Runbook + grep |
| 7 | Main CI weaker than PR CI | **Medium** | `ci.yml` vs `client-ci.yml` |
| 8 | 1 failing server recovery test | **Medium** | `clientRecoverySignals.test.ts` |
| 9 | `App.tsx` god-component re-render cascade | **Medium** | 1,607 lines |
| 10 | 12 global CSS on boot | **Medium** | `main.tsx` L17–30 |
| 11 | 642 kB main JS bundle | **Medium** | Build output |
| 12 | recharts 396 kB vendor | **Low–Med** | Only rating history |
| 13 | In-memory rate limits per instance | **Medium** | `rateLimit.ts` |
| 14 | JWT decode for rate limit without verify | **Low** | `getUserIdFromAuthHeaderSync` |
| 15 | Client `isAdmin` email gate | **Medium** | `useAuthSession.ts` |
| 16 | `VITE_DEBUG_*` flags in production | **Medium** | Multiple modules |
| 17 | `mp_telemetry` localStorage verbose logs | **Low** | `logger.ts` |
| 18 | Missing `VITE_SERVER_URL` silent fallback | **Medium** | `gameServerUrl.ts` |
| 19 | Hardcoded Render URL | **Low** | `gameServerUrl.ts` L17 |
| 20 | localStorage recovery token XSS surface | **Medium** | `matchRecovery.ts` |
| 21 | No focus trap on modals | **Medium** | a11y |
| 22 | `prefers-reduced-motion` rare | **Medium** | 3 CSS matches |
| 23 | Touch targets < 44px in places | **Low–Med** | Modal close 32px |
| 24 | DefaultErrorFallback false "saved" claim | **Low** | `DefaultErrorFallback.tsx` L26 |
| 25 | StrictMode dev double effects | **Low** | Dev only |
| 26 | ESLint 600 warning budget | **Medium** | `package.json` |
| 27 | Low coverage thresholds (35%) | **Medium** | `vite.config.ts` |
| 28 | No Web Vitals monitoring | **Medium** | — |
| 29 | Server console logging not structured | **Medium** | Runbook |
| 30 | Raw socket/user IDs in server logs | **Medium** | Runbook L58–60 |
| 31 | Tournament scheduler single-instance | **Medium** | Runbook L46 |
| 32 | Supabase timeout without client-wide circuit breaker | **Medium** | Per-route handling |
| 33 | Guest identity in localStorage | **Low–Med** | `matchRecovery.ts` |
| 34 | Guided authoring localStorage bloat | **Low** | `guidedAuthoring.ts` |
| 35 | Daily puzzle worker fail-open? | **Low** | Worker `onerror` rejects pending |
| 36 | Canvas-confetti perf on low-end GPU | **Low** | vendor chunk |
| 37 | HashRouter SEO limitations | **Low** | Static game app |
| 38 | No CSP in production client headers | **Medium** | CSP only in vite dev server |
| 39 | `express.json` 2 MB limit DoS vector | **Low** | Mitigated by rate limit |
| 40 | Sim bot dev mode defaults | **Low** | `simBot.ts` NODE_ENV check |
| 41 | Legacy tournament flag | **Low** | `ENABLE_LEGACY_TOURNAMENTS` |
| 42 | Multiple z-index overlay stacks | **Low** | Incident debugging harder |
| 43 | No automated a11y CI | **Medium** | — |
| 44 | Image assets without lazy load | **Low–Med** | Home art |
| 45 | `continue-on-error` lint on main | **Medium** | `ci.yml` L39–41 |
| 46 | Behavior test suite runtime in CI | **Low** | Long PR times |
| 47 | Playwright E2E flakiness risk | **Medium** | Network/timing deps |
| 48 | Server `index.ts` 784 lines monolith | **Low–Med** | Ops complexity |
| 49 | Missing CONTRIBUTING onboarding | **Low** | DX |
| 50 | Observability runbook outdated on Sentry | **Low** | Doc says "no Sentry" |

---

## 13. Top 100 Highest-ROI Production Improvements

Ranked by **impact ÷ effort** for thousands of real users.

| Rank | Improvement | Impact | Effort |
|------|-------------|--------|--------|
| 1 | Fix BotMatchScreen bundle regression (split guided/lessonV2 from hot path) | Critical | High |
| 2 | Add `lessonV2` to `size-check` LIMITS or separate chunk budget | High | Low |
| 3 | Document + enforce deploy window for live matches (in-memory rooms) | Critical | Low |
| 4 | Require `VITE_SENTRY_DSN` + `SENTRY_DSN` in prod deploy checklist | Critical | Low |
| 5 | Align `ci.yml` main push with PR gates (E2E + size-check) | High | Low |
| 6 | Fix `clientRecoverySignals.test.ts` failure | High | Low |
| 7 | Lazy-load `lessonV2` from all bot/guided modules | Critical | High |
| 8 | Dynamic-import `recharts` only in `RatingHistoryPage` | Medium | Low |
| 9 | Defer non-critical global CSS to route entry | High | Medium |
| 10 | Split `App.tsx` state into mode-specific hooks/stores | High | High |
| 11 | Add Web Vitals reporting to Sentry | High | Medium |
| 12 | Implement minimal product analytics (privacy-safe events) | High | Medium |
| 13 | Add Playwright `@axe-core/playwright` smoke on home + match | High | Medium |
| 14 | Standardize modal focus trap + `aria-labelledby` | High | Medium |
| 15 | Global `prefers-reduced-motion` CSS override | Medium | Low |
| 16 | Increase touch targets to 44px minimum on primary controls | Medium | Low |
| 17 | Add production CSP headers at CDN/host | High | Medium |
| 18 | Redact/hash socket/user IDs in server prod logs | Medium | Medium |
| 19 | Structured JSON logging on server (pino/winston) | Medium | Medium |
| 20 | Redis-backed rate limiter for multi-instance future | Medium | High |
| 21 | Room persistence / graceful drain before deploy | Critical | High |
| 22 | `/ready` based load-balancer drain hook | High | Medium |
| 23 | Circuit breaker for Supabase client calls | Medium | Medium |
| 24 | Verify DefaultErrorFallback copy against actual persistence | Low | Low |
| 25 | Remove or server-verify client `isAdmin`-only features | Medium | Low |
| 26 | Block `VITE_DEBUG_*` in production builds via env validate | Medium | Low |
| 27 | Document `mp_telemetry` as internal-only | Low | Low |
| 28 | Add `loading="lazy"` to hero images | Medium | Low |
| 29 | WebP variants for large home art | Medium | Medium |
| 30 | Cap `localStorage` authoring payload size | Low | Low |
| 31 | Memo `Board` + match HUD heavy subtrees | Medium | Medium |
| 32 | Audit `App.tsx` subscriptions — split by `appMode` | High | High |
| 33 | Add bundle analyzer to CI artifact | Medium | Low |
| 34 | Lower ESLint max-warnings over time (600→300→100) | Medium | Medium |
| 35 | Raise vitest coverage floor to 45% statements | Medium | Medium |
| 36 | Add server integration test job in `ci.yml` | Medium | Low |
| 37 | E2E: daily Fritz complete flow | High | Medium |
| 38 | E2E: multiplayer reconnect scenario | High | High |
| 39 | Chaos E2E required on PR (already exists — ensure stable) | High | Medium |
| 40 | Add stale-room TTL sweeper on server | Medium | Medium |
| 41 | Expose `mpTelemetry` counters on `/ready` or admin metrics | Medium | Medium |
| 42 | Sentry release health + source maps upload in CI | High | Medium |
| 43 | Client source maps hidden but uploaded | Medium | Low |
| 44 | Add uptime check on `/ready` not just `/health` | High | Low |
| 45 | Alert on `uncaughtException` Sentry events | Critical | Low |
| 46 | Alert on sustained `joinAckTimeout` | High | Medium |
| 47 | Add submit-failure metric for daily puzzle | Medium | Low |
| 48 | Server-side daily Fritz completion idempotency audit | Medium | Low |
| 49 | Pen-test socket replay / double-submit | High | Medium |
| 50 | Review Supabase RLS policies (external audit) | Critical | Medium |
| 51 | Rotate `ADMIN_SECRET` runbook | Medium | Low |
| 52 | Ensure cron secrets not in client bundle | High | Low |
| 53 | Add `Referrer-Policy` + `X-Content-Type-Options` headers | Medium | Low |
| 54 | HSTS on production game server | Medium | Low |
| 55 | Virtual keyboard scroll fix for auth modals | Medium | Low |
| 56 | `visualViewport` resize handler for match tray | Medium | Medium |
| 57 | Reduce `walnut-live.css` global load — route-scope | Medium | Medium |
| 58 | Service worker for offline shell only (optional) | Low | High |
| 59 | Preconnect to `VITE_SERVER_URL` origin in `index.html` | Medium | Low |
| 60 | HTTP/2 server push not needed — skip | — | — |
| 61 | Compress Brotli at CDN for JS | Medium | Low |
| 62 | Tree-shake lucide-react imports per-icon | Low | Low |
| 63 | Replace seedrandom duplication if any | Low | Low |
| 64 | Worker pool for analyzer if used in prod UI | Low | Medium |
| 65 | Throttle confetti triggers on repeat wins | Low | Low |
| 66 | Add session replay sampling (Sentry) at 1% | Medium | Low |
| 67 | Document incident severity matrix | Medium | Low |
| 68 | On-call runbook link in `/health` internal doc | Low | Low |
| 69 | Feature flag service for LEARN/JOURNEY visibility | Low | Medium |
| 70 | Kill switch env for matchmaking | Medium | Low |
| 71 | Graceful degradation when Supabase unconfigured | Medium | Low |
| 72 | Guest→account merge conflict tests | Medium | Medium |
| 73 | Password recovery E2E | Medium | Medium |
| 74 | Email verification pending state timeout | Low | Low |
| 75 | Brute-force auth rate limit per IP | Medium | Medium |
| 76 | Socket connection storm limit per IP | Medium | Medium |
| 77 | Validate `CORS_ALLOWED_ORIGINS` in `/ready` | Medium | Low |
| 78 | Fail deploy if `CLIENT_URL` missing in prod | Medium | Low |
| 79 | Cross-region latency measurement | Low | High |
| 80 | Database connection pool metrics | Medium | Medium |
| 81 | Puzzle generation cron failure alert | Medium | Low |
| 82 | Daily ladder readiness gate before promote | High | Low |
| 83 | Tournament stale cleanup metrics | Medium | Low |
| 84 | Fritz pending match cleanup job monitor | Medium | Low |
| 85 | Bot match stale session cleanup | Medium | Low |
| 86 | Client memory snapshot devtool doc | Low | Low |
| 87 | Long-session soaker test (multiplayer) | High | High |
| 88 | Mobile Safari Playwright project | High | Medium |
| 89 | Android Chrome Playwright project | Medium | Medium |
| 90 | 3G throttled Lighthouse CI | High | Medium |
| 91 | CONTRIBUTING.md with local prod parity | Medium | Low |
| 92 | Env var template `.env.example` completeness | Medium | Low |
| 93 | Release changelog automation | Low | Medium |
| 94 | Canary deploy to 5% traffic | High | High |
| 95 | Auto-rollback on `/ready` failure | High | Medium |
| 96 | Status page integration | Medium | Medium |
| 97 | User-facing incident banner component | Medium | Medium |
| 98 | Post-deploy synthetic smoke cron | High | Low |
| 99 | Quarterly production readiness re-certification | High | Low |
| 100 | Track certification score trend in dashboard | Medium | Low |

---

## 14. Five-Year Maintainability Projection

### Year 0 (today)

- **Strengths:** Deep automated testing culture (behavior tests + E2E + architecture invariants); multiplayer recovery investment; server validation of competitive integrity (daily puzzle, stats); Sentry hooks ready.
- **Weaknesses:** Bundle regression; monolithic `App.tsx`; in-memory multiplayer; observability gaps (analytics, RUM); accessibility debt.

### Year 1 (status quo)

- User growth increases **incident volume** without analytics — product issues invisible until support tickets.
- BotMatch/guided bundle grows with features — **mobile churn** risk.
- Single-instance deploys during peak hours cause **social media-visible game loss**.
- ESLint warning debt compounds.

### Year 3 (status quo)

- Horizontal scaling attempted without room persistence → **split-brain matches** or forced single-instance cap.
- Onboarding new engineers slowed by `App.tsx` + `index.ts` orchestration size.
- Compliance requests (WCAG, SOC2 logging) expensive retrofits.

### Year 5 (status quo)

- **Operational fragility** under peak concurrent multiplayer without room store migration.
- Technical reputation strong for game logic correctness, weak for **platform SRE maturity**.

### Year 5 (if Top 20 improvements executed)

- Room drain + persistence path, bundle budgets enforced, Sentry+RUM+analytics, CI parity on main, a11y smoke — **viable PRODUCTION READY** posture for tens of thousands DAU with stated live-game deploy constraints.

---

## 15. Area-by-Area Summary Tables

### Performance checklist

| Item | Status |
|------|--------|
| Route lazy loading | ✅ Strong |
| Vendor chunk splitting | ✅ Partial |
| BotMatch bundle budget | ❌ Failing |
| Main-thread puzzle validation | ✅ Worker |
| Image optimization | ⚠️ Weak |
| Context/provider perf | ⚠️ App shell heavy |
| Animation perf | ⚠️ CSS-heavy match UI |
| Memoization | ⚠️ Inconsistent |

### Memory checklist

| Item | Status |
|------|--------|
| Socket listener cleanup | ✅ `socketEventBus` detach |
| Timer cleanup | ⚠️ Many sites — mostly patterned |
| Worker terminate | ✅ |
| Telemetry map bounds | ✅ |
| Server room Map growth | ⚠️ No TTL documented |

### Error handling checklist

| Item | Status |
|------|--------|
| Global handlers | ✅ |
| Sentry | ✅ (config-dependent) |
| Error boundaries | ✅ Major routes |
| Async auth timeouts | ✅ |
| Socket recovery | ✅ |
| Deploy chunk recovery | ✅ |
| Server validation | ✅ Daily puzzle + stats |

### Security checklist

| Item | Status |
|------|--------|
| Server socket identity | ✅ |
| Admin secret routes | ✅ |
| Client admin gate | ⚠️ UI only |
| Rate limiting | ⚠️ In-memory |
| Secrets in client | ✅ None found |
| Supabase RLS | ⚠️ Not audited here |
| CSP production | ❌ Dev only |

---

## 16. Certification Criteria for Re-Test

### NOT READY → READY WITH NOTES (current)

- [x] Production build succeeds
- [x] Automated test suite largely green (1 server fail)
- [x] Error boundaries on critical surfaces
- [x] Sentry integration present
- [x] Server-side score validation
- [ ] Bundle size CI green
- [ ] Full CI on main branch
- [ ] Sentry DSN configured in prod

### READY WITH NOTES → PRODUCTION READY

- [ ] BotMatchScreen + lessonV2 bundle budgets met
- [ ] Deploy runbook for live-room restarts published
- [ ] `/ready` monitored with alerts
- [ ] Product analytics minimum viable
- [ ] a11y smoke tests in CI
- [ ] All server tests green
- [ ] Web Vitals baseline established

### PRODUCTION READY → WORLD-CLASS

- [ ] Durable room state / horizontal scale
- [ ] Distributed rate limiting
- [ ] WCAG 2.1 AA on core flows
- [ ] Structured logging + metrics dashboard
- [ ] Canary deploys + synthetic monitoring
- [ ] 90th percentile mobile LCP < 2.5s on 4G

---

## 17. Audit Methodology

- Read-only scan of `client/src`, `server/src`, `.github/workflows`, `docs/`
- Production build: `npm run build --prefix client`
- Bundle gate: `npm run size-check --prefix client`
- Server tests: `npm run test --prefix server` (512 pass, 1 fail)
- Pattern greps: timers, listeners, storage, env flags, a11y attributes
- Cross-reference: `docs/production-observability-and-release-runbook.md` (noted drift vs. current Sentry code)

**No code was modified during this certification.**

---

## 18. Certification Statement

| Field | Value |
|-------|-------|
| **Certification** | **READY WITH NOTES** |
| **Overall Score** | **64 / 100** |
| **Recommended deployment** | Controlled beta / thousands of registered users with disclosed live-match restart policy |
| **Blockers before broad launch** | Fix bundle CI failure; configure Sentry; publish deploy runbook; fix server recovery test |
| **Strongest production asset** | Multiplayer recovery + server validation + deep CI |
| **Highest operational risk** | In-memory live rooms + missing analytics |

---

*Phase Z — Production Readiness Certification. Repository evidence only.*