# Native shell status (2026-10-04)

All phases of the "finish the remaining native screens" pass are done; this branch is up for
review as a PR against main. Resume notes below are for follow-up work only.

## What's on this branch
- Rebased onto main (remote force-pushed `d8a1f79d` → `4f53f09e`; old tip kept locally as
  `backup/mobile-native-shell-pre-rebase`), then:
- Native layouts: Rating History, Friends, Quick Match status line, Home Soon pill, global
  leaderboard, auth modals (incl. lost-tap fix), post-game review, player profile, Rating History
  axis label, disabled Play Ghost button.
- **Website-affecting commits (cherry-pick/revert independently):**
  - `6f41fcf4` rating-history y-axis spans the rating band
  - `dd02efda` shorter Daily Fritz locked-game hints
  - `abccd8dc` Stats shows ratings as whole numbers
  - `e36412c4` player profile rounds fractional ratings
  - `03d33b10` profile sections grouped into layout-neutral columns (no visual web change)
  - `ace0d541` Game Review board zoom icons drawn outside the match screen
- Separate PR #329 (off main): `recover()` gated by the tournaments flag.

## Verification tooling
- Simulators: iPhone 18 Pro `84FA3987-4BAD-4DE5-BE28-F624FF1326BB` (874×402, signed in),
  "RH iPhone 16e" `DD9932E5-133C-4A61-8F50-82A9F53BD3EE` (844), "RH iPhone 16 Plus"
  `32D5B865-238D-423B-8259-5356562A700C` (932), both signed out. Boot at most one extra at a
  time: each booted sim costs ~200 processes and three at once exhausted the per-user limit.
- Build: `npm run build && npx cap sync ios`, then
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=<UDID>" -derivedDataPath ios/DerivedData/<UDID> build -quiet`,
  `xcrun simctl install <UDID> ios/DerivedData/<UDID>/Build/Products/Debug-iphonesimulator/App.app`.
- Open any route without tapping: set `server.appStartPath` in the installed bundle's
  `capacitor.config.json`, `mkdir -p public/<route>` in the bundle (Capacitor exits at launch if the
  path doesn't exist), ad-hoc re-sign (`codesign --force --sign - --preserve-metadata=entitlements`),
  relaunch. (Xcode 27: `npx cap run ios` fails — Simulator.app is now DeviceHub.app.)

## Known follow-ups (not done)
- Signed-out global leaderboard shows "No ranked players yet." (LeaderboardScreen skips fetching
  without a user) — website behaviour.
- Leaderboard "Your position" ignores the server's `self` rank when the user is outside the top 100.
- The welcome modal is parked (`WELCOME_MODAL_VISIBLE = false`, `c45fde8a`); no native pass done.
- No `@capacitor/keyboard` plugin: on device the keyboard overlays the web view; the auth modals
  were made to scroll inside themselves, but real-keyboard behaviour needs a device check.
