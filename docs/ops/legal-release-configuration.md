# Legal release configuration

Production web (`npm run build --prefix client`) and iOS (`npm run build:ios --prefix client`) builds validate the centralized legal configuration before compiling. Blank, placeholder, invalid email/age/date, or unknown location disclosure values fail the build.

The owner must supply:

- `VITE_LEGAL_LEGAL_ENTITY_NAME`: actual operator/legal name.
- `VITE_LEGAL_SUPPORT_EMAIL`: monitored support/privacy email.
- `VITE_LEGAL_POLICY_EFFECTIVE_DATE`: effective date, preferably YYYY-MM-DD.
- `VITE_LEGAL_MINIMUM_AGE`: actual minimum account age, as a positive integer.
- `VITE_LEGAL_POSTHOG_LOCATION`: `derived` or `discarded`, matching the actual PostHog project setting.

Set these in the release environment or the appropriate Vite mode environment file. Browser and prerendered legal copy use the same values. For iOS, prerendering loads the iOS mode too. Alternatively, resolve the centralized defaults in `client/src/legal/legalConfig.mjs` with actual owner-approved values.

Development keeps explicit unresolved labels. Automated production QA may use valid, clearly identified test values in its process environment; those bundles must never be published. There is no release-guard bypass.
