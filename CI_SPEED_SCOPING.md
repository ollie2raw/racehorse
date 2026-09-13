# CI Speed — Scoping Doc

Date: 2026-09-12
Scope: investigation only, per request. No workflow files touched. This is a
report to review and greenlight from, in the same spirit as
`FEATURE_COMPLETENESS_AUDIT.md` / `REFACTOR_OPPORTUNITIES.md` / `PRE_LAUNCH_HARDENING.md`.

Read from `.github/workflows/ci.yml` (229 lines, current on `main`),
`client/playwright.config.ts`, `client/package.json`, and one real recent CI
run (`gh run view 34724286369`, the last green run of
"fix(journey): correct ch1-n03's illegal claimed answer") for actual step
timings, not guesses.

---

## 0. Current wall-clock shape

Three jobs. `mp-private-soak` depends on `server`; `client` runs independently.
Total pipeline wall-clock = `max(client, server → mp-private-soak)`.

| Job | Duration | Gates on |
|---|---|---|
| Server Validation | 2m27s | nothing |
| MP Private Authority Soak | 2m09s | `server` |
| **Client Validation** | **22m14s** | nothing — **this is the critical path** |

`client` alone is ~4.5x the other two jobs *combined*. Any speed win has to
come from `client`. Its step breakdown from the real run:

| Step | Duration |
|---|---|
| Setup + install deps + build game-core | ~20s |
| Typecheck | 14s |
| Lint TS/JS | 25s |
| Lint hooks | 21s |
| Lint CSS | 1s |
| Dependency boundaries | 2s |
| Multiplayer arch boundaries | 1s |
| Multiplayer dependency cycles | 2s |
| Socket event registry ownership | <1s |
| Architecture invariant enforcement | 5s |
| Journey content validation | 1s |
| Client tests (`vitest` + behavior tests) | 2m33s |
| Build server (for E2E) | 4s |
| **Playwright E2E tests** | **13m41s** |
| Mobile reachability gate | 2m22s |
| Upload reachability matrix | 1s |
| Client build | 38s |
| Bundle size check | <1s |
| Upload source maps to Sentry | <1s |
| Lighthouse CI | 1m18s |
| Bot match lazy-load boundaries | <1s |

**Playwright E2E is 62% of the client job and 48% of the entire pipeline.**
Everything else is comparatively cheap. This changes the priority order from
what the request assumed — browser/apt caching turns out to be a rounding
error, and the real lever is Playwright itself.

---

## 1. Playwright browser caching

**Finding: not cached today, but the cost of that is small.** `ci.yml:115`
runs `npx playwright install chromium --with-deps` fresh every run, no
`actions/cache` anywhere in the repo (grepped all of `.github/workflows/*.yml`
— zero hits).

Measured from the real log, the entire `install --with-deps` step (apt
resolve + package install + all three downloads: Chrome for Testing, FFmpeg,
Chrome Headless Shell) took **~29 seconds**, from 23:05:22.9 to 23:05:51.9.
Two reasons it's already fast and caching won't move the needle much:

- **apt packages are mostly no-ops.** The runner's stock `ubuntu-latest` image
  already ships `libasound2t64`, `libatk-bridge2.0-0t64`, `libcairo2`,
  `libdrm2`, `libgbm1`, etc. — the log shows each as `is already the newest
  version`, just re-marked "manually installed". Only `google-chrome-stable`'s
  apt source and the package itself are new work, and pulling the small
  `Release`/`Packages` metadata plus installing already-resolvable debs took
  under 6 seconds.
- **Browser binary downloads are small and CDN-fast.** Chrome for Testing +
  FFmpeg + Headless Shell together downloaded in ~10 seconds total
  (`cdn.playwright.dev`, GitHub-runner-to-CDN bandwidth is good).

**Proposal (still worth doing, just size the expectation correctly):**
cache `~/.cache/ms-playwright` keyed on the resolved Playwright version, e.g.:

```yaml
- name: Get installed Playwright version
  id: playwright-version
  run: echo "version=$(node -p "require('./client/node_modules/@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"

- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-browsers-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}
- name: Install Playwright browsers (+ system deps if cache missed)
  run: npx playwright install chromium --with-deps
```

