# Daily Fritz — Chess.com Platform Redesign Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development task-by-task.

**Goal:** Transform Daily Fritz from incident-driven dual-path architecture into a server-authoritative daily mode where players never strand, verification is async, and one code path owns resume + advance.

**Architecture:** Server owns cursor, set progress, and mid-hand checkpoints. Client is a thin command/view layer. Journal is the only verification evidence for modern attempts. Mutations always timeout with retry UX. Observability pages on bypass/strand rates.

**Tech Stack:** Express + Supabase (Postgres RPC), React client, `@racehorse/game-core` verifier, Playwright e2e, Sentry.

## Global Constraints

- Preserve gameplay rules unless explicitly changing them (AGENTS.md §4).
- Do not rewrite working bot/multiplayer systems opportunistically.
- Daily Fritz route blobs stay split (`dailyFritz*Route.ts` pattern); no new godfiles.
- Score/result writes go through verifier — no raw `req.body` score persistence.
- Homepage / Play vs Fritz visual identity unchanged for UI-only touch points.

---

## Target state (Chess.com daily shape)

```
POST /start  → { cursor, deal, resume_board?, set_progress, next_action }
Player acts  → local engine + journal append
POST /checkpoint (debounced) → server stores active_checkpoint
Hand ends    → POST /next-hand → server advances immediately, verify async
Game ends    → POST /record-game → server records game immediately, verify async
Set ends     → POST /complete → leaderboard rank
```

Client overlays driven by `next_action` + server phase, not guessed local state.

---

## Phase 1 — Stop stranding & consolidate evidence (1–2 weeks)

**Status:** Partially shipped (PR #15: record-game timeout, server checkpoints, saving watchdog).

- [ ] **1.1 Unified mutation client** — All DF POSTs use shared timeout + error taxonomy (`api.ts` → `dailyFritzMutations.ts`).
- [ ] **1.2 Journal-only for modern attempts** — Game completion + next-hand always pass `officialJournal`; move-log reconstruction legacy-only when journal missing AND attempt pre-journal.
- [ ] **1.3 Client Sentry** — `captureMessage` on saving timeout, cursor divergence, recovery_started/failed (tags: `daily_fritz_alert`, attempt_id).
- [ ] **1.4 Checkpoint under attempt lock** — Wrap `dailyFritzCheckpointRoute` in `withDailyFritzAttemptLock`.
- [ ] **1.5 Safari sound fix** — `.catch(() => {})` on `HTMLAudioElement.play()` (noise reduction).
- [ ] **1.6 Metrics export hook** — Persist `dailyFritzMetrics` counters to `daily_fritz_events` or Supabase metrics table (replace in-memory-only).

**Exit criteria:** Zero infinite overlays in e2e; journal used in record-game path; Sentry alert on bypass + saving timeout.

---

## Phase 2 — Server-authoritative UX (2–4 weeks)

- [ ] **2.1 Advance-first record-game** — Mirror next-hand: accept scores, return `set_result` + `next_game_number` immediately; verify async; mark `verification_status: rejected` on fail.
- [ ] **2.2 `next_action` on /start and /today** — Enum: `play_hand | between_games | finalize_set | view_results | locked`.
- [ ] **2.3 Collapse client overlay state machine** — Map server `next_action` to overlay; remove client guessing for between/saving/finalizing where possible.
- [ ] **2.4 Single resume loader** — Replace `loadPersistedDailyFritzMatch` + reconcile + server checkpoint merge with one `resolveDailyFritzSession(startResponse)`.
- [ ] **2.5 Merge authority cursor into match bootstrap** — One `DailyFritzMatchSession` reducer; delete torn-checkpoint guards.

**Exit criteria:** Hard refresh mid-set always restores from server alone; record-game p95 < 2s perceived (advance before verify completes).

---

## Phase 3 — Kill dual paths (4–8 weeks)

- [ ] **3.1 Transactional commands 100%** — Enable `DAILY_FRITZ_TRANSACTIONAL_COMMANDS` everywhere; delete legacy JSONB-only upsert path.
- [ ] **3.2 Normalize authority storage** — `verified_hands` / `verified_games` tables sole source; slim `attempt.result` to cursor + checkpoint + contract pointer.
- [ ] **3.3 Remove move-log transcript builder** — Delete reconstruction + sealBlockedHand paths after 30-day journal coverage metric = 0 failures.
- [ ] **3.4 Remove legacy score-only fallbacks** — Unranked advance only via explicit `unverified_fallback` policy, not silent legacy fields.
- [ ] **3.5 Outbox consumers** — Activity, social, leaderboard writes async from outbox (never block mutations).

**Exit criteria:** One server write path per mutation; no `legacy_unverified` new attempts.

---

## Phase 4 — Platform maturity (8–12 weeks)

- [ ] **4.1 Always-green e2e** — Full BO3 verified lifecycle in CI; un-skip terminal refresh test; fix `/today` post-reload.
- [ ] **4.2 Daily ops dashboard** — Challenge publish health, bypass rate, p99 mutation latency, active attempts.
- [ ] **4.3 Single Fritz engine contract** — Client/server engine parity CI gate (see `docs/fritz-trust-guardrails.md`).
- [ ] **4.4 Ranked vs casual daily modes** — Optional strict-verify path for competitive leaderboard slice.

---

## PR sequence (recommended)

| PR | Scope | Risk |
|----|--------|------|
| #16 | Phase 1 remainder (journal completion, Sentry, checkpoint lock) | Low |
| #17 | Advance-first record-game | Medium |
| #18 | Server `next_action` + overlay collapse | Medium |
| #19 | Single resume + session reducer | High |
| #20 | Transactional-only + legacy deletion | High |

---

## Files (primary ownership)

| Area | Paths |
|------|--------|
| Client orchestration | `client/src/dailyFritz/useDailyFritzRunController.ts`, `useDailyFritzInit.ts`, `api.ts` |
| Client match | `client/src/modules/daily/*`, `dailyFritzHandService.ts`, `dailyFritzSessionStorage.ts` |
| Server routes | `server/src/http/routes/dailyFritz*Route.ts`, `dailyFritzVerificationGlue.ts` |
| Verifier | `server/src/dailyFritzVerifier.ts`, `packages/game-core/src/dailyFritzJournal.ts` |
| Stores | `server/src/http/stores/dailyFritzStore.ts`, `dailyFritzCommandStore.ts` |
| Tests | `server/src/http/routes/dailyFritz*.test.ts`, `client/e2e/daily-fritz-*.spec.ts` |
