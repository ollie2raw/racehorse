# Sentry alerting — dashboard setup (H5)

PRE_LAUNCH_HARDENING.md §4 item 5. This is **config, not code** — it must be done
in the Sentry and Render dashboards. Everything below is a one-time setup;
budget ~5 minutes.

Context: the code side (H1–H4) is done — client + server `beforeSend` volume
guard, per-user aggregation on the MP move-log + tournament alerts, tournament
invariant (T-15) alerts, and a bounded `/ready` probe. None of it does anything
in production unless the steps below are true.

---

## 0. Prerequisite — confirm the server DSN is actually set (CRITICAL)

The **client** DSN is confirmed live (it is in the deployed bundle:
`o4511656845312000.ingest.us.sentry.io`). The **server** only initialises Sentry
when `SENTRY_DSN` is present *and* `NODE_ENV=production` (`server/src/index.ts`).
`SENTRY_DSN` is **not** in `/ready`'s env map, so it may be unset — in which case
every server-side alert (MP move-log verification, tournament winner-conflict,
tournament invariant violations, Supabase circuit-breaker) is silently disabled.

1. Sentry → **Settings → Projects →** (the server project) **→ Client Keys (DSN)** — copy the DSN.
   - If there is only one project and it is the React one, create a second
     project: **Projects → Create Project → Platform: Node.js**, name it
     `racehorse-server`. Use its DSN below.
2. Render → dashboard → the **racehorse** web service → **Environment** →
   **Add Environment Variable**:
   - Key: `SENTRY_DSN`
   - Value: the server project DSN from step 1
3. **Save, Manual Deploy → Deploy latest commit** (env changes need a redeploy).
4. Verify: after deploy, Sentry → the server project → **Issues**. Within a few
   minutes of normal traffic you should see the project marked as having
   received its first event (or trigger one — see step 4 below).

---

## 1. Issue-alert rule → a real channel

Sentry → **Alerts → Create Alert → Issues** (one rule per project, or a single
rule if both projects share an org-wide notification).

- **When:** "A new issue is created" **OR** "The issue changes state from resolved to unresolved"
- **If (optional but recommended):** add a second condition —
  "The issue's level is equal to `error` or higher" — so `warning`-level
  aggregation notes (first offence of an abuser, etc.) don't page, but the
  escalated `_repeat` / `error` versions do.
- **Then:** "Send a notification to [Slack / email / PagerDuty]".
  - Slack: **Settings → Integrations → Slack → Add Workspace**, then pick the
    channel here. A dedicated `#racehorse-alerts` is ideal.
  - No Slack: set the action to **Send an email** to your address — still real-time.
- **Action interval:** 30 min (dedupes a storm to one message per issue per 30 min).
- Name it `prod new issue → #racehorse-alerts` and **Save Rule**.

Repeat for the second project, or use an **org-level** rule that covers all
projects if the plan allows.

### Recommended tag-scoped rules (optional, 1 min each)

The code sets these tags — a rule filtered on any of them goes straight to a
"someone is abusing us / the bracket is corrupt" channel:

| Tag | Meaning |
|---|---|
| `mp_alert:move_log_verification_failed_repeat` | same user failed move-log verification ≥3× in 7 days |
| `tournament_alert:match_winner_conflict` | two producers disagreed on a completed match |
| `tournament_alert:invariant_violation` | bracket invariant (T-INV-2/5/6) violated — player stranded |

---

## 2. Spike protection — ON

Sentry → **Settings → Projects →** (each project) **→ Spike Protection** →
toggle **Enabled**.

- This is separate from the code-side `beforeSend` volume guard (which caps
  ~20 events/min/instance before they leave the process). Spike protection is
  Sentry's server-side backstop against a bill/quota blowout.
- Also check **Settings → Subscription → Usage & Billing** — the free plan is
  **5,000 errors/month**. Set an **On-Demand / spend cap** of `$0` if you do not
  want to pay for overages (events past quota are dropped, not billed).

---

## 3. Confirm `beforeSend` is not silently dropping everything

After the server redeploy, in Sentry → server project → **Issues**, trigger a
test error (e.g. hit a route that throws in a safe way, or temporarily add and
remove a `Sentry.captureMessage('sentry wiring test')` call). Confirm it lands.
The volume guard only drops *after* 20 events in a rolling minute, so a single
test event always gets through.

---

## 4. One-line checklist

- [ ] `SENTRY_DSN` set on the Render service + redeployed
- [ ] Server project exists and has received an event
- [ ] Issue-alert rule → Slack/email, action interval 30 min
- [ ] (optional) tag-scoped rules for `*_repeat` / `winner_conflict` / `invariant_violation`
- [ ] Spike protection enabled on both projects
- [ ] On-demand spend cap set (or accepted) for the 5k/mo free quota
