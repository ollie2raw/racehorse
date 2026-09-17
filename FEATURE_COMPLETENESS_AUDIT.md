# Feature Completeness Audit

Date: 2026-09-08
Scope: every user-facing route/mode reachable from the main nav or a deep link —
is it **actually finished**, or does it carry stub content, a marker comment on a
user-visible path, a disabled test, a blank empty state, or a swallowed error?

This is the opposite of `LAUNCH_READINESS_CHECKLIST.md`. That file was a
synthesis of findings that already existed. **This one is an audit pass** — every
item below was hunted fresh this session and verified against running code, not
inherited from another document.

**Same rule this list is built on:** every item in §2 and §3 must be *closeable* —
it has an end state you can point at. Anything genuinely open-ended is named in
§5 and removed from the bar entirely.

**Originally a report — nothing was fixed when it was written.** Update
2026-09-09: all four §2 (P1) items are now closed and merged — see §2 and §7.
§3 and §5 are untouched.

---

## 1. Method — what was actually exercised

Static:

- Full-tree grep for `TODO` / `FIXME` / `HACK` / `XXX` across `client/src`,
  `server/src`, `packages`, `scripts`, `supabase`.
- Full-tree grep for `.skip` / `.todo` / `.only` test markers (vitest + Playwright).
- Multiline scan for empty and comment-only `catch` blocks, and for
  `.catch(() => {})`-shaped noop rejection handlers.
- Read of every route component, the `AppMode` union, `appRoutePath.ts`,
  `useAppRouteState.ts`, both nav tab tables, and `ErrorBoundary` +
  `DefaultErrorFallback`.

Live, in a browser (Playwright, against a **fresh** server pair on isolated ports
— `:5233` client / `:3001` API — deliberately *not* the stale `:5173` dev server
that was already running, per the known reuse trap):

- **28-route guest sweep** — every static path, both dynamic patterns, plus five
  deliberately malformed URLs. Captured console errors, uncaught page errors,
  failed requests, final URL, and rendered text length (blank detection).
- **11-route authenticated sweep** — same, signed in as the QA account (fixture
  re-minted; the existing one had expired 2 minutes before this session started).
- **A full Play vs Fritz match played to completion** — 64 tiles, multiple hands,
  boneyard draws, through to the result screen.
- **Daily Fritz** — hub → Game 1 → ~30 real moves, then forced offline mid-match
  and recovered.
- **Multiplayer** — private lobby, forced offline and recovered.
- **Practice / The Lab, Puzzle Rush, Journey, Learn, Ghost, Tournament** — entered,
  driven as far as each allows, error conditions probed.
- Direct PostgREST probes to establish which Daily Puzzle tables still exist.

**What this pass did *not* do:** play a multiplayer match to completion across two
seats — the existing `multiplayer-in-match-reconnect.spec.ts` already drives 5
two-seat scenarios in depth (see §5.1), so the marginal value of repeating it
here was low — and play Journey or Puzzle Rush to chapter/run completion. Both
named in §5.

---

## 2. Findings that affect a shipped user path

**§2 is empty.** All four items that started here — P1-1, P1-2, P1-3, P1-4 —
are closed, each with a merged PR and a green full bar, and the combined result
re-verified on `main` after all four landed. They are kept below, struck
through and left in full, so the record shows what "done" actually meant for
each rather than just a checkmark.

Merge sequence (2026-09-09): #139 first (the real data fix, no conflicts),
then #142, #140, #141 — each rebased onto the then-current `main`, its trivial
`routing.spec.ts` / `PublicProfileScreen.test.tsx` conflicts resolved, full bar
re-run, CI green, then merged. Combined post-merge bar on `main`
(`75c32499`): `tsc -b` both packages · `lint` / `lint:hooks` / `lint:css` ·
`check:deps` · `check:architecture` 20/20 · `check:multiplayer-{arch,cycles}` ·
`check:socket-registry` · client `test:all` (218 files / 1627 tests + 39
behaviour-test files) · server vitest (all shards) · both builds — all green.

### ~~P1-1 — Daily Puzzle stats are computed from the retired Ladder's tables; Puzzle Rush is invisible~~ — CLOSED

