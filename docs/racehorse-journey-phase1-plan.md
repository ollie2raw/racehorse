# Racehorse Journey — Discovery & Phase 1 Implementation Plan

**Status:** Planning only (no code in this pass)  
**Date:** 2026-06-13  
**Scope:** Long-term single-player progression mode (working names: Racehorse Journey / The Trail / Fritz Trail)

---

## 1. Recommended final name

| Layer | Name | Rationale |
|-------|------|-----------|
| **Product mode (player-facing)** | **Racehorse Journey** | Brand-aligned, premium, not mobile-game generic. Reads like a flagship Racehorse mode alongside Daily Fritz and Daily Puzzle. |
| **Chapter 1 subtitle** | **The Fritz Trail** | Fritz-themed, sets expectation for a winding progression toward Fritz mastery. |
| **Internal code** | `journey` | Matches existing short `AppMode` names (`learn`, `daily`, `bot`). |

Do **not** ship “Fritz Trail” as the top-level mode name—it sounds like a sub-chapter only. Use it on the chapter card inside the map.

---

## 2. MVP scope (Phase 1)

Ship a **playable map shell** with real sequential unlock logic—not full gameplay integration.

- New route/mode: `journey` → hash path `/journey`
- New screen: `RacehorseJourneyScreen` with static **12-node** map for **Chapter 1: The Fritz Trail**
- **localStorage-only** progress (device-local, no auth required)
- Sequential unlock: complete node *N* → unlock node *N+1*
- Node detail panel: title, subtitle, type badge, reward text, CTA
- **Phase 1 CTAs:**
  - Unlocked nodes: “Begin” opens a lightweight placeholder modal (“Match integration coming in Phase 2”) **or** a dev-only “Mark complete” control for QA
  - Locked nodes: disabled state, no navigation
  - Completed nodes: check/medallion state on map
- Entry point: **Single Player Hub** (featured card or replace “More modes coming soon” strip)
- Visual: premium Racehorse identity—matte navy, brass route, domino-shaped nodes, chapter card, boss medallion on node 12
- **No changes** to bot logic, Daily Fritz, Daily Puzzle, multiplayer, tournaments, scoring, or server APIs

---

## 3. Non-goals (Phase 1)

- No Supabase table or server API
- No badge/achievement backend
- No real match/puzzle/lesson launch from nodes (placeholders only)
- No Grandmaster bot tier or intelligence rewrite (use existing `master` tier later)
- No Daily Fritz / Daily Puzzle / Learn behavior changes
- No multiplayer / tournament / socket work
- No route-history or `App.tsx` multiplayer hook moves
- No scoring, draw, RNG, or fairness changes
- No HomeScreen hero placement (Single Player Hub entry only for Phase 1)

---

## 4. Files likely touched (Phase 1)

### New (feature folder: `client/src/journey/`)

| File | Purpose |
|------|---------|
| `types.ts` | Node types, status enum, progress record, chapter config types |
| `chapter1Nodes.ts` | Static 12-node content for Chapter 1 |
| `progressStorage.ts` | load/save/sanitize/mark-complete (mirrors `learn/progress/storage.ts`) |
| `useJourneyProgress.ts` | React hook: derived node statuses, complete/unlock helpers |
| `RacehorseJourneyScreen.tsx` | Main map screen (viewport-locked shell) |
| `JourneyNodeMap.tsx` | Winding path + domino nodes (optional split for readability) |
| `JourneyNodeDetail.tsx` | Selected node panel + CTA (optional split) |
| `journey.css` | Scoped styles (`rh-journey-*` prefix) |

### Edit (minimal wiring)

| File | Change |
|------|--------|
| `client/src/appRouteTypes.ts` | Add `'journey'` to `AppMode` |
| `client/src/types.ts` | Add `'journey'` to `AppMode` (**must stay in sync**) |
| `client/src/App.tsx` | `MODE_TO_PATH.journey = '/journey'` |
| `client/src/AppRoutes.tsx` | `React.lazy` import + `appMode === 'journey'` block |
| `client/src/screens/SinglePlayerHubScreen.tsx` | Entry card / featured row → `onNavigate('journey')` |
| `client/src/components/GlobalNav.tsx` | Add `'journey'` to Single Player `activeModes` |

### Not touched in Phase 1

- `BotMatchScreen.tsx`, `botEngine.ts`, `fritzConfig.ts`
- `dailyFritz/`, `dailyPuzzle/`, `multiplayer/`, `server/`
- `App.tsx` socket blocks, auth, Supabase config

