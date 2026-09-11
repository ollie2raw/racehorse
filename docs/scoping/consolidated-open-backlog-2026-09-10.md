# Consolidated open backlog — all four standing docs

**Date:** 2026-09-10. Single cross-referenced list of everything **not yet
closed** across `FEATURE_COMPLETENESS_AUDIT.md`, `REFACTOR_OPPORTUNITIES.md`,
`HARDENING_PLAN.md`, `LAUNCH_READINESS_CHECKLIST.md` (+ `PRE_LAUNCH_HARDENING.md`,
which is an offshoot of the same pass).

Each item: **size** (cheap = hours / medium = 1–3 days / large = dedicated
project) × **readiness** (safe-now / needs-product-input / needs-human-or-dashboard
/ needs-dedicated-session).

**Bottom line up front:** the launch bar is met (`LAUNCH_READINESS` §1 empty),
every numbered System in `HARDENING_PLAN` and every R-item in
`REFACTOR_OPPORTUNITIES` §2 is closed, and `FEATURE_COMPLETENESS` §2 + §3 (S1–S8)
are done or deferred. Almost nothing on this list is both cheap and safe-now —
the cheap items are mostly already done (see §0) or need a human/product call,
and the substantive items are all `needs-dedicated-session`. The one exception
is **§1a** below.

---

## §1a — Cheap AND safe-now (surfaced 2026-09-10, not from the four audits)

| # | Item | Size | Notes |
|---|---|---|---|
| 0 | **Journey has no discoverable home-screen entry.** `/journey` (6 chapters, 108 nodes — a shipped premium mode) is reachable only by deep link or by returning from a journey challenge. It is not on the home mode-tab strip, the Single Player hub (Fritz + Ghost only), or the Learn hub. `APP_PRIMARY_TABS` lists `journey` under the Single Player tab's `activeModes` (so `/journey` highlights "Solo") but nothing navigates there. Same discoverability gap as the welcome modal, but independent of it. | cheap · safe-now | Add an entry: a Journey card on the Single Player hub (alongside Fritz / Ghost), or a home "Today's Race"-adjacent card, or a Learn-hub tile. Copy exists ("A long march through Fritz…"). No protected files; `SinglePlayerHubScreen.tsx` already has the card pattern. Surfaced while drafting the welcome-modal copy (#171) — **not tied to that decision.** |

---

## §0 — items these docs list as open that are actually already closed (doc drift)

Fix the docs when convenient; no work needed.

