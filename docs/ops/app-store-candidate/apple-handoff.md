# Apple signing & TestFlight handoff (2026-10-16)

Candidate `45947d34eb6b7643a383b76625326216dd0db4a9`. This file separates **facts the project determines**
from **decisions only the owner can make**, and lists the shortest path to a TestFlight build.
It complements [apple-owner-checklist.md](apple-owner-checklist.md) (step-by-step) and
[testflight-candidate.md](testflight-candidate.md) (archive → upload). No credentials are recorded here.

## 1. Signing state of this machine and project (measured, not assumed)

| Item | State |
|---|---|
| Xcode | 27.0 (build 27A266a); `LicenseInfo` marks it GM (confirm in Xcode › About that it is not a beta: App Store Connect rejects beta-SDK uploads) |
| Apple ID signed in to Xcode | **None** |
| Code-signing identities in the keychain | **0** (`security find-identity -v -p codesigning`) |
| Provisioning profiles | **None** installed |
| `DEVELOPMENT_TEAM` in the project | **Not set** |
| Signing style | Automatic (`CODE_SIGN_STYLE = Automatic`, identity `iPhone Developer`) |
| Bundle ID | `com.racehorse.dominoes` (both configurations; matches `capacitor.config.ts` `appId`) |
| Version / build | `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1` |
| Entitlements / capabilities | None (no entitlements file; no push, Sign in with Apple, associated domains, background modes) |
| Scheme / configuration | No shared scheme is committed; Xcode's default `App` scheme archives **Release** |
| Real iOS env file | Exists at `~/racehorse-dominoes-native-main/client/.env.ios` (not in the repo or this checkout). It passes `iosReleaseGuard` (production server + Supabase project, all six keys non-empty) but has **no `VITE_LEGAL_*` values** |

Nothing about the Apple account, certificates, team or profiles was changed.

## 2. Release identity (verified in the final archive)

Product **Racehorse Dominoes** (`appName`, App Store name) · home-screen label **Racehorse** (`CFBundleDisplayName`) ·
`com.racehorse.dominoes` · iPhone only (`TARGETED_DEVICE_FAMILY = 1`) · minimum iOS 15.0 · landscape left/right only ·
`ITSAppUsesNonExemptEncryption = false` · `arm64` · `CAPACITOR_DEBUG` empty · `loggingBehavior: "none"`.
Unsigned Release archive of the candidate with the **real** `.env.ios` plus the canonical legal values: archive succeeds, 3 valid
privacy manifests (app, `Capacitor.framework`, `Cordova.framework`), no dev URLs, no service-role key, no source maps, no permission
strings. The only artwork blocker is the stock icon.

## 3. App icon (the one artwork blocker)

- Current file: `client/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, the Capacitor placeholder
  (1024×1024, no alpha; blue "X" on white). The catalog is a single universal 1024 slot; Xcode derives every size.
- Provide one **1024×1024, sRGB, opaque (no alpha), square-cornered, full-bleed** PNG (details and rationale: [brand-assets.md](brand-assets.md)).
- Process (one source, all outputs):
  ```sh
  cd client
  node scripts/generateBrandAssets.mjs --icon /path/to/icon-1024.png --dry-run   # validate, writes nothing
  node scripts/generateBrandAssets.mjs --icon /path/to/icon-1024.png             # writes the iOS icon + web icons/favicons
  ```
  It refuses alpha/`tRNS`/too-small input. Then `npm run build:ios` and commit the generated files.
  `scripts/iosProjectSettings.test.ts` also fails if the committed icon is not 1024×1024 or has alpha.
  (Verified here with a throwaway synthetic fixture in `--dry-run`; no final artwork exists in the repo.)
- Splash: **the launch storyboard is a plain navy view with no image**, so `Splash.imageset` is not shown today and
  `--mark` only matters if the storyboard is changed to display it. Decide whether a mark on the launch screen is wanted.

## 4. App Store Connect: project-determined facts vs owner decisions

**Determined by the project**

| Field | Value |
|---|---|
| Platform / bundle ID | iOS / `com.racehorse.dominoes` (register as an **explicit** App ID) |
| Version / build | 1.0 / 1 (raise the build for every upload; never reuse) |
| Devices | iPhone only, so no iPad screenshots; landscape-only, so landscape screenshots (6.9": 2868 × 1320) |
| Export compliance | Standard HTTPS only: `ITSAppUsesNonExemptEncryption = NO`, so nothing is asked per build |
| Sign in with Apple | **Not triggered.** Sign-in is email + password only; no third-party or social login exists in the code |
| Push / background modes / ATT | None used (no code, no entitlements, no `UIBackgroundModes`, no tracking prompt) |
| Account deletion | Present in-app: Settings › Delete account (immediate, typed-username confirmation; what survives is documented in the privacy policy) |
| Report / block | Present (fixed-reason reports, blocks); no free-text chat, only preset emotes |
| URLs | Privacy `https://playracehorse.com/privacy`, Support `https://playracehorse.com/support`, Terms `/terms` (confirm live, and that the support address receives mail) |
| Permissions | None requested |

