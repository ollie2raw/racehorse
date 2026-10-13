# Apple owner checklist

Steps only the account owner can do. **None is marked done.** Values in
`<angle brackets>` are owner facts this repo does not know (legal name, team
ID, contact details). Never commit credentials, the demo-account password or
the team's personal details.

## A. Apple Developer Program

- [ ] **Enroll** at developer.apple.com/programs (individual, or organisation:
      organisation needs a D-U-N-S number and shows the organisation as the
      seller). Seller name shown on the store: `<owner legal name or entity>`.
- [ ] **Verify membership is active**: developer.apple.com/account → Membership
      details shows an active Apple Developer Program membership with an
      expiry date. Note the Team ID privately (`<TEAM ID>`, not committed).
- [ ] Accept the latest Program License Agreement (Account → banner) and, in
      App Store Connect → Business, the Free Apps agreement if prompted.

## B. Identifiers and signing

- [ ] Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs →
      App → Description `Racehorse Dominoes`, **Bundle ID (explicit)
      `com.racehorse.dominoes`**. No capabilities needed (no push, no Sign in
      with Apple, no associated domains in 1.0).
- [ ] Xcode → Settings → Accounts → add the Apple ID of the team.
- [ ] `open client/ios/App/App.xcodeproj` → target **App** → Signing &
      Capabilities → **Automatically manage signing** on → **Team**:
      `<the team>`. Xcode writes `DEVELOPMENT_TEAM` into `project.pbxproj`;
      that change is safe to commit.
- [ ] Confirm the bundle identifier field reads `com.racehorse.dominoes` and
      no signing error is shown.

## C. App Store Connect record

- [ ] appstoreconnect.apple.com → Apps → **+** → New App:
  - Platform: **iOS**
  - Name: **Racehorse Dominoes** (if taken, decide an alternative; ≤ 30 chars)
  - Primary language: English (U.S.)
  - Bundle ID: `com.racehorse.dominoes`
  - **SKU**: `racehorse-dominoes-ios` (internal, never shown; any unique string)
  - User access: Full access
- [ ] App Information:
  - **Category**: Primary **Games → Board**; secondary **Games → Strategy**
  - Content rights: does not contain third-party content (all art first-party;
    fonts are SIL OFL)
  - **Age rating**: complete the questionnaire. Expected answers: no violence,
    no sexual content, no gambling or simulated gambling (no wagering,
    currency or prizes), no unrestricted web access, no free-text messaging
    (chat removed; preset emotes only), user-generated content limited to
    usernames, with report/block. Product policy minimum age is decided by the
    owner in the Terms; pick the matching rating if offered. Not "Made for Kids".
  - Copyright: `© 2026 <owner legal name or entity>`
- [ ] **Privacy Policy URL**: `https://playracehorse.com/privacy` (confirm the
      page is live first).
- [ ] **Support URL**: `https://playracehorse.com/support` (confirm live, and
      that its email address receives mail: [support runbook](support-and-smtp-runbook.md)).
- [ ] Marketing URL (optional): `https://playracehorse.com`.
- [ ] Pricing and Availability: Free; countries `<owner choice>`.

## D. App Privacy

- [ ] App Privacy → Get Started → "Do you or your third-party partners collect
      data from this app?" **Yes**.
- [ ] Enter exactly the types in `client/ios/App/App/PrivacyInfo.xcprivacy`,
      each **linked to the user, not used for tracking**:

| Type | Purposes |
|---|---|
| Contact Info → Email Address | App Functionality |
| Identifiers → User ID | App Functionality, Analytics |
| User Content → Gameplay Content | App Functionality |
| Usage Data → Product Interaction | Analytics |
| Location → Coarse Location | Analytics — **only if Option A** in [posthog-location-decision.md](posthog-location-decision.md) |
| Diagnostics → Crash Data | App Functionality |
| Diagnostics → Performance Data | App Functionality |
| Diagnostics → Other Diagnostic Data | App Functionality |

- [ ] Tracking: **No** for every type (no ATT prompt needed).
- [ ] After the first archive, compare against Xcode's **Privacy Report**
      ([testflight-candidate.md](testflight-candidate.md)). They must match.

## E. App Review information

- [ ] **Review contact**: `<first name>`, `<last name>`, `<phone>`,
      `<email>` (the owner's real contact; not committed anywhere).
- [ ] **Demo account**: create a dedicated production account (not personal,
      not one of the moderation test accounts unless deliberately chosen),
      enter username/email and password **only** in App Store Connect.
      Sign-in required: Yes.
- [ ] Review notes: paste the reviewed draft (owner-held notes). Mention:
      landscape-only, internet required, how to reach Settings → Delete
      account, multiplayer needs two players, tournaments not in this version.
- [ ] Attachments: none needed.

## F. Version and release

- [ ] Version 1.0 → Build: select the tested TestFlight build.
- [ ] Screenshots: 6.9" iPhone set, landscape 2868 × 1320 (owner capture plan).
- [ ] Export compliance: answered by `ITSAppUsesNonExemptEncryption = NO` in
      `Info.plist`; confirm nothing is asked.
- [ ] **Version Release: "Manually release this version"** (so approval does
      not publish before launch-day infrastructure work).
- [ ] Submit for Review only after the [device matrix](device-matrix.md) and
      [moderation checklist](production-test-accounts.md) pass.
