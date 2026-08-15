// This file is imported by vite.config.ts to configure Sentry source map uploads
// during production builds. Keep this separate from main.tsx so the build tool
// plugin can reference the same DSN/org/project config without importing runtime code.
export const sentryConfig = {
  org: process.env.SENTRY_ORG ?? '',
  project: process.env.SENTRY_PROJECT ?? '',
  authToken: process.env.SENTRY_AUTH_TOKEN ?? '',
};
