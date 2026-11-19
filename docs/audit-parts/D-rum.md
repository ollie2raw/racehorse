# Audit D: RUM speed-measurement beacon (#525): abuse, DoS and the privacy text

Audit date 2026-11-17, branch `audit/2026-11-17` (base `ebd5e0b9`). Read-only: no production code changed. Merge commit: `20429dce`.

Evidence labels: **confirmed** = reproduced by a test in this branch; **read from code** = traced by reading; **guess** = plausible, not shown.

Reproductions: `server/src/rum/rum.audit.test.ts`. Run with `cd server && nice -n 19 npx vitest run src/rum/rum.audit.test.ts`. Result: 3 passed, 3 expected fail. Each `it.fails` asserts what the PR or the privacy text promises. I also ran them as plain `it` to check they fail on the assertion itself: D1 the log matches `203.0.113.7`, D3 `expected true to be false`, D4 `expected 400 to be 413`.

Request path for `POST /api/rum` (read from code, `server/src/index.ts`): `requestIdMiddleware` (:372) → `cors` with origin reflection and `credentials: true` (:350-355, :373) → `processAdmissionMiddleware` → `compression` → **global `express.json({ limit: '2mb' })`** (:385) → security headers → `app.use('/api', restApiLimit)` (600 / 5 min / IP, :474) → the route at :893: `rumIngestLimit` (30 / 10 min / IP, :438) → `express.text({ type: () => true, limit: '2kb' })` → `bodyErrors` → handler (`server/src/rum/registerRumRoutes.ts:23-36`).

---

## Findings (ranked)

### D1 — MEDIUM (privacy text accuracy) — When the rate limiter trips on `/api/rum`, the application writes the client's IP to the server log, tagged as a RUM request (confirmed)

**Evidence.** `createRateLimitMiddleware` logs on every 429: `{ scope, key: 'rest:rum:ip:<ip>', keyIp, reqIp, peer, cfConnectingIp, xffRaw }` at warn (`server/src/rateLimit.ts:140-150`). Render keeps that pino line. The same happens for the broader `rest:api` limiter at `/api` (:474), which counts RUM posts together with all other API calls from the IP. The PR's own route tests mount the route **without** the limiter (`server/src/rum/rum.test.ts:204-206`), so "never logs a request" was never tested on the real chain. Reproduction: 31 posts from one address. The log contains `203.0.113.7` under scope `rest:rum` ("AUDIT D1").

**When it happens (guess).** A client sends at most 3 summaries per page load (and only 25% of page loads are sampled), so a single person rarely trips 30 per 10 min. It happens behind shared addresses: carrier-grade NAT on mobile, schools, offices. It also happens when a visitor already over the 600 / 5 min `rest:api` budget for other reasons sends a beacon. Abusers' addresses are logged too, which is defensible, but the policy sentence makes no exception.

**Impact.** The sentence "our application does not record that address with these measurements" is literally true: the beacon is not ingested on a 429. But the application *does* record the address of a RUM request in its logs. "The game server also uses IP addresses briefly, in memory, to limit abusive request rates" (the Logs bullet, `client/src/legal/legalContent.mjs:81`) says nothing about writing them to logs. This is a pre-existing limiter behaviour that the new sentence now leans on.

**Suggested fix.** In the limiter, do not log `keyIp/reqIp/peer/cfConnectingIp/xffRaw` for `rest:rum` (or log a salted hash, or log for all scopes only behind a debug flag). Alternatively, reword the policy: "if a device sends too many requests, its address can appear in our server logs".

### D2 — MEDIUM (DoS, memory; also contradicts "briefly") — `InMemoryRateLimiter` never evicts expired buckets (confirmed; pre-existing, #525 adds a second key per IP)

**Evidence.** `take()` overwrites a bucket only when the **same** key comes back. Nothing ever deletes stale keys, and there is no size cap or sweep (`server/src/rateLimit.ts:24-88`; `clear()` is never called on `restRateLimiter`). After 10,000 distinct addresses and a day of time, all 10,000 entries remain ("AUDIT D2"). Every RUM post now creates `rest:rum:ip:<ip>` in addition to `rest:api:ip:<ip>`.

**Impact.** (a) Memory: an attacker rotating source addresses grows the map without bound until restart. Example: many IPv6 addresses from one /64, each passed through by Cloudflare as a distinct `CF-Connecting-IP`. Each request also gets 2 MB of global JSON parsing (D4). At about 150-250 B per entry (guess), 5-10 M requests is about 1-2 GB, enough for an OOM on a small Render instance. Since #525 `/api/rum` is a cheap, unauthenticated, CORS-free target for this, though any `/api` route already was. (b) Privacy text: addresses are held in memory for the **life of the process**, not "briefly". The policy says "briefly, in memory".