**Closed 2026-09-09, PR #139, merged.** Investigated first. The audit's premise
held, plus one constraint it missed: `rush_runs` has **deny-all RLS**, so the
browser cannot read it — both surfaces had to be fed from the server (service
role). Source of truth is `rush_runs` **unioned with the frozen
`daily_puzzle_attempts` history**, the same additive union
`/api/home/daily-summary` already computes, so a streak in flight when Rush
shipped carries across the 2026-08-20 boundary without a gap. New pure
`server/src/puzzleRush/puzzleStatsSummary.ts` + `puzzleStatsStore.ts`; new
`GET /api/puzzle-rush/stats-summary` (auth); `statsApi` calls it (failure →
zeros, matching the old swallow); `socialProfile.ts` uses the shared builder.
"Perfect days" — a Ladder-only concept with no Rush day-level equivalent —
removed from both surfaces and the identity model rather than faked (decision
confirmed with the repo owner). The `daily_puzzle_completions` line in
`2026-09-02_daily_puzzle_ladder_decommission.sql` corrected: the table is
**absent from production** (`PGRST205`), probed directly. Verified against live
production data for `oliver` (`3d70f65e…`), the account the finding cited:
bestScoreEver **2163** (was a stale 800 labelled "all-time"), bestScoreToday
**1907**, completions **63** (was hardcoded 0), best streak **8**. Tests: builder
unit cases (era-boundary union, streak anchor/gap, 7-day window,
best-across-eras); store degrades to `[]` on a missing relation; a source guard
asserting `/stats` no longer names `daily_puzzle_completions` and routes through
the server endpoint — the test that would have caught this.

**The strongest finding in this pass, and it is not in any existing document.**

Puzzle Rush *became* the Daily Puzzle on 2026-08-20 and writes to `rush_runs` /
`rush_run_puzzles`. Both surfaces that display "Daily Puzzle" statistics still
read the **retired Ladder's** tables, so no Puzzle Rush activity has ever
appeared in either:

- **`/stats`** — `client/src/stats/statsApi.ts:138-157` reads
  `daily_puzzle_completions` and `daily_puzzle_scores`.
  `daily_puzzle_completions` **no longer exists in production.** Probed directly:
  `PGRST205 — Could not find the table 'public.daily_puzzle_completions' in the
  schema cache`. The four sibling tables (`daily_puzzle_scores`,
  `daily_puzzle_attempts`, `daily_puzzle_slot_results`, `daily_puzzles`) all
  return 200. The read is guarded by `if (!completionResp.error)`, so the failure
  is **silently swallowed** and `completionRows` stays `[]` — meaning
  `currentStreak`, `completions`, `completionsThisWeek` and `perfectDays`
  (`statsDerivations.ts:242-275`) are **hardcoded 0 for every user, forever**.
  Every `/stats` load fires a guaranteed-404 request.

- **`/players/:username`** — server path,
  `server/src/social/socialProfile.ts:110-116`, computes `puzzles_completed`,
  `best_puzzle_score` and `best_streak` **entirely from
  `daily_puzzle_attempts`** — the table the 2026-09-02 migration itself marks
  `RETIRED 2026-08-20 … Read-only historical`. That table still exists and still
  has rows, so this surface shows *plausible but stale* numbers rather than zeros.

**Confirmed end-to-end on real production data, not inferred.** `oliver`
(user `3d70f65e…`) has completed Puzzle Rush runs on 2026-08-31, 09-01, 09-04,
09-06 and 09-08 scoring up to **2163** (`rush_runs`, read via service role). His
public profile renders:

> `PUZZLE BEST | 800 | All-time Daily Puzzle score`
> `Daily Puzzle | 44 completions | — · best 800`

800 is his best *Ladder* score. The page labels it "All-time Daily Puzzle score"
— so this is not merely a missing stat, it is an **actively wrong number
presented as authoritative**, and the streak reads `—`.

The 2026-09-02 migration's own header comment says `daily_puzzle_completions` is
"Not touched (separate parked items DF-CAND-3 / DF-CAND-4)". Production says
otherwise. That comment is wrong and should be corrected as part of this.

**Done looks like:** a decision on the source of truth (`rush_runs` is the only
table with current-era data) · both readers repointed, or the puzzle stat blocks
removed from both surfaces if the product answer is "don't show it" · the
guaranteed-404 client read is gone · `/stats` and `/players/:u` show numbers
consistent with `rush_runs` for a user who has played Puzzle Rush · the
`daily_puzzle_completions` line in `2026-09-02_daily_puzzle_ladder_decommission.sql`
corrected to state the table is absent · a test that would have caught a
stat block reading a nonexistent table.

### ~~P1-2 — `/tournament/<unknown-id>` is a permanent "Loading bracket…" dead end~~ — CLOSED

