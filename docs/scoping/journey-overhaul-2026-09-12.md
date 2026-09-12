# Journey Content Model Overhaul — Scoping Doc

**Status:** investigation only. No code or content files were touched to produce this doc. `chapters/*.nodes.ts`, `journeyChapters.ts`, and all other content files are unmodified. Hold for review before any build work starts.

**Date:** 2026-09-12

## Baseline: what Journey actually is today

108 nodes across 6 chapters (12 / 12 / 20 / 24 / 24 / 16), tallied directly from `client/src/journey/chapters/*.nodes.ts`:

| Chapter | Nodes | match | puzzle | checkpoint | boss |
|---|--:|--:|--:|--:|--:|
| ch1 Fritz Trail | 12 | 6 | 3 | 2 | 1 |
| ch2 High Line | 12 | 4 | 5 | 2 | 1 |
| ch3 Long March | 20 | 6 | 9 | 4 | 1 |
| ch4 Pressure Circuit | 24 | 7 | 12 | 4 | 1 |
| ch5 Iron Mile | 24 | 7 | 12 | 4 | 1 |
| ch6 Master Table | 16 | 5 | 7 | 3 | 1 |
| **Total** | **108** | **35** | **48** | **19** | **6** |

Of the 19 `checkpoint` nodes, 18 are `action: { kind: 'placeholder' }` — a static acknowledgement briefing with no interactivity (`journeyBriefings.ts`). Every `match` node is `{ kind: 'botMatch', fritzTier, dealSize: 7, trialFormat, winningScore }` — a bot race, distinguished only by tier and target score. Every `puzzle` node is a static multiple-choice scenario (`journeyPuzzles.ts`: board state + 4 text choices + one `correctChoiceId`) — not an interactive board.

**Only 3 nodes run through the real authored-lesson engine**, and — non-obvious finding — none of them are declared as `lesson` nodes in the content files the way you'd expect. The content **resolver** overrides node behavior by nodeId, independent of what the static file says:

- `ch1-n07` — declared `checkpoint` / `{kind:'lesson', lessonId:'doubles-tempo'}` → actually resolves to `openEndDiscipline` lesson.
- `ch1-n08` — declared `puzzle` / `{kind:'puzzle', puzzleId:'ch1-puzzle-gate'}` → actually resolves to `countingWhatsLeft` lesson.
- `ch1-n09` — declared `puzzle` / `{kind:'puzzle', puzzleId:'ch1-pressure-hand'}` → actually resolves to `doublesArentFree` lesson.

This works via `journeyContentResolver.ts`: `PRODUCTION_PREMIUM_LESSON_DEFINITIONS` is a list of `{contentId, nodeId, ...}` records; for any node whose id appears in that list, the resolver returns the premium lesson descriptor instead of building one from the static node's `action` field (`journeyContentResolver.ts:209-215`). **Practical consequence for the build plan below: a new authored lesson can be attached to an existing node purely by adding a premium definition that targets that node's id — no edit to `chapters/*.nodes.ts` required.** This matters directly for the "don't touch content files" investigation constraint and should hold for early phases of implementation too.

All 3 real lessons are clustered at the start of Chapter 1 — nothing past `ch1-n09` uses the lesson engine, despite it being the strongest teaching tool in the codebase.

Every one of the 108 nodes has a `rewardText` (plus a `finalReward` per chapter) — confirmed below (§4) to be pure decorative string with zero persistence or effect.

---

## 1. Puzzle-sprint node type

**Question:** can Puzzle Rush's engine be parameterized into a short embedded burst, or does it need a smaller sibling component?

**Finding: build a small sibling component. Do not fork Puzzle Rush's engine.**

Puzzle Rush's client-side run/clock/scoring math is genuinely generic and reusable as-is:
- `useRushClock.ts` (`baseSeconds`, `maxSeconds`, `onExpire`, `autoStart`) — zero external deps, drop-in.
- `rushScoring.ts` — pure functions over params, drop-in.

But the parts that make Puzzle Rush *Puzzle Rush* are not configurable and are inseparable from server-side infrastructure that a Journey node has no business touching:

