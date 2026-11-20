# First-party speed measurements (RUM beacon)

Field data for the perceived-lag programme: how long a real player waits for the main transitions, without a new service, an identifier, or
anything stored on the device. Budgets and lab numbers: [`docs/perf-budget.md`](../perf-budget.md). The privacy text is in
`client/src/legal/legalContent.mjs` ("Speed measurements").

## What happens
1. **Client** (`client/src/rum/`). `main.tsx` calls `startRumAfterFirstPaint()` (a few hundred bytes). It draws one random number per page load, **in
   memory**: below the sample rate the visit is measured. Rate `0`, or a visit outside the sample, returns before anything is imported, listened
   to or sent. A measured visit loads the collector (`rumCollector`, its own chunk, not in the cold-load JS) when the page is idle.
2. **Collector.** It watches what the screens already render (selectors in `rumSelectors.ts`, guarded by a contract test) rather than hooking the
   screens: tap to next screen (hub, setup, Play vs Fritz match, Daily match, multiplayer room), match to first playable tile, hand-result dialog
   closing to the next playable tile, plus `hand:ready` and `room:join` acknowledgements (two one-line `rumRecord` calls) and INP (web-vitals).
3. **Beacon.** When the tab is hidden or the page is left: one `navigator.sendBeacon` of `text/plain` JSON to `POST /api/rum` on the game server
   (no CORS preflight), at most once per 20 minutes and three times per page load, and only if there is something to report.
4. **Server** (`server/src/rum/`). Strict validation (unknown keys, metrics, bands or out-of-range numbers: 400). The summary is added to per-hour
   histograms and dropped. Once an hour a totals line goes to the pino log; optionally rows go to `public.rum_hourly`.

## The beacon (version 1, about 400 bytes)
| Field | Type | Example | Why |
|---|---|---|---|
| `v` | `1` | `1` | schema version; anything else is rejected |
| `app` | string, 1-16 chars `[A-Za-z0-9._-]` | `"d462426"` | build (first 7 characters of `VITE_APP_VERSION`, or `dev`): ties a slowdown to a release |
| `plat` | `web` / `ios` / `android` | `"web"` | website versus app shell |
| `form` | `phone` / `tablet` / `desktop` | `"phone"` | touch-only device under 600 CSS px on the short side is a phone, above it a tablet, else a computer |
| `scr` | `xs` / `s` / `m` / `l` | `"s"` | short side of the screen: under 400, 400-599, 600-1023, 1024 and up |
| `mem` | `le2` / `4` / `8p` / `na` | `"4"` | `navigator.deviceMemory` (Chromium only, banded), else `na` |
| `net` | `slow` / `3g` / `4g` / `na` | `"4g"` | `navigator.connection.effectiveType` (Chromium only), else `na` |
| `m` | metric name to `[count, median, max]` (whole ms, 0 to 600000) | `"nav.start_to_match.daily": [2, 261, 340]` | the timings |