| Doc says open | Reality |
|---|---|
| `LAUNCH_READINESS` §2 **S1** — `LessonCoachPanelContent` name collision | **Done.** `BotGuidedMatchPanel.tsx` renamed it to `BotGuidedCoachPanelContent` with a full F3/D-CQ-6 comment. |
| `LAUNCH_READINESS` §2 **S2** — F11 3 dead `*ClassName` props | **Done.** `InGameBoardFrame` carries only the 2 live props (`handStackClassName`, `handFooterClassName`); the 3 dead ones are gone tree-wide. |
| `LAUNCH_READINESS` §3.1 — F6 / #126 `modules/guided/` Tiers 2–3 | **Done** — `2cb2b4ea` "F6 complete — Tier 3 shipped, #126 closed". |
| `FEATURE_COMPLETENESS` §3 **S1–S8** | S1–S5, S7, S8 merged (#159–#167) tonight; **S6** parked as a named investigation. |
| `FEATURE_COMPLETENESS` §3 **S3** decision (CI) | Done — validator added to CI in #161. |
| `PRE_LAUNCH_HARDENING` §4 items 1, 4, 5, 6 + T-15 | Done — H5 dashboard + PRs #149/#150/#151/#152. |

---

## §1 — Cheap, but NOT safe-now (needs a human, a dashboard, or a product call)

| # | Item | Source | Size | Why not safe-now |
|---|---|---|---|---|
| 1 | **Supabase Auth CAPTCHA** — enable (dashboard toggle + `captchaToken` on `signUp`) or record the POSTURE decision. | `PRE_LAUNCH_HARDENING` §1.2 | cheap | **needs-product-input** — already "deferred by maintainer decision"; only open as an unstated-vs-stated call. |
| 2 | **AU-6 `ADMIN_SECRET` hardening checklist** — header transport for the admin POSTs, drop the admin-UI `sessionStorage` of the secret, CSPRNG ≥32 bytes, consider IP allowlist. | `HARDENING_PLAN` §6.4 / `PRE_LAUNCH_HARDENING` §1.4 | medium | **needs-human** — must be done *before* anyone ever sets `ADMIN_SECRET` in prod; fail-closed today (`ADMIN_SECRET` unset, confirmed live). Not urgent while unset. |
| 3 | **`.vercel/project.json` mislink** — the local file links to a `racehorse-server` Vercel project; the frontend projects are `racehorsedominoes` / `racehorsedoms` and the server is on Render. | `ENGINEERING_GUARDRAILS.md` §5 / `HARDENING_PLAN` D-26 | cheap | **needs-human** — `.vercel/project.json` is gitignored, local-machine only; fix is `vercel link` (interactive). No repo impact. |
| 4 | **Confirm Vercel preview deployments are on** (the Guardrail #5 posture depends on it). | `ENGINEERING_GUARDRAILS.md` §5 | cheap | **needs-dashboard** |
| 5 | **`vercel env ls` check: `VITE_DEBUG_DAILY_FRITZ` unset in prod.** Fires 106 failed local requests / 5-min Fritz match; local console noise only, no prod data path. | `FEATURE_COMPLETENESS` §5.6 | cheap | **needs-dashboard** |
| 6 | **Supabase free-tier ceiling alerts** (500 MB DB, 5 GB egress/mo, 50k MAU) — no code lever; a usage-monitor decision. | `PRE_LAUNCH_HARDENING` §3.2 | cheap | **needs-dashboard** |
| 7 | **System 3 deploy check** — confirm the Daily-Fritz stranded-set reaper is live after the next Render deploy (a `daily-fritz-recovery` boot log line / `recovery_succeeded` event). | `HARDENING_PLAN` §3.4 | cheap | **needs-human** — one-time observation after a deploy. |
| 8 | **AU-1 follow-up** — verify Supabase project JWT expiry was actually lowered 3600→900s in the dashboard. | `HARDENING_PLAN` §6 (AU-1 "human, dashboard") | cheap | **needs-dashboard** |
| 9 | **GC-2** — `GAME_RULES_VERSION` rollout (human-action POSTURE). | `HARDENING_PLAN` §7 | cheap | **needs-human** |

---

## §2 — Needs-product-input (a decision, not an engineering task)

| # | Item | Source | Notes |
|---|---|---|---|
| 10 | **Welcome modal / onboarding** — a real shipped feature (first-visit mode-picker dialog) dropped by accident in the June 2026 `e8d3c23d` App split. State (`welcomeOpen`, `hasSeenWelcome` effect) survives in `useAppSessionUi`, wired to nothing. `phase-ac-client-polish-audit.md` classified it **IMPROVE**. See `welcome-modal-decision-package-*.md` + `welcome-modal-copy-drafts-*.md` (4 directions, PR #171). | `FEATURE_COMPLETENESS` §5.3 (adjacent) | Awaiting a copy-direction decision, then a build. |
| 11 | ~~`WeeklyStatsScreen`~~ — **DONE (PR #170)**. Wired to a "Weekly Recap" trigger on `/stats`; dead `weeklyStatsOpen` removed from `useAppSessionUi`. | (same split) | — |
| 12 | **Public profiles are auth-gated** — is that the intent? Sharing a profile link with a signed-out person gets them a gate. #142 fixed the *message*; the gate itself is a product call. | `FEATURE_COMPLETENESS` §5.2 | |
| 13 | **Learn → "Lesson Library · COMING SOON"** — inert card on a primary nav route advertising an unbuilt feature. Same for Single Player hub's "More modes coming soon" and Match Found's "Per-match stats coming soon". | `FEATURE_COMPLETENESS` §5.3 | Build / remove / leave as honest placeholder. |
| 14 | **`DefaultErrorFallback` says "Your progress has been saved."** unconditionally on every caught error. Rewording is easy; deciding the right copy is the open part. | `LAUNCH_READINESS` §3.5 | |
| 15 | **`ErrorBoundary context="auth-modals" fallback={null}`** — a failed auth-modal chunk makes "Sign In" silently inert. Fixing it well needs a design answer. | `LAUNCH_READINESS` §3.4 | |
| 16 | **Game Review chess-parity plan** — Batches 1–6 unimplemented, gated on an unapproved evaluation-model verdict; analyzer already held back from players. | `LAUNCH_READINESS` §3.4 (list) | |
| 17 | **CC-3** — `daily_puzzles` admin RLS gates on a hardcoded email. POSTURE; needs a prod RLS migration; do opportunistically next time that file is touched. | `HARDENING_PLAN` §13 D-22 | |

---

## §3 — Needs-dedicated-session (real projects; do not start as side tasks)

| # | Item | Source | Size | Notes |
|---|---|---|---|---|
| 18 | **D2 — `Board.tsx` decomposition** | `REFACTOR` §3 | large | Scoping: `D2-board-tsx-decomposition-scoping.md`. Tier-0 geometry move shipped (#173). 2026-09-10: confirmed `fritz-play-to-completion.spec.ts` exercises placement but **not** camera-fit (no framing/pan/zoom/re-fit assertions) — the doc's pre-req still didn't exist. Building `board-camera.spec.ts` now (mutation-tested, catches a broken double-click-refit; loop-testing 10×) as the real pre-req, then the hook extractions (`useBoardRenderLayout` → `useBoardPointerControls` → `useBoardCamera`) one PR each. |
| 19 | **D4 — `rooms.ts` (+ `generatePuzzles.ts`)** | `REFACTOR` §3 | large | **DECIDED 2026-09-10: skip, no further action.** Re-verified against the scoping doc: a split gains only legibility (1437 lines → ~6 files), no functional/perf improvement, and *removes* a real safety property — `act`/`actUnlocked`'s co-location, which exists precisely so a future edit can't call the unlocked core without the per-room lock. Recovering that needs a new architecture check just to make a cosmetic refactor safe. No `max-lines` ratchet forces this on the server, and `HARDENING` System 2 just certified the file "audited as written" — a restructure invalidates that until re-reviewed. `generatePuzzles.ts` — same call, low-value tidy, defer indefinitely. |
| 20 | **D5 — `App.tsx`** | `REFACTOR` §3 | large (incremental parts cheap) | Scoping: `D5-...md`. §6 already found PRs 1–4 don't exist as safe chips. 2026-09-10: **PR 5 also a no-go as scoped.** The doc missed `client/src/multiplayer/runtime/` — `createMultiplayerRuntime()` already consolidates the ~25 refs into one `MultiplayerRuntime` object, and `runtimeSelectors.ts`'s `selectLegacyAppSessionRuntime` (comment: "Legacy … selectors only, no construction") shows an in-progress internal migration the doc never examined. What's actually left in App.tsx is ~25 raw `useRef`s each read 2–6× directly by 6+ separate hook calls (`useMultiplayerResync`, `useMultiplayerRoomCallbacks`, `useMultiplayerConnectionHostParams`, three `useRegister*SocketHandlers`) — none single-consumer, no free corner to peel off. A `useMultiplayerConnectionLifecycle` extraction is either pure churn (wrap the refs, still return ~20 of them to feed the other hooks unchanged) or the full ~1-week all-or-nothing move the doc always flagged as the risk. **No small-reviable-commit path exists for PR-5 as scoped.** The real next step is different work — finishing that migration (consumer hooks reading the runtime object instead of raw refs) — and it touches CLAUDE.md-protected `client/src/multiplayer/`; needs its own scoping + sign-off, not folded into "PR-5." |
| 21 | **System 9's 5 parked items** — `modules/guided/` (18 files), `modules/daily-puzzle/` (2 files, likely dead), `client/src/match/board/` rendering, `useLiveMatchSession`'s composed hooks, the review hooks. System 9 is "closed for audited scope only" until these are re-opened. | `HARDENING_PLAN` D-18 | large | Overlaps D2 (`match/board/`) and F12 (`useLiveMatchSession`). |
| 22 | **FC-DEAD-1** — ~2k LOC of unmounted Fritz-Challenge server code + `fritz_challenge*` tables. `registerFritzChallengeRoutes` never called on `main` (404s). Deleting needs a proof-of-no-dependency pass; dropping tables needs its own migration. Carries the moot Guardrail #4 residual (`requireStateDigests` at `fritzChallenges.ts:407/:515`). | `LAUNCH_READINESS` §3.6 / `HARDENING_PLAN` "sixth pool" | medium | Pure deletion, but needs care. |
| 23 | **F12 / #127** — regroup `useLiveMatchSession`'s ~95-key return. Its own issue sequences #128 (F15) before it. | `LAUNCH_READINESS` §3.2 | large | Not small — rewrites a spread consumed across a socket-adjacent prop tree on a protected surface. |
| 24 | **F15 / #128** — composition test for `useLiveMatchSession` (~25-field mock harness). Mainly scaffolding for F12. | `LAUNCH_READINESS` §3.3 | medium | |
| 25 | **End-to-end "play to completion" coverage** for Play vs Fritz, Puzzle Rush, Tournament, Ghost, The Lab. Drivers are ~60 lines against stable selectors (proven this session); Ghost + The Lab have *zero* functional coverage. | `FEATURE_COMPLETENESS` §5.1 | medium–large | Unscoped, not hard. A Fritz-completion + Puzzle-Rush-run spec would be the highest value. |

---

## §4 — Deferred by explicit decision: REVISIT IF SCALE / ACCEPT (no action wanted)

Listed for completeness — each has a ratified verdict and a named revisit
trigger. **Do not touch without new live evidence.**

| ID | What | Verdict | Revisit trigger |
|---|---|---|---|
| **T-18 / T-19** | 0.1-CPU instance marginal for socket.io; lifecycle transitions fire late on wake | ACCEPTED RISK | paid-tier upgrade |
| **MP-G5, G7, G8, G9, G10, G11, G13** | private/matchmaking room restart & concurrency residuals (last-writer-wins terminal outcome, live-session resurrect, pre-game-draw timer, no boot recovery sweep, attach not lock-serialized, grace-timer race, two-guest-seat ambiguity) | REVISIT IF SCALE | traffic / instance count change |
| **DF-G3** | `withDailyFritzAttemptLock` in-process only (CAS holds integrity) | REVISIT IF SCALE | multi-instance |
| **DF-G4** | 2 Daily-Fritz command RPCs body-guard-deferred (grant lockdown holds) | REVISIT IF SCALE / defence-in-depth | next migration touching those RPC bodies |
| **DF-G5** | Puzzle Rush `/complete` no lock + unconditional finalize PATCH (deterministic replay ⇒ no corruption) | ACCEPT | "Step 3 if trivially cheap: add `&status=eq.in_progress` to the PATCH" — a 1-line change + test, but overriding an ACCEPT verdict needs re-ratification |
| **RK-3** | client rating-prediction omits server forfeit-outcome override (mispredicts a preview number) | REVISIT IF SCALE | — |
| **RK-7** | Fritz rematch / `bot_match_pending` gap | ACCEPT / DORMANT | not reachable today |
| **GC-3b** | detect *any* client reimplementation of an exported game-core function | REVISIT | — |
| **GC-7** | (game-core, accepted) | ACCEPT | — |
| **AU-2 / AU-5 / `InMemoryRateLimiter` ceiling** | in-memory rate limiter resets on deploy; socket limit keys on shared proxy pre-auth; limiter unbounded-by-design | REVISIT IF SCALE | shared-store (Redis/Upstash) move |
| **AU-7** | recovery-token URL-fragment window (well-mitigated) | ACCEPT | later client-auth pass (`flowType: 'pkce'`) |
| **`ranked_games.opponent_id`** | orphaned bare-uuid column, no longer a live FK | non-blocking posture | — |
| **Archive-table retention** | `daily_puzzle_attempts` / `_slot_results` / `_completions` — zero writers | ACCEPT | — |
| **F-misc** | consolidate 3 scattered multiset helpers (`multisetDiff` in protected `learn/`) | ACCEPT | — |
| **F16** | pivotal-review wizard — flag-off *and unfinished* (no `setPivotalReviewOpen(true)` anywhere) | ACCEPT | — |
| **`roomKind.ts` `legacy_league`** inert branches + `isLegacyLeagueRoom` guards | System 1/2 ratified | "safe to strip in a later cleanup" — but multiplayer-adjacent | — |
| **PostHog client event throttle** | no client-side event cap (1M/mo free) | REVISIT IF SCALE | marketing traffic |
| **`/ready` dedicated IP bound** | `/ready` runs a Supabase probe, not rate-limited (probe now 2s + circuit-breakable via #152) | REVISIT | — |
| **PRE_LAUNCH §2.3 residuals** | no alert on a Daily-Fritz stranded-set *spike*; no independent scheduled check on `dailyPuzzleGeneration.shouldAlert` | small, needs threshold judgment | — |

---

## §5 — Also on these docs, no action

- **`FEATURE_COMPLETENESS` §4** ("checked and clean") — marker comments,
  disabled tests, swallowed errors, error boundaries, empty states, Journey
  content, accessibility: all verified clean. Not a backlog.
- **`REFACTOR` §4** ("looks like an opportunity but isn't") — `dailyPuzzle/api.ts`
  not dead (live `normalizeBoardState` import); `packages/game-core/botHeuristics.ts`
  not a duplicate; type safety genuinely good (don't hunt `any`); 40 `max-lines`
  files are frozen not growing (budget pinned at 51). Do not re-discover.
- **`HARDENING_PLAN` D3** — game-core / client re-implementations
  (`openEndsGeometry`, `botEngine`, `glicko2`, Ghost move-log) — tracked in
  `HARDENING_PLAN` §7/§8.3/§9 + `ENGINEERING_GUARDRAILS.md` §2. A
  game-correctness project, not a cleanup. Not re-filed.

---

## The one-paragraph answer

Nothing is blocking. One cheap safe-now engineering item — **§1a: Journey has no
home-screen entry**. Everything else is three buckets: **(a)** a handful of
one-time human/dashboard confirmations (§1 — CAPTCHA posture, `vercel env ls`,
preview-deploys-on, the reaper deploy check); **(b)** product decisions on
half-built or placeholder surfaces (§2 — welcome modal, "coming soon" cards, the
auth-modal fallback — *WeeklyStatsScreen wired up in #170*); and **(c)** the
genuinely large projects (§3 — D2/D4/D5, System 9's 5 items, FC-DEAD-1 deletion,
F12/F15, and end-to-end mode coverage), of which **a Fritz/Puzzle-Rush completion
spec is the best value-per-risk** (D5's incremental path did **not** hold up —
see the D5 scoping doc §6). Everything else (§4) is a ratified REVISIT-IF-SCALE /
ACCEPT that should not be touched without new evidence.