- Puzzle count (15), stage boundaries (warm_up 1-3 / building 4-8 / master 9-15), and clock bounds are hardcoded in `server/src/puzzleRush/config.ts:122-200` (`PUZZLE_RUSH_CONFIG`). `POST /api/puzzle-rush/start` (`server/src/http/routes/puzzleRush.ts:52-135`) takes **no body params** — it always reads `puzzlesPerRun` from that config. There is no "give me 3 puzzles" API.
- The run requires auth, persists a run row, does anti-cheat replay grading on completion (`gradeRun`), writes to the leaderboard, and touches daily-streak bookkeeping (`useRushRun.ts:60-99`, `puzzleRush.ts:73-99, 240-268`). None of that is appropriate or separable for a one-off embedded Journey burst.
- `PuzzleRushPlayView.tsx` is wired into full-screen match chrome (`MatchLiveLayout`, `RotateOverlay`, full-viewport CSS) — re-hosting it inside a modal-sized Journey node means stripping that layout, not just passing new props.
- The 3-stage escalating-difficulty UI (`RushStageProgress`, `RushHudStageMeter`, `RushStageTransition`) is structurally generic but semantically built for the 15-puzzle arc; a flat 3-puzzle sprint would bypass it entirely, not reuse it.

Journey's existing static-puzzle system (`journeyPuzzles.ts` + `InteractivePuzzleModal.tsx`) is already the better foundation: fully client-side, zero network, zero persistence — exactly the shape a `PuzzleSprintModal` needs. Reuse plan:
- Reuse `useRushClock.ts` verbatim (no `puzzleRush/api.ts` dependency — it lifts out cleanly).
- Reuse the existing `JourneyPuzzle` type and `puzzleBoardAdapter.ts` for board rendering, and the interactive-board pattern already proven in `InteractivePuzzleModal.tsx`.
- Sequence through a local `puzzles: JourneyPuzzle[]` array with a `useState` index; call `onComplete(score)` locally. No network calls, no leaderboard, no anti-cheat.
- New `JourneyRuntimeCapability` variant (e.g. `kind: 'puzzle_sprint'`) plus a matching completion signal in `journeyContentContract.ts` — the contract's discriminated-union shape is designed for exactly this kind of addition (see `journeyLaunch.ts`/`journeyRuntime.ts` for the existing bridge-module pattern to follow).

**Interface sketch:**
```ts
<PuzzleSprintModal
  puzzles: JourneyPuzzle[]      // 3, reused from the existing JourneyPuzzle content type
  timeLimitSec={40}
  onComplete={(result: { correct: number; total: number }) => void}
  onExit={() => void}
/>
```

**Effort:**
- New small sibling component (recommended): **S, ~2–3 engineer-days.** Reuse `useRushClock.ts` + existing puzzle types/board rendering; write one new ~120-line sequencing component; no server changes.
- Fork-and-parameterize Puzzle Rush's real engine (not recommended): **M/L, ~5–8 engineer-days.** Forking `useRushRun.ts` off its network coupling, re-hosting `PuzzleRushPlayView.tsx` out of full-screen chrome, bypassing the authenticated pool-selection route, and building the same new contract plumbing anyway — for no real reuse gain, since only 2 of ~7 Rush files are true drop-ins.

**Recommendation: build the small sibling.** It's cheaper, and it keeps Journey's zero-backend-dependency invariant intact.

---

## 2. Match-variant mechanics

**Question:** what's actually configurable in the match/bot engine today vs. what needs new engine work?

**Architecture:** three layers sit between a Journey node and a real game — `packages/game-core/` (the real rules engine, with a genuinely generic typed `Config` object), `client/src/modules/match/runtime/botEngine.ts` (client bot wrapper, builds a fresh `Config` per move via `gameCoreAdapter.ts`, always defaulting anything not explicitly overridden), and Journey's own node-action shape (`{ fritzTier, dealSize, trialFormat, winningScore }` — the *entire* configurable surface visible from content today).

### Buildable today from existing config knobs

