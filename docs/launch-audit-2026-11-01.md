# Launch audit, 2026-11-01

A fresh, read-only audit of the whole platform against a chess.com-level bar, ahead of the App Store launch and marketing.
It replaces `LAUNCH_READINESS_CHECKLIST.md` as the current view; that file predates the tournament, review and Games work.

**Method.** Playwright against production (`playracehorse.com`, `racehorse.onrender.com`) as a guest, 23 routes at phone portrait (390x844), phone landscape (844x390), desktop (1440x900), and again with the native iOS shell emulated (`rh-native` class, 844x390 and 667x375, the App Store build is landscape-only). Header, SEO and legal checks with curl. `npm audit --omit=dev` for both packages. Nothing was changed in the app or server, and no account was signed in.

**Not covered** (needs the owner or a device): signed-in flows (Games, Rating History, tournament play), real-device TestFlight behaviour, Apple Developer setup, haptics/audio on hardware.

## Verdict

No P0 launch blockers found in what could be tested from outside. The product is visually strong, layouts hold in every viewport, and operations are healthy. The gaps are (1) owner-side App Store prerequisites, (2) a guest first-impression problem, (3) dependency advisories to clear after the tournament week, and (4) a polish tail of small tap targets and accessibility gaps.

## P1: fix before App Store submission

1. **App icon is still the stock Capacitor icon.** Needs owner artwork (1024x1024 plus the asset catalog). Hard blocker for review and for marketing screenshots.
2. **Owner-side Apple prerequisites are open**: developer team and signing, App Store Connect record, privacy questionnaire (the privacy manifest is present and consistent), physical-device TestFlight pass per `docs/ops/app-store-candidate/testflight-qa-checklist.md`. Old PRs #352 / #353 (Journey / TestFlight) are still open and should be merged or closed deliberately.
3. **Guest first impression.** A guest tapping the primary Play card lands on Daily Fritz showing placeholder dashes (DATE / TIER / FORMAT), a "Sign in to play Daily Fritz." line, and a gold Play button with no sign-in action beside it. `/games` for a guest is a heading and one line of grey text. chess.com lets a new visitor play immediately and shows a clear sign-in button. Recommended: make the guest route to a playable mode (Play vs Fritz works as a guest) or put a real "Sign in" button in the empty states; fill the placeholders with a skeleton or hide them when signed out.
4. **Production dependency advisories** (`npm audit --omit=dev`): server 7 (1 critical `proxy-addr`, 4 high incl. `compression`, `body-parser`, `engine.io`, `socket.io-parser`), client 11 (1 critical `dompurify`, high `react-router(-dom)`, `socket.io-parser`, `brace-expansion`). `npm audit fix` is available for all but the `@capacitor/cli` chain, which is dev tooling. Needs triage for real reachability, then a PR with the full test and e2e run. **Server changes are paused until after the first tournament week**, so schedule the server half for after it; the client half can go first.

## P2: polish a chess.com-level product would not ship

5. **Tap targets under 44px on primary controls** (reachability gate passes via spacing exemptions, but the bar is higher): Multiplayer Quick/Private toggle 29px, Settings On/Off 28px, Daily Fritz leaderboard tabs 30px, Social filter chips 30px, "View Leaderboard" 32px, how-to-play step markers 28px, practice close 32px, support email link 20px.
6. **Accessibility: no `h1` on `/practice`, `/friends`, `/games`, `/rating-history`.** Cause is `client/src/ui/LayoutScreen.tsx:25`, which renders the title as `<h2>`. One-line fix, but CSS selectors keyed on `h2.layout-screen-title` need checking first.
7. **Generic page title** on `/puzzle-rush`, `/practice`, `/friends`, `/stats`, `/games`, `/rating-history` (the default site title). Matters for the browser history list, shares and screen readers.
8. **Raw error text**: the Social feed shows the raw string `not_found` in a failure state; Rating History did the same against the fake backend. Route both through `playerFacingErrorMessage`.
9. **Console noise**: a guest opening `/daily-fritz/leaderboard` calls the authenticated `GET /api/daily-fritz/today` and logs a 401. Harmless, but skip the call when signed out.
10. **Single OG image for every page**, and `apple-touch-icon` uses the 192px icon (should be 180px). Matters for marketing links.
11. **Known visual nits carried over**: HUD button width about 30px in the match tray, nav tightness at 1280-1360px, the Play vs Fritz description touching the badge row.

## What is solid (verified)

- **Production health**: `/health` and `/ping` 200 in about 0.3 s. Tournament schedule correct: first event 2026-11-02 18:00 ET, then 21:00 ET, registration opens 06:00 ET; DST handled.
- **Security headers**: strict CSP, HSTS preload, X-Frame-Options DENY, nosniff, Permissions-Policy, Referrer-Policy.
- **SEO and legal**: robots.txt, sitemap, manifest, favicon, canonical, OG and Twitter tags all present; privacy, terms and support pages have real content with a named operator and contact address, no placeholders.
- **Layout**: no document-level overflow on any of the 23 routes at 6 viewport/shell combinations; no content below the fold that should not be (long legal and how-to pages scroll in an internal region by design). Daily Fritz, Multiplayer, Solo and Home read well in native landscape.
- **iOS**: privacy manifest, `ITSAppUsesNonExemptEncryption=false`, no third-party sign-in (so Sign in with Apple is not required), report/block and in-app account deletion exist.
- **Code health**: one TODO/FIXME in client and server source; architecture invariants and lint budget enforced in CI.

## Recommended sequence

1. Owner: icon artwork, Apple Developer / App Store Connect setup, TestFlight on a real device (items 1, 2). Nothing else gates the launch as much as these.
2. Monday: run the tournament event-night monitor (`docs/ops/tournament-launch/monitor-one-result.sql`) and watch the first two events. No server changes until it has run for the week.
3. Client PR "guest first impression" (item 3) plus the a11y and title batch (items 6, 7, 8, 9), which are small and share a review.
4. Client dependency update PR (item 4, client half), full CI and e2e.
5. Tap-target PR (item 5), verified with the reachability gate and native screenshots.
6. After the event week: server dependency update, multiplayer review records (design already written), OG/apple-touch assets (item 10).

## Owner reminders

- Play one signed-in Play vs Fritz game, then open **Games** and press Analyze; review has not yet been run on a real game.
- Change the password that was pasted into chat earlier.