**Closed 2026-09-09, PR #140, merged.** Root cause: `openBracket` was a bare
`await fetchAndApplyBracket` with no catch; every caller does
`void tournament.openBracket(id)`, so each 20s poll threw an uncaught rejection,
and the bracket screen's null state was an unconditional spinner.
`fetchAndApplyBracket` now catches and records `bracketError`
(`{ tournamentId, code }`, id-tagged so a stale error can't bleed onto another
tournament) instead of rethrowing — which also removes the uncaught rejection on
every caller, including the one the `/result` route triggers. The bracket screen
renders a real error state (friendly message + "Back to Tournament Home"),
matching the `/result` screen's pattern. New `tournamentErrorCopy` maps server
codes to human copy; the raw `invalid_tournament_id` is no longer shown on either
sub-route (`/result` printed it verbatim). Verified against the exact failure: a
new e2e case loads `/tournament/route-smoke` (not a UUID → a real
`400 invalid_tournament_id` from the server) and asserts the error copy appears,
the back button is visible, "Loading bracket…" has count 0, and the raw code
never appears — reproduces the hang and asserts it resolves. Plus unit tests for
the copy mapper and for `openBracket` resolving rather than rejecting.


Measured over 30 seconds: the screen shows nav chrome, "TOURNAMENT / Bracket /
**Loading bracket…**" and never resolves. The fetch fails with a 400
`invalid_tournament_id`, retries on a slow poll (6 attempts in 30s, still going
when the probe ended), and **each attempt throws an uncaught promise
rejection** — 6 `Error: invalid_tournament_id` page errors, none of which reaches
the user.

Mechanism: `client/src/routes/tournamentRoutes.tsx:68` —
`onLoadBracket={(id) => { void tournament.openBracket(id); }}` — and
`useTournament.ts:447`, where `openBracket` is a bare `await
fetchAndApplyBracket(...)` with no catch. `activeBracket` stays `null`, and the
bracket screen's null state is an unconditional spinner with no failure branch.

This is reachable by ordinary means: a shared bracket link for a tournament that
has since been cleaned up, a mistyped URL, or a stale bookmark. There *is* a
"Back to Tournament" link, so the user is not fully trapped — but nothing tells
them anything is wrong.

The sibling route `/tournament/<bad-id>/result` **does** handle this correctly —
it shows "Result unavailable / RETRY". The bracket route should match it. (Two
notes on the result route: it still emits one uncaught rejection, and it prints
the raw error code `invalid_tournament_id` as user-facing copy.)

**Done looks like:** a failed bracket load sets a visible error state with a route
back to the hub, matching the result screen's pattern · no uncaught rejection on
either tournament sub-route · the raw error code no longer shown as copy · an
e2e case loading `/tournament/<bad-id>` and asserting a real message, not a
spinner.

### ~~P1-3 — Puzzle Rush has no URL: not linkable, and a refresh drops you home~~ — CLOSED

**Closed 2026-09-09, PR #141, merged.** Confirmed: `puzzleRush` was in neither
`STATIC_PATHS` nor `buildAppPath`, and the hub has no in-progress-run recovery (a
run is entirely client-held), so it genuinely has nothing to hydrate and does
not belong in the Fritz/Ghost/Journey carve-out. `/puzzle-rush` →
`{ mode: 'puzzleRush' }` and `puzzleRush → '/puzzle-rush'`; the existing generic
mode↔path sync (App.tsx seeds `appMode` from `resolveAppRoute`, `useAppRouteState`
pushes on change and restores on popstate) handles direct-load, refresh, and
browser-back. Verified against the failure: a new e2e enters Puzzle Rush from the
Home card, asserts the URL becomes `/puzzle-rush`, reloads and confirms the mode
survives (not home), then browser-back returns to the homepage; `/puzzle-rush`
added to the approved-routes direct-load sweep; plus an `appRoutePath` unit
round-trip.


`puzzleRush` appears in neither `STATIC_PATHS` nor the `buildAppPath` map in
`client/src/routing/appRoutePath.ts`. Confirmed live: entering Puzzle Rush from
the Home card leaves the URL at `/`, and a hard refresh there returns to Home,
losing the mode.

`buildAppPath`'s comment explains this for `bot` / `ghost` / journey trials —
"Active … matches intentionally retain the existing root-path behavior until
their session state can be hydrated". Puzzle Rush is not one of those: it is the
**Daily Puzzle**, one of the two cards on the homepage, and its hub is a
static screen with nothing to hydrate. It is also the only primary mode that
cannot be linked to.

**Done looks like:** a path (e.g. `/puzzle-rush`) in both `STATIC_PATHS` and
`buildAppPath` · direct load and refresh keep the mode · browser back from it
returns Home · a case in `routing.spec.ts` alongside the other approved routes.

### ~~P1-4 — Signed-out visitors to `/players/:username` are told "Session expired"~~ — CLOSED