---

## 5. Existing systems to reuse

### Routing & shell

- **`appMode` + HashRouter** (`App.tsx`): `appMode` is source of truth; non-socket modes sync to hash via `MODE_TO_PATH`. `journey` should **not** be in `SOCKET_MODES`.
- **`AppRoutes.tsx`**: Lazy routes wrapped in `<Suspense fallback={<ScreenLoader …/>}>`.
- **`ScreenLoader`**: Standard loading chrome for lazy chunk.
- **Viewport-locked shell** (`AGENTS.md` §6): Journey root uses `flex: 1 1 0; min-height: 0; overflow: hidden` like `SinglePlayerHubScreen` / `PlayVsFritz`.

### UI patterns & primitives

- **`SinglePlayerHubScreen`**: `home-shell`, `RacehorseHomeArt.css` background, brass single-player accent, `GlobalNav`.
- **`PlayVsFritz` / `PlayVsFritz.css`**: Canonical matte panel reference for node detail cards.
- **`GlassCard`, `Button`** from `components/primitives`.
- **`useDeferredAsset`**: Optional hero art for chapter card (reuse `singlePlayerHub/` assets or add one webp later).
- **`LearnProgressTrack`** + `learn/academy/learnAcademy.css`: Horizontal step rail pattern—**adapt visually** (domino nodes, gold connectors) but do not import Learn CSS directly into journey (scoped `journey.css`).

### Progress persistence patterns

| Pattern | File | Reuse for Journey |
|---------|------|-------------------|
| Simple v1 key + sanitize | `learn/progress/storage.ts` | Primary template |
| User-scoped key | `practice/noBrainerLabProgress.ts` | Phase 2 when syncing to account |
| Streak/date | `dailyPuzzle/streakStorage.ts` | Not needed Phase 1 |

**Recommendation:** Phase 1 uses **`rh_journey_progress_v1`** (device-local). Phase 2 adds optional **`rh_journey_progress_v1:${userId}`** merge on sign-in.

### Gameplay systems (Phase 2+, not Phase 1)

| System | Location | Future use |
|--------|----------|------------|
| Fritz tiers | `bot/fritzConfig.ts` | Match/boss nodes: `rookie` → `master` |
| Bot match | `BotMatchScreen` + `AppRoutes` bot block | `setBotFritzTier`, `setBotDealSize`, `setAppMode('bot')` |
| Fixed deals | `botEngine.createFixedBotMatch` | Scripted challenge hands |
| Puzzle state | `dailyPuzzle/validator.createPuzzleMatchState` | Puzzle gate nodes |
| Learn guided flow | `learn/LearnPlayer`, `lessonV2` | Checkpoint/lesson nodes |
| Hub stats API | `stats/statsApi.fetchFritzHubStats` | Display-only on journey screen later |

**Note:** There is **no “Grandmaster” Fritz tier** today. Highest tier is **`master`** (~2200). Node 12 should be labeled “Grandmaster Fritz Trial” in copy but launch **`master`** tier in Phase 2 until a true Grandmaster tier exists.

---

## 6. Proposed route / appMode name

```ts
// AppMode union
| 'journey'

// Hash path (App.tsx MODE_TO_PATH)
journey: '/journey'
```

**Naming consistency check:** Existing modes use camelCase (`singlePlayerHub`, `dailyFritz`, `noBrainer`) or short names (`learn`, `daily`). **`journey`** fits the short-name pattern and avoids a long union member.

**GlobalNav:** Add `'journey'` to Single Player tab `activeModes` alongside `botSetup`, `ghostSetup`, `noBrainer`, etc.

---

## 7. Data model

### Enums

```ts
type JourneyNodeType =
  | 'checkpoint'   // lesson / briefing / rules recap
  | 'match'        // vs Fritz (tier + deal size)
  | 'puzzle'       // tactical puzzle / challenge hand
  | 'boss';        // milestone fight (master tier in Ch.1)

type JourneyNodeStatus =
  | 'locked'
  | 'unlocked'     // available but not current focus
  | 'current'      // next recommended node (derived)
  | 'completed';

type JourneyDifficulty = 'intro' | 'casual' | 'standard' | 'hard' | 'expert' | 'boss';
```

### Node definition (static content)

