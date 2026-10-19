# First App Store candidate (iOS 1.0)

What is still needed before the first signed TestFlight build of Racehorse
Dominoes, and what the project already declares. Public runbook: no secrets,
no owner credentials. Every "Verified" row below cites the file it was read
from. Last checked: 2026-10-12 against `origin/main` 26cb14e2.

Related docs:

| Doc | For |
|---|---|
| [`../ios-release-build.md`](../ios-release-build.md) | `npm run build:ios`, its guards, the privacy manifest |
| [`apple-handoff.md`](apple-handoff.md) | **Start here (2026-10-16):** measured signing state, facts vs owner decisions, privacy inventory, signed-build plan, physical-iPhone checklist |
| [`apple-owner-checklist.md`](apple-owner-checklist.md) | Apple Developer + App Store Connect steps (owner only) |
| [`testflight-candidate.md`](testflight-candidate.md) | Archive → validate → internal TestFlight, once signing exists |
| [`brand-assets.md`](brand-assets.md) | App icon, splash and favicon generator; master artwork requirements |
| [`support-and-smtp-runbook.md`](support-and-smtp-runbook.md) | Support mailbox, Supabase custom SMTP, auth URLs |
| [`posthog-location-decision.md`](posthog-location-decision.md) | Keep or drop Coarse Location (privacy manifest + App Privacy) |
| [`production-test-accounts.md`](production-test-accounts.md) | Two disposable accounts + live moderation checklist |
| [`testflight-qa-checklist.md`](testflight-qa-checklist.md) | What is proven in a simulator vs what needs a physical iPhone and a signed build (2026-10-18) |
| [`device-matrix.md`](device-matrix.md) | Real-device pass/fail matrix, cold-start measurement |
| [`native-surface-audit.md`](native-surface-audit.md) | Every screen reachable in the iOS build: live, hidden or admin-only |

## 1. What remains for the first TestFlight candidate

Nothing below is done unless it says so.

| # | Item | Owner | Blocks | Doc |
|---|---|---|---|---|
| 1 | Apple Developer Program membership active; team selected in Xcode | Owner | Signing, everything after | [apple-owner-checklist](apple-owner-checklist.md) |
| 2 | **Replace the stock Capacitor icon and splash.** `AppIcon-512@2x.png` and the three `splash-2732x2732*.png` in `client/ios/App/App/Assets.xcassets/` are still the Capacitor template art (blue "X" on white). Owner supplies a 1024 px opaque icon master and a transparent mark; `client/scripts/generateBrandAssets.mjs` produces every size | Owner (art), engineering (run + commit) | App Review (Guideline 2.3 / placeholder icon), and the white launch flash | [brand-assets](brand-assets.md) |
| 3 | `client/.env.ios` exists only on the owner's build machine; confirm its values pass `npm run build:ios` | Owner | Archive | [ios-release-build](../ios-release-build.md) |
| 4 | Privacy policy, terms and support pages live at `https://playracehorse.com/privacy`, `/terms`, `/support` (Phase 5B.2) | Engineering + owner facts | App Store Connect record, App Review | — |
| 5 | Support mailbox receiving mail; Supabase custom SMTP + Site URL + Redirect URLs | Owner | Password reset from the app, support URL | [support-and-smtp-runbook](support-and-smtp-runbook.md) |
| 6 | Coarse Location decision (PostHog IP setting) | Owner | Final archive's privacy manifest; App Privacy answers | [posthog-location-decision](posthog-location-decision.md) |
| 7 | Production moderation migrations applied, then the 14-item live moderation check with two test accounts | Owner | App Review (Guideline 1.2: report/block must work in production) | [production-test-accounts](production-test-accounts.md), [`../moderation-rollout/README.md`](../moderation-rollout/README.md) |
| 8 | First archive: Privacy Report, Validate, upload, internal TestFlight | Owner (signing) | Device testing | [testflight-candidate](testflight-candidate.md) |
| 9 | Real-device matrix on two iPhones, including cold-start timing | Owner | App Review submission | [device-matrix](device-matrix.md) |
| 10 | App Store Connect record, metadata, screenshots, App Privacy, age rating, review notes, demo account | Owner | App Review submission | [apple-owner-checklist](apple-owner-checklist.md) |

Not required for TestFlight but tracked: self-hosting the two web fonts
(deferred, see §3), and the decision on whether tournaments ship in 1.0
(`VITE_ENABLE_TOURNAMENTS=false` today, so the iOS build has no Tournament tab).

## 2. First signed archive: what the project already declares