`playwright install` is already idempotent — it detects each binary's own
version-tagged directory (`chromium-1228`, etc.) and skips downloading when
present, so the same install command works whether the cache hit or not. The
key must include the Playwright version (`^1.61.1` in `package.json`,
resolved via the installed `package.json`, not the semver range) — Playwright
ties browser build numbers to the npm package version, and a stale cache
entry after a Playwright bump would either silently skip a needed
re-download (cache hit on old key = fine, new key = correct miss) or, if you
key on something looser like `runner.os` alone, serve last version's browser
binary against this version's driver, which can hang or crash at protocol
mismatch. Keying on the resolved version avoids that: a `package.json` bump
naturally invalidates.

- **Estimated savings: ~15-20s per run.** (Can't save the whole 29s — apt
  invocation and cache-restore itself both cost a few seconds.)
- **Risk: low.** Purely additive, doesn't change what gets installed, only
  whether it's downloaded again. Worst case on a bad cache write is a slower
  run (cache miss falls through to today's behavicior), not a wrong one.
- **Verdict: do it, but don't expect it to matter.** Low effort, low risk,
  small win. Not where the time is.

---

## 2. apt package caching / pre-built Docker image

Same conclusion as above, more so: apt install is already ~6 seconds because
the `ubuntu-latest` GitHub-hosted runner image already carries almost every
lib Playwright's Chromium needs (it's a common enough dependency set that
GitHub bakes it in). There is very little apt work left to cache.

**Pre-built Docker image (e.g. `mcr.microsoft.com/playwright:v1.61.1-noble`)
is a much bigger change than the ~6 seconds it would save, and it's the
wrong shape for this repo:** the `client` job doesn't run in a container
today (`runs-on: ubuntu-latest`, no `container:` key), and the job also runs
`npm ci`, builds `@racehorse/game-core`, builds the server, and runs
non-Playwright steps (lint, typecheck, architecture checks, Vite build,
Lighthouse) that have nothing to do with Playwright's image. Moving the whole
job into a Playwright-flavored container would mean either (a) reinstalling
Node.js tooling assumptions inside that image and re-validating every other
step still works in it, for a few seconds of apt savings, or (b) splitting
Playwright into its own job just to get a specialized container — which is
worth doing anyway per §3, but then the container choice becomes an
implementation detail of that new job, not a repo-wide swap.

- **Proposal: skip.** The `actions/cache` step in §1 already covers the
  browser binaries, which is where the real (if still small) cost is. A
  Docker image swap is unjustified effort for single-digit seconds.
- **Risk if done anyway: medium.** Pinning to a Playwright-published image
  tag creates a second place (image tag + `package.json` version) that has to
  stay in sync, and any Node/npm version baked into that image needs to
  satisfy the same-Node-24 assumption `actions/setup-node` currently pins for
  every other step.

---

## 3. Job parallelization

Real step list for "Client Validation" (confirmed from `ci.yml:53-166`, not
from memory — this differs from what was guessed in the request: there's no
separate "server build" gate before E2E as its own top-level job, it's a step
inside `client`, and lint:css / dep-boundary / architecture checks are five
separate fast steps, not folded into "architecture checks" as one):

```
checkout → setup node → npm ci → build game-core
  → typecheck
  → lint (TS/JS)
  → lint:hooks
  → lint:css
  → check:deps
  → check:multiplayer-arch
  → check:multiplayer-cycles
  → check:socket-registry
  → check:architecture
  → qa:journey-content
  → client tests (vitest + behavior tests)
  → build server (dist, needed by E2E + soak)
  → playwright install + e2e
  → e2e:reachability
  → upload reachability artifact
  → client build (vite + prerender)
  → size-check
  → upload sourcemaps to Sentry (main branch only)
  → lighthouse CI
  → check:bot-match-lazy
```

### Real dependencies vs. artificial serialization

- **`npm ci` + `build game-core`** must precede everything (workspace
  package all downstream code imports).
- **Lint/typecheck/architecture-check steps** (typecheck through
  qa:journey-content, ~70s combined) have no dependency on each other or on
  anything after them — they're independent static analyses over `client/src`
  that happen to currently run sequentially in one job. They're cheap enough
  (70s total) that splitting them into their own parallel job **saves wall
  time only if the client job's other work is still the long pole** — which
  it is (E2E dominates), so pulling these ~70s off the front of the `client`
  job's serial chain does shave ~70s off total pipeline time, at the cost of
  one more job's fixed overhead (~10-15s for checkout/setup/install-deps,
  which would now run twice).
- **Client tests (vitest, 2m33s)** need `build game-core` but nothing else
  before it, and nothing after it needs its output. Independent job
  candidate.