**Suggested fix.** Sweep expired buckets (on `take` every N calls, or on an interval), cap map size, and key IPv6 on the /64.

### D3 — MEDIUM (privacy floor) — The five-summary floor can be undone by differencing two published rows (confirmed)

**Evidence.** Every summary goes into `all` **and** into one group per dimension (`rumAggregator.ts:140-151`). `all` is published whenever it has ≥ 5 (`:185-186`), regardless of which groups were withheld. Rows publish `reports`, `n` and an **exact** `max` (`:117-125`). Reproduction: 6 web summaries plus 1 iOS summary with a slowest tap of 4321 ms. `plat:ios` is withheld as promised, but `all.reports − plat:web.reports = 1` and `all.max = 4321`: the single iOS summary's count and exact slowest value are in the published totals ("AUDIT D3"). With five dimensions, a "folded into other" group can often be isolated the same way. Also, carried groups are re-published the next hour inside `other:<dim>` after already counting toward this hour's `all`, so the hours double-count (accuracy).

**Impact.** Only the owner reads the outputs (logs, `rum_hourly` with no anon/auth grants per the migration, the token endpoint), so there is no external attacker here. But the policy's "a group that is still under five is held back" is weaker than it reads. The text is literally true ("a total is written only if at least five summaries went into it"). Its intent, that no small group can be read, is not achieved.

**Suggested fix.** Publish `all` only when every dimension's withheld remainder is also ≥ 5 or zero. Or drop the exact `max` (publish p95 only) and round `reports`/`n`. Or publish `all` only.

### D4 — LOW — The 2 KB body cap does not apply to `application/json` bodies (confirmed)

**Evidence.** The global `express.json({ limit: '2mb' })` (`index.ts:385`) runs before the route. For `Content-Type: application/json` it reads and parses up to 2 MB. The route's `express.text` then skips the already-read body, and the handler sees a non-string and answers 400 (`registerRumRoutes.ts:31`). Reproduction: a 1 MB JSON body gets **400, not 413** ("AUDIT D4"). Also, a valid beacon sent as `application/json` is rejected 400. That doesn't affect the real client (it sends `text/plain` via `sendBeacon`, `client/src/rum/rumCollector.ts:69`), but the PR body says "2 KB body cap → 413".

**Impact.** No new DoS beyond what every `/api` route already allows (2 MB parse per request, rate-limited 600 / 5 min / IP). The PR's claim is inaccurate. Malformed JSON with `application/json` errors in the global parser and is caught by the route's own `bodyErrors` → 413 'invalid' (read from code, Express 5 route error dispatch). So the error handler and Sentry are not reached.

**Suggested fix.** Register `/api/rum` before `express.json`, or pass `type: 'text/plain'` and reject any other content type with 415.

### D5 — LOW — Sentry tracing exclusion is case-sensitive; Express routing is not (confirmed)

**Evidence.** `ignoreIncomingRequests: (urlPath) => urlPath.startsWith('/api/rum')` (`index.ts:23`). Express 5 routes are case-insensitive by default, so `POST /API/RUM` is ingested (204) while the predicate returns false. At `tracesSampleRate: 0.2`, such a request can produce a transaction carrying the address ("AUDIT D5"). The real client always uses lower case (`rumCollector.ts:72`), so a real player is never affected. Only hand-crafted requests are. Also, the existing test only checks the source text (`rum.test.ts:255-258`), not runtime behaviour.

**Suggested fix.** `urlPath.toLowerCase().startsWith('/api/rum')`, or `app.set('case sensitive routing', true)` for this route.

### D6 — LOW (data integrity) — Anyone can poison the totals, and one beacon can weigh as much as 1000 visits (read from code)

There is no authentication, and POST `text/plain` is a CORS "simple request" (no preflight), so any website can make its visitors' browsers send forged beacons from many addresses. That gets past the per-IP limit. The CORS reflection (`index.ts:350-355`) only governs reading the response. Each metric's `n` may be up to 1000 (`rumAggregator.ts:80`), and the visit median is added to the histogram `n` times (`:147`). So one forged beacon moves the percentiles as much as 1000 honest observations. Impact: perf-budget decisions made on corrupted numbers. Fix: cap `n` well below 1000 (the client caps samples at 60 per metric, `rumPayload.ts:3`), count each summary once per metric, and consider an `Origin` allow-list check (cheap, and it blocks only browser-based forgery).

### D7 — INFO — Checked and fine