| Mechanic | Control | Status |
|---|---|---|
| Bot difficulty (4 tiers) | `fritzTier: 'rookie'\|'standard'\|'elite'\|'master'` | Wired end-to-end |
| Race target | `winningScore` — fixed set `{25,30,35,40,45,50,60}` | Wired end-to-end |
| Alternate hand size / no-draw-pile variant | `dealSize: 7 \| 14` — `14` deals all 28 tiles evenly, **zero boneyard**, already implemented and tested (used today only by Puzzle Rush) | **Wired but unused — every single match node in all 6 chapters hardcodes `dealSize: 7`.** This is a free variant sitting on the shelf. |
| Score head-start handicap | `createBotMatch`/`createDealtHand` already accept a `scores` seed record | Plumbed in the bot layer, never populated with non-zero values from Journey — cheap to wire (no core change) |
| Blocked-hand tiebreak rule | `Config.blockedHandRule: 'lowestPips'\|'noScore'` | Exists and implemented in `packages/game-core`, never threaded past `DEFAULT_CONFIG` |
| End-hand bonus rule | `Config.endHandBonus: 'sumOpponentPenalties'\|'none'` | Same — implemented, never threaded |
| Scoring multiple (e.g. all-fives-style scoring) | `Config.scoringMultiple` | Same — implemented, never threaded, scoring math already generic |

`trialFormat` (`'fullMatch'|'shortRace'`) is a trap worth flagging: it's validated for internal consistency against `winningScore` but **dropped before it ever reaches the match engine** (`soloPlayRoutes.tsx` never reads it off the launch object). It's authoring metadata only, not a real mechanic — don't design new content around it meaning anything at runtime.

### Would need new engine work

| Mechanic | Invasiveness |
|---|---|
| Per-player hand-size handicap (uneven deal) | Core change — `startNewHand` deals one `tilesPerPlayer` value to every player in a loop; needs a schema addition, moderate scope, isolated function |
| Forced/non-standard opening tile | Core change — "double or scoring tile only" is inline logic in `getLegalMoves`, not data |
| Sudden-death / single-hand-decides match | Moderate, mostly orchestration — hand-level outcomes already exist independent of running score; missing piece is "don't deal another hand" at the bot-engine layer, not a core rules change |
| Per-move clock inside a standard match | New subsystem — nothing tracks time in `GameState` today; also requires a real policy decision (what happens on timeout) |
| Domino sets larger than double-six | Layered — `packages/game-core` is already generic (`Config.maxPips`), but the bot layer hardcodes `generateDoubleSixSet()`, bot heuristics are tuned/tested only at 28-tile double-six, and tile UI hardcodes pip layouts for 0–6 |

**No first-class "ruleset" type exists.** Everything mechanic-related is ad hoc props hand-threaded through 3+ layers. This is itself worth flagging as a structural gap: introducing a real `MatchVariant`/`Ruleset` type that a node references by id (bundling tier + deal size + winning score + blocked-hand rule + scoring multiple) would unlock all of the "cheap" rows above at once and prevent another `trialFormat`-style dead knob.

**Practical takeaway for content redesign:** today's real, zero-new-engine-work variant menu is bot tier (4) × deal size (2, one of which is unused) × winning score (7) × the three cheap-to-wire knobs (score handicap, blocked-hand rule, end-hand bonus, scoring multiple — each pure plumbing, no core change). That's a meaningfully bigger design space than "race to N vs tier X" once `dealSize: 14` and the handicap/rule knobs are actually threaded into Journey's node-action type — and it requires no `packages/game-core` changes at all, only journey-layer + gameCoreAdapter plumbing.

---

## 3. Extending the authored-lesson system

**Question:** what does authoring one new lesson cost, and is scaling to 15–20 curriculum-anchor nodes viable?