Metric names: `nav.home_to_hub`, `nav.hub_to_setup`, `nav.start_to_match.pvf`, `nav.start_to_match.daily`, `nav.private_to_room.mp`,
`match.first_playable.pvf|daily|mp`, `hand.end_to_playable.solo|mp`, `mp.hand_ready_ack`, `mp.room_join_ack`, `inp`.
`hand.end_to_playable` is measured **from the hand-result dialog closing** (the player's own reading time is not counted) **to the first tile the
player can play**, so it includes any wait for the opponent to move first. `match.first_playable` runs from the match appearing, so it includes the
pre-game draw and the opponent's opening when they lead.

Not sent: any account, anonymous or session id, username, email, IP address as a field, URL or path, room code, match id, moves or tiles, user-agent
string, timestamps. The server notes only the UTC hour it received the summary.

## Hourly totals and the five-summary floor
Groups: `all`, and one dimension at a time: `plat:*`, `form:*`, `scr:*`, `mem:*`, `net:*` (never combined). Per row: summaries that contained the
metric, observations, p50, p75, p95, max (a percentile is the upper edge of its histogram bucket; each summary's median stands for its count).
- A group with fewer than **5 summaries** in the hour is folded into `other:<dimension>`; an `other` (or `all`) still under 5 is **carried into the
  next hour in process memory** and not published. A row (group and metric) that fewer than 5 summaries reported is withheld.
- The table also refuses `reports < 5` (`CHECK`). A summary is not a person: one page load can send up to three an hour, so five summaries is at least
  two page loads, not five people.
- A server restart loses the in-progress hour and any carried group (nothing is flushed on shutdown, so a partial hour cannot overwrite a row).

## Settings
| Name | Where | Default | Effect |
|---|---|---|---|
| `VITE_RUM_SAMPLE_RATE` | client build (Vercel / iOS build) | `0.25` in a build, `0` in the dev server | share of page loads measured; `0` = nothing loads or sends. **If you change it, change "about one in four" in the privacy text.** |
| `RUM_INGEST_ENABLED` | Render | on unless exactly `false` | `false` answers 204 and drops every summary |
| `RUM_SUMMARY_TOKEN` | Render (secret) | unset | bearer token for `GET /api/rum/summary` (404 when unset): `{ current, published }`, the in-memory preview and the last 24 hours |
| `RUM_SUPABASE_APPEND_ENABLED` | Render | off | append the hourly rows to `public.rum_hourly` and run the daily 12-month delete |
| `RUM_RETENTION_ENABLED` | Render | off | keep the daily 12-month delete running while the append is OFF (set it BEFORE turning the append off, then rows already stored still expire; rollback: unset it) |

## Owner steps
- **Use it:** nothing to enable; a build with the default rate measures 25% of page loads once this ships. Read it from the Render log line
  `rum hourly summary` (field `rum.rows`), or `curl -H "Authorization: Bearer $RUM_SUMMARY_TOKEN" $SERVER/api/rum/summary`.
- **Keep the trend across restarts (optional):** apply `supabase/migrations/2026-11-16_rum_hourly.sql`, then set `RUM_SUPABASE_APPEND_ENABLED=true` and restart.
  Rows older than 12 months are deleted by a job that runs about once a day while the server is up and the flag is on.
  **Before turning the flag off, delete the old rows yourself** (`delete from public.rum_hourly where hour < now() - interval '365 days'`) or drop the
  table, or set `RUM_RETENTION_ENABLED=true` first so the delete job keeps running without the append.
- **Roll back:** set `VITE_RUM_SAMPLE_RATE=0` and redeploy the client (stops new summaries after the next load), and/or `RUM_INGEST_ENABLED=false` on Render (stops
  collection at once).
- **App Store Connect:** review the declared data purposes before the first iOS build with the beacon (owner checklist, section D).

## What each sentence of the privacy text rests on
| Claim | Proof | Not provable from the code |
|---|---|---|
| about a one in four chance per open or reload | default `0.25`, drawn per page load (`startRum.ts`, `rum.test.ts`) | the deployed `VITE_RUM_SAMPLE_RATE`: the text is right only while it is unset or `0.25` |
| sent when you switch away or leave, at most every 20 min and three per visit | `rumCollector.ts` (`MIN_SEND_GAP_MS`, `MAX_SENDS`), test | |
| contains only the listed fields | `buildBeacon` and the server's strict `parseBeacon` (unknown keys rejected), tests on both sides | |
| no account, username, email, IP, room code, moves or identifier in it | same; the client test bans id and storage APIs in `src/rum` | |
| the app stores nothing on the device for it | the sample draw is in memory; test bans `localStorage`, cookies, etc. in `src/rum` | |
| the server does not keep the summary | the aggregator holds histograms only (test dumps it and finds no field); the route never logs | request lines in the hosting provider's own logs (covered by the last sentence of the text) |
| totals per description separately, never combined; five-summary floor | `RumAggregator` and its tests; the table's `CHECK` | |
| the application does not record the address with these measurements | no `req.ip`, user agent or header is read or logged in `src/rum` (test); `/api/rum` is excluded from Sentry tracing (test); errors on the route are answered in the route | the in-memory rate limiter sees the address to count requests (the policy already says so); Sentry error reports for other failures (the policy already says they can include it); the hosting provider's logs |
| hourly totals in our server logs | `log.info({ rum }, 'rum hourly summary')` | how long Render keeps its logs (set by the plan, not by us; the text does not give a period for logs) |
| stored totals deleted after 12 months | `runRetention` (test with a fake clock), daily while the flag is on | that the job has run in production; it stops when the flag is turned off (see Owner steps) |
