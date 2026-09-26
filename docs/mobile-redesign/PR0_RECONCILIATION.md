# PR 0 current-main reconciliation

## Provenance

- Fetched `origin/main`: `105ebf71cb3a204578c705f8b40209079a1473f1`.
- Original recovery base: `124248b9597cf05ecd075681c0ffbddb90b36434`.
- Merge base of original PR 0 commit `86bdf9b1` and `origin/main`: `785357e4e81a5af9cc416d846a8aac06963fdc7c`.
- `25` commits are on current `origin/main` after the recovery base. The recovery branch also has three recovery-only commits after the merge base. The original PR 0 branch is therefore not a suitable merge base.
- Clean worktree: `/private/tmp/racehorse-mobile-pr0-main-20260925`, branch `codex/mobile-pr0-main`.
- `86bdf9b1` cherry-picked as `2af2f3dc` with no textual conflict. None of the PR 0 production seam/config files changed on main between `124248b9` and `105ebf71`. No recovery-only behavior appears in the resulting diff.

### Current-main commits absent from the recovery base

```text
105ebf71 fix(ui): remove recent reviews from Fritz setup (#303)
3104e14e chore(db): track review completion RPC grants (#302)
79f4f1bd feat(review): durable completion + progressive Game Review release gate (#301)
c038d31f fix(review): production integrity + accuracy-model v5 action-forced (#300)
ad01f992 feat(review): enable positional coaching for admin cohort (#299)
1048df18 feat(review): polish coaching explanations (#298)
470bb225 docs(review): Phase F engineering closeout and launch gate audit (#297)
df5f16cd devtools(review): report F4 latency results (#296)
bedf444b perf(review): enforce oracle wall-clock ceiling (#295)
625ec62b perf(review): parallelize review batch deterministically (#294)
339a2836 devtools(review): validate convergence coverage gate (#293)
996e8f4c feat(review): reopen persisted historical Game Review (#292)
da17515e fix(review): apply F1c disagreement policy (#291)
d42b86f3 devtools(review): adjudicate oracle/Fritz disagreements (#290)
1283abb2 fix(review): stabilize coaching facts within a review (#289)
c7aa520a docs(review): complete F1e parity audit (#288)
933712be feat(review): explain true displayed-reference ties (#287)
9afb7a16 fix(review): separate displayed-reference value deltas (#286)
aa035a82 docs(review): measure explanation coverage jitter (#285)
381bddb2 feat(review): add value-gap prose fallback (#284)
d3a69cb0 devtools: report unresolved review value gaps (#283)
0ba7d506 devtools: add review explanation coverage study (#282)
74859791 F2: gate positional review explanations (#281)
2e1d9744 devtools: replayable Phase F oracle validation campaign (#280)
29760079 docs(review): publish Phase F plan and execution amendments (#279)
```

## Published frozen evidence

The specification commit tracks the 16 planning Markdown files that were previously local-only, this reconciliation report, and the updated PR 0 foundation note. It also tracks eight canonical 844×390 current-state baseline screenshots from `baseline/`, four derived asset crop/conformance sheets from `reference-specs/`, and seven approved original PNG mockups in `references/`. All seven copied source PNG SHA-256 hashes match their untouched root originals. `references/README.md` maps every screen to its original file; Finder screenshot `image(5).png` is excluded. No `/private/tmp` image or diagnostic artifact is committed.

The baseline images are forensic BEFORE evidence, not approved new golden screenshots. The asset crop sheets are the specific derived artifacts cited by `ASSET_SELECTION_MANIFEST.md` and `REFERENCE_CONFORMANCE_SPECS.md`.

## Current-main validation

`npm ci`, then workspace builds for game-core and review-engine, preceded client validation. The first pre-game-draw attempt stopped before assertions because a fresh worktree lacks generated workspace `dist` files; after those prerequisite builds, all four behavior files passed. The first exact full Vitest run, concurrent with production build, had two timeouts in untouched devtools tests; both files passed 23/23 in isolation, then the exact full command passed 305 files and 2,322 tests without competing build load.

| Gate | Result |
|---|---|
| Client typecheck | PASS |
| Client lint | PASS, 0 errors / 50 current-main warnings |
| Architecture check | PASS, 22/22 |
| Client production build | PASS, 4,895 transformed modules / 17 prerendered routes |
| Size check | PASS, AppRoutes 94 KB / BotMatchScreen 253 KB / index 481 KB |
| Full client Vitest | PASS, 305 files / 2,322 tests on exact isolated rerun |
| Pre-game draw | PASS, four behavior files |
| New fixture E2E | PASS, 6/6 on isolated port 5244 |
| Existing mobile hub E2E | PASS, 10/10 on fresh isolated port 5233 |
| Existing mobile route/game E2E | PASS, 9/9 on fresh isolated port 5233 |

The first legacy hub E2E invocation at default port 5173 reused a recovery-worktree server and was excluded from evidence. Both final legacy E2E invocations used `REACHABILITY=1` to force a fresh 5233 server; Playwright's fingerprint identified `codex/mobile-pr0-main @ 2af2f3dc`.

## Scope and production boundary

The diff from `origin/main` contains only four classes: fixture/test infrastructure, guarded test-only production data seam, optional Home derivative assets/tooling, and frozen planning/reference documentation. No page component, shell, CSS, breakpoint, navigation, gameplay logic, or production preload policy changed. The generated Home derivatives are unreferenced by production; the two rejected heavy Home alternates are not newly imported or preloaded. The emitted production JS has no `racehorse_mobile_visual_identity_v1` or `e2e-mobile-user` marker, in addition to the unit test that rejects a fully seeded identity when `PROD` is true. Existing E2E screenshot outputs regenerated during validation were restored or removed. The original dirty worktree and its PROGRESS-F, Journey and Supabase changes were untouched.
