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

---

## 7. Copy drafts (2026-09-11) — for review, not a decision

Two options for a new first-visit modal, per §1's history and §2's mode
list. **Not built, not wired to anything** — copy only. Both use the
`<Modal>` primitive per `client/CLAUDE.md` (the original in §3 predates it
and used raw inline styles — don't reuse that markup).

### Grounding table — every claim below traces to real, current copy

| Mode | Route | Line grounded in | Source |
|---|---|---|---|
| Daily Fritz | `/daily-fritz` | "Best of 3 series. Same deal for everyone." | `HomeScreen.tsx:235` (current card copy) |
| Puzzle Rush | `/puzzle-rush` | "Beat the clock. Solve as many as you can." | `HomeScreen.tsx:270` (current card copy) |
| Multiplayer | `/multiplayer` | Private room, room code, invite links; capped at 2 players (1v1) | `PrivateMatchLobbyControlPanel.tsx:201/218/448` (room-code UI copy) + `server/src/rooms.ts:530,782` (`room.players.length >= 2` / `!== 2` — confirms 1v1, not the old modal's unverified claim) |
| Tournament | `/tournament` | "8-player bracket. First to 30 wins. One champion every 30 minutes." | `TournamentHubScreen.tsx:330` — **current mechanic, and it has changed**: it's now a fixed 8-player single-elimination bracket, not the old modal's "round-robin lobby (4+ players)." The §3 copy is stale and was not reused. |
| Play vs Fritz | `/solo/fritz` | "Choose your tier and format, then start a match against Fritz." | `bot/PlayVsFritz.tsx:216` (current subtitle) |
| Journey | `/journey` | "Master every position. Beat the campaign." (tagged "Flagship Campaign") | `journey/JourneyHomeEntryCard.tsx:67,69` |
| Ghost | `/solo/ghost` | "Train a rolling model of how you play from Fritz matches, then spar against your ghost—or a friend's." | `ghost/GhostSetupScreen.tsx:264` (current subtitle, signed-in state) |
| The Lab | `/practice` | "Some starting hands win in one turn — all 7 tiles in a single chain." | `learn/LearnHome.tsx` mode-card `desc` for `id: 'lab'` |
| Learn / How to Play | `/learn` | "Walk through the rules and core instincts before your first coached hand." | `learn/LearnHome.tsx` mode-card `desc` for `id: 'howToPlay'` |

**Flagged — insufficient material for a crisp one-liner:** the old modal's
"Social" copy (`§3`: "tracks your wins, point diff, and streaks... weekly
leaderboard" / "Add friends... challenge them directly") describes real
features (`social/LeaderboardScreen.tsx`, `social/ActivityFeedScreen.tsx`
both have friend-adding/challenging and leaderboard tabs) but there's no
current single sentence anywhere in the codebase that describes "Social"
as one thing — it's a leaderboard, a friends list, and an activity feed
under one nav tab. Both drafts below describe it as two short clauses
rather than inventing a unifying tagline.

### Option A — Daily Fritz leads as "start here"

```
Welcome to Racehorse Dominoes

Start here: Daily Fritz — best of 3, same deal for everyone, once a day.
[Play Daily Fritz →]

Everything else, whenever you want it:
· Puzzle Rush — beat the clock, solve as many as you can.
· Multiplayer — invite a friend with a room code, 1v1 live.
· Tournament — 8-player bracket, first to 30 wins, a new champion every
  30 minutes.
· Play vs Fritz — pick a tier and format, practice offline anytime.
· Journey — the flagship campaign: master every position, beat every
  chapter.
· Ghost — train a model of your own play from your Fritz matches, then
  spar against it (or a friend's).
· The Lab — spot one-turn, all-7-tile clears before they're offered.
· Learn — walk through the rules before your first coached hand.
· Social — your leaderboard, your friends, and what they're up to.

[Let's play →]
```

Rationale: Daily Fritz is the one mode framed as a daily habit everywhere
else in the product (`HomeScreen.tsx`'s "Today's Race" section, the streak
strip), so leading with it here matches what the rest of the home screen
already trains a returning user to expect. New users get one obvious first
click instead of nine equal-weight options.

### Option B — neutral mode grid, nothing singled out

```
Welcome to Racehorse Dominoes

Pick a mode. Everything tracks automatically as you play.

┌─────────────────┬─────────────────┬─────────────────┐
│ Daily Fritz      │ Puzzle Rush      │ Multiplayer      │
│ Best of 3, same  │ Beat the clock,  │ Invite a friend  │
│ deal for         │ solve as many    │ with a room      │
│ everyone.        │ as you can.      │ code, 1v1 live.  │
├─────────────────┼─────────────────┼─────────────────┤
│ Tournament       │ Play vs Fritz    │ Journey          │
│ 8-player         │ Pick a tier and  │ Master every     │
│ bracket, first   │ format, practice │ position, beat   │
│ to 30 wins.      │ offline anytime. │ the campaign.    │
├─────────────────┼─────────────────┼─────────────────┤
│ Ghost            │ The Lab          │ Learn / Social   │
│ Train a model of │ Spot one-turn,   │ How to play,     │
│ your own play,   │ all-7-tile       │ your stats,      │
│ then spar        │ clears before    │ friends, and     │
│ against it.      │ they're offered. │ leaderboard.     │
└─────────────────┴─────────────────┴─────────────────┘

[Let's play →]
```

Rationale: matches the original 2026 modal's structure (a flat grid, no
mode singled out) and the zero-state's own "five one-word tabs, equal
weight" framing from §4 — closer to the *lineage* of what was cut than
Option A, at the cost of not solving §4's "nothing says start here"
problem it was built to diagnose.

### Open questions for product, not resolved here

- Both drafts fold Learn + Social into one line/cell for space; if either
  is meant to be a primary destination rather than a footnote, it needs
  its own line and this doc's grounding table doesn't have strong enough
  source copy for Social specifically (see the flag above) — that'd need
  new copy, not just condensed existing copy.
- Neither draft revives `WeeklyStatsScreen` (§5) — it's a separate,
  cheap, independently shippable trigger, not part of a first-visit
  modal's job.