- **Cardinality / memory of histograms: refuted as a risk.** Groups are keyed only on validated enum values: 1 + 3 + 3 + 4 + 4 + 4 = 19 groups × ≤ 13 metrics × 23 buckets. `app` is validated but never used as a key or published. `carried` is bounded by the same key set, and `recent` holds ≤ 24 hours (`rumHourly.ts:61`).
- **Prototype pollution: refuted.** `JSON.parse` makes `__proto__` an own key, which `TOP_KEYS` rejects (`rumAggregator.ts:66`). Metric names must be in `METRIC_SET` (`:78`), and only known names are written to `clean`.
- **Log injection: refuted.** The only RUM log line logs the published object: enum-derived group names, fixed metric names and integers (`rumHourly.ts:59`). The pino JSON output escapes it. The route itself never logs.
- **Gzip bombs:** body-parser inflates and enforces the limit on decoded bytes (read from code / library behaviour; the 2 KB text cap and the 2 MB JSON cap both bound it).
- **Summary token:** `timingSafeEqual` after a length check (leaks only the length), 404 when unset, 20 / 10 min / IP limit, excluded from tracing by the same prefix. Token strength is the owner's choice (not verifiable).
- **Exceptions:** the handler cannot throw (try/catch around `JSON.parse`; `parseBeacon` and `ingest` are pure), so the error handler and Sentry error events with request data are not reached from this route (read from code).
- **Referer:** the client sets `Referrer-Policy: strict-origin-when-cross-origin` (`vercel.json:9`, `client/public/_headers:4`), so the cross-origin beacon carries only the origin, never a page path (no room code in the Referer). On iOS the origin is the Capacitor scheme.
- **Cookies:** `sendBeacon` sends credentials, but the game server sets no cookies (`grep res.cookie|Set-Cookie` in `server/src`: none). Whether Cloudflare/Render add their own cookies: unproven.

---

## Privacy sentence, claim by claim

Source: `client/src/legal/legalContent.mjs:80` (list bullet), `:81` (Logs bullet, pre-existing), `:83` (the paragraph).

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "about a one in four chance" each open/reload | **Read from code: true only for the default build** | `DEFAULT_RUM_SAMPLE_RATE = 0.25`, `rumConfig.ts:2`; one `Math.random()` per call, `startRum.ts:18`; called once at module load, `main.tsx:78`. **Unprovable:** the deployed `VITE_RUM_SAMPLE_RATE` for web and for each iOS build. |
| 2 | "measures a few timings during that visit": screen after tap, first tile, after a hand ends, room join / hand ready ack, tap reaction | **Read from code: true** | `RUM_METRICS` (`server/src/rum/rumAggregator.ts:16-30`); collector `rumCollector.ts:26-154`. |
| 3 | "When you switch to another app or leave, it may send" | **Read from code: true on web**; iOS unproven | `visibilitychange` hidden + `pagehide`, `rumCollector.ts:171-173`. Capacitor WKWebView behaviour on app switch was not verified (the PR says so too). |
| 4 | "at most once every 20 minutes and no more than three times per visit" | **Read from code: true** (per JS context) | `MIN_SEND_GAP_MS`, `MAX_SENDS`, `rumCollector.ts:23-24,157-160`. "Visit" = page load; an iOS app kept alive for days is one visit. |
| 5 | "contains only" timings (count, middle value, slowest) | **Confirmed** (server rejects anything else) | `summarize` `rumPayload.ts:29-34`; server strict `parseBeacon` `rumAggregator.ts:63-84`; PR tests `rum.test.ts:34-58`. |
| 6 | "which part of the app they come from (Daily Fritz, Play vs Fritz or multiplayer)" | **Mostly true; incomplete** | Metric names also include `nav.home_to_hub`, `nav.hub_to_setup` and `inp`, which belong to none of the three modes. |
| 7 | "the app version" | **True** | `VITE_APP_VERSION` sliced to 7 chars, else `'dev'`, `rumCollector.ts:49-51`. |
| 8 | "whether you are on the website or the iOS app" | **Slightly incomplete** | `plat` may also be `android` (`analyticsPlatform`, `client/src/lib/analytics.ts:59-61`; server accepts it, `rumAggregator.ts:35`). |
| 9 | Device bands: form, screen band, memory band "where your browser shares that", connection type "such as 4g" | **True** | `rumPayload.ts:12-27`, `rumCollector.ts:45-58`. `connection.effectiveType` is an *estimated quality* class, not the connection type; that wording is loose but harmless. |
| 10 | "does not contain your account, username, email, IP address, room codes, moves or any identifier" (body) | **Confirmed for the body** | `buildBeacon` `rumPayload.ts:40-48`, server rejects unknown keys. **Not true of the request as a whole:** the HTTP request inherently carries IP, User-Agent, Origin and Accept-Language, which the text addresses only for IP. |
| 11 | "the app stores nothing on your device for it" | **Read from code: true** | Sample draw in memory, `startRum.ts:11-18`. The PR's source ban test is in `client/src/rum/rum.test.ts`. (The lazily loaded chunk sits in the HTTP cache like any asset.) |
| 12 | "adds each summary to totals for the hour, for everyone together and for each of those descriptions separately (never combined)" | **Confirmed** | `ingest` `rumAggregator.ts:140-154`: `all` plus one key per dimension, no cross keys. |
| 13 | "does not keep the summary itself" | **True in letter** | Only histograms are kept. But a group with a single summary holds that summary's bucket, `n` and **exact max** in memory, possibly across hours (`carried`), until it reaches 5 or the process restarts. |
| 14 | "A total is written to our logs or stored in our database only if at least five summaries went into it" | **Confirmed in letter**; intent undermined by **D3** | Floor `rumAggregator.ts:122-125,185-201`; DB `CHECK (reports >= 5)` in `supabase/migrations/2026-11-16_rum_hourly.sql`. Differencing `all` against per-group rows recovers withheld counts and exact max (D3). |
| 15 | "smaller groups are folded into 'other', and a group still under five is held back" | **Confirmed** (see D3 caveat) | `:188-201`. Held groups live only in process memory; a restart drops them unwritten. |
| 16 | "The hourly totals are written to our server logs" | **Confirmed** | `log.info({ rum: hour }, 'rum hourly summary')` `rumHourly.ts:59`. **Unprovable:** Render's log retention period (the text gives none). |
| 17 | "may be stored in our database, where they are deleted after 12 months" | **Read from code: conditional** | `runRetention` `rumHourly.ts:43-54` runs only while `RUM_SUPABASE_APPEND_ENABLED=true` and only when an hour was published (`:64`). If the flag is turned off with rows present, they are never deleted. A retention failure retries hourly. **Unprovable:** that it has ever run in production, and whether the migration is applied. |
| 18 | "Like any request, the summary reaches our server from your IP address: our application does not record that address with these measurements" | **True in letter; misleading in one path (D1)** | The route never reads the IP and never logs (`registerRumRoutes.ts`; test `rum.test.ts:229-234`). But on a 429 the limiter logs the IP with `scope: 'rest:rum'` (`rateLimit.ts:140-150`, confirmed D1). Sentry tracing is excluded for lower-case paths only (D5). |
| 19 | "our hosting provider, like any web host, may log requests" | **Unprovable from code** | Render (and its Cloudflare edge) request logs: their content (IP, UA, path, query) and retention are outside the repo. |
| 20 | (Logs bullet, :81) "The game server also uses IP addresses briefly, in memory, to limit abusive request rates" | **Contradicted** | Buckets keyed by IP are never evicted: process lifetime, not "briefly" (D2, confirmed). On a 429 the IP is also written to logs, not only kept in memory (D1, confirmed). |
| 21 | (Diagnostics bullet, :79) server Sentry "may include your IP address" | **Consistent** | The RUM route is excluded from tracing (lower case) and cannot throw; error events from other routes are covered by this bullet. |

