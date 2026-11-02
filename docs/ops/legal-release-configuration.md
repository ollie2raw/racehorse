# Legal release configuration

Production web (`npm run build --prefix client`) and iOS (`npm run build:ios --prefix client`) builds validate the centralized legal configuration before compiling. Blank, placeholder, invalid email/age/date, or unknown location disclosure values fail the build.

The owner must supply:

- `VITE_LEGAL_LEGAL_ENTITY_NAME`: actual operator/legal name.
- `VITE_LEGAL_SUPPORT_EMAIL`: monitored support/privacy email.
- `VITE_LEGAL_POLICY_EFFECTIVE_DATE`: effective date, preferably YYYY-MM-DD.
- `VITE_LEGAL_MINIMUM_AGE`: actual minimum account age, as a positive integer.
- `VITE_LEGAL_POSTHOG_LOCATION`: `derived` or `discarded`, matching the actual PostHog project setting.

Set these in the release environment or the appropriate Vite mode environment file. Browser and prerendered legal copy use the same values. For iOS, prerendering loads the iOS mode too. Alternatively, resolve the centralized defaults in `client/src/legal/legalConfig.mjs` with actual owner-approved values.

## Guest play and the Privacy Policy

The Privacy Policy describes guest accounts (what is created, where a guest's games go, that guests are not ranked, and that idle guest accounts are deleted after 30 days) **only in a build where `VITE_ENABLE_GUEST_PLAY=true`**. It reads that same flag, in the browser and in the prerendered `/privacy`, so the copy and the feature cannot be switched separately. Turning the flag on therefore changes the policy, so on the same release:

- Set `VITE_LEGAL_POLICY_EFFECTIVE_DATE` to the release date (the policy promises to update it when it changes).
- The 30-day sentence is true only while the server's `GUEST_CLEANUP_MODE` is `delete` (the default) or unset. Do not set it to `report` or `off` with the flag on.
- Decide whether playing as a guest needs a minimum-age statement. The policy's age line says "to create an account"; guests have no age step. That is a legal decision for the owner and is not written for you.
- Captcha: nothing in the copy mentions one. When a provider is chosen, add what it receives (for Turnstile: IP address and browser details) to the policy and to Service providers.

Development keeps explicit unresolved labels. Automated production QA may use valid, clearly identified test values in its process environment; those bundles must never be published. There is no release-guard bypass.
