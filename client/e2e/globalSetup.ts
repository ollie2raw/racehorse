import type { FullConfig } from '@playwright/test';
// @ts-expect-error — build script module, not part of the app's TS program.
import { checkServerFreshness, describeFreshness } from '../scripts/serverFreshness.mjs';

/**
 * Freshness gate — issue #119. Before any test runs, confirm the client dev
 * server is serving the current working tree's config and not stale output
 * (a server left running from before a postcss.config.js / vite.config.ts /
 * dependency change silently serves e.g. unresolved `@media (--phone)`).
 *
 * The `mobile-reachability` project already guarantees this with its own
 * `--strictPort` fresh server; this covers the `chromium` / `mobile-390`
 * projects, which reuse whatever is on :5173 locally.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects.find((p) => p.use.baseURL)?.use.baseURL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.REACHABILITY ? 5233 : 5173}`;

  const result = await checkServerFreshness(baseURL);

  if (result.status === 'stale' || result.status === 'no-endpoint') {
    throw new Error(
      `\n\n${describeFreshness(result)}\n\n` +
        `Aborting the whole run — testing against a stale server produces false results.\n`,
    );
  }
  // fresh / unreachable → proceed (Playwright's own webServer wait already
  // covers a genuinely-down server).
  console.log(`[freshness] ${describeFreshness(result)}`);
}
