# Audit part E: CI and process (2026-11-19)

Scope: the #523 docs-only path filter (`.github/workflows/ci.yml`, job `changes`), the #522 perf budgets (`.github/workflows/perf-budgets.yml`, `client/scripts/perf/perfBudgetsTier1.mjs`, `perf-budgets.json`, `docs/perf-budget.md`), and how branch protection interacts with skipped jobs. Read-only: nothing in the product was changed, and no build, dev server or browser was run. Base: `ebd5e0b9` (origin/main).

Labels: **confirmed** means reproduced (scratch repo, script run, or GitHub API output quoted here). **read from code** means I read it but did not run it. **guess** means inference.

Reproduction scripts (scratch, not committed):
- `/private/tmp/claude-501/-Users-olivermorid-racehorse-dominoes/bfe677b4-f01d-427d-b089-94184f69ef6c/scratchpad/rule.sh`: a copy of the `run:` block at `ci.yml:172-246`, comments removed, run under `bash -e`.
- `/private/tmp/claude-501/-Users-olivermorid-racehorse-dominoes/bfe677b4-f01d-427d-b089-94184f69ef6c/scratchpad/repro.sh`, `repro2.sh`, `repro3.sh`: scratch repos (git 2.47.1, `GIT_CONFIG_GLOBAL=/dev/null`, so default config as on a runner).
- `/private/tmp/claude-501/-Users-olivermorid-racehorse-dominoes/bfe677b4-f01d-427d-b089-94184f69ef6c/scratchpad/regex.mjs`: the Tier 1 file-discovery regexes run against a real built `index.html`.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| E1 | Critical | `main` has no branch protection and no rulesets. Every "blocking" gate, Tier 1 included, is advisory, and PRs have merged red (#507 with Bundle ratchet failing; #488 and #491 with Playwright failing) | confirmed |
| E2 | High | Renames: the filter uses `git diff --name-only`, which lists only the **new** path. Moving shipping code or a workflow into `docs/` is classified docs-only. The server worker `.cjs` files are a concrete case that still compiles | confirmed |
| E3 | High | The Tier 1 bundle measure has no lower bound. If the markup changes so the regexes find nothing, the measure is 0 bytes and it passes | confirmed |
| E4 | Medium | The perf workflow's `paths:` list leaves out `packages/review-engine/**` and `packages/match-protocol/**`, although Vite builds both from source into the client, and review chunks are in the first-paint `modulepreload` | confirmed (paths) / read from code (impact) |
| E5 | Medium | The E2E "non-shipping" allow-list skips Playwright for any change under `packages/review-engine/` except `src/index.ts`, but `index.ts` re-exports the internals and the client ships them | confirmed by reading the import graph |
| E6 | Medium | The multiplayer Tier 1 budgets measure only with `MP_HAND_BOUNDARY_FAST=true`, which production does not run (default off) | read from code |
| E7 | Medium | Tier 1 budgets are one-sided and loose. A Daily checkpoint path that stops posting (0 posts) passes, and regressions of 1.5-2x pass | read from code |
| E8 | Medium (latent) | If `changes` fails, Server Validation, E2E and the soak are skipped, and GitHub counts a skipped job as passing a required check | confirmed (job failure) / read from GitHub docs (required-check semantics) |
| E9 | Low | The two-dot `base.sha..head.sha` diff hides a revert if `base.sha` is ever stale | mechanism confirmed; staleness unproven |
| E10 | Low | Process odds and ends: Lighthouse `|| true`, thresholds and baselines can be edited in the same PR, no CODEOWNERS, actions pinned by tag, a wrong claim in the #523 PR body | read from code |

Refuted (the filter handles these correctly): pure deletions, symlinks, gitlinks/submodules, case variants, quoted/non-ASCII/newline paths, `..`, mode-only changes, base advancing with code, merging main into the PR, merge commits in the PR, `push` events. Details in "Refuted".

---

## E1 (Critical): nothing enforces CI; red PRs have merged

**Evidence (confirmed)**
- `gh api repos/ollie2raw/racehorse/branches/main/protection` returns `{"message":"Branch not protected","status":"404"}`.
- `gh api repos/ollie2raw/racehorse/branches/main` returns `"protected":false, "required_status_checks":{"checks":[],"contexts":[],"enforcement_level":"off"}`.
- `gh api repos/ollie2raw/racehorse/rulesets` and `.../rules/branches/main` both return `[]`.
- Final check states of the last 40 merged PRs (`gh pr list --state merged --limit 40 --json statusCheckRollup`):
  - **#507**: `Client Build & Audit=FAILURE`. The failing step is **Bundle ratchet** (run 43605758620, job 132479917878). It was merged by `ollie2raw`.
  - **#491**: `Playwright E2E=FAILURE`.
  - **#488**: `Playwright E2E=FAILURE`.
  - #490: `Playwright E2E=CANCELLED`.
- Production deploys when `main` is pushed, whatever CI says. `smoke-test.yml:3-16` runs on `push: main` and starts with "Wait for Vercel + Render to finish deploying: sleep 90". That only makes sense if deploys start on push (read from code). Whether Vercel or Render is configured to wait for checks is in "Unproven".

**Impact.** `docs/perf-budget.md:9,78` and `perf-budgets.yml:3` call Tier 1 "blocking" and "enforced". In practice nothing blocks: a red Tier 1, ratchet, lint or E2E check can merge and deploy. #507 shows it has already happened for a perf gate. This also makes the "skipped job counts as passing" analysis (E8) moot today: no check is required, so skipped, missing and failed checks all look the same to the merge button. The repo is **public**, `allow_merge_commit`, `allow_squash_merge` and `allow_rebase_merge` are all on, and the admin can push straight to `main`.

**Suggested fix.** Add a ruleset on `main`:
- Require a PR.
- Require these status checks: `Lint & Static Checks`, `Client Unit Tests`, `Client Build & Audit`, `Mobile Reachability Gate`, `Detect Non-Shipping-Only Diff`, `Server Validation`, `Playwright E2E`, `MP Private Authority Soak`.
- Before requiring `Perf Budgets (Tier 1)`, apply the E8 / workflow-level-`paths` caveat: move the filter into a job-level `if:`, or add an always-running aggregate job.
- Optionally block force pushes.
- Admin bypass can stay for emergencies, but should be a deliberate act.

---

## E2 (High): rename detection hides the old path, so moving code into `docs/` is "docs-only"

**Code.** `ci.yml:179`: `changed_files=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")`. Rename detection is on by default (`diff.renames=true` since git 2.9). With `--name-only`, a rename prints only the destination path.

**Repro (confirmed, `repro.sh` S1/S1b/S1c and `repro2.sh` S12):**
```
$ git mv server/src/rateLimit.ts docs/attic/rateLimit.ts
git diff --name-only            -> docs/attic/rateLimit.ts
git diff --name-status          -> R100  server/src/rateLimit.ts  docs/attic/rateLimit.ts
git diff --name-only --no-renames -> docs/attic/rateLimit.ts
                                   server/src/rateLimit.ts
rule.sh -> e2e_required=false  server_required=false
```
- **S1b**, rename plus edits (still similar enough to count as a rename) into `docs/attic/rateLimit.md`: classified docs-only.
- **S1c**, rename of the root file `babel.config.js` to root `NOTES.md`: classified docs-only.
- **S12**, `git mv .github/workflows/perf-budgets.yml docs/`: classified docs-only, and the workflow is deleted.
- **S2**, a pure deletion: classified correctly as "needs everything". Only renames slip through.

**Concrete scenario in this repo (read from code).** `server/workers/reviewSearchWorker.cjs` and `server/workers/eventLoopWatchdog.cjs` are loaded at runtime by path string (`server/src/reviewCompletion/reviewSearchRunner.ts:24,153`, `server/src/platform/health/eventLoopLagMonitor.ts:21,95`), not by an import. Suppose a PR renames one into `docs/`, for example as an "archive old worker" cleanup:
- It is classified docs-only, so Server Validation (server tests, `ci.yml:47-52`) is skipped.
- The server `tsc` build that still runs in Mobile Reachability (`ci.yml:323-324`) passes, because a path string does not fail compilation.
- Client jobs are unaffected.
- The PR is green. On merge, production review search or the event-loop watchdog fails at runtime.

The same move hides:
- deleting an E2E spec or a game-core or review-engine test by moving it under `docs/` (coverage silently drops, and the suites that would notice are the skipped ones);
- removing a workflow file (S12).

The push-to-main run would catch the worker case after merge (`ci.yml:172-177` always runs everything on `push`). Per E1, that is after deploy.

**Fix.** Use `git diff --name-only --no-renames` (both paths listed). Better, take the list from what the job actually tests. `actions/checkout` on `pull_request` checks out the merge commit, so `git diff --name-only --no-renames HEAD^1 HEAD` is exactly the change being tested (see E9). Add a test case for "rename code -> docs" next to the 13 cases the #523 PR body lists.

---

## E3 (High): the Tier 1 bundle measure can drop to 0 and pass

**Code.** `perfBudgetsTier1.mjs:44-56` finds files with `/<script[^>]*type="module"[^>]*src="..."/` and `/<link[^>]*rel="modulepreload"[^>]*href="..."/`, and sums their brotli sizes. `record()` (`:29-35`) checks only `v <= max`. Nothing requires `files > 0`, and nothing compares against an expected file count.

**Repro (confirmed, `regex.mjs` on `/Users/olivermorid/racehorse-dominoes/client/dist/index.html`, built 2026-11-15):**
```
as built: 14 files
attribute order swapped (src before type, href before rel): 0 files
single-quoted rel='modulepreload': 1 files
```
With 0 files, the measure is 0 bytes, which is `PASS` against `<= 460000`.

**How it ships (read from code / guess).** Any of these collapses the measure while the browser still loads the same JS before first paint:
- a Vite upgrade or plugin that serialises attributes in a different order;
- `build.modulePreload: false` in `client/vite.config.ts` (the chunks are still statically imported, just found later, which is slower);
- a `transformIndexHtml` plugin such as `preloadHeroImagePlugin` (`vite.config.ts:20-31`) that rewrites the tags.

CSS in `<head>` (three render-blocking stylesheets in the current `index.html`) and the Google Fonts stylesheet are not counted at all. A CSS regression is invisible to every gate: `check:css-ratchet` counts `!important`, hex values and gradients, not bytes.

**Fix.**
- Fail when `files < N`, with N pinned in `perf-budgets.json` (today 14) and changed only on purpose.
- Parse attributes in any order (match each tag first, then read its attributes).
- Optionally add a CSS-bytes-before-first-paint budget.

---

## E4 (Medium): the perf workflow does not start for review-engine or match-protocol changes

**Evidence.**
- Confirmed: `perf-budgets.yml:13-23` (and `:26-36` for `push`) lists `packages/game-core/**`, but **not** `packages/review-engine/**` or `packages/match-protocol/**`.
- Read from code: `client/vite.config.ts:122-123` aliases `@racehorse/match-protocol` and `@racehorse/review-engine` to their `src/index.ts`, so their source is built straight into the client.
- Read from the doc: `docs/perf-budget.md:73` says "the review chunks in the home `modulepreload` (~270 KB br)". The current `dist/index.html` preloads `pivotal-review-*.js`, `game-reviewer-*.js` and `analyzer-*.js`.
- Other build inputs that are missing (lower impact): `client/scripts/prerender.mjs` and the rest of `client/scripts/**` apart from `perf/`, the root `package.json` (workspaces), and `client/tsconfig*.json`.

**Impact.** A PR that touches only `packages/review-engine/src/**` and grows the first-paint JS gets no Perf Budgets run on the PR. The same applies to the server's multiplayer path through match-protocol. The overall JS growth is still caught by the bundle ratchet in `ci.yml` (subject to E1), but not by the first-paint budget. The nightly `schedule` run on `main` catches it within about 24 hours, after merge. GitHub also documents that a PR path filter looks at only the first 300 changed files. A very large PR can therefore skip the workflow even when it touches `client/src` (read from GitHub docs, not reproduced).

**Fix.** Add `packages/**` and `client/scripts/**` (or invert the filter: run on everything except docs-only, as `ci.yml` does). If the check ever becomes required, the filter must move into a job-level `if:` anyway (`perf-budgets.yml:6-8` already says so).

---

## E5 (Medium): Playwright is skipped for shipped review-engine code

**Code.** `ci.yml:207-210`: `packages/review-engine/src/index.ts` requires E2E. `client/src/devtools/*|packages/review-engine/*|*/fixtures/recorded-*/*` count as "non-shipping", so E2E is skipped. The comments (`ci.yml:151-160`, `:200-202`) say these paths "never reach a real player".

**Why that is wrong for review-engine (read from code).**
- `packages/review-engine/src/index.ts` has 51 `export` lines that re-export internals, for example `export { evaluateReviewPosition, ... } from './evaluateReviewPosition'`.
- Shipped client modules import the package: `client/src/analyzer/moveAnalyzer.ts`, `gameAccuracyModel.ts`, `reviewCoachingProse.ts`, `client/src/modules/review/runReviewBatch.ts` and others.
- `vite.config.ts:123` builds it from source.

So a change to `packages/review-engine/src/evaluateReviewPosition.ts`, or to `packages/review-engine/package.json` / `tsconfig.build.json`, changes the shipped review and skips Playwright. Server Validation, unit tests and the client build still run, so the risk is limited to behaviour that only E2E covers.

This rule predates #523; #523 kept it. `client/src/devtools/*` and `*/fixtures/recorded-*/*` are fine today: no non-devtools client source imports either (`git grep` returned nothing).

**Fix.** Narrow the allow-list to `packages/review-engine/src/devtools/*` and `packages/review-engine/fixtures/*`, which are what is actually calibration-only.

---

## E6 (Medium): the multiplayer budgets measure a configuration production does not run

**Evidence (read from code).**
- `perfBudgetsTier1.mjs:74` always starts the server with `serverEnv({ ..., fastFlag: true })`.
- `perfCommon.mjs:70` sets `MP_HAND_BOUNDARY_FAST: 'true'`.
- `server/src/envSchema.ts:83` says the flag is "default off".
- `docs/perf-budget.md:45` says "flag default OFF, so production still pays 871".

**Impact.** "awaited room writes <= 1" and "bytes/step <= 2000" guard the flag-on path only. A regression on the flag-off path, which players get today (for example 3 to 5 sequential writes under the room lock), passes Tier 1.

**Fix.** Also measure flag-off, with budget `<= 3`, the measured value, until the flag ships on by default. Then retire that check.

---

## E7 (Medium): one-sided, loose thresholds

**Evidence (read from code).**
- `record()` (`perfBudgetsTier1.mjs:29-35`) checks only an upper bound. `NaN` fails, correctly (`!(NaN <= max)`), and the bytes-per-step metric becomes `NaN` when no room write is seen (`perfCommon.mjs:83`). That part is robust.
- But `dailyCheckpointPostsOver3Hands = 0` passes. So does `awaitedRoomWritesSecondPlayer = 0`.
  - The first means a regression that stops Daily Fritz checkpoints being saved (a durability bug that #517 exists to prevent) is green on Tier 1. `checkpointResume.mjs` is not in Tier 1.
  - For the second, it is the bytes check, not the awaited check, that catches "no persistence at all".
- `median()` (`perfCommon.mjs:50-55`) drops boundaries whose value is not finite. One measurable boundary out of three still produces a "median".
- Headroom against the current measurements:
  - posts: 12 against 6-7 (about 1.8-2x);
  - Daily bytes: 450,000 against 259,092-294,538 (about 1.5-1.7x);
  - bytes per step: 2,000 against 1,083-1,357 (about 1.5-1.8x);
  - first-paint JS: 460,000 against 440,496 (+4.4%).
  - The doc defends these (posts follow wall-clock time). The consequence is that a regression of up to about 1.5-2x on the Daily and multiplayer byte and post counts passes.
- Retry policy (`:29-41`): a check fails only if both attempts exceed. A regression that pushes the value over the budget in half the runs passes about 75% of the time.
- The demotion rule (`docs/perf-budget.md:85`) lets the PR author move a flaky check to report-only in "the next PR". Combined with E1, that needs no outside approval.

**Fix.**
- Add lower bounds where 0 is a bug: Daily posts `>= 1` (`>= 3` if hand-end posts are guaranteed), boundaries measured `>= 2` before taking a median.
- Tighten bounds once ten CI runs give a p95.

---

## E8 (Medium, latent): a failed `changes` job turns the heavy jobs into "skipped"

**Evidence.**
- Confirmed: Actions runs `run:` under `bash -e`. If `git diff` fails, `changed_files=$(...)` aborts the job. `repro.sh` S11, with an unknown base SHA, prints `fatal: bad object ...`, `exit=128`.
- Read from code: `server` (`ci.yml:16-17`) and `e2e` (`:250-251`) have `needs: [changes]` and an `if:` that does not use `always()`, so a failed `changes` makes them **skipped**. `mp-private-soak` (`:424`) needs `server` and is skipped too.
- Read from GitHub docs: a skipped job reports success for a required status check. The comment at `ci.yml:14-15` and the #523 PR body say the same.

**Impact.** Today the failed `changes` check shows a red X (and E1 means nothing is required anyway). If Server Validation and Playwright E2E are later made required but `Detect Non-Shipping-Only Diff` is not, a PR whose `changes` job fails would show those two as "passing" and could merge untested.

**Fix.** When adding required checks (E1), either require `Detect Non-Shipping-Only Diff` as well, or add one aggregate `ci-gate` job:
- `needs:` every job, `if: always()`;
- fail unless each needed result is `success`, or `skipped` *and* `needs.changes.result == 'success'`;
- require only that job.

---

## E9 (Low): two-dot diff and a stale `base.sha`

**Mechanism (confirmed, `repro3.sh`).** `main` M0 → M1 changes `server/src/x.ts`. The PR is based on M1, edits docs, and reverts M1's change to `x.ts`.
```
two-dot from CURRENT base (M1..head): docs/n.md, server/src/x.ts -> server_required=true
two-dot from STALE base (M0..head):   docs/n.md                  -> server_required=false
merge commit HEAD^1..HEAD:            docs/n.md, server/src/x.ts
```
With an up-to-date `base.sha`, two-dot is safe. It is a superset of what the merge changes, and S7/S8 in `repro.sh` show base-advanced and merged-main cases classified correctly. The risk exists only if `github.event.pull_request.base.sha` ever lags the base tip that the merge ref was built from. I did not prove it does (see Unproven).

**Fix.** Same as E2: diff the merge commit against its first parent, which by construction is the base GitHub merged into.

---

## E10 (Low): process odds and ends (read from code)

- **Lighthouse never fails** (`ci.yml:408-419`): every assertion is `warn`, and the command ends in `|| true`. Fine as information, but do not cite it as a gate.
- **Self-serve thresholds.** `perf-budgets.json`, `bundle-ratchet-baseline.json` (`checkBundleRatchet.mjs --update`) and the `LIMITS` in `check-bundle-size.mjs` are all edited in the same PR that grows them. There is no `.github/CODEOWNERS` (`.github/` holds only `workflows/`), and E1 means no review is required.
- **`check-bundle-size.mjs`** matches chunks with `files.find(f => f.startsWith(name))`, and `if (!match) continue;`. A renamed chunk is silently unchecked, and `index` can match any chunk whose name starts with `index`. The ratchet's per-stem baseline and total largely cover this.
- **The #523 PR body says "a PR only sees the workflow file that is on its base branch".** For `pull_request`, that is not true: the workflow comes from the merge ref, so a PR runs its own edited `ci.yml`. (That rule describes `pull_request_target`.) The consequence: a PR can change or delete the filter or any job for its own run. The edit is visible in the diff, but with E1 nothing forces a review.
- **Supply chain.** Actions are pinned by major tag (`actions/checkout@v5`, `setup-node@v6`, `cache@v4`, `upload-artifact@v4`), and `npx @sentry/cli@2` / `@lhci/cli@0.14` are floating. Low for a single-owner repo. Pin to SHAs if this ever takes outside contributors. Fork PRs need approval from first-time contributors (`approval_policy: first_time_contributors`); there is no `pull_request_target`, and default workflow permissions are `read`. Fine.
- **Operational SQL lives in `docs/`.** Files such as `docs/ops/tournament-launch/prod-preflight.sql` are run by hand against production and by `scripts/tournament-db-verify.sh`, which is not in CI. A docs-only PR can change them with no CI check. No CI checked them before #523 either, so the filter loses nothing here, but "docs-only" does not mean "never executed".

---

## Refuted (the docs-only filter handles these correctly)

All results come from `rule.sh` in a scratch repo unless marked.

| Case | Result | Why |
|---|---|---|
| Pure deletion of `client/src/app.ts` (S2) | runs everything | `--name-only` lists deleted paths |
| Symlink `docs/link.ts -> ../server/src/rateLimit.ts`, mode 120000 (S3) | docs-only | Harmless: the target's content is unchanged. Today there are no symlinks or gitlinks in the repo (`git ls-files -s` shows no 120000/160000), so editing a `docs/` file cannot change code through a link. It would become a risk only if a link from code into `docs/` were added later (guess) |
| Gitlink `docs/sub` (S6) | docs-only | Harmless: `actions/checkout` does not fetch submodules by default |
| Case variants `Docs/a.md`, `README.MD` (repro2 S4b, index written directly because macOS is case-insensitive) | runs everything | `case` matching is case-sensitive |
| Non-ASCII `docs/café.md` (S5) | runs everything | git quotes the path (`"docs/caf\303\251.md"`), which falls to `*/*`. Safe; a non-ASCII docs file simply runs everything |
| Filename with an embedded newline (S10) | runs everything | Quoted by git, so there is no line split |
| `..` in a path | runs everything | `ci.yml:192` |
| Mode-only change on code (S9) | runs everything | |
| Base advanced with code, PR docs-only (S7) | runs everything | Two-dot includes main's change (conservative) |
| Main merged into a docs-only PR (S8) | docs-only | Correct: the merge brings in nothing new relative to `base.sha` |
| `push` to `main`, `schedule` | runs everything | `ci.yml:172-177` |
| Empty diff | runs everything | `ci.yml:229-232` |
| `docs/**` read by server or Playwright | none found | `git grep "docs/"` across `server/`, `client/e2e`, `packages/*/src` (outside devtools) finds runtime readers only in `client/scripts/checkArchitectureInvariants.ts:23` (docs/architecture, excluded) and `client/src/auth/usernamePolicy.test.ts:13` (unit tests still run). Root `*.md` files are read by no code; `AGENTS.md`/`README.md` steer agents and humans only |
| Fork PRs | not a bypass | They run the same `pull_request` workflow without secrets |

## Unproven, needs production or admin access

1. **Do Vercel and Render deploy `main` without waiting for CI?** `smoke-test.yml`'s `sleep 90` after push suggests yes. Confirm in the Vercel project settings (Git / Ignored Build Step, "wait for checks") and the Render service (Auto-Deploy, "after CI checks pass"). If both deploy on push, E1 and E2 are production-impacting, not just merge-impacting.
2. **Does `github.event.pull_request.base.sha` ever lag the base used for the merge ref** (for example on `synchronize` after a base-branch push with no PR push)? Check by comparing the "Changed files (BASE..HEAD)" line in a few `changes` job logs against `git rev-parse origin/main` at the run's timestamp. That decides whether E9 is real.
3. **How GitHub's workflow-level `paths:` filter treats renames** (old path, new path, or both) for `perf-budgets.yml`. That decides whether moving `client/src/x` to `docs/` starts the perf workflow. Needs a throwaway PR.
4. **Sentry source-map upload** (`ci.yml:396-406`): the step's `if:` reads `env.SENTRY_AUTH_TOKEN`, which is set in that same step's `env:`. I believe a step's own `env` is not visible to its `if:`, so the step may never run (guess). Check whether Sentry has releases for recent `main` SHAs.
5. **Whether any other merged PR shipped a real regression behind a red or missing check.** I sampled final check states only. #507's red Bundle ratchet was later absorbed by a baseline update (the `docs/perf-budget.md:39` history row "#507/#510 +4.1 kB"); I did not trace the rest.
