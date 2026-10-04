# Native shell status (2026-10-04)

Resume with: "read docs/native-shell-status.md and continue".

## Done
- Phase A: `claude/mobile-native-shell` rebased onto main, work committed in logical commits and
  force-pushed (remote `d8a1f79d` → `4f53f09e`; old tip kept locally as
  `backup/mobile-native-shell-pre-rebase`).
  - **Website-affecting commits (cherry-pick/revert independently):**
    `6f41fcf4` rating-history y-axis fix, `dd02efda` shorter Daily Fritz hints,
    `abccd8dc` Stats rating rounding.
- Item 5: PR #329 (recover() gated by tournaments flag), off main, all CI green.
- Merged into this branch: `native/leaderboard` (CSS-only; the earlier crash was a mock
  artefact, no real bug). Post-merge lint / tsc / check:architecture / build all pass.

## In progress (branches in their own worktrees, not yet merged)
- `native/profile` — /Users/olivermorid/racehorse-dominoes-native-profile (also asked to round
  ratings in PlayerCompetitiveSummary / PlayerIdentityHighlights as a separate website commit).
- `native/postgame-review` — /Users/olivermorid/racehorse-dominoes-native-postgame-review
- `native/auth-modals` — /Users/olivermorid/racehorse-dominoes-native-auth-modals
  (also determines whether WelcomeModal is dead code; report only, no fix if so).
Agents may have finished after this file was written: check each branch's `git log 4f53f09e..`.

## Next steps
1. For each remaining branch: review its commits, `git merge --no-ff native/<name>` into
   `claude/mobile-native-shell` (CSS conflicts in `native-landscape.css`: keep both sets of rules),
   then from `client/`: `npm run lint && npx tsc -b && npm run check:architecture && npm run build`.
2. Full suites once at the end: `npx vitest run` in `client/` and `server/` (re-run engine
   corpus/head-to-head devtools failures on their own; they are timing-sensitive under load).
3. Simulator sweep, signed in as the real account (iPhone 18 Pro `84FA3987-…` = 874×402); extra
   sims created: "RH iPhone 16e" `DD9932E5-133C-4A61-8F50-82A9F53BD3EE` (844) and
   "RH iPhone 16 Plus" `32D5B865-238D-423B-8259-5356562A700C` (932), signed out.
   Build: `npm run build && npx cap sync ios`, then
   `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=<UDID>" -derivedDataPath ios/DerivedData/<UDID> build -quiet`,
   `xcrun simctl install <UDID> ios/DerivedData/<UDID>/Build/Products/Debug-iphonesimulator/App.app`.
   Open any route without tapping: set `server.appStartPath` in the installed bundle's
   `capacitor.config.json`, `mkdir -p public/<route>` in the bundle (Capacitor exits at launch if the
   path doesn't exist), ad-hoc re-sign (`codesign --force --sign - --preserve-metadata=entitlements`),
   relaunch. (Xcode 27: `npx cap run ios` fails — Simulator.app is now DeviceHub.app.)
4. Push (normal push unless history is rewritten) and open the PR against main, calling out the
   website-affecting commits above.

## Known follow-ups found along the way (not done)
- Signed-out global leaderboard shows "No ranked players yet." (LeaderboardScreen skips fetching
  without a user) — website behaviour, separate change.
- Leaderboard "Your position" ignores the server's `self` rank when the user is outside the top 100.