```ts
interface JourneyNode {
  id: string;                    // e.g. 'ch1-n01-trailhead'
  chapterId: string;               // 'ch1-fritz-trail'
  chapterTitle: string;            // 'Chapter 1: The Fritz Trail'
  order: number;                   // 1–12
  title: string;
  subtitle: string;
  nodeType: JourneyNodeType;
  difficulty: JourneyDifficulty;
  requirements: string[];          // human-readable, e.g. ['Complete node 4']
  rewardText: string;              // e.g. 'Trail Marker — First Score'
  badgeText?: string;              // short HUD label on map node
  // Phase 2 action payload (inert in Phase 1)
  action: JourneyNodeAction;
  completionCriteria: string;      // human-readable; machine rule in Phase 2
}

type JourneyNodeAction =
  | { kind: 'placeholder' }
  | { kind: 'navigate'; mode: AppMode; params?: Record<string, unknown> }
  | { kind: 'botMatch'; fritzTier: FritzTier; dealSize: BotDealSize; winningScore?: number }
  | { kind: 'puzzle'; puzzleId: string }
  | { kind: 'lesson'; lessonId: string };
```

### Progress record (localStorage)

```ts
interface JourneyProgress {
  version: 1;
  chapterId: string;
  completedNodeIds: string[];      // ordered unique
  lastVisitedNodeId: string | null;
  updatedAt: string;               // ISO
}
```

### Derived status algorithm

1. Load progress; default `completedNodeIds: []`.
2. Node 1 always **unlocked** (or auto-complete briefing on first “Begin”).
3. Node *k* is **unlocked** iff node *k−1* is in `completedNodeIds` (or *k === 1*).
4. **Current** = lowest-order unlocked node not completed.
5. **Completed** = id in `completedNodeIds`.

Storage key: **`rh_journey_progress_v1`**

Functions (mirror learn progress):

- `loadJourneyProgress(): JourneyProgress`
- `saveJourneyProgress(p: JourneyProgress): void`
- `markJourneyNodeCompleted(nodeId: string): JourneyProgress`
- `getJourneyNodeStatus(nodeId: string, nodes, progress): JourneyNodeStatus`

---

## 8. First 12-node content plan — Chapter 1: The Fritz Trail

Aligned with existing Fritz tiers, Learn themes, and Daily Puzzle ladder pacing. Names tuned for Racehorse tone (premium, strategic, not cartoon quest).

| # | ID | Title | Type | Difficulty | Subtitle | Reward / badge | Phase 2 action (not Phase 1) |
|---|-----|-------|------|------------|----------|----------------|-------------------------------|
| 1 | `ch1-n01` | **Trailhead Briefing** | checkpoint | intro | Fritz welcomes you to the long road. | Trail Marker | Placeholder modal / short rules recap |
| 2 | `ch1-n02` | **First Score** | match | casual | Win your first Racehorse hand to 60. | First Blood | `rookie`, deal 7, win match |
| 3 | `ch1-n03` | **Open Ends Trial** | puzzle | casual | Read the board. Maximize open-end pressure. | Open Eye | Curated puzzle (local fixture) |
| 4 | `ch1-n04` | **Draw Escape** | match | casual | Survive the boneyard without panic. | Steady Hand | `rookie`, deal 7, complete match |
| 5 | `ch1-n05` | **Porch Fritz** | match | standard | Standard Fritz on the porch—no excuses. | Porch Pass | `standard`, deal 7, win match |
| 6 | `ch1-n06` | **Tempo Test** | match | standard | Keep initiative hand over hand. | Tempo | `standard`, deal 7, win match |
| 7 | `ch1-n07` | **Double Trouble** | checkpoint | standard | Doubles decide tempo. Know when to feed and when to lock. | Double Down | Link to Learn doubles module or inline brief |
| 8 | `ch1-n08` | **Puzzle Gate** | puzzle | standard | One board. One chance. Find the line. | Gate Cleared | Curated puzzle fixture |
| 9 | `ch1-n09` | **Pressure Hand** | puzzle | hard | Fixed hand under score pressure. | Ice Veins | `createFixedBotMatch` scripted hand |
| 10 | `ch1-n10` | **Elite Warmup** | match | hard | Elite Fritz—the Daily Fritz strength. | Elite Crest | `elite`, deal 7, win match |
| 11 | `ch1-n11` | **No-Hint Trial** | match | expert | Master Fritz with coaching stripped back. | Silent Focus | `master`, deal 7, win match (minimal hints) |
| 12 | `ch1-n12` | **Grandmaster Fritz Trial** | boss | boss | The end of Chapter 1. Beat the sharpest Fritz. | **Fritz Trail Conqueror** | `master`, deal 7, win match; boss medallion UI |

