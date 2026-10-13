# Coarse Location: keep or drop (owner decision)

**Current state: undecided.** `client/ios/App/App/PrivacyInfo.xcprivacy`
declares `NSPrivacyCollectedDataTypeCoarseLocation` (linked, not tracking,
purpose Analytics), because PostHog derives an approximate location (GeoIP)
from the client IP unless the project discards it. The client sets no IP
option (`client/src/lib/analytics.ts`: `person_profiles: 'always'`,
`autocapture: false`), so the PostHog project setting decides.

The rule that never changes: **the privacy manifest, the App Store Connect App
Privacy answers and the privacy policy must say the same thing, and change
together.** Never drop the declaration to get a smaller label while the data
is still collected.

## Option A: keep GeoIP (no settings change)

1. Keep Coarse Location in `PrivacyInfo.xcprivacy` (no code change).
2. App Privacy: Location → Coarse Location → linked to user, not tracking,
   purpose Analytics.
3. Privacy policy: include a sentence such as "Our analytics provider derives
   an approximate location (city/country) from your IP address; we don't
   collect precise location."
4. Done. Revisit if analytics needs change.

## Option B: discard IP data

1. PostHog → project settings → **Discard client IP data** → on. Note the
   date; events before it still hold GeoIP properties.
2. Check other processors that could derive location from app traffic:
   - **Sentry** (client and server): project Settings → Security & Privacy →
     **Prevent Storing of IP Addresses** → on. (The client SDK doesn't set
     `sendDefaultPii`; the server keeps request headers except
     `Authorization`, and forwarding headers can carry the client IP.)
   - Render / Supabase / Vercel request logs keep IPs for security and rate
     limiting; that is not "collection for location" but the policy should
     still mention operational logs.
3. Verify: send a test event from a signed-in test device; in PostHog, the
   event and person have **no** `$geoip_*` properties and no `$ip`.
4. Then, in **one** change:
   - remove the Coarse Location dict from `PrivacyInfo.xcprivacy` (PR + CI,
     new build),
   - remove Coarse Location from App Privacy in App Store Connect,
   - update the privacy policy sentence.
5. Archive a new build and confirm the Privacy Report no longer lists it.

## Record

| Date | Option | PostHog setting checked by | Sentry setting | Manifest PR | App Privacy updated | Policy updated |
|---|---|---|---|---|---|---|
| | | | | | | |
