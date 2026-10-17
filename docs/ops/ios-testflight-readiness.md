# iOS / TestFlight readiness pass (2026-10-16)

Base: `feat/app-store-candidate` @ `614d95e4`. Branch: `audit/ios-testflight-readiness`.
Evidence is split: **simulator** (iPhone 17e 844×390 notch, iPhone 18 Pro 874×402 Dynamic Island, Release build, real WKWebView) vs **needs a physical device**.
No legal, privacy-label or App Store answers are made here; those are owner decisions.

## Fixed in this pass

| ID | Finding | Fix |
|----|---------|-----|
| I1 | Release build printed every Capacitor plugin call and payload (including the stored Supabase session) to stdout, so it was readable over a tethered cable | `loggingBehavior: 'none'` in `capacitor.config.ts`; console verified silent, including during a session migration |
| I1 | Native suspension is invisible to the resync policy: WKWebView delivers `visibilitychange` late, so every resume looked like `hidden_duration_short` and a multiplayer match never resynced | 1 s heartbeat; a gap ≥ 5 s counts as hidden since the last beat (`multiplayerLifecycleRecovery.ts`, 8 tests) |
| I1 | Home on 844×390 / 874×402: Daily Fritz / Daily Puzzles cards were 95pt tall for 164pt of content, so **PLAY and the status row were clipped and unreachable**. Cause: bottom safe-area inset counted twice (Home `<main>` and the legal footer) | `native-landscape.css`: the footer owns the inset, `<main>` bottom padding 0, tighter card padding/title, blurb hidden. Measured in WKWebView: card content 125pt in a 125pt box; PLAY visible on both devices. Pinned by `styles/nativeHomeFit.test.ts` |
| I1 | The auth session (access + refresh token) lived in UserDefaults (plaintext plist, in device backups) | Keychain-backed storage, below |
| I2 | iOS keyboard: room-code field autocorrected/lowercased the code and Return did nothing; username/friend inputs autocapitalised | `autoCapitalize/autoCorrect/spellCheck/enterKeyHint`; Return joins once, never while pending |
| I2 | Web phones in landscape: the legal footer took 61px from the pixel-sized compact Home, so `.home-main` scrolled and the streak strip fell under the tab bar | `RacehorseHomeArt.css`: hide the Home footer on `(--short-landscape)` for **web only** (`html:not(.rh-native)`); native keeps it. Privacy / Terms / Support remain in Settings › Legal and support, the sign-in sheet and the public legal URLs |
| test | Listener/interval leak regression across open/background/resume/leave | `lifecycleListenerLeaks.test.tsx` |

## Native session storage (Keychain)

**What was persisted.** Capacitor Preferences was used by exactly one module, the Supabase auth adapter, so *every* key in it was credential-bearing: `sb-<ref>-auth-token` (session JSON: access token, refresh token, user), `…-code-verifier` (PKCE secret) and `…-user`. Nothing benign was stored there, so nothing benign moved.