**Copy note:** “Grandmaster” is **product language** for the boss fantasy; implementation uses existing **`master`** tier until a dedicated Grandmaster profile ships in Phase 3.

---

## 9. Phase 1 implementation steps

1. **Scaffold feature folder** `client/src/journey/` with types, static `chapter1Nodes.ts`, and `progressStorage.ts` (copy discipline from `learn/progress/storage.ts`).
2. **Add `journey` AppMode** to `appRouteTypes.ts` and `types.ts`; add `journey: '/journey'` to `App.tsx` `MODE_TO_PATH`.
3. **Wire route** in `AppRoutes.tsx`: lazy `RacehorseJourneyScreen`, `ScreenLoader` fallback, `onBack={() => setAppMode('singlePlayerHub')}`, pass `onNavigate={setAppMode}` for nav.
4. **Build `RacehorseJourneyScreen`**:
   - Viewport-locked root (`home-page-root` / `home-shell` pattern)
   - Chapter header card: “Racehorse Journey” + “Chapter 1: The Fritz Trail”
   - Progress summary: `3 / 12` nodes, brass progress rail
   - `JourneyNodeMap`: vertical or S-curve path; domino tile nodes; gold connectors; boss medallion on #12
   - Node detail panel on select: type, difficulty, reward, requirements, CTA
5. **Implement unlock logic** via `useJourneyProgress` + localStorage; persist on mark-complete.
6. **Phase 1 CTA behavior**: “Begin” on unlocked node → placeholder modal explaining upcoming integration; include **“Mark complete (dev)”** button behind `import.meta.env.DEV` **or** always-visible “Complete node” for MVP QA (product decision at implement time—recommend DEV-only mark complete + manual QA script).
7. **Single Player Hub entry**: Add fourth card **Racehorse Journey** (brass accent, tier-elite) **or** replace footer “More modes coming soon” with a full-width featured Journey card. Prefer **featured row above the 3-mode grid** to avoid crowding the grid.
8. **GlobalNav**: Include `journey` in Single Player active modes.
9. **Build & manual QA** (see §12).

**Estimated Phase 1 diff:** ~8 new files, ~5 edited files, **no server changes**.

---

## 10. Phase 2 / 3 roadmap

### Phase 2 — Real node completion hooks

- Add `journeyContext` ref/state in `App.tsx`: `{ activeNodeId, returnMode: 'journey' }`
- **Match nodes:** Before `setAppMode('bot')`, set tier/deal from node action; add optional `onJourneyMatchComplete` callback prop to `BotMatchScreen` (win-only) → `markJourneyNodeCompleted` → return to `journey`
- **Puzzle nodes:** Local puzzle fixtures in `journey/puzzles/` using `createPuzzleMatchState`; lightweight puzzle UI or reuse Daily Puzzle single-board flow **without** daily API
- **Checkpoint nodes:** Inline brief panel or deep-link to `learn` with return to journey
- **Boss node:** Master tier match + confetti/medallion modal on complete
- User-scoped localStorage merge on login (`userId` suffix)
- Hub card shows real progress `n/12`

### Phase 3 — Persistence, seasons, prestige

- Supabase table: `journey_progress(user_id, chapter_id, completed_node_ids, updated_at)`
- API: GET/PUT progress; optional idempotent node completion events
- Badge/reward system tied to `rewardText` / profile display
- **Grandmaster Fritz v1/v2** (new tier or tuned master profile)
- Seasonal chapters (“Chapter 2: Ghost Pass”, etc.)
- Optional journey leaderboard / achievements (social API extension)
- HomeScreen teaser card when Chapter 1 completion rate justifies homepage placement

---

## 11. Risks and safeguards

| Risk | Severity | Safeguard |
|------|----------|-----------|
| **AppMode drift** (`types.ts` vs `appRouteTypes.ts`) | Medium | Update both in same commit; grep for `AppMode` when adding `journey` |
| **Route integration** | Medium | Add to `MODE_TO_PATH` only (not `SOCKET_MODES`); test hash `/journey` refresh |
| **Progress loss** | Medium (Phase 1) | Document device-local limitation in UI footer; Phase 2 user-scoped keys |
| **Completion detection** | High (Phase 2) | New optional callback on `BotMatchScreen`—do not fork match logic; win-only for Ch.1 |
| **Bot difficulty backlash** | Medium | Chapter 1 ramps rookie→master; boss is opt-in end node; copy sets expectations |
| **Bundle size** | Low | Lazy-load `journey/` chunk; no static import of `BotMatchScreen` from journey |
| **UX / generic map feel** | Medium | Domino nodes, brass route, matte panels—explicitly **not** cartoon forest; reference PlayVsFritz + HomeScreen |
| **BotMatch onBack** | Medium (Phase 2) | Journey context must override default `onBack → home` |
| **Scope creep** | High | Phase 1 placeholders only; no server, no bot edits |

