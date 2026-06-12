# Daily Fritz Browser Resume QA Report

Run at: 2026-06-04T04:48:46.624Z  
Client: http://127.0.0.1:4173 (preview build)  
Server: http://127.0.0.1:3001 (`ENABLE_QA_DAILY_FRITZ_RESET=1`)  
Auth: magic-link service-key bootstrap (`QA_TOURNAMENT_USER_ID`)  
Harness: `npm run qa:daily-fritz:resume --prefix client`

## Executive Summary

- **QA day-lock blocker resolved** via flag-gated reset (`ENABLE_QA_DAILY_FRITZ_RESET` + `POST /api/daily-fritz/qa-reset` / `npm run qa:daily-fritz:reset --prefix server`).
- Original score-reset bug fixed in browser: **yes** (DF-03 scored-hand resume preserved 1-0)
- Unsafe resume guard works: **yes** (DF-GUARD)
- Recovery/restart copy on blocked resume: **yes** (DF-COPY)
- Hub date consistency: **yes** (DF-DATE)
- `npm run test:daily-fritz --prefix client`: **passed**
- `npm run build --prefix client`: **passed**

### QA reset mechanism

| Control | Purpose |
| --- | --- |
| `ENABLE_QA_DAILY_FRITZ_RESET=1` | Server + harness gate; **required** for reset (local/staging only; blocked in production) |
| `QA_DAILY_FRITZ_USER_ID` | Optional dedicated QA user; falls back to `QA_TOURNAMENT_USER_ID` |
| `POST /api/daily-fritz/qa-reset` | Authenticated QA user deletes today's attempt row (preflight in harness) |
| `npm run qa:daily-fritz:reset --prefix server` | CLI reset before manual QA (same logic as API) |

Preflight **no longer calls `/abandon`** (that locked the Pacific day). With the flag off, harness only clears local storage.

**CLI preflight (2026-06-03):** deleted abandoned attempt for QA user (`previousStatus=abandoned`).

## Scenario Results

| Scenario | Status | Notes | Screenshots |
| --- | --- | --- | --- |
| DF-03 | **Passed** | Scored-hand resume preserved 1-0 after reload/resume. | `docs/qa-artifacts/daily-fritz-resume/df-03-before-reload.png`, `df-03-after-resume.png` |
| DF-04 | Blocked | Draw-state persistence needs extended gameplay seed; not in this pass. | — |
| DF-05 | Blocked | Fritz-turn reload not reached (DF-GUARD consumed in-progress state first). | — |
| DF-06 | Blocked | Hand-end modal timing; not in this pass. | — |
| DF-07 | Blocked | Game-end modal timing; not in this pass. | — |
| DF-08 | Blocked | Complete Game 1 win + resume Game 2; not in this pass. | — |
| DF-09 | Blocked | Complete Game 1 loss + resume Game 2; not in this pass. | — |
| DF-GUARD | **Passed** | Deleted snapshot while attempt started; hub shows recovery-required copy instead of fake 0-0 resume. | `docs/qa-artifacts/daily-fritz-resume/df-guard-blocked-resume.png` |
| DF-COPY | **Passed** | Recovery/restart copy present on blocked resume path. | `docs/qa-artifacts/daily-fritz-resume/df-copy-recovery-copy.png` |
| DF-DATE | **Passed** | Hub date "June 3, 2026"; no cross-day mix. | `docs/qa-artifacts/daily-fritz-resume/df-date-hub-date.png` |

## Additional Checks

- **Score-reset bug (DF-03):** yes — browser confirmed scored-hand resume at 1-0.
- **Unsafe resume guard (DF-GUARD):** yes — browser confirmed blocked resume after snapshot delete.
- **Abandoned-day hub copy:** Dedicated abandoned state UX — hub detects `attempt_status: abandoned` or `/start` 409 `{ status: "abandoned" }`, shows explicit copy (not generic "Please try again."), disabled **Come Back Tomorrow** CTA, and dev/QA reset hint. See `dailyFritzErrors.ts` + `DailyFritzScreen.tsx` (2026-06-03 patch).