**A new lesson requires 7 files** (`Lesson.ts`, `Scenarios.ts`, `Evaluator.ts`, `Feedback.ts`, `Validation.ts`, `Bundle.ts`, `.test.ts`) plus a registry line and a node/descriptor wiring (which, per the resolver-override finding above, doesn't require touching the chapter's `.nodes.ts` file). Of the 7, most is mechanical scaffolding — the shared engine (`journeyLessonController.ts`, `JourneyLessonHost.tsx`, `journeyAuthoredLessonBundle.ts`'s `createJourneyScenarioState`/`analyzeJourneyAuthoredMove` helpers, the generic variant resolver, the structural validator) is fully lesson-agnostic and already built.

**Two parts are genuinely hard and do not compress with volume:**
- **Scenario/board curation** — every board+hand must be hand-picked so the "accepted" and "tempting" moves are both legal per the real engine, diverge in exactly the way that teaches the target concept, and satisfy the lesson's structural validation.
- **Evaluator correctness + feedback copy** — judging arbitrary player moves against the lesson's rule (including deliberate "recognized exception" cases where the stated rule and the correct answer diverge on purpose), and writing non-generic, board-specific feedback prose per outcome.

**Evidence the shared infra amortizes, but content does not:** comparing the 3 existing lessons, `openEndDiscipline` (built first, 438 lines) reimplemented scenario-state/variant-resolution helpers that didn't exist yet; `countingWhatsLeft` (205 lines) and `doublesArentFree` (211 lines, and the pedagogically richest of the three at 10 scenarios across 4 decision principles) were both built on the now-stable shared contract and are visibly leaner in code — but not because the design work got easier, because the plumbing got reused.

**Effort estimate, grounded in the 3 examples:** ~2–7 engineer-days per lesson depending on complexity (simple single-principle lesson: 2–4 days; a lesson needing an "exception" case or a second interaction mode: 4–7 days), average **3–5 days/lesson** for someone fluent in the conventions, plus 0.5–1 day of validation-schema debugging for the first few lessons in any batch.

**Judgment: 15–20 lessons is not realistic as a single push.** At 3–5 days average, that's 60–100 engineer-days (roughly 3–5 engineer-months) of pure content-authoring work, before playtesting or pedagogy review, and the irreducible board-curation/evaluator/copy work is bespoke domain design each time — it doesn't get materially cheaper at scale the way infra reuse does.

**Recommendation: a smaller anchor set of ~6–10 authored lessons**, reserved for concepts a fake multiple-choice puzzle or generic bot match genuinely can't teach (open ends, doubles, counting, hand-shape/endgame patterns). Fill the remaining curriculum-anchor slots with a cheaper intermediate tier — e.g. engine-verified static puzzles (real board positions checked for legality/correctness by the actual engine, replacing today's fabricated multiple-choice content) or single-shot "interactive_board_decision" nodes that reuse the lesson engine's evaluator idea without the full 5-stage guided→independent→proof sequence.

---

## 4. Reward persistence

**Current state, confirmed with no ambiguity:** `JourneyNode.rewardText` and `JourneyChapterDefinition.finalReward` (`journeyTypes.ts:56,69`) are plain display strings, rendered once in the node detail panel and the chapter-complete modal, asserted only for non-emptiness by content validation. `grep -rl "supabase" client/src/journey` returns **zero files** — Journey never talks to the database at all. Progress itself (`journeyStorage.ts`) is 100% `localStorage` (`rh_journey_progress_v1`), which is why Journey data today only ever appears for the current device's own logged-in user (`usePlayerIdentityModel.ts:34` explicitly gates on `subjectUserId === currentUserId`) — it can't even survive a browser change, let alone be shown on another player's profile. This is the concrete gap reward persistence has to close.

**Nothing to extend — a rewards table would be net-new.** `supabase/schema.sql`'s `profiles` table has no cosmetic/title/unlock columns (the client-side `avatarUrl` field is dead, always `null`). No `cosmetics`/`unlocks`/`achievements`/`titles` table exists anywhere in `supabase/migrations/*.sql`. There's also no existing "bot personality" concept to unlock — `FritzTier` is a difficulty selector, not a skin/personality system — so "unlock an alternate bot personality" is itself new product surface, not just new plumbing.

**Two existing RLS precedents, and the choice matters:**
- **Owner-writable, append-only** (`ghost_games`: insert/select where `auth.uid() = user_id`, no update/delete policy at all) — the right pattern if unlocks stay purely cosmetic and it's acceptable to trust the client's completion claim.
- **Server-authoritative, zero client access** (`rush_runs`, `profiles` column-locking via `grant update (username) ... to authenticated` only) — enforced by a standing regression test (`databaseAccessBoundarySchema.test.ts`) that fails any migration reopening a server-only table to browser roles. Required if an unlock ever has competitive weight.