| Setting | Value | Verified in | Status |
|---|---|---|---|
| Bundle ID | `com.racehorse.dominoes` | `client/ios/App/App.xcodeproj/project.pbxproj` (`PRODUCT_BUNDLE_IDENTIFIER`, Debug and Release of target App); `client/capacitor.config.ts` `appId` | Verified. Must be registered under Identifiers by the owner |
| Display name | Store/product name `Racehorse Dominoes`; **home-screen label `Racehorse`** (the long name truncated as "RacehorseDomi…") | Label: `client/ios/App/App/Info.plist` `CFBundleDisplayName`; product name: `capacitor.config.ts` `appName` | Verified 2026-10-16 |
| Version | `1.0` | `project.pbxproj` `MARKETING_VERSION = 1.0` → `Info.plist` `CFBundleShortVersionString = $(MARKETING_VERSION)` | Verified |
| Build number | `1` in the project | `project.pbxproj` `CURRENT_PROJECT_VERSION = 1` → `CFBundleVersion` | Verified. **Process:** raise it for every upload (Xcode → target App → General → Build). App Store Connect refuses a build number already used for version 1.0. Suggested: 1, 2, 3 … per upload; never reuse. Commit the bump only if the team wants the number in git (it is not needed for the build) |
| Devices | iPhone only | `project.pbxproj` `TARGETED_DEVICE_FAMILY = 1` (both configurations); `Info.plist` `LSRequiresIPhoneOS = true` | Verified. No iPad screenshots needed |
| Orientation | Landscape, both directions | `Info.plist` `UISupportedInterfaceOrientations` = `LandscapeLeft`, `LandscapeRight` (an unused `~ipad` key also lists both) | Verified |
| Minimum iOS | 15.0 | `project.pbxproj` `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (project and target, both configurations); `client/ios/App/CapApp-SPM/Package.swift` `.iOS(.v15)` | Verified |
| Release configuration | Archive uses **Release** (Xcode's default for the Archive action; no shared scheme is committed, so Xcode creates the default App scheme) | `project.pbxproj` target App Release has no `debug.xcconfig`, so `CAPACITOR_DEBUG` (`Info.plist`) resolves empty in Release; `client/ios/debug.xcconfig` sets it `true` for Debug only | Verified. Check Product → Scheme → Edit Scheme → Archive → Build Configuration = Release before the first archive |
| Production web bundle | `npm run build:ios` | `client/package.json` `build:ios`: env guard → `tsc -b` → `vite build --mode ios` → prerender → delete `*.map` → bundle guard → `cap sync ios` | Verified. `client/ios/App/App/public` and `capacitor.config.json` are gitignored (`client/ios/.gitignore`): an archive without a fresh `build:ios` would ship whatever was last synced |
| Source maps | Not in the app | `build:ios` runs `find dist -name '*.map' -delete` before `cap sync` (`vite.config.ts` has `sourcemap: true` for the web/Sentry) | Verified |
| Store-build guard | Refuses dev/localhost/service-role/e2e/debug config, and (new in 5B.3) `VITE_ENABLE_SPECTATOR_MODE` | `client/scripts/iosReleaseGuard.mjs` `FORBIDDEN_FLAGS`, tests in `iosReleaseGuard.test.ts` | Verified |
| Privacy manifest | `PrivacyInfo.xcprivacy` in the App target's Resources | `project.pbxproj` (`PrivacyInfo.xcprivacy in Resources`); `client/ios/App/App/PrivacyInfo.xcprivacy`: no tracking, UserDefaults `CA92.1`, 8 collected data types incl. Coarse Location | Verified. Coarse Location pending [decision](posthog-location-decision.md) |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` | `Info.plist` | Verified. Means App Store Connect won't ask per build |
| Permissions | None requested | `Info.plist` has no `NS*UsageDescription` keys | Verified |
| Native code | Capacitor 8.5.2, `@capacitor/preferences` (one-time migration read only) and the in-repo `packages/capacitor-keychain-storage` (session storage) | `client/ios/App/CapApp-SPM/Package.swift`; both plugins listed in the packaged `capacitor.config.json` `packageClassList` | Verified 2026-10-18 |
| Signing | Automatic, **no team yet** | `project.pbxproj` `CODE_SIGN_STYLE = Automatic`, no `DEVELOPMENT_TEAM` | Owner: select the team in Xcode (writes `DEVELOPMENT_TEAM`; that diff is fine to commit) |
| App icon | Single 1024 universal entry | `Assets.xcassets/AppIcon.appiconset/Contents.json` | Structure verified; **art is the Capacitor placeholder** (item 2) |
| Launch screen | `LaunchScreen.storyboard` is a plain navy (`#0A0E17`) view with **no image view** | `client/ios/App/App/Base.lproj/LaunchScreen.storyboard` (no `imageView`, re-checked 2026-10-18); `Splash.imageset` still holds the Capacitor art but is not shown | Verified. A mark on the launch screen is a deliberate storyboard change, see [brand-assets](brand-assets.md) |
| `UIRequiredDeviceCapabilities` | `arm64` | `Info.plist`; pinned by `client/scripts/iosProjectSettings.test.ts`; confirmed in the unsigned Release archive (2026-10-18: arm64-only binary, `minos 15.0`) | Verified. The old `armv7` template value is gone |

## 3. Decisions recorded in this phase

- **Native surface (5B.3):** two more placeholder surfaces are hidden in the
  iOS app only: the locked "Lesson Library — Coming Soon" card in Learn, and
  the data-less head-to-head panel ("Per-match stats coming soon") on the
  Quick Match found screen. Spectator mode is now refused by the store-build
  guard. Full table: [native-surface-audit.md](native-surface-audit.md).
- **Fonts: self-hosting deferred.** See [native-surface-audit.md §3](native-surface-audit.md#3-font-audit-part-17).
- **Brand assets:** pipeline added, no final artwork generated. See
  [brand-assets.md](brand-assets.md).
