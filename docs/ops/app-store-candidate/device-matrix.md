# Real-device matrix (TestFlight build)

Two iPhones, one sitting. Install from **TestFlight**, not Xcode, so the
Release build is what's tested.

| Device | Model | iOS | Notes |
|---|---|---|---|
| A (modern, Dynamic Island) | `<e.g. iPhone 15/16/17 Pro>` | | |
| B (older / smaller) | `<e.g. iPhone SE, 12 mini, any iOS 15–17 device>` | | |

Build: 1.0 (____)  Commit: ______  Date: ______  Tester: ______

Mark each cell PASS / FAIL / n/a and note anything odd. Any FAIL blocks
submission until triaged.

| # | Area | Case | A | B | Notes |
|---|---|---|---|---|---|
| 1 | Install | Fresh install from TestFlight; first launch | | | |
| 2 | Install | **Cold launch time**: force-quit, stopwatch from icon tap to interactive Home (cards tappable). Record seconds, 3 runs each | ___ / ___ / ___ s | ___ / ___ / ___ s | |
| 3 | Install | Relaunch after force-quit: still signed in | | | |
| 4 | Account | Sign up a new account (username kept) | | | |
| 5 | Account | Sign in | | | |
| 6 | Account | Sign out | | | |
| 7 | Account | Password reset to an external address, finish on the web, sign in to the app with the new password | | | |
| 8 | Account | Delete account (Settings → Delete account) → signed out, can't sign in again | | | |
| 9 | Native | Keyboard in sign-in / sign-up / Settings fields: field stays visible, can submit, keyboard dismisses | | | |
| 10 | Native | Landscape left: layout, nothing under the notch/Dynamic Island | | | |
| 11 | Native | Landscape right: same | | | |
| 12 | Native | Safe areas: nav, tab bar, board and modals clear the home indicator and sensor housing | | | |
| 13 | Network | Wi-Fi: Home, Play vs Fritz, Daily Fritz load | | | |
| 14 | Network | Cellular (Wi-Fi off): same | | | |
| 15 | Network | Temporary offline: airplane mode 10 s mid-match → back online → reconnects, state intact | | | |
| 16 | Lifecycle | Background 30 s mid-match → foreground → state intact | | | |
| 17 | Play | Play vs Fritz full game (two tiers across the devices) | | | |
| 18 | Play | Daily Fritz: start the set, play a game | | | |
| 19 | Play | Quick Match A vs B | | | |
| 20 | Play | Private room: A creates, B joins with the code, finish | | | |
| 21 | Play | Reconnect: B force-quits mid-match and reopens → seat reclaimed (or forfeit handling as designed) | | | |
| 22 | Social | Friend request A → B, accept, see each other's activity | | | |
| 23 | Safety | Report and block between two accounts (full list: [production-test-accounts.md](production-test-accounts.md)) | | | |
| 24 | Share | Daily Fritz / Daily Puzzle share: share sheet or copy works, no dead end | | | |
| 25 | Links | Privacy, Terms, Support links open (Safari or in-app browser) and load | | | |
| 26 | Native | No permission prompt appears at any point | | | |
| 27 | Native | Launch screen is solid navy (no white flash, no Capacitor "X"); a logo mark appears only if the storyboard was changed to show one ([brand-assets.md](brand-assets.md)) | | | |
| 28 | Home screen | Icon is the final artwork and the label reads `Racehorse` in full (not truncated) | | | |
| 29 | Account | Force-quit and reopen: still signed in (Keychain session). Then sign out and sign in as a second account: nothing from the first remains | | | |

## Cold start (Part 16): measure first

Target: interactive within a few seconds on Device B. Do **not** add a fake
splash or artificial delay to hide a slow start.

Only if row 2 reproducibly shows a blank screen longer than about **5 s**:

1. **Profile JS startup.** Connect the device, Safari → Develop → the device →
   the app's WebView (Release builds don't expose the inspector by default:
   use a Debug build from Xcode on the same commit, which sets
   `CAPACITOR_DEBUG`), record a Timeline from launch.
2. **Chunk preload.** The built `client/dist/index.html` modulepreloads a
   number of chunks (about 13 at the time of the 5B brief; recount with
   `grep -c modulepreload dist/index.html` after `build:ios`). From the local
   `capacitor://` origin these should be fast; check whether any single chunk
   dominates parse/eval.
3. **Fonts.** Google Fonts load over the network
   ([native-surface-audit.md §3](native-surface-audit.md#3-font-audit-part-17));
   with `display=swap` they shouldn't block paint, but confirm in the Timeline.
   Self-hosting is the fix if they do.
4. **Auth restore.** Session restore from the Keychain (the in-repo
   `capacitor-keychain-storage` plugin) plus the Supabase token refresh: time
   from launch to the first authenticated request.
5. **Remote assets.** Home art and any images fetched from the network rather
   than bundled.

Record what was measured and which (if any) of these explained it before
changing anything.