### What each third party sees for a RUM request

- **Cloudflare (Render's edge) and Render:** full request: IP, User-Agent, Origin, path `/api/rum`, headers, body. Logging and retention are unproven (outside the code).
- **Sentry:** nothing from the RUM route on the lower-case path (excluded from tracing, `index.ts:23`; the handler cannot throw). An upper-case path can be traced at 20% (D5). The event-loop lag monitor and other routes report independently (covered by the Diagnostics bullet).
- **Our pino logs (Render log stream):** hourly totals only, **plus** the IP, `X-Forwarded-For` and `CF-Connecting-IP` of any rate-limited RUM request (D1).
- **Rate limiter (process memory):** `rest:api:ip:<ip>` and `rest:rum:ip:<ip>` keys, kept until the process restarts (D2).
- **Supabase:** only aggregated rows (when the flag is on), with no anon or authenticated access (migration revokes and enables RLS).

---

## Unproven: needs device or production access

- The deployed `VITE_RUM_SAMPLE_RATE` (web and every iOS build); claim 1 depends on it.
- iOS Capacitor: whether `visibilitychange`/`pagehide` fire on app switch, and whether `sendBeacon` delivers from `capacitor://localhost` to the game server (CORS is not needed for a simple POST, but WKWebView beacon behaviour is unverified).
- Render and Cloudflare request-log contents and retention; whether Cloudflare sets cookies on the game-server origin that `sendBeacon` would then send.
- Production 429 rate on `rest:rum` / `rest:api`, which decides how often D1 actually writes addresses to logs (search Render logs for `"scope":"rest:rum"` and `rate limited`).
- Rate-limiter map size in production over a long uptime (D2): heap trend in `startResourceUsageLog` output.
- Whether `RUM_SUPABASE_APPEND_ENABLED` is on, whether the migration is applied, and whether retention deletes have run (claim 17).
- That `isTrustedInfraPeer` is always true for production peers (so `CF-Connecting-IP` is used and cannot be forged by an origin-direct request); this is a property of Render's network, not the code.
