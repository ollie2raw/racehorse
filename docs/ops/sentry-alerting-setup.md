# Sentry alerting — configuration record (H5)

PRE_LAUNCH_HARDENING.md §4 item 5. **Config, not code.** As of **2026-09-09 this
is fully configured and verified in the dashboard** — the sections below are the
as-built record plus the steps to reproduce/audit it.

Context: the code side (H1–H4 / PRs #149–152) is done — client + server
`beforeSend` volume guard, per-user aggregation on the MP move-log + tournament
alerts, T-15 tournament invariant alerts, and a bounded `/ready` probe. This
document is what makes those actually reach a human.

---

## Current state (verified 2026-09-09)

| Thing | Value |
|---|---|
| Sentry project | **one shared `node-express` project** — client (`@sentry/react`) and server (`@sentry/node`) send to the **same DSN**. There is no separate frontend project. |
| `SENTRY_DSN` on Render | **set** (confirmed: identical to the client `VITE_SENTRY_DSN` in the prod bundle → server-side capture is live). |
| Baseline alert rule | **live** — trigger: issue is **new or regresses**; filter: **level ≥ `error`**; action: **email the `#racehorse` team**; **30-minute** per-issue throttle. |
| Tag-scoped rules | **3 live**, each routed **individually to the maintainer** (not the team alias): `mp_alert:move_log_verification_failed_repeat`, `tournament_alert:match_winner_conflict`, `tournament_alert:invariant_violation`. |
| Spike protection | **ON**. |
| Plan / quota | **Developer (free)** — **5,000 errors/mo**; **23 used** this cycle at check time; **no payment method on file** (quota is a hard drop-ceiling, zero spend risk). |

The tags come from the code: PR #150 sets `mp_alert` / `tournament_alert`
(`match_winner_conflict`); PR #151 sets `tournament_alert: invariant_violation`
(with `tournament_invariant` naming the specific violation).

---

## How it was set up / how to audit it

### 0. Server DSN (the one that silently breaks everything)

The **server** only initialises Sentry when `SENTRY_DSN` is present *and*
`NODE_ENV=production` (`server/src/index.ts`). To confirm it is set: Render →
the **racehorse** web service → **Environment** → `SENTRY_DSN` present, and its
value matches the client DSN host (`o4511656845312000.ingest.us.sentry.io`).
Both SDKs point at the same project — that is intentional; do **not** split them.

### 1. Baseline issue-alert rule

Sentry → **Alerts → Rules**. The rule:

- **When:** "A new issue is created" **OR** "the issue changes state from resolved to unresolved"
- **If:** "The event's level is equal to `error`" (so `warning`-level first-offence
  aggregation notes don't page — only the escalated `error` / `_repeat` versions do)
- **Then:** "Send a notification to the `#racehorse` team" (email)
- **Action interval:** 30 min

### 2. Tag-scoped rules (the abuse / corruption signals)

Three separate rules, one per tag, each **Then → notify the maintainer directly**:

| Rule filter | Meaning |
|---|---|
| tag `mp_alert` equals `move_log_verification_failed_repeat` | same user failed move-log verification ≥3× in 7 days |
| tag `tournament_alert` equals `match_winner_conflict` | two producers disagreed on a completed match |
| tag `tournament_alert` equals `invariant_violation` | bracket invariant (T-INV-2/5/6) violated — player stranded |

### 3. Spike protection + plan

- **Settings → Projects →** the project **→ Spike Protection** → **Enabled**.
- **Settings → Subscription** — Developer (free), 5k errors/mo. No on-demand
  budget / payment method, so overage events are dropped, never billed. The
  code-side `beforeSend` volume guard (H1) is what keeps an error loop from
  reaching the ceiling in the first place.

### 4. Sanity check

Trigger one event (a safe throwaway `Sentry.captureMessage('wiring test')` or a
known-safe throwing route) and confirm it lands in **Issues** and the baseline
rule emails the team. The volume guard only drops after 20 events in a rolling
minute, so a single test event always gets through.
