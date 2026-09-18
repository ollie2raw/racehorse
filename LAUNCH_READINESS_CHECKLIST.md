# Launch Readiness Checklist

Date: 2026-09-08
Scope: a **finite, closeable** synthesis of what is actually left across
`CODE_QUALITY_PLAN.md`, `HARDENING_PLAN.md`, `ENGINEERING_GUARDRAILS.md`, the
open tracking issues (#116, #126, #127, #128), and today's merged work
(PRs #124 / #129 / #130 / #131 — D-CQ-5, D-CQ-6, Guardrail §8, the solo
scrubber).

This is **not** an audit pass. No new findings were hunted. Everything below
already exists somewhere in those documents; this file only sorts it into
"blocks launch" / "cheap, finish it" / "explicitly deferred" and gives each
retained item a concrete definition of done.

**Rule this list is built on:** every item in §1 and §2 must be *closeable* —
it has an end state you can point at. Anything genuinely open-ended is named in
§3 and removed from the bar entirely.

---

## Where today's work left things

**Update, same day: all three Must-close items are now closed.** Since this
checklist was first written, every item it named as open on the launch bar —
M1, M2, and M3, plus the S3 Should-close item — has shipped, merged, and been
re-verified. In order:

- **M2 — RK-6, boot + periodic catch-up sweep for the ranking cron.**
  Investigated the mid-sweep-restart atomicity question first (found: already
  safe by construction — `commit_glicko_game_update` commits one game per
  Postgres transaction, so a restart mid-sweep loses no state and double-applies
  nothing). Shipped PR #132, merged. `HARDENING_PLAN.md` D-25.
- **S3 — Guardrail #5 direction call.** Ratified the scoping doc's own
  recommendation: no canary environment at this scale, Vercel-preview habit +
  the already-shipped light feature-flag manifest instead. Doc-only. Shipped
  PR #133, merged. `HARDENING_PLAN.md` D-26.
- **M1 — SA-4, completion lock for `/api/ghost/complete`.** Investigated the
  concurrency shape first (found: a genuine in-process TOCTOU on
  `verifiedMatch.status`, reachable within a single process — no multi-instance
  needed; `withDailyFritzAttemptLock`'s pattern ported directly with no wrinkle).
  Reproduced the race with a failing test before fixing it. Shipped PR #134,
  merged. `HARDENING_PLAN.md` D-27.
- **M3 — the authenticated mobile-reachability run (#116).** Set up a
  dedicated QA account, ran all 60 cases for real (0 skipped) — one finding
  (`/social` phone-landscape, sub-44px filter chips), fixed, re-ran clean
  (60/60). Shipped PR #135, merged. **A second finding then surfaced on the
  post-merge confirmation run** (`/social` phone-portrait, a different
  element, exposed rather than caused by #135 — the layout-shift theory
  confirmed by measurement, not left open). Fixed, PR #136.

After each merge, `main` was pulled and the **full bar re-run clean** on the
combined result — server build + vitest, client
typecheck/lint/lint:hooks/lint:css/check:deps/check:multiplayer-arch/
check:socket-registry/check:architecture (20/20 CERTIFIED)/check:bot-match-lazy
(fresh `--dist` build)/vitest — four independent changes landed back to back,
each confirmed not to have broken anything the others touched.

**§1 is now empty.** See below — this document's launch-readiness bar has been
reached.

Original note, still accurate: none of the four PRs merged the day this
document was first written (D-CQ-5, D-CQ-6, the STYLE batch, the solo
scrubber, Guardrail §8) were on the Must-close list — they were hygiene and
feature work. They contributed the two §2 items below (`LessonCoachPanelContent`,
the F11 correction), both still open, neither blocking.

---

## 1. Must-close before wider traffic

**§1 is empty.** All three items that started here — SA-4, RK-6, and the
authenticated reachability run — are closed, each with a merged PR and a
green full bar. Kept below, struck through, not deleted, so the record shows
what "done" actually meant for each rather than just a checkmark.

### ~~M1 — `/api/ghost/complete` has no double-completion lock (SA-4)~~ — CLOSED

**Source:** `HARDENING_PLAN.md` §11.3 SA-4, was ratified **REVISIT IF SCALE** at D-20.

**Closed 2026-09-08, PR #134, merged.** Investigated first: the race is a
genuine in-process TOCTOU on `verifiedMatch.status` (read from an in-memory
`Map` cache before either of two concurrent requests writes it back to
`'completed'`) — reachable within a single process, no multi-instance needed.
`withDailyFritzAttemptLock`'s pattern ported directly, no wrinkle.
`withGhostCompletionLock(matchId, …)` now wraps the route end-to-end. The
pre-fix race was reproduced with a failing test (2 concurrent completions → 2
Glicko applications) before the fix, then confirmed closed (exactly 1). SA-4's
row in `HARDENING_PLAN.md` §11.3 flipped to CLOSED, SA-INV-3 now HOLDS,
decision **D-27**. Full server vitest (220 files / 1310 tests) + build green.

### ~~M2 — rating-period cron has no boot-time catch-up sweep (RK-6)~~ — CLOSED

**Source:** `HARDENING_PLAN.md` §8.3 RK-6, was ratified **REVISIT IF SCALE** at D-15.

**Closed 2026-09-08, PR #132, merged.** Investigated first: the mid-sweep-restart
atomicity question was resolved as already-safe-by-construction —
`commit_glicko_game_update` commits one game's rating update in a single
Postgres transaction, and every sweep re-queries `rating_after=is.null` fresh,
so a restart mid-sweep loses no state and can't double-apply anything.
`startRankingCron()` now also fires `processAllPendingRatingGames()` at boot
(20s delay) and every 15 minutes, mirroring the `dailyFritzStrandedRecovery`
reaper pattern. A vitest case proves a mid-week pending game is processed on
the next tick without waiting for Sunday. RK-6's row in §8.3 flipped to CLOSED,
decision **D-25**. Full server vitest (219 files / 1306 tests) + build green.

### ~~M3 — run the authenticated mobile-reachability matrix once and fix what it finds (#116)~~ — CLOSED

**Source:** issue #116; harness landed as Phase 1 in PR #123 (`9afa5b20`).

**Why it was a blocker.** The blocking CI reachability gate runs as a
**guest**, so `/friends`, `/stats`, `/settings`, `/social`,
`/daily-fritz/leaderboard` and `/multiplayer/private` are measured on their
signed-out gate screens, not their real content. This is not hypothetical: it is
precisely how the 24px INVITE/REMOVE buttons and 30px back link on populated
`/friends` (#115) shipped past a green gate. Every one of those routes is a
screen a newly signed-up user lands on. The harness existed and auto-skipped —
the gap was that it had never actually been run against data.

**Closed 2026-09-08, PR #135, merged.**

**Setup — a dedicated QA account, created and driven end to end this session**
(no fixture, credentials, or identity carried over from before): a new account
(`daily-fritz-qa-reachability+<random>@qa.invalid`, username `daily_fritz_qa`)
created via the Supabase Auth Admin API with `email_confirm: true` — the
documented bypass, since `@qa.invalid` has no real inbox. Credentials and the
approved `DAILY_FRITZ_QA_USER_ID`/`DAILY_FRITZ_QA_USERNAME` saved to
`client/.env.qa.local` (gitignored via `.env*.local`), reusable in a future
session without repeating account creation. `npm run seed:reachability-qa`
run once, confirmed idempotent on a second run (`already-accepted` on all 3
friend rows, no duplicate writes).

**One deliberate deviation from the documented capture flow, stated
plainly:** `qa:capture-auth` expects a human to complete sign-in in a headed
browser window it opens. Since this account's credentials were generated and
held for this purpose (not a human's personal login), the session was minted
directly via `POST /auth/v1/token?grant_type=password` — the same endpoint
the app's own sign-in form calls — and written straight into the Playwright
storageState fixture shape, skipping the browser round-trip. Same credentials,
same REST call, same resulting session object. Validated against the spec's
own freshness check before use.

**The run — 60/60 executed, 0 skipped, first finding:** `npm run
e2e:reachability:authed` came back **59/60 pass**. The one failure:
`/social` at phone-landscape (844×390) — two sub-44px tap targets
(`.rh-sb-filter`'s "Wins" 52×30 and "Mentions" 73×30). Root cause:
`.rh-sb-filter` was `height: 30px` **unconditionally, at every breakpoint** —
it only failed at phone-landscape because WCAG 2.5.8's spacing exemption
(undersized targets are fine if every pair's centers are ≥24px apart)
covered it at phone-portrait/tablet-portrait, where the chips have more room;
at phone-landscape's wider row the filters pack tightly enough to lose that
exemption. **Fixed** — `height: 30px` → `min-height: 44px`, matching the
`min-height: 44px` convention already used for touch targets elsewhere in the
mobile CSS. PR #135, merged.

**A second finding, on the post-merge confirmation run — not the original
pass, worth having on record as its own thing rather than a footnote.**
Re-running `e2e:reachability:authed` against merged `main`, as part of the
same "confirm the combined result" discipline used after every PR this
session, turned up a **new** failure: `/social` at **phone-portrait** —
`.rh-sf-widget-link` ("View All Friends ›" in the friends rail card), 328×42,
`min-height: 42px` unconditionally — 2px under the floor, and not caused by
the #135 fix (different component entirely). **Confirmed the layout-shift
theory by measurement rather than leaving it as inference:** `.rh-sf-widget-
link` and `.rh-sb-filter` sit in the same `.rh-sf-layout-grid`, which
collapses to a single stacked column below 1080px — covering all three
reachability breakpoints. Probed `/social` at 390×844 with the real QA
session, forcing `.rh-sb-filter` back to its pre-#135 `height: 30px` via an
injected stylesheet: `.rh-sf-widget-link`'s document-relative position
shifted by **exactly 28px** between the two states — a 1:1 match against
`.rh-sb-filter`'s own wrapped-row height growth
(`(44−30)px × 2 rows = 28px`). **The record this belongs on:** these WCAG
2.5.8 spacing exemptions are not independent per-element facts — they're
coupled to whatever else shares the same layout flow, so fixing one
undersized target can silently flip the exemption state of an unrelated one
sharing that flow, in either direction. A reachability pass that's clean
today is not proof the next CSS change nearby won't quietly break something
that was only ever passing by exemption margin, not by design. **Fixed** —
same convention, `min-height: 42px` → `44px`. PR #136. Also grepped both
`activityFeedScreen.css` and `socialBoard.css` for other near-floor
interactive elements per instruction — found two more real, rendered,
currently-passing candidates (`.rh-sf-challenge-btn` 32px,
`.rh-sb-btn` 34px) and one dead one (`.rh-sf-chat-btn`, no consumer);
**reported, not fixed** — neither is a confirmed failure, so fixing them
blind would be scope creep beyond what this pass found. Re-ran clean (fresh
JSONL — the harness's `cells.jsonl` **appends across runs rather than
truncating**, worth knowing for any future confirmation pass): **60/60
pass**.

**Left open, not part of this close-out, not blocking:** the Phase-2 CI
direction (#116 option B "document and accept" vs C "opt-in non-blocking
job") — a documentation/process decision, not a defect, and the standing
constraint that put it there (CI has no Supabase secrets for client E2E, so
this pass stays local by design) is unchanged.

---

## 2. Should-close, cheap

Three items open (S3 shipped — see below). Each is a genuine quick win —
hours, not sessions — and each removes something that would otherwise read as
an open question later.

### S1 — `LessonCoachPanelContent` name collision (F3 leftover)

**Source:** `CODE_QUALITY_PLAN.md` §CQ9.2 / D-CQ-6, explicitly excluded from the
barrel-trim pass and recorded as still-open STYLE.

`client/src/bot/BotGuidedMatchPanel.tsx:5` declares a **local** `interface
LessonCoachPanelContent` that shadows the canonical
`modules/guided/guidedCoachPresentationTypes.ts:8` type of the same name. Two
independent declarations of one concept, one of which is the module's real
contract — a structural-typing trap waiting for the day the two shapes diverge.

**Done looks like:** the local interface is either renamed to something
unambiguous or replaced by an import of the canonical type · `tsc -b` green ·
full client vitest green · `check:architecture` 20/20 · the still-open-STYLE
note removed from §CQ9.2.F3, the D-CQ-6 decisions-log row, and the §CQ9.4
checklist · PR merged, CI green on `main`.

### S2 — F11: trim the 3 genuinely-dead `*ClassName` props and correct the plan row

**Source:** `CODE_QUALITY_PLAN.md` §CQ9.2 REFACTOR table (F11) + the §CQ9.4
"F11 — STOP" note.

The finding as written claims `MatchLiveLayout` never passes any of
`InGameBoardFrame`'s five `*ClassName` escape hatches. PR #124 correctly stopped
on it, because 2 of the 5 are live — `NoBrainerLabScreen.tsx:402–403` threads
`handStackClassName` / `handFooterClassName` through. But the **other three are
dead**: `studioShellClassName`, `boardZoneClassName` and `handDockClassName` are
declared and consumed inside `InGameBoardFrame.tsx` and passed by nobody, and
`InGameBoardFrame`'s only caller is `MatchLiveLayout`, which does not accept
them. The §CQ9.2 table still states the wrong version of the finding.

**Done looks like:** the 3 unpassed props removed from `InGameBoardFrameProps`
and their template interpolations collapsed, the 2 live props untouched · the
F11 row in §CQ9.2 rewritten to the corrected finding rather than left contradicting
the §CQ9.4 STOP note · `tsc -b` · full client vitest · `check:architecture` 20/20
· `check:deps` · PR merged, CI green on `main`.

### ~~S3 — Guardrail #5: make the direction call and record it~~ — CLOSED

**Source:** `ENGINEERING_GUARDRAILS.md` §5 (was the only guardrail reading
**NOT YET BUILT AT ALL**) + `docs/guardrail-5-staging-canary-scoping.md`.

**Closed 2026-09-08, PR #133, merged, doc-only.** Ratified the scoping doc's
own recommendation as written: no canary environment at this scale (none of
the three priced options would have caught AD-1, SA-6, or DF-STALE-1, and a
shadow-DB canary would have *masked* the two schema-drift ones); adopt (A)
Vercel preview deployments as a pre-merge habit and (B) the light
feature-flag manifest, already shipped. `ENGINEERING_GUARDRAILS.md` §5
rewritten to the accepted posture with the revisit triggers named (off Render
free tier, or ~50+ peak concurrent / ~1 deploy-a-day with live multiplayer).
`HARDENING_PLAN.md` decision **D-26**. One small human follow-up left open,
noted in §5 itself, not a blocker: confirm Vercel preview deployments are
actually on and fix the noted `.vercel/project.json` mislink.

### ~~S4 — confirm spectator mode is off in both prod environments~~ — CLOSED

**Source:** `HARDENING_PLAN.md` Appendix (Latent / dev-only).

Spectator / Live Now (`server/src/spectator/**`, `client/src/live/**`,
`spectator:{join,leave,list}`) is an **unaudited surface** — it has never had a
Step-1 pass — gated only by `ENABLE_SPECTATOR_MODE` / `VITE_ENABLE_SPECTATOR_MODE`
both needing to be the literal string `'true'`. Both default off, so this is a
confirmation rather than a fix, but "an unaudited socket surface is one env var
away from live" is worth five minutes of certainty before traffic widens.

**Closed 2026-09-08, confirmation only, no code change, no PR.**
`VITE_ENABLE_SPECTATOR_MODE`: confirmed absent via `vercel env ls` in both live
client projects (`racehorsedoms` — production, playracehorse.com — and
`racehorsedominoes`), across all three environments. `ENABLE_SPECTATOR_MODE`:
no Render dashboard access this session, so confirmed a different way rather
than left unchecked — live-probed the running prod server directly (connected
a real socket, emitted the always-registered, read-only `spectator:list` with
an ack callback; no ack ever fired, meaning no handler is registered, meaning
the flag is off — `registerSpectatorHandlersIfEnabled()` is confirmed by
source read to be the sole gate on every spectator socket handler).
Cross-validated the probe methodology itself against a false negative by
emitting a known unconditionally-registered event (`stats:weekly`) on the
same connection, which acked immediately with real data — ruling out "acks
never fire on this connection style" as an alternative explanation. Recorded
in `HARDENING_PLAN.md`'s Appendix entry, dated.

**Original "done looks like," superseded by the above (kept for the record):**
both variables confirmed absent-or-not-`'true'` in the
Render service env and the Vercel project env (all environments), and that
confirmation dated in the Appendix entry · no code change.

---

## 3. Explicitly deferred — not launch blockers

These are named here so they are visibly *decided*, not silently dropped. None
goes on the bar in §1. Each carries one sentence on why shipping without it is
fine.

**Open-ended projects**

1. **F6 / #126 — `modules/guided/` test coverage, Tiers 2–3.** Safe to defer:
   Tier 1 is landed and the tiers already written surfaced and fixed the only
   two real bugs in the area (F21, F22), so what remains buys confidence, not
   correctness.
2. **F12 / #127 — regroup `useLiveMatchSession`'s ~95-key return.** Safe to
   defer, and the direct answer to "is it actually small": **no.** It rewrites a
   spread consumed across a large socket-adjacent prop tree on a
   socket-lifecycle-coupled surface treated as protected, and its own tracking
   issue sequences #128 *before* it as a safety net — the code works today and
   the smell is legibility, not behaviour.
3. **F15 / #128 — composition test for `useLiveMatchSession`.** Safe to defer:
   the six sub-hooks are already tested individually; the missing piece is a
   ~25-field mock harness whose main value is as scaffolding for F12, which is
   itself deferred.
4. **Game Review chess-parity plan (`docs/game-review-chess-parity-implementation-plan.md`).**
   Safe to defer: Batches 1–6 are unimplemented and gated on an unapproved
   evaluation-model verdict, and the post-game analyzer was already deliberately
   held back from players (`97e47ae0`, 2026-08-15) — nothing regresses by leaving
   it where it is.
5. **Mid-match scrubber: multiplayer / tournament scope + the reconnect-backfill
   decision** (`docs/mid-match-move-scrubber-plan.md` §"Open decision"). Safe to
   defer: the solo scope shipped complete and gated to solo play, so the MP half
   is a feature increment, not an unfinished edge.
6. **FC-DEAD-1 cleanup** — ~2k LOC of unmounted Fritz-Challenge server code plus
   the `fritz_challenge*` tables. Safe to defer: `registerFritzChallengeRoutes`
   is never called on `main`, so the endpoints 404 and the code is inert where
   it sits; dropping the tables needs its own proof-of-no-dependency pass.
   **Carries the Guardrail #4 residual** (`requireStateDigests` omitted at
   `fritzChallenges.ts:407`/`:515`) — real, RT-2-shaped, and unreachable while
   the routes are unmounted; it becomes a revival task, not a hardening task.

**Small but not worth a dedicated pass**

7. **RK-3 — client rating-prediction omits the server's forfeit-outcome
   override.** Safe to defer: the rating of record is always server-computed;
   this mispredicts a preview number on forfeit-decided matches only.
8. **CC-3 — `daily_puzzles` admin RLS gates on a hardcoded email.** Safe to
   defer: it is a working single-admin mechanism whose only failure mode is the
   admin's own email changing, which is immediately visible and invisible to
   players; it needs a prod RLS migration, so it is not the cheap win it looks
   like.
9. **`ranked_games.opponent_id`** — orphaned bare-uuid column, no longer a live
   FK. Safe to defer: it is a stored id that no longer resolves, not a
   deletion-blocking constraint, and Guardrail #6 cannot see it by design.
10. **Archive-table retention** (`daily_puzzle_attempts` / `_slot_results` /
    `_completions`, now zero writers). Safe to defer: three tables with no
    writers and no readers cost storage and nothing else.
11. **F-misc — consolidate the three scattered multiset helpers.** Safe to
    defer: `multisetDiff` lives in CLAUDE.md-protected `learn/`, so a low-value
    tidy would touch a protected surface for no behavioural gain.
12. **F16 — the pivotal-review wizard.** Safe to defer, with a warning that must
    survive: it is flag-off *and unfinished* — no `setPivotalReviewOpen(true)`
    exists anywhere, so flipping `PIVOTAL_REVIEW_WIZARD_ENABLED` alone does not
    ship it.
13. **Guardrail #5 — actually building staging/canary.** Safe to defer: see S3;
    the scoping work concluded it would not have caught a single real incident
    this project has had.
14. **Guardrail #2's general case (GC-3b)** — detecting any client
    reimplementation of an exported `@racehorse/game-core` function. Safe to
    defer: the highest-signal slice (the rating constant table) is already
    enforced by INV-16, and the general mechanism has not been designed.
15. **Migrate the post-game dossier's H1-H8 per-hand accuracy to the
    calibrated model.** The headline `accuracy`/`grade` (C4, coverage-floor
    revision) already use `accuracyFromEvaluations`/`MINIMUM_COVERAGE_FLOOR`;
    the per-hand rows below them (`hand.handAccuracy`, `moveAnalyzer.ts`'s
    `analyzeHandMoves`) still average `classifyMove`'s legacy heuristic score
    -- unrelated to the new model, now visibly labeled as such (the
    "Per-hand scores use Fritz's classic scoring model" caption). Safe to
    defer: migrating the math itself needs its own hand-scoped corpus pull
    and its own `MINIMUM_COVERAGE_FLOOR`-equivalent constant -- the existing
    game-level floor was calibrated against full-game samples (46+
    decisions in the smallest real game); a single hand has ~8-15, so
    reusing the same floor would likely read most hands as "Partial" by
    construction, not a real finding. Real, separate calibration work, not
    a small fix.

---

## 4. The bar

**Once §1 is empty, that is launch readiness.** Not zero findings. Not an empty
§2, and certainly not an empty §3.

**As of 2026-09-08: §1 is empty. All three Must-close items — SA-4, RK-6, and
M3 (the authenticated reachability run) — are closed, merged, and re-verified
on `main`.** This is the launch-readiness bar this document exists to define,
reached. Everything in §2 is worth finishing and none of it gates anything.
Everything in §3 has been looked at and deliberately set down.

New findings discovered after §1 is empty go into the normal
`CODE_QUALITY_PLAN.md` flow — Step-1 map, Step-2 grade, per-finding greenlight —
or, if a finding turns out to be a security or correctness bug, they are handed
to `HARDENING_PLAN.md`'s process as a dated finding plus a human call on
urgency, exactly as AD-1 and DF-STALE-1 were. **A new finding is a queue entry,
not a re-block.** The plans are designed to absorb findings indefinitely; the
launch bar is a fixed, finite list, and this is it.
