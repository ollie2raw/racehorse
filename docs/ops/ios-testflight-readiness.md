# iOS / TestFlight readiness pass (2026-10-16)

Base: `feat/app-store-candidate` @ `614d95e4`. Branch: `audit/ios-testflight-readiness`.
Evidence is split: **simulator** (iPhone 17e 844×390 notch, iPhone 18 Pro 874×402 Dynamic Island, Release build, real WKWebView) vs **needs a physical device**.
No legal, privacy-label or App Store answers are made here; those are owner decisions.

## Fixed in this pass

| ID | Finding | Fix |
|----|---------|-----|
| I1 | Release build printed every Capacitor plugin call and payload (including the stored Supabase session) to stdout, so it was readable over a tethered cable | `loggingBehavior: 'none'` in `capacitor.config.ts` (45f8e676); console verified silent |
| I1 | Native suspension is invisible to the resync policy: WKWebView delivers `visibilitychange` late, so every resume looked like `hidden_duration_short` and a multiplayer match never resynced | 1 s heartbeat; a gap ≥ 5 s counts as hidden since the last beat (`multiplayerLifecycleRecovery.ts`, 8 tests) |
| I1 | Home on 844×390 / 874×402: Daily Fritz / Daily Puzzles cards were 95pt tall for 164pt of content, so **PLAY and the status row were clipped and unreachable** (the card is not tappable). Cause: bottom safe-area inset counted twice (Home `<main>` and the legal footer) plus the legal footer's height | `native-landscape.css`: footer owns the inset, `<main>` bottom padding 0, tighter card padding/title, blurb hidden (same precedent as completed cards). Measured in WKWebView: card content 125pt in 125pt box; PLAY visible on both devices. Pinned by `styles/nativeHomeFit.test.ts` |
| I2 | iOS keyboard: room-code field autocorrected/lowercased the code and Return did nothing; username/friend inputs autocapitalised | `autoCapitalize/autoCorrect/spellCheck/enterKeyHint` on those inputs; Return joins from the room-code field once, never while pending (f42acf07) |
| test | Listener/interval leak regression across open/background/resume/leave | `lifecycleListenerLeaks.test.tsx` (a5ef1e9a) |

## Privacy manifests (unsigned Release archive, `CODE_SIGNING_ALLOWED=NO`)

Three `PrivacyInfo.xcprivacy`, all valid plist, no duplicates: app, `Capacitor.framework`, `Cordova.framework`.
The `UserDefaults` / `CA92.1` declaration matches actual use in the binary (Capacitor Preferences stores the session). No other required-reason API symbols found. No permission usage strings, entitlements or capabilities. No unexpected plugins (`@capacitor/preferences` only).

## Owner blockers (nothing in code can resolve these)

1. Apple Developer team + signing + App Store Connect access (archive with signing fails only for the missing team).
2. Legal env values for `npm run build:ios` (`VITE_LEGAL_*`); validation here used stand-ins that are never committed.
3. **App icon: still the stock Capacitor icon.** Needs a 1024×1024 PNG, no alpha, sRGB at `client/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (or supply `assets/icon-only.png` + `assets/splash.png` and run `npx @capacitor/assets generate --ios`). Launch screen is a solid-navy storyboard; `Splash.imageset` is unused.
4. **Home-screen display name truncates** as "RacehorseDomi…". Pick a ≤ 12-char `CFBundleDisplayName` (e.g. "Racehorse").
5. App Store privacy answers (PostHog anonymous ID, coarse location setting): owner decision.
6. Physical-device pass: background/foreground on a live match, keyboard in landscape, real network loss.

## Deferred

- I2 Supabase session lives in UserDefaults (Capacitor Preferences), not Keychain.
- I2 Web-landscape Home overflows 390pt because the legal footer sits outside `<main>` (10 failing specs in the non-CI `chromium-mobile-visual` project). Needs a design call on where legal links live on short landscape; native is fixed.
- I3 Daily Fritz server checkpoint is not flushed on `pagehide`.
- I3 Dev diagnostic localStorage toggles remain reachable.
- I3 "Daily Puzzles" title overlaps its art on 844pt.

## Store technical settings observed

Export compliance: HTTPS only. iPhone-only, min iOS 15.0. No push, background modes, ATT or Sign in with Apple code. Account deletion and report/block exist.
