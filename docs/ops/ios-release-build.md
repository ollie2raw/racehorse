# iOS release build

How to produce an App Store / TestFlight build of the Capacitor app without
shipping dev configuration.

## Why there is a separate command

Vite bakes every `VITE_*` value into the app at build time. On a developer
machine, `client/.env` points at the **dev** Supabase project and a
**localhost** game server (`docs/ops/dev-supabase-project.md`), so a plain
`npm run build && npx cap sync ios` produces an app that talks to dev data and
to a server that doesn't exist on the phone. `npm run build:ios` builds in a
dedicated `ios` mode and refuses to continue unless the configuration is
production.

## One-time setup (owner)

1. `cp client/.env.ios.example client/.env.ios` (gitignored; never commit it).
2. Fill in the production **public** values:

   | Variable | Value |
   |---|---|
   | `VITE_SERVER_URL` | `https://racehorse.onrender.com` |
   | `VITE_SUPABASE_URL` | Production project URL (Supabase → Settings → API) |
   | `VITE_SUPABASE_ANON_KEY` | The **anon / public** key. Never `service_role` |
   | `VITE_POSTHOG_KEY` | Production PostHog project API key (`phc_…`) |
   | `VITE_SENTRY_DSN` | Production client DSN |
   | `VITE_ENABLE_TOURNAMENTS` | `false` until the tournament launch gate passes on the web |

   These are the same public values the website ships. The service-role key,
   `ADMIN_SECRET` and any other secret must never appear in a `VITE_*`
   variable: everything in this file is readable by anyone who unpacks the app.

3. In Xcode, open `client/ios/App/App.xcodeproj` → target **App** → Signing &
   Capabilities → choose your Apple Developer team (needs Apple Developer
   Program membership).

## Build

```sh
cd client
npm run build:ios
```

Steps, in order (any failure stops the build before anything is copied into
the iOS project):

1. `scripts/iosReleaseGuard.mjs env` resolves exactly what Vite will bake for
   `--mode ios` (`.env`, `.env.local`, `.env.ios`, `.env.ios.local`) and
   refuses if:
   - `VITE_SERVER_URL` isn't exactly `https://racehorse.onrender.com`;
   - the Supabase URL or anon key isn't the production project, or the key
     isn't an `anon` key;
   - any `VITE_*` value points at the dev Supabase project or a
     localhost/127.0.0.1 address;
   - any `VITE_*` value is a service-role key, or a variable name looks like a
     secret (`SERVICE`, `SECRET`, `PRIVATE`, `PASSWORD`);
   - PostHog key or Sentry DSN is missing;
   - `VITE_ENABLE_TOURNAMENTS` isn't explicitly `true` or `false`;
   - an e2e/debug switch is on.
2. `tsc -b`, then `vite build --mode ios` (Sentry release `ios-<git sha>`
   unless `VITE_APP_VERSION` is set), then the usual prerender step, then
   source maps are deleted from `dist/` (they would only add size to the app).
3. `scripts/iosReleaseGuard.mjs bundle` scans `dist/` and refuses if it finds
   the dev project ref, a localhost URL, or any service-role key, or if the
   production server/Supabase origins are missing.
4. `cap sync ios` copies `dist/` into the iOS project.

Then in Xcode: bump **Build** (Target → General), select **Any iOS Device
(arm64)**, Product → **Archive** → Organizer → **Generate Privacy Report** →
**Validate App** → **Distribute App**.

## What the iOS project declares

| Setting | Value |
|---|---|
| Bundle ID | `com.racehorse.dominoes` |
| Devices | **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`), landscape only |
| Minimum iOS | 15.0 |
| Privacy manifest | `App/PrivacyInfo.xcprivacy` in the App target's Resources |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO`: the app only uses the encryption built into iOS (HTTPS/TLS) and a SHA-256 hash; no custom cryptography |

### Privacy manifest contents

- `NSPrivacyTracking = false`, no tracking domains.
- Required-reason API: `NSPrivacyAccessedAPICategoryUserDefaults`, reason
  `CA92.1`. `@capacitor/preferences` stores the signed-in session in the app's
  own UserDefaults. Capacitor 8.5.2 itself ships a manifest with no
  required-reason APIs; there are no other native SDKs.
- Collected data (all linked to the account, none used for tracking):
  email address and user ID (app functionality; user ID also analytics),
  gameplay content (app functionality), product interaction (analytics),
  coarse location (analytics; PostHog derives it from the IP address unless
  "discard client IP data" is on in the PostHog project), crash data,
  performance data and other diagnostic data (app functionality; Sentry).

The App Store Connect "App Privacy" answers must match this list.

**Owner decision before the final App Store archive: coarse location.**

1. Open the PostHog project settings and check whether client IP data is
   discarded (and so no GeoIP location is derived).
2. If IP/GeoIP processing is still on, **keep** Coarse Location in the
   manifest and declare it in App Privacy (Analytics, linked, not tracking).
3. Only if IP discard is on **and** no other processor derives location from
   the app's traffic (check Sentry's IP setting too), re-evaluate: remove Coarse
   Location from both the manifest and the App Privacy answers together.

Never under-declare to make the privacy label smaller; the manifest and the
App Privacy answers must always say the same thing.

## Native-only presentation

`client/src/config/nativeAppSurface.ts`: the app doesn't show coming-soon
features. With tournaments off it has no Tournament tab (the website shows
"Soon"), and non-admins don't see the locked Journey card. Turning tournaments
on (`VITE_ENABLE_TOURNAMENTS=true` in `.env.ios`) brings the tab back in the
next build.

## Auth email links

Password-reset and email-change links from the app point at
`https://playracehorse.com`, never `capacitor://localhost`. The reset
completes on the website; the player then signs in to the app with the new
password. Owner settings still required in Supabase (not in code): custom SMTP
sender, Site URL `https://playracehorse.com`, and that origin in the Redirect
URLs list.
