# Launch audit follow-up, 2026-11-02

A re-run of the read-only guest sweep from `launch-audit-2026-11-01.md` against production (`playracehorse.com`), after the fixes that landed since (the guest first impression, the headings, titles and tap-target batch, the dependency updates, Journey Chapter One polish, the Daily Fritz review). Nothing was changed on production and no account was signed in.

**Method.** Playwright, 23 routes at three sizes (phone portrait 390x844, phone landscape 844x390, desktop 1440x900), 69 page loads. For each: HTTP status, page title, `h1` count, document horizontal overflow, elements hanging past the right edge, raw error-like text on screen (`not_found`, `undefined`, `NaN`, `[object Object]`, stack-trace text), console errors, failed (4xx or 5xx) requests to the site or the API, and interactive controls under 44px. Controls under 44px were then tested for real: whether a tap anywhere in the 44px box around the control actually reaches it (`elementFromPoint`), because an invisible hit area, which the reachability gate relies on, does not show in a size measure.

## Result

| Check | Result |
| --- | --- |
| Page loads | 69 of 69 loaded, all HTTP 200 |
| Console errors | **0** |
| Failed requests (4xx or 5xx) | **0** (the audit's guest `401` on `/daily-fritz/leaderboard` is gone) |
| Horizontal overflow, any route, any size | **0** |
| Elements hanging past the right edge | **0** |
| Raw error text on screen | **0** (the audit's raw `not_found` in Social is gone) |
| Page titles | every route has its own (`Games \| Racehorse Dominoes`, and so on; the audit's generic-title list is fixed) |
| Headings | every route has an `h1` (the audit's four routes without one are fixed). **One page had two**: `/learn/how-to-play` (the tutorial step title and the article title). Fixed in this PR: the step title is an `h2`; the article keeps the page's only `h1`, which is also the one in the prerendered HTML |
| Tap targets | 13 routes tested. Controls under 44px visually (Fritz tier chips 27px, Quick/Private toggle 29px, Settings On/Off 34px, "View Leaderboard" 32px, practice close 32px, how-to-play step markers 28px, Social rows 34 to 40px) **all have their full 44px tap area**. One exception, not a defect: Social's "Load earlier activity" is 34px and its 44px box touches the fixed bottom tab bar by 8px at the initial scroll position; it is mid-feed and scrolls clear of the bar |

## Closed since 2026-11-01

- **Item 4, dependency advisories:** `npm audit --omit=dev` is 0 across the workspace (the production advisories were already fixed). The 14 high build and test tooling advisories are cleared by the lockfile-only update in PR #482; 20 moderate remain (ESLint, vitest and `@capacitor/cli` chains that need breaking major upgrades), none shipped to players.
- **Items 3, 6, 7, 8, 9:** the guest first impression, headings, titles, raw errors and the guest 401. Verified on production above.
- **Item 5, tap targets:** verified above.

## Still open (owner or later)

- Items 1 and 2: app icon artwork, Apple Developer and App Store Connect, privacy questionnaire, a physical-device TestFlight pass.
- Item 10: one social preview image for every page, and the `apple-touch-icon` is the 192px icon (should be 180px). Roadmap 4.11.
- Signed-in flows are not covered by a guest sweep: Games with real data, Rating History, the Daily Fritz and multiplayer reviews, tournament play. A person needs to play one of each on a phone.

## One production finding that is not a page defect

The server was asleep when first requested (three requests timed out at 20 to 30 seconds before the fourth woke it). The free Render instance sleeps after about 15 minutes idle; a keep-awake monitor on `/ping` at 5-minute intervals is the only thing preventing that, and registration for a tournament closes 2 minutes before its start. See `docs/ops/tournament-launch/launch-day-checklist.md` step 4.