## Unit / Build Validation

| Command | Result |
| --- | --- |
| `npm run test:daily-fritz --prefix client` | Passed |
| `npm run build --prefix client` | Passed |
| `npm test --prefix server -- dailyFritz/qaReset` | Passed (6 tests) |

## Remaining Issues

### P1 (automation coverage)

1. **DF-04–DF-09** — still need extended deterministic gameplay or server-side in-progress seed fixtures before unattended browser coverage.
2. **Stale auth storage** — if `client/.auth/daily-fritz-qa.json` expires, delete it and re-run (magic-link bootstrap recreates session).

## User Actions Needed

1. **Server:** set `ENABLE_QA_DAILY_FRITZ_RESET=1` in `server/.env` (or export when starting server) and restart after deploy.
2. **Harness rerun:** `ENABLE_QA_DAILY_FRITZ_RESET=1 DAILY_FRITZ_QA_APP_URL=http://127.0.0.1:4173 npm run qa:daily-fritz:resume --prefix client`
3. **Optional CLI reset:** `ENABLE_QA_DAILY_FRITZ_RESET=1 npm run qa:daily-fritz:reset --prefix server`
4. **Optional dedicated user:** `QA_DAILY_FRITZ_USER_ID=<uuid>` in `server/.env` to isolate from tournament QA account.

## Abandoned Attempt UX Patch (2026-06-03)

When today's attempt is **abandoned** (hub `attempt_status: abandoned` or `POST /api/daily-fritz/start` → 409 with `status: abandoned`):

| Surface | Behavior |
| --- | --- |
| Primary copy | "Today's set was already abandoned on this account." |
| Secondary copy | "Come back tomorrow for a fresh Daily Fritz set." |
| Dev/QA hint | "QA: use a fresh QA user or reset today's daily_fritz_attempts row." (`DEV` / `VITE_DEBUG_DAILY_FRITZ`) |
| Primary CTA | **Come Back Tomorrow** (disabled — does not imply resume/play today) |
| Error loop | Stable — abandoned path clears generic hub error and does not offer Retry/start |

**Browser resume QA blocked by locked QA user?** Only if the QA account remains abandoned **and** `ENABLE_QA_DAILY_FRITZ_RESET=1` reset is not run. With qa-reset preflight (documented above), resume scenarios **DF-03 / DF-GUARD passed** in the latest run.

## Files Added / Changed (this pass)

- `server/src/dailyFritz/qaReset.ts` — flag-gated QA reset core
- `server/src/dailyFritz/qaReset.test.ts` — unit tests
- `server/src/scripts/resetDailyFritzQa.ts` — CLI entry
- `server/src/index.ts` — `POST /api/daily-fritz/qa-reset`
- `server/package.json` — `qa:daily-fritz:reset` script
- `client/scripts/dailyFritzBrowserResumeQa.mjs` — preflight calls qa-reset (no abandon)
- `client/src/dailyFritz/dailyFritzErrors.ts` — abandoned copy, `DailyFritzApiError`, init error helpers
- `client/src/dailyFritz/dailyFritzErrors.behaviorTests.ts` — abandoned error/copy unit tests
- `client/src/dailyFritz/api.ts` — preserve 409 `status` on `DailyFritzApiError`
- `client/src/dailyFritz/DailyFritzScreen.tsx` — abandoned hub state, notice UI, disabled CTA
- `client/src/dailyFritz/dailyFritz.css` — `.df-hub-notice` styles
- `client/package.json` — `test:daily-fritz` runs error behavior tests
- `docs/daily-fritz-browser-resume-qa-report.md` — this report
- `docs/daily-loop-trust-ux-audit.md` — resume QA status cross-link

## Related Docs

- [Daily Loop Trust UX Audit](./daily-loop-trust-ux-audit.md)