- **"Build server" step** is required by E2E (`npm run e2e --prefix client`
  drives a real server process per `playwright.config.ts`'s `webServer`
  array) and by the MP soak job (which already builds server itself,
  separately, in the `mp-private-soak` job — that's an existing, harmless
  duplication across jobs, not new).
- **Playwright E2E, mobile reachability, client build, Lighthouse** form a
  real dependency chain today only because reachability's `webServer` block
  reuses the same dev-server pattern and Lighthouse needs `client/dist` from
  the Vite build. Reachability does **not** depend on E2E finishing — it's an
  independent Playwright project (`mobile-reachability`, gated behind
  `REACHABILITY=1`) hitting its own port (5233) per `playwright.config.ts:12`.
  It's serialized today purely by being a later step in the same job, not by
  a real need.
- **Client build → size-check → Sentry upload → Lighthouse** is a real chain
  (each needs `client/dist`).
- **`check:bot-match-lazy --dist`** greps the built `client/dist` output
  (`--dist` flag), so it needs the client build to have already happened —
  real dependency, currently misplaced *after* Lighthouse instead of right
  after the build step it depends on, which is a one-line reordering
  opportunity independent of parallelization.

### Proposed split

```
job: lint-and-static      (~70s)   — typecheck, lint, lint:hooks, lint:css,
                                      check:deps, check:multiplayer-arch,
                                      check:multiplayer-cycles,
                                      check:socket-registry,
                                      check:architecture, qa:journey-content
job: unit-tests           (~2m33s) — client tests (vitest + behavior tests)
job: e2e                  (~14m)   — build server, playwright install, e2e run
                                      (see §4 for shrinking this number itself)
job: mobile-reachability  (~2m22s) — build server, e2e:reachability
                                      (independent webServer/port; needs its
                                      own server build since jobs don't share
                                      a filesystem)
job: build-and-audit      (~2m)    — client build, size-check, bot-match-lazy
                                      (moved up, see above), Sentry upload,
                                      Lighthouse
```

All five run in parallel (each does its own `checkout`/`setup-node`/`npm ci`/
`build game-core`, ~20s fixed cost each — five jobs' worth of that is spent in
parallel, not additive, since GitHub Actions runs jobs on separate runners
concurrently). **New client-side critical path ≈ max(70s, 2m33s, 14m, 2m22s,
2m) ≈ the `e2e` job**, i.e. ~14m instead of ~22m.

- **Estimated savings: ~8 minutes** (22m14s → ~14m, dominated by whatever E2E
  itself takes — see §4 for shrinking that further).