**Closed 2026-09-09, PR #142, merged.** Root cause: `apiFetch`'s 401 branch
returned a hardcoded "Session expired. Please sign in again." for *any* 401, even
a request that never carried a token. That branch now distinguishes — had a
token → "Session expired…" (`session_expired`); guest → "Sign in to continue."
(`auth_required`). `fetchPublicProfile` reads status/code: 401 → "Sign in to view
player profiles."; 404 → "We couldn't find a player called "x"." (a distinct
not-found). `PublicProfileScreen`'s failure state is now a real gate — the
message, a "Sign in" button (opens the auth modal, threaded through
`ProfileRoute`), and a "Back to home" link; guests get the gate regardless of the
raw error, signed-in users get the not-found / generic copy. Verified against the
failure: an e2e loads `/players/route-smoke` signed out and asserts "sign in to
view player profiles" appears, "session expired" has count 0, and both buttons
are visible; plus unit tests for `fetchPublicProfile` (401 → gate copy, never
"session expired"; 404 → username-named not-found) and `PublicProfileScreen`
(guest gate with working Sign in; signed-in distinct not-found, no Sign in
button). The endpoint itself is unchanged — profiles stay auth-gated by design.


A guest hitting any profile URL sees exactly:

> `← Session expired. Please sign in again.`

Identical for a real username (`/players/daily_fritz_qa`), a nonexistent one, and
a garbage segment (`/players/☠ <script>`) — 40 characters of text, no nav, no
route back except the arrow. Two distinct problems:

1. **The message is factually wrong** for someone who never had a session. This
   is the copy a first-time visitor sees when they follow a shared profile link —
   the most common way a new player would arrive.
2. **No not-found state.** A nonexistent player is indistinguishable from an
   expired session, so a typo'd link reads as an auth failure.

(The underlying request correctly 401s — profiles are auth-gated by design. This
is about what the client does with that, not about opening the endpoint up.)

