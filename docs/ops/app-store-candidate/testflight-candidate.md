# TestFlight candidate: archive → validate → internal TestFlight

Run only after [apple-owner-checklist.md](apple-owner-checklist.md) §A–C
(membership active, bundle ID registered, team selected, App Store Connect
record exists) and the real icon/splash are committed ([brand-assets.md](brand-assets.md)).

**Never bypass validation.** If Validate App or the upload reports an error or
an `ITMS-` warning, stop, record it in the log below and fix it in the
project; don't upload around it.

## Steps

1. **Clean tree on the commit being shipped.**
   ```sh
   git status            # clean
   git rev-parse --short HEAD   # record it
   npm ci                # repo root
   ```
2. **Production web bundle into the iOS project.**
   ```sh
   cd client
   npm run build:ios
   ```
   Must end with `cap sync ios` succeeding. Any guard failure stops the run;
   fix `client/.env.ios`, never the guard. (Details: [`../ios-release-build.md`](../ios-release-build.md).)
3. **Open Xcode.** `open ios/App/App.xcodeproj`. Wait for Swift packages to
   resolve (Capacitor 8.5.2, CapacitorPreferences, and the in-repo
   `packages/capacitor-keychain-storage`).
4. **Set the build number.** Target App → General → Identity: Version `1.0`,
   **Build** = previous uploaded build + 1 (first upload: `1`). Record it.
5. **Check the scheme.** Product → Scheme → Edit Scheme → Archive → Build
   Configuration **Release**.
6. **Archive.** Destination **Any iOS Device (arm64)** → Product → **Archive**.
   The Organizer opens with the new archive.
7. **Generate Privacy Report.** Organizer → select the archive → right-click →
   **Generate Privacy Report**. Save the PDF (owner files, not the repo).
   Compare with `client/ios/App/App/PrivacyInfo.xcprivacy` and the App Privacy
   answers: the same data types, no tracking, UserDefaults `CA92.1`.
8. **Validate App.** Organizer → **Validate App** → App Store Connect →
   automatic signing. Fix every error; copy every warning into the log.
9. **Distribute App.** → App Store Connect → **Upload** (TestFlight & App Store)
   → automatic signing → Upload.
10. **Processing.** App Store Connect → the app → TestFlight. Wait for
    processing (often 10–30 min); watch the owner's email for `ITMS-` notices
    sent after upload, and log them.
11. **Internal testing.** TestFlight → Internal Testing → create group
    (e.g. "Owner") → add testers (team members with App Store Connect access)
    → add the build. No Beta App Review needed.
12. Install from the TestFlight app on both test iPhones and run the
    [device matrix](device-matrix.md).

## Upload log (fill in)

| Date | Commit | Version (build) | Validate result | ITMS warnings / errors (verbatim) | Action taken |
|---|---|---|---|---|---|
| | | 1.0 ( ) | | | |

Former watch item, resolved: `UIRequiredDeviceCapabilities` is now `arm64`
(pinned by `client/scripts/iosProjectSettings.test.ts`), so Validate should not flag it.

Current facts for this build (2026-10-16, candidate `45947d34`; see [apple-handoff.md](apple-handoff.md)):
the home-screen label is `Racehorse`; the auth session lives in the Keychain, which only works in a
**team-signed** build (unsigned/ad-hoc builds get error -34018 and fail closed to signed-out); and
`npm run build:ios` needs the five `VITE_LEGAL_*` values in addition to `client/.env.ios`.
