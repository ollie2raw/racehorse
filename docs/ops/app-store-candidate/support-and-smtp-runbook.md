# Support mailbox and auth email (SMTP) runbook

Owner-run. No keys, passwords or SMTP credentials go in this repo; they live
only in the provider dashboards and Supabase.

Recommended support address: **`support@playracehorse.com`** (unconfirmed:
the owner decides; whatever is chosen must match the support page and the App
Store Connect support details). The domain is registered and its DNS hosted
at **Namecheap** (`docs/ops/hosting-cost-plan.md`).

## 1. Support mailbox

Pick one:

- **Forwarding (free):** Namecheap → Domain List → `playracehorse.com` →
  Manage → **Redirect Email** (Email Forwarding) → alias `support` → forward
  to `<owner inbox>`. Namecheap adds its MX records when forwarding is turned
  on (Advanced DNS → Mail Settings = Email Forwarding).
- **Hosted mailbox** (Google Workspace, Fastmail, Zoho, Namecheap Private
  Email): follow the provider's setup; it gives MX records to set under
  Advanced DNS → Mail Settings = Custom MX. Only one MX setup can be active.

**Reply-from:** with forwarding, replies come from the owner's personal
address unless the inbox is set up to "send mail as" `support@…` through an
SMTP service (e.g. the same provider as §2). Decide whether replies may show
the personal address; a hosted mailbox avoids the issue.

Tests (record date and result):

- [ ] Send from an external address (not the owner's) to `support@…` → arrives.
- [ ] Reply → arrives at the external address; check the From shown.
- [ ] Check the message isn't in spam on either side.

## 2. Supabase custom SMTP (auth emails)

Supabase's built-in mailer is for testing only (low hourly limit, may only
reach team addresses). Password reset and email change from the app need a
real sender. Example provider: **Resend** (free tier; `docs/ops/hosting-cost-plan.md`).
Any SMTP provider works the same way.

At the provider:

1. Add the domain `playracehorse.com` (or a subdomain such as
   `mail.playracehorse.com` / `send.playracehorse.com` to keep reputation
   separate). The provider shows the exact DNS records to add: typically an
   **SPF** TXT (or an `include:` added to an existing SPF record: only one SPF
   TXT per name), one or more **DKIM** TXT/CNAME records, and sometimes an MX
   for bounce handling on a subdomain.
2. Add exactly those records at Namecheap → Advanced DNS. Wait for the
   provider to show the domain **verified**.
3. Create an SMTP credential / API key for Supabase only. Keep it in the
   provider and Supabase; never in the repo or a `VITE_*` variable.

In Supabase (production project) → Authentication → **SMTP Settings** → Enable
custom SMTP:

| Field | Value |
|---|---|
| Sender name | `Racehorse` |
| Sender email | an address on the verified domain, e.g. `no-reply@playracehorse.com` (or `support@…` if replies should reach support) |
| Host | from the provider (Resend: `smtp.resend.com`) |
| Port | from the provider (Resend: `465` SSL or `587` STARTTLS) |
| Username | from the provider (Resend: `resend`) |
| Password | the provider SMTP key (entered in Supabase only) |
| Minimum interval between emails | keep the default unless abuse appears |

Then Authentication → **Rate Limits**: raise "emails sent per hour" from the
built-in limit to something sensible for launch (e.g. 100), within the
provider's quota.

**DMARC:** current record is `p=none` (monitoring only). Leave it while the
new sender's SPF/DKIM are confirmed passing; consider moving to
`p=quarantine` later with a `rua=` report address. Don't tighten it before
both the support mailbox and the SMTP sender align.

## 3. Supabase auth URLs

Authentication → **URL Configuration**:

| Setting | Value |
|---|---|
| Site URL | `https://playracehorse.com` |
| Redirect URLs | `https://playracehorse.com/**` and `https://www.playracehorse.com/**` |

Never add `capacitor://localhost` (no mail client can open it; the app sends
reset/change links to the website: `client/src/auth/authRedirect.ts`). Keep
`http://localhost:*` only on the **dev** project.

Email templates (Authentication → Email Templates): check that reset and
email-change templates read as Racehorse and use `{{ .ConfirmationURL }}`.

## 4. Tests after configuring

Use an external mailbox, not a team address.

- [ ] From the iOS app: Forgot password → external address → email arrives
      from `Racehorse <…@playracehorse.com>`, not in spam.
- [ ] Link opens `https://playracehorse.com/…`, new password is accepted.
- [ ] Sign in to the app with the new password.
- [ ] Settings → change email → confirmation arrives at the new address (and
      the old one, if "secure email change" is on) → change completes.
- [ ] Message headers show `spf=pass`, `dkim=pass` (Gmail: Show original).
- [ ] Repeat once from the website.