**Done looks like:** a guest sees a correct gate ("Sign in to view player
profiles") with working navigation · a signed-in user requesting an unknown
username sees a distinct not-found state · both reachable from the sweep.

---

## 3. Should-close, cheap

### S1 — Nested `<button>` elements on `/friends`

Six instances (two per friend row): `.friends-page-action-btn` ("Invite" /
"Remove") rendered **inside** `.friends-page-row--selectable`, which is itself a
`<button>`. React logs it on every load:

> `In HTML, <button> cannot be a descendant of <button>. This will cause a
> hydration error.`

Invalid HTML, an accessibility defect (nested interactive controls are not
reliably operable by keyboard or AT), and a latent click-target conflict — the
row's select handler and the action handler both fire unless one stops
propagation. Worth noting this is the same component that shipped the 24px
tap-target bug in #115.

**Done looks like:** the row is not a `<button>` (or the actions move out of it) ·
no React nesting warning on `/friends` · row-select and Invite/Remove remain
independently operable, including by keyboard.

### S2 — `aria-label="Record placeholder"` ships on the Match Found overlay

`client/src/matchmaking/MatchFoundOverlay.tsx:154` and `:210` — both seats, on the
overlay shown before **every ranked multiplayer match**. Screen-reader users hear
the opponent's win/loss record announced as the words "Record placeholder". The
visible fallback (`— · — · —`) is fine; only the label is wrong.

Related, same file: the stats fetch behind those records is
`.catch(() => {})` (`:95`, `:113`), so a failed record lookup is indistinguishable
from a player with no record.

**Done looks like:** both `aria-label`s describe the actual content (e.g.
"Win–loss–draw record") · the empty case has a label that reads correctly when
the record is genuinely unknown.

### S3 — `npm run qa:journey-content` cannot run

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../client/src/utils/logger'
  imported from .../client/src/game/openEndsGeometry.ts
```

`scripts/validateJourneyContent.mjs` shells out to `ts-node --esm`, which cannot
resolve the extensionless TS imports this codebase uses. The **validator itself
is fine** — running the same runner under `tsx` passes:

> `Journey content validation passed.`
> `Normalized content: supported=90, legacyFallback=0, placeholder=18, unsupported=0`

So this is a one-line wrapper fix, not a content problem. But it matters, because
this script is the **only** thing that validates the real shipped Journey content:
`journeyContentValidation.test.ts` and `journeyContentResolver.test.ts` both run
against fixtures, and the script is not in CI. Today nothing would catch a
Journey node that resolves to `unsupported` (i.e. a dead node in a shipped
chapter).

**Done looks like:** `npm run qa:journey-content` runs green (swap `ts-node --esm`
for `tsx`) · a decision recorded on whether it joins CI, given it is the only
real-content check.

### S4 — Desktop and mobile nav disagree about which tab is active

There are two hand-maintained tab tables, and they drive **different surfaces**:

- `client/src/components/GlobalNav.tsx:48` (`TABS`) → the **desktop** nav row
  (`GlobalNav.tsx:284-285`, `isActive = tab.activeModes.includes(currentMode)`).
- `client/src/components/nav/appPrimaryTabs.ts:10` (`APP_PRIMARY_TABS`) → the
  **mobile bottom tab bar** (`AppBottomTabBar.tsx:69`).

They have drifted. `APP_PRIMARY_TABS` lists `dailyFritzLeaderboard`,
`dailyPuzzleLeaderboard`, `ratingHistory`, `guidedMatchRecorder` and
`guidedMatchAnnotator` among its `activeModes`; `GlobalNav`'s copy lists none of
them. So on the same route, mobile highlights "Solo"/"Learn" and desktop
highlights nothing.

**Narrowed to what is actually observable.** Several of those routes turn out not
to render the global nav at all (`/rating-history` and `/learn/guided-annotator`
render standalone screens — confirmed in the sweep, their page text has no
`RACEHORSE | Multiplayer | …` prefix), so they cannot exhibit the bug. The two
routes that **do** render the desktop nav and highlight no tab are:

- `/daily-fritz/leaderboard`
- `/learn/recorder`

`APP_PRIMARY_TABS` also carries `dailyPuzzleLeaderboard`, which is an orphaned
mode (S7) — the two items should be closed together.

This is the same failure shape `appRouteTypes.ts:27-38` already documents and
solved for the `AppMode` union ("This module used to carry a second,
hand-maintained copy … the two drifted the moment a mode was added to only one of
them"). Same fix applies.

**Done looks like:** one shared table drives both navs (`GlobalNav` imports
`APP_PRIMARY_TABS` / `APP_PRIMARY_TAB_COLORS` rather than declaring its own) ·
`/daily-fritz/leaderboard` and `/learn/recorder` highlight the correct desktop
tab · no second copy remains.

### S5 — Dead test: "daily puzzle loads a playable board state"

`client/e2e/match.spec.ts:71`, hard-skipped. Its stated reason is "pending real
E2E auth setup". That reason is stale: the test does `page.goto('/daily')` and
looks for a **"Start Daily Ladder"** button. The Daily Puzzle Ladder was retired
2026-08-20 and its routes removed; `/daily` no longer resolves (it falls through
to Home), and `daily` is an orphaned `AppMode` (see S7). The test cannot be
un-skipped — it tests a deleted feature.

**Done looks like:** the test is deleted (not re-enabled), and the Daily Puzzle
lifecycle case that *should* exist — a Puzzle Rush run — is either written or
explicitly deferred in §5.

### S6 — A parked, un-root-caused Daily Fritz refresh behaviour

`client/e2e/daily-fritz-server-restore.spec.ts:181`, hard-skipped, with an
unusually honest comment worth quoting because it names a **potential user-facing
bug**, not just a flaky test:

> `GET /today itself never fires within 30s post-reload in this specific
> scenario, for a reason not root-caused in this pass's budget — the hub page
> renders … but the "Game 1" card reads as still-in-progress ("Your move")
> rather than reflecting the completed state`

The underlying claim is proven at the server/route level by
`dailyFritzTodayCompletedRestore.test.ts`, and the skip was the right call over
committing red. But the client-side symptom — after finishing a Daily Fritz set,
a hard refresh may show the set as still in progress — has never been explained.
This is the only item on this list that is a *possible defect of unknown size*
rather than a known one.

**Done looks like:** the 30s no-request behaviour is root-caused — either it is a
harness artifact (documented, test deleted or rewritten) or a real client bug
(fixed, test un-skipped). Either way the unknown is closed.

### S7 — `daily` and `dailyPuzzleLeaderboard` are orphaned modes with a blank fallback

Both are still in the `AppMode` union (`client/src/types.ts:95-96`) but have **no
branch in `AppRoutes.tsx`**, so either would fall through to
`fallbackConnectionHost` — which is `<MultiplayerConnectionHost … />` rendered
with **no children** (`useAppRoutesProps.tsx:302`), i.e. no visible UI at all.

Currently unreachable, so this is latent rather than live: nothing calls
`setAppMode('daily')`, and `/daily` no longer maps to it. But the union still
advertises them, `APP_PRIMARY_TABS` still lists them as active modes, and
`homePrimaryAction.ts:176,226` / `homeActivityTimeline.ts:119,134` still emit
`route: 'daily'` — those are inert only because `useHomeCommandCenter`'s
`primaryAction` and `activityTimeline` are **computed but rendered nowhere**
(`HomeScreen.tsx` consumes only `homeModel.daily`, `.sourceStatus` and
`.identity`). Wire that recommendation engine to any UI and a `route: 'daily'`
candidate becomes a blank screen.

**Done looks like:** `daily` and `dailyPuzzleLeaderboard` removed from `AppMode`
and from `APP_PRIMARY_TABS`, and the `route: 'daily'` candidates removed or
repointed at `puzzleRush` · `tsc -b` green · a decision recorded on whether the
unrendered `primaryAction` / `activityTimeline` engine is being kept for a
planned surface or should go with them.

### S8 — The unused `homeOverlays` prop bundle

`AppRoutesProps` declares `homeOverlays: AppRoutesHomeOverlayProps`
(`appRouteTypes.ts:183`) and it is constructed and threaded through, but
`AppRoutes` never destructures it. Dead weight on the prop funnel that the
D-CQ-5/D-CQ-6 barrel work was explicitly trying to shrink.

**Done looks like:** either consumed or removed from the type and its call sites ·
`tsc -b` · `check:architecture` 20/20.

---

## 4. Checked and clean — why this list is finite

These were the audit's actual questions. Recording the negatives is the point:
it is what stops this becoming an open-ended hunt.

**Marker comments — clean.** Zero real `TODO` / `FIXME` / `HACK` / `XXX` in the
entire shipped source tree. The grep returns exactly two hits and both are false
positives: `main.tsx:18` (`oXXXXXX` inside a Sentry DSN example string) and
`guidedMatchValidation.test.ts:226` (a fixture string `'TODO-123'`). This is
genuinely unusual and worth stating plainly.

**Disabled tests — a finite, fully-triaged set of 7.** Zero skipped or `.todo`
**unit** tests anywhere (vitest, client and server). All 7 markers are Playwright:
5 are runtime guards that are correct by design (auth fixture absent → skip;
spectator flag off → skip), and 2 are hard skips, both itemised above (S5, S6).

**Swallowed errors — no bare swallows.** 150 empty-or-comment-only `catch` blocks
across `client/src` (129), `server/src` (21) and `packages` (0) — and **zero of
them are bare `catch {}`**. Every single one carries an explanatory comment, and
the sampled reasons are legitimate (localStorage quota/private-browsing guards,
"room no longer exists" races, optional-chunk fallbacks). `server/src/social/presenceRegistry.ts:6`
even carries a comment documenting a past incident caused by exactly this
pattern, which reads as a team that has already been bitten and adjusted. The
noop-arrow handlers (`client` 20, `server` 9) are the weaker set; the ones that
matter are called out in P1-2 and S2, and the rest are fire-and-forget telemetry
or sound playback.

**Error boundaries — real, not decorative.** Every route in all five route files
is wrapped in `<ErrorBoundary context="…">` with a labeled `<Suspense>` loader
("Loading Friends…", "Loading Tournament Bracket…"). `DefaultErrorFallback`
renders a real message, an error detail in DEV, and both a "Try again" and a home
action. Exactly one `fallback={null}` exists (`AppOverlays.tsx:59`, auth-modals)
and it is deliberate and documented — though it does mean a failed auth-modal
chunk makes "Sign In" silently do nothing (§5).

**Empty states — designed, not blank.** This was the hypothesis most likely to
turn up rot, and it did not. Across the authenticated sweep every zero-data
surface renders composed copy: `/social` → "NO ACTIVITY YET · Play a match or
follow rivals to start your feed"; `/daily-fritz/leaderboard` → "No runs match
this filter yet. Complete today's Daily Fritz set to claim the first spot";
`/rating-history` → "🏆 No rated games yet"; `/stats` → "Play a ranked match to
start a record here". **Zero blank screens across 39 route loads** (28 guest,
11 authenticated). The one exception is the latent fallback in S7.

**Journey content — validated, no dead nodes.** 6 chapters, 108 nodes,
`supported=90, legacyFallback=0, placeholder=18, unsupported=0`. The 18
"placeholder" nodes are **not** stubs: they are chapter checkpoint/briefing nodes
that resolve to the `briefing_acknowledgement` runtime, and the first one renders
real authored copy ("WELCOME TO THE FRITZ TRAIL / TRAILHEAD BRIEFING / Racehorse
Journey is a long march through Fritz—not a daily sprint…"). Nothing in Journey
dead-ends.

**Play vs Fritz plays to completion, cleanly.** A full match driven end to end:
pre-game draw, 64 tiles, multiple hands, boneyard draws, hand-over modals with
pip breakdowns and auto-advance, through to `Defeat / FINAL SCORE 37-74 / MARGIN
-37 / FINAL STANDINGS / Rematch · Change Setup · Home`. **Zero uncaught page
errors** for the entire match.

**Deliberate error conditions fail gracefully.** Forced offline mid-match in
Daily Fritz → `You're offline — reconnect to continue playing.` — a real,
designed message, and the match recovered correctly on reconnect. Same message
and same recovery in the multiplayer private lobby. Invalid username in Settings
→ `Use lowercase letters, numbers, and underscores only.` No blank screens, no
raw exceptions surfaced to the user.

**Accessibility on the board is good.** Every domino carries a real label
(`aria-label="Domino 3-4"`, `"Domino 5-5, not playable"`,
`"Domino 2-6, opponent's turn"`), every icon-only control is labeled ("Zoom in",
"Mute", "Enter fullscreen", "Leave game"), placement targets are labeled ("Place
tile down on horizontal lane"), and turn state is announced via a live region
("Your turn. Your score: 0. Fritz score: 0."). S2's "Record placeholder" stands
out precisely because the surrounding standard is high.

**Unknown routes** (`/this-route-does-not-exist`, `/solo/fritz/../../etc`)
silently resolve to Home rather than 404ing. Reading `resolveAppRoute`'s
`return { mode: 'home' }` this is deliberate; noted, not filed.

---

## 5. Explicitly deferred — named, not silently dropped

Each of these is real. None is closeable as written, so none goes on the bar.

1. **No end-to-end "play it to completion" coverage for most modes.** What exists
   today: Play vs Fritz has setup/HUD/tile-selection cases but no completion;
   the three Journey premium lessons are the *only* specs that play something to
   completion; Puzzle Rush and Tournament have "hub loads" smoke tests only;
   **Ghost and The Lab have no functional coverage at all**. Multiplayer is the
   exception and is well covered: 5 two-seat scenarios in
   `multiplayer-in-match-reconnect.spec.ts` (seat authority, stale-tab move
   rejection, a concurrent-MOVE race window, independent per-seat grace windows,
   transport loss) plus 6 single-client resilience scenarios in
   `multiplayer-chaos.spec.ts` (refresh, offline/online, hidden-tab resume,
   refresh storm, duplicate navigation). Building the missing walkthroughs is a project, not a
   task — but this pass demonstrated the drivers are straightforward to write
   (the Fritz completion driver is ~60 lines against stable selectors), so it is
   deferred as *unscoped*, not as *hard*.

2. **Public profiles are auth-gated — is that the product intent?** Sharing a
   profile link with someone who does not have an account currently gets them a
   gate. P1-4 fixes the *message* regardless of the answer; whether the gate
   should exist at all is a product call, not a defect.

3. **Learn → "Lesson Library · COMING SOON".** An inert card (confirmed
   unclickable — the URL does not change) advertising an unbuilt feature on a
   primary nav route. Deliberate, and honest about itself; listed so it is
   visibly a decision. The other two "coming soon" strings — Single Player hub's
   "More modes coming soon" and the Match Found overlay's "Avg margin —  /
   Per-match stats coming soon" — are the same category.

4. **`ErrorBoundary context="auth-modals" fallback={null}`.** If the auth-modal
   chunk fails to load, clicking "Sign In" does nothing at all, with no feedback.
   The tradeoff is documented and defensible (the alternative took the whole tree
   down), but "silently inert sign-in button" is a bad worst case for the one
   control a new user must find. Fixing it well needs a design answer, not a
   patch.

5. **`DefaultErrorFallback` promises "Your progress has been saved."**
   Unconditionally, on every caught error, without checking whether anything was
   saved. Harmless in most cases and actively wrong in some. Rewording is easy;
   deciding what it should say instead is the open part.

6. **Confirm `VITE_DEBUG_DAILY_FRITZ` is unset in production.** Two hardcoded
   debug ingest endpoints post to `http://127.0.0.1:7933/ingest/<uuid>` with a
   `.catch(() => {})`. Both are correctly gated —
   `handLifecycleRules.ts:198` is `if (!import.meta.env.DEV) return;` (statically
   eliminated at build), and `dailyFritz/api.ts:559` is
   `import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true'`.
   The first is proven safe. The second has an env-var escape hatch, so it is a
   five-minute `vercel env ls` confirmation of exactly the shape S4 in
   `LAUNCH_READINESS_CHECKLIST.md` used for spectator mode — but it needs
   dashboard access this pass did not have. *(Local impact, no production
   bearing: this fires 106 failed requests during a single 5-minute local Fritz
   match, which is enough console noise to hide a real failure during manual QA.)*

7. **Guest 401 console noise.** `/social` (1) and `/daily-fritz/leaderboard` (3)
   fire authenticated endpoints while signed out and log 401s. Harmless, no
   user-visible effect, and cleaning it up means reworking when those fetches
   fire — more than it is worth on its own.

---

## 6. Route and mode inventory

Every path that resolves, from `appRoutePath.ts` and verified live. **Status is
from the live sweep**, not from reading the code.

| Path | Mode | Guest | Signed in | Notes |
|---|---|---|---|---|
| `/` | `home` | ✅ | ✅ | |
| `/solo` | `singlePlayerHub` | ✅ | ✅ | "More modes coming soon" strip (§5.3) |
| `/solo/fritz` | `botSetup` | ✅ | ✅ | **Played to completion, clean** |
| `/solo/ghost` | `ghostSetup` | ✅ gate | ✅ | Designed signed-out gate; no e2e (§5.1) |
| `/journey` | `journey` | ✅ | ✅ | 6 chapters, 108 nodes, 0 unsupported |
| `/practice` | `noBrainer` | ✅ | ✅ | The Lab; fully working, no e2e (§5.1) |
| `/learn` | `learn` | ✅ | ✅ | "Lesson Library" inert (§5.3) |
| `/learn/how-to-play` | `learn` | ✅ | ✅ | Full 5-step walkthrough |
| `/learn/recorder` | `guidedMatchRecorder` | ✅ | ✅ | Authoring tool, ungated; no desktop tab highlight (S4) |
| `/learn/guided-annotator` | `guidedMatchAnnotator` | ⚠️ | ⚠️ | Authoring tool, ungated; shows internal storage key `racehorse:guided-match:source:v1` to any visitor |
| `/daily-fritz` | `dailyFritz` | ✅ gate | ✅ | **Played; offline handled cleanly** |
| `/daily-fritz/leaderboard` | `dailyFritzLeaderboard` | ✅ | ✅ | Guest 401 noise (§5.7); no desktop tab highlight (S4) |
| `/multiplayer` | `multiplayer` (quick) | ✅ | ✅ | |
| `/multiplayer/private` | `multiplayer` (private) | ✅ | ✅ | Offline handled cleanly |
| `/tournament` | `tournament` | ✅ | ✅ | Hub fine |
| `/tournament/:id` | `tournament` (bracket) | ✅ | ✅ | ~~P1-2~~ closed #140 — bad id → real error + route back |
| `/tournament/:id/result` | `tournament` (result) | ✅ | ✅ | ~~P1-2~~ closed #140 — raw code + rejection both gone |
| `/social` | `feed` | ✅ | ✅ | Guest 401 noise (§5.7) |
| `/friends` | `friends` | ✅ gate | ⚠️ | **S1** — nested `<button>` ×6 |
| `/stats` | `stats` | ✅ | ✅ | ~~P1-1~~ closed #139 — puzzle stats from `rush_runs`, no 404 |
| `/rating-history` | `ratingHistory` | ✅ | ✅ | Standalone screen — renders no global nav |
| `/settings` | `settings` | ✅ | ✅ | Validation messages correct |
| `/players/:username` | `profile` | ✅ gate | ✅ | ~~P1-4~~ closed #142 (guest sign-in gate) · ~~P1-1~~ closed #139 (puzzle stats) |
| `/admin/daily-fritz-health` | `dailyFritzHealthAdmin` | ✅ | ✅ | Admin key stays tab-local |

Modes with **no URL**: `bot`, `ghost` (in-match, deliberate — documented in
`buildAppPath`) · ~~`puzzleRush` (**P1-3**)~~ — now `/puzzle-rush`, closed #141 ·
`leaderboard` (shares `/social`, so the sub-view is not linkable) · `live`
(spectator, flag-off) · `daily`, `dailyPuzzleLeaderboard` (**S7**, orphaned).

---

## 7. The bar

**§2 was the bar. §2 is now empty.** All four items closed 2026-09-09 — PRs
#139 (P1-1), #142 (P1-4), #140 (P1-2), #141 (P1-3), each merged with a green
full bar, combined result re-verified on `main`. Each is struck through and
left in full in §2 above with what "done" meant.

§3 is eight cheap items — hours each, not sessions. §5 is seven things that have
been looked at and deliberately set down; none should re-enter §2 without a new
reason.

Consistent with `LAUNCH_READINESS_CHECKLIST.md` §4: new findings after this go
into the normal `CODE_QUALITY_PLAN.md` flow, or to `HARDENING_PLAN.md` if they
turn out to be security or correctness bugs. **This audit is a finite list, and
this is it.**