**Honest scoping note:** Journey completion itself is currently only asserted client-side — there is no server-side truth about "did this player actually complete node X" today. Any reward system with real stakes needs to also decide whether Journey completion becomes server-verified, or whether unlocks stay trusted client-assertions (fine for pure cosmetics, not for anything competitively visible).

**Proposed schema (proposing plumbing only, not deciding what rewards are):**

```sql
create table public.journey_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  unlock_id text not null,            -- e.g. 'title.fritz_trail_conqueror', 'bot_personality.iron_mile'
  unlock_type text not null check (unlock_type in ('title', 'cosmetic', 'bot_personality')),
  source_chapter_id text not null,    -- matches journeyChapters.ts chapterId
  source_node_id text null,           -- matches JourneyNode.id when node-level; null for chapter-level
  granted_at timestamptz not null default now(),
  unique (user_id, unlock_id)
);

-- optional convenience projection for "currently equipped," mirroring ghost_profiles:
alter table public.profiles
  add column if not exists equipped_title text null,
  add column if not exists equipped_bot_personality text null;
```

RLS: owner-writable/append-only (`ghost_games` pattern) for pure cosmetics, or server-only + a validating server route (mirroring `server/src/social/socialProfile.ts`'s existing service-role pattern) if stakes are ever competitive. Surfacing outside Journey: (a) client-side, add a `journey_unlock` variant to the existing `PlayerIdentityMilestone` union (`playerIdentityTypes.ts:9-14`) fed by a new `loadJourneyUnlocks()` loader parallel to `loadJourney()`; (b) server-side, add a `journey_unlocks` query to `server/src/social/socialProfile.ts` alongside its existing `matches`/`daily_fritz_attempts` queries so unlocks appear on any player's public profile, not just the owner's device.

---

## 5. Node-count reduction — proposed target

**Current:** 12 / 12 / 20 / 24 / 24 / 16 = 108.

**Proposed:** **10 / 10 / 12 / 14 / 14 / 10 = 70**, a ~35% reduction.

Reasoning:
- The current counts were padded almost entirely with cheap content: `puzzle` nodes (fake multiple-choice) make up 48 of 108 nodes and scale up sharply in the later chapters (12 each in ch4/ch5) — that's volume, not density. Cutting the multiple-choice-puzzle count roughly in half per chapter, while upgrading the survivors to real engine-verified puzzles or puzzle-sprint nodes (§1), removes bulk without removing teaching value.
- Checkpoint nodes: 18 of 19 are inert placeholder briefings today. Collapsing chapter framing into fewer, better-written checkpoints (2–3 per chapter instead of 2–4) is a pure win — nothing is lost, since the placeholder ones carry no mechanic today anyway.
- Match nodes should shrink in raw count but gain real variety: today's 35 match nodes only vary tier/winning-score; using the newly-cheap variant knobs from §2 (deal-size-14 no-draw-pile matches, score-handicap matches, blocked-hand-rule matches — all pure plumbing, no core engine work) means fewer match nodes can cover more actual skill ground than more nodes of the same "race to N" shape did.
- Authored lessons: per §3, 6–10 total is the realistic ceiling, concentrated at genuine curriculum-anchor points rather than spread thin. The current design has all 3 in Chapter 1; the new counts should place lessons/puzzle-sprints roughly one per 8–10 nodes across the whole arc, front-loaded slightly less (Chapter 1 doesn't need to hold literally all of them).
- Boss nodes stay 1 per chapter — no change; they already function as intended.
- Chapters 3–5 keep a modest step-up in size (12/14/14) rather than the current sharp escalation (20/24/24) — the later chapters' extra volume today is almost entirely extra fake puzzles, which is the exact bulk this overhaul removes.

This is a target for discussion, not a locked number — it should be revisited once the puzzle-sprint and reward systems are actually built and their per-node "weight" (time-to-complete, teaching density) is better understood.

---

## 6. Phased build plan

Ordered for independent, reviewable PRs, smallest/lowest-risk first. Each PR should be shippable and testable on its own without depending on later phases being merged.

1. **PR 1 — Thread the already-implemented but unused config knobs into Journey's node-action type.** Add `dealSize: 14` usage, `scoreHandicap`, `blockedHandRule`, `endHandBonus`, `scoringMultiple` to `JourneyNodeAction`'s `botMatch`/`boss_match` variants and plumb them through `journeyLaunch.ts` → `soloPlayRoutes.tsx` → `gameCoreAdapter.ts`. Pure engineering — no core engine change, no product decision needed. This alone unlocks real match variety before any content is rewritten.
2. **PR 2 — Build `PuzzleSprintModal`** (§1) as a new component, reusing `useRushClock.ts` and the existing `JourneyPuzzle`/board-rendering pattern, plus the new `puzzle_sprint` runtime-capability variant in `journeyContentContract.ts` and a bridge module alongside `journeyLaunch.ts`/`journeyRuntime.ts`. No content wiring yet — ship it inert/untargeted, verified via its own test suite and a manual harness node.
3. **PR 3 — Reward persistence plumbing**: the `journey_unlocks` table + migration, the `loadJourneyUnlocks()` client loader, the `PlayerIdentityMilestone` variant, and the `socialProfile.ts` query addition. **Needs a product decision first** (flagged below) on what unlock types exist and whether Journey completion becomes server-verified — this PR is pure plumbing built to whatever answer comes back, but shouldn't start until that's settled.
4. **PR 4 — Upgrade a handful of existing fake-puzzle nodes to engine-verified puzzles**, as a template/precedent for the "cheaper intermediate tier" from §3, before committing to full lesson authoring. Small, content-only, validates the harder-puzzle format end to end.
5. **PR 5+ — Author lessons in batches of 2–3**, each its own PR (`Lesson/Scenarios/Evaluator/Feedback/Validation/Bundle/.test` + registry line), attached to existing nodeIds via the resolver-override mechanism (§ baseline) so `chapters/*.nodes.ts` doesn't need to change until the final content-restructuring pass. Requires the curriculum-anchor list (which concepts, which nodes) — a **product/content decision**, not engineering.
6. **PR 6 — Content restructuring pass**: the actual edit to `chapters/*.nodes.ts` and `journeyChapters.ts` to land on the new 10/10/12/14/14/10 target, retargeting nodes to the new puzzle-sprint/upgraded-puzzle/lesson content built in PRs 2–5. This is the one PR that actually touches content files, and it should land last, after every underlying mechanism has shipped and been verified independently.

**Flagged for a separate product/content decision (not to be guessed at in engineering PRs):**
- What reward types actually exist (titles? bot personalities? cosmetics?) and whether any of them carry competitive weight (determines RLS pattern and whether Journey completion needs server verification).
- Which 6–10 concepts get full authored lessons vs. the cheaper upgraded-puzzle tier.
- The exact new per-chapter node count and pacing (the 70-node target above is a reasoned proposal, not a decision).
- Copy/tone for any new checkpoint consolidation and puzzle-sprint framing, consistent with the existing Fritz voice.

**Known engineering follow-ups (deferred, not fixed — flagged so they aren't rediscovered cold):**
- `chooseOfficialFritzBotChoice` in `gameCoreAdapter.ts` scores its diagnostic `score`/`breakdown.immediate` fields via `scoreCoreBoard(preview)` with no config argument, so it always scores under `DEFAULT_CONFIG` and never sees a match's rule overrides — same family as the two scoringMultiple bugs fixed in PR 1 (`computeHandPenalty`/`computeGoOutBonusPoints` in `packages/game-core/src/scoring.ts`, and the client preview effect in `useMatchPresentation.ts`). Currently unreachable: this function backs only Daily Fritz's official bot policy, which never receives Journey's `MatchRuleOverrides`, and the affected fields are diagnostic only (they don't change the bot's actual chosen move or applied score). Not fixed in PR 1/2 because nothing in scope reaches it.
