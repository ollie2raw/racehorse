# Phase AC Client Production Polish Audit

## 1. Executive Summary

As part of the **Racehorse Dominoes Phase AC Client Production Polish**, we conducted a thorough UX and visual interface audit of the client application as if reviewing a shipped, Chess.com-quality strategy gaming platform. 

The core visual identity established in Phase AA (matte/neon "Play vs Fritz" panels, obsidian backgrounds, ivory dominoes) is solid, premium, and distinct. However, the product suffers from:
1. **Parallel / Unused Code Paths**: There exists a legacy accordion home screen inside [AppRoutes.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx#L907-L995) which conflicts with the live [HomeScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/HomeScreen.tsx), leaving onboarding components (like the welcome modal) orphaned.
2. **Competitive Data Gaps**: Critical touchpoints (such as the match-found overlay) render hardcoded mock statistics, which degrades user trust.
3. **Guest User Dead-ends**: Social feeds, friend lists, and global leaderboards show empty lists or blank states instead of offering clear "Sign In / Sign Up" CTAs.
4. **Safety Confirmation Prompts**: Major destructive actions (such as removing a friend or withdrawing from a tournament) are executed instantly without confirmation.

---

## 2. Current Quality Assessment

### Overall Score: **75 / 100**

* **Visual Polish (82/100)**: Excellent layout grids, dark obsidian backgrounds, high-fidelity ivory tiles, and theme colors match the "Play vs Fritz" system perfectly.
* **UX Integrity (68/100)**: The interface has multiple stubs, missing configuration controls (such as sound toggle or settings), mock stats, and dead-ends for signed-out guest users.
* **Accessibility (60/100)**: Landscaping buttons, custom selectors, and panels use clickable generic tags (like `div`) without proper keyboard focus, ARIA landmarks, or HTML5 button semantics.

---

## 3. Screen-by-Screen & System Findings

We categorize each page, component, or flow under the following definitions:
* **KEEP**: Already production quality.
* **IMPROVE**: Needs polish, layout, styling, or API correction.
* **REBUILD**: Major architectural/UX flaw.
* **REMOVE**: Unnecessary complexity or legacy code.

### A. Major Screens

| Screen / Flow | Classification | Finding | Reference File |
| :--- | :--- | :--- | :--- |
| **New Home Screen** | **IMPROVE** | Streak tracker and daily cards look beautiful. However, API failures (e.g. `getHomeDailySummary`) fail silently. It also contains unused fritz/streak state hooks. | [HomeScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/HomeScreen.tsx) |
| **Legacy Home Screen** | **REMOVE** | Bypassed by the `/` and `/redesign` pathname matches. Bloats the route manifest and retains the orphaned first-visit welcome modal. | [AppRoutes.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx#L907-L982) |
| **Single Player Hub** | **IMPROVE** | Strong card layout. Spells out "More modes coming soon" placeholder. Loading and transition states between cards can feel abrupt. | [SinglePlayerHubScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/SinglePlayerHubScreen.tsx) |
| **Learn Academy** | **IMPROVE** | Clickable study modules are rendered as `div` elements instead of `button` tags. Contains "Locked / Coming Soon" course stubs. | [LearnHome.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/learn/LearnHome.tsx) |
| **Global Leaderboard** | **REBUILD** | Guests viewing the screen see an empty container with no warning or indicator to authenticate. No retry button upon API load failure. | [LeaderboardScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/LeaderboardScreen.tsx) |
| **Friends List** | **IMPROVE** | Removing a friend triggers instantly with no secondary validation. Signed-out users get a basic blank container instead of an auth prompt. | [FriendsScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/FriendsScreen.tsx) |
| **Tournament Hub** | **IMPROVE** | Clicked "Withdraw" kicks player out of a tournament without verification. Waiting rooms lack a structured loading placeholder. | [TournamentHubScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/tournament/TournamentHubScreen.tsx) |

### B. Common & Interaction Systems

| Area | Classification | Finding | Reference File |
| :--- | :--- | :--- | :--- |
| **Match Found Overlay** | **REBUILD** | Renders hardcoded mock statistics for players (wins, losses, streaks) which undermines the Glicko/rating trust. | [MatchFoundOverlay.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/matchmaking/MatchFoundOverlay.tsx) |
| **Welcome / Onboarding** | **IMPROVE** | The welcome modal is attached only to the dead legacy home accordion route, so first-time users never see it. | [AppRoutes.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx#L982) |
| **Navigation Flows** | **IMPROVE** | Clicking top bar links during active rooms can trigger unexpected navigation resets. Settings panel (promised in onboarding) is missing. | [GlobalNav.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/components/GlobalNav.tsx) |
| **Match Gameplay Screen** | **KEEP** | Outstanding rendering. Real-time board placement, turn labels, score trackers, and Web Audio elements are production-grade. | [LiveMatchScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/match/LiveMatchScreen.tsx) |
| **Error Fallback Screen** | **IMPROVE** | Error boundaries fallback to standard inline elements that break away from the Play vs Fritz neon/obsidian theme. | [ErrorBoundary.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/components/ErrorBoundary.tsx) |
| **Loading / Spinner States** | **IMPROVE** | Route loading displays a plain `ScreenLoader` spinner. Modal elements show a blank `Suspense fallback={null}` during chunk fetching. | [AppRoutes.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/AppRoutes.tsx) |
| **Responsiveness** | **KEEP** | Locked flex structures enforce a `100dvh` shell that avoids double scrolling. Responsive breakpoints scale tiles cleanly on mobile. | [App.css](file:///Users/olivermorid/racehorse-dominoes/client/src/App.css) |

---

## 4. Highest ROI Improvements

1. **Clean up Legacy Accordion Home & Move Welcome Modal**
   * *Impact*: High. Ensures first-time users receive the welcome walkthrough. Removes obsolete code bloating the router bundle.
2. **Wire Authoritative Stats to Match-Found Screen**
   * *Impact*: High. Replaces placeholder competitive data (wins, losses, streak stats) with real player profile telemetry.
3. **Add Sign-In CTAs for Guest Users**
   * *Impact*: Medium. Prompts guests to authenticate when visiting the Leaderboard, Social feed, or Friends page, instead of displaying empty slots.
4. **Implement Secondary Confirmation Dialogs**
   * *Impact*: Medium. Prevents accidental clicks from instantly removing friends or abandoning tournaments.
5. **Convert Non-Semantic Element Click Handlers to Buttons**
   * *Impact*: Medium. Resolves key accessibility issues in the Learn Hub and Play vs Fritz choice lists.

---

## 5. Recommended Implementation Order

We recommend dividing the polish into three distinct, structured passes:

### Pass 1: Navigation & Layout Cleanup (Focus: UX & Bundle Cleanliness)
* Remove the legacy accordion homepage routes.
* Relocate the welcome/first-time modal to the live [HomeScreen.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/screens/HomeScreen.tsx).
* Add secondary modal verification for friend deletions and tournament withdrawals.

### Pass 2: Data Integrity & Conversion (Focus: Trust & Retention)
* Resolve mock data in the match-found overlay; load actual Glicko rating, streak counts, and profile records.
* Add clean empty-state templates with auth triggers for guests visiting social/competitive routes.
* Surface home api errors gracefully instead of silently swallowing data-fetching exceptions.

### Pass 3: Accessibility & Micro-animations (Focus: Inclusivity & Motion)
* Convert generic card nodes and setup options to semantic `<button>` wrappers with ARIA labelling.
* Implement support for `prefers-reduced-motion` in core layout overlays.
* Polish Suspense loading boundaries to render themed progress skeletons.
