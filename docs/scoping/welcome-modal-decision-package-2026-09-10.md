# Welcome-modal decision package

**Date:** 2026-09-10. For a product review — **no new copy drafted, no
decision made.** Assembles what's needed to see the actual gap.

Related: `FEATURE_COMPLETENESS_AUDIT.md` §5.3;
`docs/product/phase-ac-client-polish-audit.md` ("Welcome / Onboarding —
**IMPROVE**"); the S8 PR (#165) that removed the dead `homeOverlays` bundle the
welcome state was routed through.

---

## 1. History (why there's a gap)

There **was** a real, shipped welcome modal. It was not a stub.

| When | Commit | What |
|---|---|---|
| ≤ Feb 2026 | `0417ca83` and earlier | `welcomeModal` renders on the home screen — first-visit dialog gated `appMode === 'home' && welcomeOpen`, set from `localStorage.hasSeenWelcome`, dismissed by a button that writes `hasSeenWelcome: 'true'`. A sibling `WeeklyStatsScreen` (weekly-awards, socket-loaded) also lived inline in App.tsx. Both fully wired. |
| **Jun 13 2026** | **`e8d3c23d` "production hardening and security fixes"** | The App.tsx → `AppRoutes` / `AppOverlays` / `appRouteTypes` split (App.tsx shed ~2000 lines). The `welcomeModal` JSX + `dismissWelcome` were **dropped**; `WeeklyStatsScreen` was extracted but its open/close wiring orphaned. The `welcomeOpen` / `weeklyStatsOpen` state + the `hasSeenWelcome` first-visit effect **survived**, plumbed into a new `homeOverlays` prop bundle. |
| Jul 2026 | `phase-ac-client-polish-audit.md` | Flags it: *"the welcome modal is attached only to the dead legacy home accordion route, so first-time users never see it."* Classified **IMPROVE**, not REMOVE. |
| Aug 12 2026 | `8fc3c353` | Welcome/weekly state extracted into `useAppSessionUi` with a 23-test suite (the tests outlived the UI). |
| later | — | The legacy accordion home route in `AppRoutes.tsx` (the modal's last attachment point) was itself removed. `hasSeenWelcome` is now only *read*, never *written*. |
| Sep 10 2026 | **#165 (S8)** | Removed the dead `homeOverlays` bundle + `activeHomeMode`. **Kept** `welcomeOpen` / `weeklyStatsOpen` in `useAppSessionUi` (welcomeOpen has the first-visit effect + tests), with a comment noting they await a UI consumer. |

**Net:** a working feature was a casualty of a refactor, not a deliberate cut.
The full original implementation is recoverable from
`git show 0417ca83:client/src/App.tsx`.

---

## 2. The current `AppMode` list (as of `main`, post-S7 #167)

`client/src/types.ts` — 25 modes:

```
home
multiplayer            singlePlayerHub
noBrainer               journey
botSetup / bot          ghostSetup / ghost
dailyFritz              dailyFritzLeaderboard
puzzleRush
learn                   guidedMatchRecorder / guidedMatchAnnotator
friends  stats  ratingHistory
tournament
leaderboard  profile  feed
live                    settings
dailyFritzHealthAdmin
```

**Player-facing "modes" a welcome would orient someone toward** (the rest are
sub-views, authoring tools, or admin):

| Mode | Route | Home nav grouping today | In the 2026 welcome modal? |
|---|---|---|---|
| **Daily Fritz** | `/daily-fritz` | "Today's Race" card (gold) | ❌ didn't exist |
| **Puzzle Rush** (the Daily Puzzle) | `/puzzle-rush` | "Today's Race" card (blue) | as "🧩 Daily Puzzle" (different mode) |
| **Multiplayer** | `/multiplayer` | mode tab | ✅ "🎮 Multiplayer Online" |
| **Tournament** | `/tournament` | mode tab | ✅ "🏆 Tournament Mode" |
| **Play vs Fritz** | `/solo/fritz` | under "Single Player" tab | as "🤖 vs Bot" |
| **Journey** | `/journey` | under "Single Player" tab | ❌ didn't exist |
| **Ghost** | `/solo/ghost` | under "Single Player" tab | ❌ didn't exist |
| **The Lab** (was No-Brainer Lab) | `/practice` | under "Single Player" tab | as "🧠 No-Brainer Lab" (renamed) |
| **Learn / How to Play** | `/learn` | mode tab | ❌ (Stats/Friends were the "learn"-adjacent entries) |
| **Social** (feed / friends / stats / leaderboard) | `/social`, `/friends`, `/stats` | mode tab | ✅ as two separate entries "📊 Stats & Leaderboard" + "👥 Friends" |

**Takeaway for the product call:** a straight revert won't fit. Since the modal
was cut, the lineup **grew** (Daily Fritz, Journey, Ghost added), **renamed**
(No-Brainer Lab → The Lab, Daily Puzzle → Puzzle Rush), and **reorganised**
(Stats + Friends folded into one "Social" tab; "vs Bot" became "Play vs Fritz"
under a "Single Player" hub). New copy is required regardless of the resurrect /
cut decision.

---

## 3. The original welcome modal — verbatim (`0417ca83:client/src/App.tsx` ~2451–2560)

```jsx
const dismissWelcome = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('hasSeenWelcome', 'true');
  }
  setWelcomeOpen(false);
};

const welcomeModal =
  appMode === 'home' && welcomeOpen ? (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Racehorse Dominoes"
         onClick={dismissWelcome}
         style={{ position:'fixed', inset:0, zIndex:1600,
                  background:'rgba(6,10,18,0.62)', backdropFilter:'blur(8px)',
                  display:'grid', placeItems:'center', padding:12 }}>
      <div className="card" onClick={(e) => e.stopPropagation()}
           style={{ width:'min(680px, calc(100vw - 24px))', maxHeight:'calc(100vh - 24px)',
                    overflowY:'auto', borderRadius:16,
                    border:'1px solid rgba(236,252,245,0.2)',
                    background:'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
                    boxShadow:'0 24px 64px rgba(0,0,0,0.42)',
                    color:'rgba(235,245,242,0.96)', padding:18, textAlign:'left' }}>

        <h3 style={{ margin:0, fontSize:'1.35rem' }}>Welcome to Racehorse Dominoes</h3>
        <p style={{ margin:'8px 0 14px', color:'rgba(223,236,244,0.86)' }}>
          Pick a mode and jump in. Everything tracks automatically as you play.
        </p>

        <div style={{ display:'grid',
                      gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:10 }}>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">🎮 Multiplayer Online</span>
            <span className="mode-option-meta">
              Create a private room and play live 1v1 against friends with a room code
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">🏆 Tournament Mode</span>
            <span className="mode-option-meta">
              Create or join a round-robin lobby (4+ players), share the code, compete through a
              full bracket first to 30 points
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">🤖 vs Bot</span>
            <span className="mode-option-meta">
              Practice offline against an AI opponent and track your daily score on the leaderboard
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">🧠 No-Brainer Lab</span>
            <span className="mode-option-meta">
              Practice one-turn clear runs with curated hands. Can you clear all 7 tiles in one shot?
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">🧩 Daily Puzzle</span>
            <span className="mode-option-meta">
              One puzzle per day, solve it and compete on the leaderboard
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">📊 Stats &amp; Leaderboard</span>
            <span className="mode-option-meta">
              Every multiplayer game tracks your wins, point diff, and streaks. Compete for the
              weekly leaderboard. Check your stats anytime from the top bar
            </span>
          </div>
          <div className="mode-option" style={{ cursor:'default' }}>
            <span className="mode-option-title">👥 Friends</span>
            <span className="mode-option-meta">
              Add friends, see when they're active, and challenge them directly from the
              Friends panel in the top bar
            </span>
          </div>
        </div>

        <div style={{ marginTop:14, display:'flex', justifyContent:'flex-end' }}>
          <button className="mode-inline-btn" onClick={dismissWelcome}>Let's Play →</button>
        </div>
      </div>
    </div>
  ) : null;
```

Notes: inline styles (predates the token system / `<Modal>` primitive);
`.mode-option` / `.mode-inline-btn` classes were part of the old mode-select
screen — **verify those classes still exist in the CSS** if any of this markup
is reused (they may have been removed with the legacy home screen).

---

## 4. What a brand-new signed-up user sees today (zero prior state)

Screenshots captured 2026-09-10 against `main @ 47688963` on localhost. The
guest home is the exact zero-data layout; a fresh signed-up user differs only in
the header (username + `800` provisional rating + `0 Friends` instead of
`Sign In` / `—` / `—`) and gets no auth-prompt on the daily cards.

**The entire home screen (single viewport, does not scroll):**

1. **Header:** logo · today's date · `— Rating` · `— Friends` · `Sign In ⌄`
   *(fresh signup: `800 Rating` · `0 Friends` · `username ⌄`)*
2. **`Today's Race`** — "Two ways to test your strategy. One daily tradition."
3. **Daily Fritz card** (gold): "Best of 3 series. Same deal for everyone." ·
   "Not played yet today" · **[PLAY ›]**
4. **Daily Puzzles card** (blue): "Beat the clock. Solve as many as you can." ·
   "Not played yet today" · **[PLAY ›]**
5. **Streak strip:** "Start your streak / Play Fritz or Puzzle today." ·
   MON–SUN circles (all empty) · "Weekly Goal — 0 / 7 Days"
6. **Mode-tab strip:** `Multiplayer` · `Single Player` · `Tournament` ·
   `Social` · `Learn` — each an icon + label, no description.

**The gap, stated plainly:** a first-time user gets two daily-challenge cards
and five one-word mode tabs. **Nothing explains what Multiplayer / Tournament /
Single Player / Learn / Social contain, nothing says "start here", and there is
no welcome.** "Single Player" in particular hides four distinct modes (Fritz,
Journey, Ghost, The Lab) behind one tab with no preview. The old welcome modal
filled exactly this — a one-screen orientation to every area with a "Let's Play"
dismissal.

Screenshots: `home-zero-data-guest.jpg`, `home-signed-in-with-data.jpg` (for the
header contrast) — attached in the review message, not committed.

---

## 5. `WeeklyStatsScreen` — is reviving it cheap or a project?

**Cheap.** The data layer is already done and maintained:

- **Component:** `client/src/stats/WeeklyStatsScreen.tsx` — exists, current, was
  migrated to `useAsyncData` in **#155** (D1 batch 2), has tests. Renders a
  weekly recap (fritz / ghost / puzzle / multiplayer this-week aggregates + a
  week label).
- **Data:** `fetchWeeklyRecap(user)` (`stats/statsApi.ts:187`) derives **entirely
  from `fetchPersonalStatsInsights(user)`** — the *same* endpoint `/stats`
  already uses — plus `getWeekStart()` for the label. **No dead tables, no stale
  data, no extra endpoint.** The `WeeklyRecap` type is
  `{ weekLabel, fritz{gamesThisWeek, ratingChangeThisWeek, bestWinMarginThisWeek},
  ghost{…same}, puzzle{completionsThisWeek, bestScoreToday}, multiplayer{gamesThisWeek, wins, losses} }`.
- **What's missing:** a **trigger** (`setWeeklyStatsOpen(true)` — a button, e.g.
  in the account menu or on `/stats`) and a **render site** (mount
  `<WeeklyStatsScreen open={weeklyStatsOpen} onClose={…} />` in `AppOverlays`).
  `weeklyStatsOpen` state already exists in `useAppSessionUi`.

Reviving it = ~1 small PR: add the trigger + wire the render. The
`welcomeOpen` first-visit modal is the more involved one (needs new copy + a
`<Modal>`-primitive rebuild), but `WeeklyStatsScreen` could ship independently
and cheaply if wanted.

---

## 6. What's NOT in this package (by request)

- No new welcome copy.
- No decision on resurrect / cut / park.
- No decision on where a `WeeklyStatsScreen` trigger should live.