**Owner decisions (not made here)**
- Enrol / pick the team; seller name (individual vs organisation); copyright line.
- App name availability ("Racehorse Dominoes" if taken); SKU (recommendation: `racehorse-dominoes-ios`, internal only); primary language (recommendation: English (U.S.)).
- Primary/secondary category (checklist proposes Games › Board / Strategy).
- Age-rating questionnaire answers and the matching minimum-age policy (the build is configured with minimum age 13).
- Pricing, availability, release mode (checklist recommends manual release).
- Review contact, demo account, review notes; screenshots.

## 5. Privacy questionnaire input (what the code actually does)

Sources: `client/src/lib/analytics.ts`, `client/src/main.tsx`, `server/src/index.ts` + `sentryScrubbers.ts`,
`client/ios/App/App/PrivacyInfo.xcprivacy`, `client/src/legal/legalContent.mjs`.

| Recipient | What is sent | Identity | Purpose per code | Tracking |
|---|---|---|---|---|
| **Supabase** (auth + database; client talks to it directly for auth, `profiles`, `friends`, `ghost_*`, `matches`, `daily_puzzle_scores`; the game server uses it with a service key) | Email, hashed password, username; games, ratings, match history, Daily Fritz / Puzzle Rush runs, friends and feed entries, reports and blocks | Linked to the account | App functionality | No |
| **PostHog** (`us.i.posthog.com`; only when `VITE_POSTHOG_KEY` is set) | Events `session_start`, `game_opened`, `game_completed`, `share_initiated` (props: `mode`, `run_date`, `context`); tournament events exist but are off. Super property `platform: ios`. `$pageleave`. SDK default device/page properties. A random anonymous id stored on-device; on sign-in `identify(<account uuid>)` with **no** extra properties; `reset()` on sign-out | Anonymous id before sign-in, then linked to the account uuid. `person_profiles: always` | Analytics. Autocapture, session replay, heatmaps, dead clicks, exceptions, surveys, performance capture are **off** in code | No (nothing crosses apps/sites) |
| **Sentry** client (production only, when DSN set) | Errors and 10% performance traces, device/browser/OS context, release id, URLs with auth fragments redacted. **No user is ever set** (`setUser` is never called, `sendDefaultPii` not enabled) | Not tagged with the account | Diagnostics | No |
| **Sentry** server | Errors and 20% traces with sensitive fields scrubbed; per the policy text can include account id and IP | Linked (account id) | Diagnostics | No |
| Google Fonts | Fonts load from Google at runtime: Google sees IP and browser details | n/a | Rendering | No |

The shipped manifest declares, all **linked / not tracking**: Email Address (functionality), User ID (functionality + analytics), Gameplay Content
(functionality), Product Interaction (analytics), **Coarse Location (analytics)**, Crash Data, Performance Data, Other Diagnostic Data
(functionality). `NSPrivacyTracking = false`, no tracking domains, UserDefaults `CA92.1`.

**Items that need your decision or verification (the code does not settle them)**
1. **PostHog IP / Coarse Location: a live inconsistency to resolve before submission.** The release build is configured with
   `VITE_LEGAL_POSTHOG_LOCATION=discarded`, so the privacy page will state "PostHog is set to discard IP addresses". The manifest still
   declares Coarse Location, and the PostHog and Sentry *project* settings that make "discarded" true cannot be verified from the repo.
   Pick one ([posthog-location-decision.md](posthog-location-decision.md)): turn on PostHog "Discard client IP data" **and** Sentry "Prevent
   Storing of IP Addresses", then drop Coarse Location from the manifest, the App Privacy answers and the policy in one change; or keep
   Coarse Location and set the legal value to `derived`. The manifest, App Privacy answers and policy must agree.