- **Risk: low-to-medium.**
  - Low: the four non-E2E jobs are genuinely independent — no shared
    mutable state, no artifact hand-off needed since each rebuilds
    `game-core` itself in ~1s.
  - Medium: `build-and-audit`'s Sentry upload step is gated
    `github.ref == 'refs/heads/main'` — moving it into a smaller job is safe
    but worth double-checking the `if:` condition still evaluates correctly
    on the new job (it references `env.SENTRY_AUTH_TOKEN`, which needs the
    `env:` block carried over intact).
  - Medium: five parallel jobs means five times the `npm ci` load on the
    npm registry / GitHub's cache — not a correctness risk, but worth
    watching if it ever gets rate-limited (unlikely at this repo's job count).
  - Not security/deploy-sensitive: no change to what runs, only which job
    boundary it runs inside.

---

## 4. Playwright worker parallelization

**Confirmed: `client/playwright.config.ts:33` hardcodes `workers: 1` and
`fullyParallel: false`, unconditionally (not just under `process.env.CI`).**
This has been true since the config's first commit
(`d9e82c8e`, "Complete production architecture refactor and multiplayer
hardening") with no comment explaining why — so the reasoning below is
reconstructed from the codebase, not from a comment.

### Why serialization is actually load-bearing here (not just inherited caution)

All Playwright tests share **one real server process** (`playwright.config.ts`'s
`webServer` array starts `npm run dev` in `server/` once for the whole run,
`reuseExistingServer: !process.env.CI`, so in CI it's one fresh server for
every test in the run). That server holds process-global mutable state, not
one store per connection:

1. **Daily Fritz's in-memory store is keyed by calendar date, not by
     test/session.** `server/src/http/stores/dailyFritzMemoryStore.ts:14-15`:
     `const runs = new Map<string, DailyFritzRunRecord>()` /
     `const attempts = new Map<string, DailyFritzAttemptRecord>()`, module-level
     singletons, seeded by `runDate` (`seedRun`, line 21) which every spec
     implicitly resolves to "today" server-side. Every one of
     `daily-fritz-v2.spec.ts`, `daily-fritz-server-restore.spec.ts`, and
     `fritz-play-to-completion.spec.ts` (12 tests total) reads/writes the
     *same* record if they overlap. Two workers running one Daily Fritz spec
     each concurrently would race on the same day's run/attempt state —
     genuinely unsafe to parallelize as-is, not just untested.
2. **Rate limiting is per-IP, process-global, and tuned for one real user.**
     `server/src/rateLimit.ts`'s `InMemoryRateLimiter` buckets by key (IP, or
     IP+route); `server/src/index.ts:396-435` wires tight windows for
     sensitive routes (e.g. admin: 20/10min, some auth-adjacent routes:
     10-20 per 5-10min). Every Playwright worker in CI originates from the
     same runner, hence the same source IP. Fanning specs that touch those
     routes out across N concurrent workers multiplies the request rate
     against the *same* bucket in a way the serial run never does — real risk
     of spurious 429s that have nothing to do with the code under test.
3. **Multiplayer specs are comparatively safe.** Room/session identifiers are
     generated with `crypto.randomUUID()` or `Date.now()+Math.random()`
     (`client/src/multiplayer/roomTransport.ts:83-86`,
     `friendChallenge.ts:66`, `useMultiplayerLobbyController.ts:270/288`) —
     no fixed room codes, so `multiplayer-chaos.spec.ts` and
     `multiplayer-in-match-reconnect.spec.ts` (15 tests) don't collide with
     each other on shared keyed state the way Daily Fritz specs do. The
     shared-IP rate-limit risk from point 2 still applies to them if any of
     their flows hit a rate-limited socket event (`room:create`, `room:join`,
     etc. are all in the per-event limiter table at `server/src/index.ts:599-609`)
     under high concurrency.

### Proposed split

- **Keep serial (own project/shard, `workers: 1`):** every spec that touches
  Daily Fritz — `daily-fritz-v2.spec.ts`, `daily-fritz-server-restore.spec.ts`,
  `fritz-play-to-completion.spec.ts`. 12 tests, and `fritz-play-to-completion`
  is also the single slowest file in the whole suite today (6.9m for 3 tests
  — full played-out matches, not something sharding fixes on its own).
- **Parallelize freely (`workers: 4`, `fullyParallel: true`):** everything
  else with no shared-date-keyed state — `match.spec.ts`, `routing.spec.ts`,
  `mobile-390*.spec.ts`, `smoke.spec.ts`, `board-camera.spec.ts`,
  `bot-match-lazy-chunks.spec.ts`, `puzzle-rush-play-to-completion.spec.ts`,
  `ghost-play-to-completion.spec.ts`, `no-brainer-lab-play-to-completion.spec.ts`,
  journey specs, `solo-hub-no-circuit.spec.ts`, `mid-match-scrubber.spec.ts`,
  `spectator-mode.spec.ts`, `welcome-modal.spec.ts` — 77 tests.
- **Multiplayer specs (`multiplayer-chaos.spec.ts`,
  `multiplayer-in-match-reconnect.spec.ts`, 15 tests):** parallelize but at a
  lower worker count (e.g. `workers: 2`) rather than full concurrency, to
  keep socket-event rate-limit headroom — these are the specs most likely to
  legitimately burst requests (chaos/reconnect scenarios), and they're the
  ones point 3 above flags as *comparatively* safe, not *fully* safe.
- Playwright's built-in `--shard=<i>/<n>` is the mechanical tool for this —
  either as separate `projects` entries with different `testMatch` patterns
  and per-project `workers` overrides (Playwright supports per-project
  worker limits via `fullyParallel`/project-level config as of the version
  pinned here, `^1.61.1`), or as a GitHub Actions matrix job per shard. Given
  the state-coupling above, **grouping by spec content (Daily Fritz vs. not)
  is safer than blind numeric sharding** (`--shard=1/4` etc.), because numeric
  shards don't guarantee which files land together and could still put two
  Daily Fritz specs on the same shard's parallel workers.

### Estimated savings

Rough, since real speedup depends on per-file duration variance (the 89-test
run today took 13.3m serial with one 6.9m outlier file):

- Daily Fritz shard stays serial: ~10m for 12 tests including the 6.9m
  outlier (unchanged from today's proportional share).
- Non-Daily-Fritz shard at `workers: 4`: the remaining ~6.4m of serial time
  (89 total tests − 12 Daily Fritz ≈ 77 tests, roughly proportional if none
  of them are outliers like `fritz-play-to-completion` — true here, the
  outlier is inside the kept-serial group) could compress toward ~2m
  wall-clock with 4-way concurrency, generously (real speedup is sublinear:
  shared CPU/network on one runner, browser startup overhead per worker).
- **Combined: Playwright job goes from ~13.3m to roughly ~10m** (bounded
  below by the Daily Fritz shard, which doesn't get faster under this plan
  unless it's separately addressed — e.g. mocking the clock so
  `fritz-play-to-completion.spec.ts`'s 6.9m for 3 full played-out matches
  isn't real wall-clock time, which is a separate, larger investigation not
  scoped here).
- **Risk: medium.** The failure mode isn't a wrong result, it's flaky CI —
  either a real race on Daily Fritz's date-keyed store if a spec is
  misclassified into the parallel group, or spurious rate-limit 429s if
  worker count for the multiplayer group is set too high. Both are
  detectable (new, non-deterministic failures after the change) but not
  free to debug if they slip in unnoticed. Recommend landing the
  Daily-Fritz-serial / everything-else-parallel split first as two projects,
  proving it green for several runs, before tuning worker counts further.

---

## 5. Summary table

| # | Change | Est. savings | Risk | Recommendation |
|---|---|---|---|---|
| 1 | Cache Playwright browsers (`~/.cache/ms-playwright`, keyed on Playwright version) | ~15-20s | Low | Do — cheap, safe, just not impactful |
| 2 | Cache apt packages / pre-built Docker image | ~5-6s / not worth it | Low if skipped, Medium if a Docker swap is forced | Skip — apt is already nearly free on `ubuntu-latest` |
| 3 | Split "Client Validation" into 4-5 parallel jobs | ~8 min (22m → ~14m) | Low-Medium (verify Sentry `if:` condition survives the split; move `check:bot-match-lazy` to right after the build step it depends on) | Do — biggest safe win available |
| 4 | Playwright worker parallelization (Daily-Fritz-serial / rest-parallel split) | ~3-4 min off the E2E step itself (13.3m → ~10m) | Medium (real shared-state coupling to respect — see §4 point 1-2) | Do, but land the file-grouping split first and prove it green before raising worker counts further |

**Combined, conservatively: ~22m client-critical-path → roughly 10-11m**
(job split brings it to ~14m bounded by E2E; E2E's own internal
parallelization brings its ~13.3m down to ~10m, and that becomes the new
job-level bound). Getting further than that means addressing
`fritz-play-to-completion.spec.ts`'s 6.9m outlier directly (real
played-to-completion matches, likely a clock-mocking or turn-skip
opportunity) — flagged here as a follow-on, not scoped in this doc.

Nothing above has been implemented. Awaiting greenlight on which of §1/§3/§4
to build first.

---

## 6. Status

- 2026-09-12 — greenlit: build #1 (Playwright browser caching) + #3 (job
  split) together, one PR, first. #4 held until #3 is green on 3-4 real
  merged PRs, and when built, land only the Daily-Fritz-serial /
  everything-else-parallel project split before touching worker counts. #2
  skipped, agreed not worth it.
- Found during #3's verification pass (not previously known): the Sentry
  sourcemap upload's `if: github.ref == 'refs/heads/main' && env.SENTRY_AUTH_TOKEN != ''`
  is dead code today — a step's own `env:` block is not visible inside that
  step's own `if:` per GitHub's context-availability rules, and `ci.yml` has
  no workflow- or job-level `env:` block that would otherwise expose
  `SENTRY_AUTH_TOKEN` to the condition. Confirmed against a real push-to-main
  run (`gh run view 34723287748`): the step's conclusion is `"skipped"`
  every time, secret configured or not. Decision: preserve verbatim in the
  job split (no net behavior change, bug pre-dates this work) — fixing it is
  a separate, later decision.
- **Follow-on, not yet scoped:** `fritz-play-to-completion.spec.ts`'s 6.9-minute
  outlier (3 tests, real played-out full matches) is the largest lever left
  once #3 and #4 land — likely a clock-mocking or turn-skip opportunity, but
  investigate before assuming either fix shape.
