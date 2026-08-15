# Racehorse Dominoes — E2E QA Audit Report

This report summarizes the E2E QA audit conducted on the production web game **Racehorse Dominoes**, focusing on **Multiplayer matches (1v1)**, **Daily Fritz**, and **Play vs Fritz (Bot Matches)**. 

All audits were run against the live-running application. Ephemeral users were provisioned, tested across disruption scenarios, and cleaned up successfully.

---

## 1. Verified Findings

### Finding 1: Active Turn Indicator Active During Pre-Game Draw Phase
* **Location**: [BotMatchLiveHud.tsx:L56](file:///Users/olivermorid/racehorse-dominoes/client/src/bot/view/hud/BotMatchLiveHud.tsx#L56)
* **Severity**: **Low**
* **Reproduction Steps**:
  1. Start any Single Player Fritz bot match (Standard or Elite).
  2. Before selecting a tile in the pre-game draw board, observe the player hud at the top of the board.
* **Evidence**:
  * In [bot_standard_match_started.png](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_standard_match_started.png) (and Elite setup), the player pill is highlighted with `is-active-turn` because the condition is simply `!botTurn`.
  * Code implementation:
    ```tsx
    className={clsx('wl-player-pill is-you', !botTurn && 'is-active-turn')}
    ```
* **Impact**: 
  During the pre-game draw phase, no domino turns are active, and hands have not been dealt. Highlighting the player pill indicating it is the player's "active turn" is a visual bug that misleads the player into thinking they should play a tile from their hand before the pre-game draw has concluded.

---

### Finding 2: Lack of URL Hash Listener / Client-Side Deep Linking Sync
* **Location**: [App.tsx:L180-L183](file:///Users/olivermorid/racehorse-dominoes/client/src/App.tsx#L180-L183)
* **Severity**: **Medium**
* **Reproduction Steps**:
  1. Open the app and log in.
  2. Edit the browser address bar to change the hash from `/#/` to `/#/solo` or `/#/daily-fritz`.
  3. Notice that the page view does not update, and stays on the home screen.
* **Evidence**:
  * In our initial E2E runs, direct URL hash navigation (e.g. `page.goto('/#/solo')`) did not trigger screen navigation. The browser URL updated but React didn't transition, causing the locators to time out.
  * In [bot_error_state.png](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_error_state.png), the page shows the Home screen instead of the Solo Hub screen.
* **Impact**:
  Users cannot use browser history buttons (Back/Forward) or deep-links to jump between routes inside the application once the app has initialized. Automated E2E testing frameworks must perform artificial reloads or click UI elements to change screens.

---

### Finding 3: Daily Fritz Hub Bypassed to Home Page When No Active Set
* **Location**: `DailyFritzScreen.tsx` / `api.ts`
* **Severity**: **Low**
* **Reproduction Steps**:
  1. Provision a new QA user.
  2. Navigate directly to `/#/daily-fritz`.
  3. If `/api/daily-fritz/today` returns `hasSet: false` (no daily set is currently configured or active), the user is redirected to the Home page `/` instead of staying on the Daily Fritz screen with an appropriate message.
* **Evidence**:
  * In [df_06_hub_revisited.png](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/df_06_hub_revisited.png), revisiting the daily fritz route redirect the user back to the Home screen because the API response had `{ hasSet: false }`.
* **Impact**:
  Instead of viewing leaderboard archives or seeing a clean "No active daily challenge" message inside the Daily Fritz hub, users are pushed back to the dashboard, which is an abrupt navigation change.

---

## 2. E2E Audit Screenshot Index

Below is the chronological index of screenshots captured during the E2E verification:

### Part 1: Multiplayer Matches (1v1)
* [Lobby Creation](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_01_host_created_lobby.png): Private matchmaking room code generated.
* [Lobby Join](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_02_guest_joined_lobby.png): Guest successfully joins the room.
* [Match Active](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_03_match_hand_dealt.png): Hands dealt after resolving pre-game draw.
* [Mid-match Rejoin Before](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_refresh_01_before.png) & [After](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_refresh_02_after.png): Verified that rejoining a match via websocket recovery is clean after page reload.
* [Second Tab Takeover](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_takeover_new_tab.png): Verified the older tab disconnects properly when a new session takes over.
* [Network Disconnect Recovery](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_offline_02_disconnected.png) & [Reconnect](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/mp_offline_03_reconnected.png): Context simulated offline, recovering socket state cleanly when back online.

### Part 2: Daily Fritz
* [Daily Fritz Hub](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/df_01_hub_screen.png): Gold "Play Today's Set" CTA.
* [Match Board Loaded](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/df_02_board_loaded.png): Game board loads with Elite bot config.
* [Recovery](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/df_04_after_refresh.png): Daily Fritz runs persist in database and auto-resume on reload.

### Part 3: Play vs Fritz (Practice Bot Matches)
* [Standard Setup](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_standard_setup.png) & [Match](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_standard_match_started.png): Played Standard bot match.
* [Elite Setup](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_elite_setup.png) & [Match](file:///Users/olivermorid/.gemini/antigravity-cli/brain/0bbe7b98-cebc-49fb-a2ef-49f74a51044f/bot_elite_match_started.png): Played Elite bot match.