---

## 12. Build / test commands

```bash
# Client production build (required)
npm run build --prefix client

# Manual QA checklist
# 1. Home → Single Player → Racehorse Journey card
# 2. URL hash is #/journey; refresh preserves screen
# 3. Node 1 unlocked; nodes 2–12 locked
# 4. Mark node 1 complete → node 2 unlocks; refresh persists
# 5. Locked node: CTA disabled, no errors
# 6. Completed node shows completed styling
# 7. Back → Single Player Hub; GlobalNav Single Player tab still active on journey
# 8. Existing routes: /solo, /learn, bot setup, daily puzzle still work
# 9. Console: no new errors on journey load/interaction
```

---

## 13. Exact next Codex prompt — implement Phase 1

Copy-paste for the implementation session:

---

**Implement Racehorse Journey Phase 1 (map shell only). Read `docs/racehorse-journey-phase1-plan.md` first.**

**Goal:** Ship the Journey map with 12 static nodes, localStorage sequential unlock, and Single Player Hub entry. No gameplay integration, no server changes, no bot/Daily Fritz/Daily Puzzle/multiplayer edits.

**Tasks:**

1. Create `client/src/journey/` with:
   - `types.ts`, `chapter1Nodes.ts` (12 nodes from plan §8), `progressStorage.ts` (key `rh_journey_progress_v1`), `useJourneyProgress.ts`
   - `RacehorseJourneyScreen.tsx` + `journey.css` (viewport-locked; matte navy + brass; domino-shaped nodes; chapter card; boss medallion on node 12)
   - Optional split: `JourneyNodeMap.tsx`, `JourneyNodeDetail.tsx`

2. Wire routing:
   - Add `'journey'` to `AppMode` in **both** `appRouteTypes.ts` and `types.ts`
   - `App.tsx`: `journey: '/journey'` in `MODE_TO_PATH` (not in `SOCKET_MODES`)
   - `AppRoutes.tsx`: lazy load screen, `onBack` → `singlePlayerHub`, `ScreenLoader` fallback
   - `GlobalNav.tsx`: add `'journey'` to Single Player `activeModes`

3. Single Player Hub entry:
   - Add a **Racehorse Journey** featured card (brass / tier-elite) navigating to `journey`
   - Remove or replace “More modes coming soon” footer

4. Phase 1 behavior:
   - Node 1 unlocked by default
   - Sequential unlock on complete
   - Unlocked node “Begin” → placeholder modal (match/puzzle integration Phase 2)
   - DEV-only “Mark complete” for QA (`import.meta.env.DEV`) OR document manual complete control for testing
   - Locked nodes cannot start

5. Reuse: `home-shell` / `RacehorseHomeArt.css` background, `GlobalNav`, `Button` / `GlassCard` primitives, `ScreenLoader`, `useDeferredAsset` only if needed.

6. Verify: `npm run build --prefix client` passes; manual QA per plan §12.

**Do not:** add Supabase tables, server routes, BotMatchScreen changes, Fritz tier changes, Daily Fritz persistence, multiplayer/tournament touches, or scoring/RNG changes.

---

## Appendix: Architecture audit notes

### Safest integration point

The established pattern for new top-level modes:

1. Extend `AppMode` (two files)
2. Add hash path in `App.tsx` (outside `SOCKET_MODES`)
3. Add conditional render + `React.lazy` in `AppRoutes.tsx`
4. Entry from hub screen via `setAppMode('journey')`

This matches `learn`, `noBrainer`, and `singlePlayerHub`—**not** the bot/ghost socket modes that force hash `/`.

### Persistence decision

**Phase 1: localStorage-only** — lowest risk, no auth/backend, matches `learn/progress` and No Brainer Lab patterns.

**Phase 2: hybrid** — device local + optional `userId` key on sign-in.

**Phase 3: Supabase** — only when cross-device save is a product requirement and schema is reviewed.

### Why not profile/stats API for Phase 1

`fetchFritzHubStats` and ghost summary are **read-only aggregates** for hub cards—not structured node progress. Repurposing them would conflate ranked Fritz stats with Journey progression and require server design. Avoid.