2. How Apple classifies: the username (shown to other players), the PostHog on-device random id (Device ID vs User ID), friends/feed and
   report/block records (Other User Content?), and whether "Diagnostics" should be linked given the client sends no user but the server does.
   The manifest's choices are a conservative reading, not a legal determination.
3. Whether the Coarse Location row is needed (item 1) and whether Email/User ID "analytics" purposes are accurate for your PostHog use.

## 6. Signed-build plan (shortest path; each step marks who acts)

1. **Owner:** active Apple Developer Program membership; note the Team ID privately.
2. **Owner:** Xcode › Settings › Accounts › add the Apple ID (Xcode currently has none).
3. **Owner:** (optional, Xcode can do it) register the explicit App ID `com.racehorse.dominoes`; create the App Store Connect app (§4).
4. **Local:** provide the build env. In the checkout you archive from, `client/.env.ios` must hold the real values (the existing file is at
   `~/racehorse-dominoes-native-main/client/.env.ios`) **plus** the five `VITE_LEGAL_*` lines (entity, support email, minimum age, effective date,
   `discarded`/`derived` per §5.1). Then `cd client && npm run build:ios`; it must end with `cap sync ios`. Never edit a guard to pass.
5. **Owner (Xcode):** `open client/ios/App/App.xcodeproj` › target App › Signing & Capabilities › Automatically manage signing › select the Team.
   Xcode writes `DEVELOPMENT_TEAM` into `project.pbxproj` (safe to commit). Confirm the bundle ID reads `com.racehorse.dominoes`, no signing error.
6. **Owner:** set Build to 1 (then +1 per upload). Product › Archive with destination **Any iOS Device (arm64)**.
7. **Owner:** Organizer › Generate Privacy Report (compare with §5) › **Validate App** › **Distribute App** › App Store Connect › Upload. Fix every error;
   never upload around a validation failure.
8. **Owner:** wait for processing; add an Internal Testing group and the build; install from the TestFlight app and run §7.

**What could stop this:** no paid membership or an unaccepted agreement; Apple ID not added to Xcode; the bundle ID already registered by another team or the app name
taken in App Store Connect; a beta Xcode/SDK; stale web bundle (a missing `build:ios` ships whatever was last synced; `ios/App/App/public` is gitignored); missing
`VITE_LEGAL_*` (guard refuses, by design); the unsigned/ad-hoc builds cannot use the Keychain (error -34018), which is expected: a team-signed build gets the
application-identifier entitlement automatically.

## 7. Physical iPhone checklist (what simulators cannot prove)

Install from **TestFlight**. This is the short list; [device-matrix.md](device-matrix.md) is the full sheet.

1. **Home screen:** the icon is the final artwork and the label reads `Racehorse` in full; launch is navy with no white flash.
2. **Real account login:** sign in with a production test account; Home shows your stats.
3. **Kill and relaunch** (swipe away, reopen): still signed in. This exercises the Keychain session.
4. **Logout, then sign in as a second account:** no trace of the first account (friends, name, rating); then log out to guest.
5. **Password recovery:** request a reset, open the email link, finish on the website, sign in to the app with the new password.
6. **Live multiplayer (two phones):** private room create/join, play to the end; ratings/result screen correct.
7. **Background/foreground mid-match:** background 30 s and 2+ min, return: the board resyncs (the native suspension fix), turn timer sane.
8. **Network loss and recovery:** airplane mode 10-20 s mid-match, then back: reconnects with state intact; also try Wi-Fi → cellular.
9. **Keyboard in landscape:** sign-in, sign-up, room-code join and Settings fields stay visible, Return submits, the room code is uppercase without autocorrect.
10. **Daily Fritz:** start the set, play a game, force-quit mid-game, reopen and resume; finish; share sheet works.
11. **Safe areas and touch targets:** both landscape directions; Home's PLAY buttons visible and easy to tap; nothing under the notch/Dynamic Island or home indicator; Privacy/Terms/Support links open.
12. **No permission prompts** appear at any point.