**Design.** A ~80-line in-repo Capacitor plugin, `packages/capacitor-keychain-storage` (Swift, Security framework `SecItem*`, generic-password items, service `com.racehorse.dominoes.auth`). No custom cryptography. Chosen over a third-party plugin to avoid an unvetted dependency in the auth path and to keep the security boundary readable. It is an npm workspace package, so `cap sync` links it without hand-editing the Xcode project.
- `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable after first unlock (a refresh can run while locked again), never restored onto another device.
- Nothing is logged and no value appears in an error message.
- The Keychain survives an app uninstall; UserDefaults does not. A UserDefaults install marker detects a fresh install and purges Keychain items left by a previous install *before JS can read them*, so deleting the app signs the user out. Proven on the simulator with a control key the app never touches.

**JS adapter** (`client/src/lib/capacitorAuthStorage.ts`, native only; web/PWA keep supabase-js's default storage).
- Keychain is the single authority. Logout removes from both stores. Account switch overwrites the same key; the previous account is gone from every store.
- A corrupted secure value behaves as signed out (and is deleted); a *read error* propagates and deletes nothing. If the Keychain is unavailable the app fails closed to signed out and never falls back to plaintext.

**Existing-install migration** (idempotent, lazy, once per launch, `sb-*` keys only): secure absent → read legacy → write secure → **read back and compare** → only then delete legacy. A failed or unverifiable secure write leaves the legacy value and keeps the user logged in (retried next launch). If both exist, the secure value wins and the legacy copy is deleted. Unrelated Preferences keys are never touched.

**Evidence.** 21 unit tests (fake stores with failure injection, plus the real supabase-js client over the adapter) and, on the simulator through the real plugin: seeded legacy session migrated to Keychain with Preferences emptied and an unrelated key preserved; survived kill/relaunch; `remove` works; uninstall → reinstall finds the Keychain empty; console silent throughout.

**QA caveat.** An *unsigned* build (`CODE_SIGNING_ALLOWED=NO`) has no application-identifier entitlement, so the Keychain returns `-34018` and the app is signed out. That is expected; archive/privacy inspection is unaffected. For simulator QA of login use an ad-hoc signed build: `xcodebuild … -sdk iphonesimulator CODE_SIGN_IDENTITY="-" CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO`. TestFlight/device builds are signed and get the entitlement automatically.

`@capacitor/preferences` stays installed only for the one-time migration read/delete; it can be removed once no pre-Keychain installs remain.

## Privacy manifests (unsigned Release archive)

Three `PrivacyInfo.xcprivacy`, all valid, no duplicates: app, `Capacitor.framework`, `Cordova.framework`. The Keychain plugin links statically (no new framework). `UserDefaults` / `CA92.1` matches actual use (Preferences migration + the install marker); no other required-reason API symbols. No permission strings, background modes, ATS exceptions, entitlements or `server.url`; `CAPACITOR_DEBUG` empty; `loggingBehavior: "none"` packaged. No credential-like strings in the binary or bundle. (The bundle contains the inert `x-e2e-daily-fritz-user` header name; `readE2eDevAuth()` returns null in production builds.)

## Display name and icon: where the owner acts

- **Display name (owner decision, not changed):** `client/ios/App/App/Info.plist` → `CFBundleDisplayName` (currently "Racehorse Dominoes", which truncates as "RacehorseDomi…"). Optionally keep `appName` in `client/capacitor.config.ts` in sync (Capacitor copies it to `capacitor.config.json`; it does not set the home-screen label).
- **Icon (owner artwork, not invented):** the catalog is a single universal 1024×1024 slot; Xcode derives every other size. Replace `client/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` with a 1024×1024, opaque (no alpha), sRGB PNG. No generator command is needed. `scripts/iosProjectSettings.test.ts` now fails if the replacement is not 1024×1024 or has an alpha channel/`tRNS` chunk, so it cannot reach App Store Connect wrong. The current file is the stock Capacitor icon. Launch screen is a solid-navy storyboard.

## Owner blockers (nothing in code can resolve these)

1. Apple Developer team + signing + App Store Connect access.
2. Production `VITE_LEGAL_*` values for `npm run build:ios` (validation here used stand-ins, never committed).
3. Owner-provided icon artwork (above).
4. Final home-screen display name (above).
5. App Store privacy questionnaire (PostHog anonymous ID, coarse-location setting).
6. Physical-device TestFlight QA: background/foreground during a live match, keyboard in landscape, real network loss, login/relaunch with a real account.

## Deferred / not caused by this pass

- Five specs in the non-CI `chromium-mobile-visual` project still fail and are unrelated to the footer or safe area: two approved 844×390 Home screenshot baselines (PLAY-button fill and the Tourney "SOON" tab badge post-date the baselines; geometry now matches), two `deterministic home/*` specs that expect a `/api/ranking/profile` call the app no longer makes, and one nav assertion expecting a gold Single Player tab (renders purple). Re-approving baselines is a design call.
- The live multiplayer e2e (`multiplayer-in-match-reconnect`) needs real Supabase credentials and is not a CI gate; not runnable in a credential-less worktree.
- I3 Daily Fritz server checkpoint is not flushed on `pagehide`; dev diagnostic localStorage toggles remain reachable; "Daily Puzzles" title overlaps its art at 844pt.

## Store technical settings observed

Export compliance: HTTPS only. iPhone-only, min iOS 15.0, landscape-only. No push, background modes, ATT or Sign in with Apple code. Account deletion and report/block exist.
