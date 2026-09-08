#!/usr/bin/env node
/**
 * `npm run check:server-fresh [url]` — asserts the dev server at `url`
 * (default http://localhost:5173) is serving the current working tree's
 * config, not stale code. See issue #119.
 *
 * Exit 0: fresh, or no server reachable (nothing to check).
 * Exit 1: stale server, or a server with no /__server_fingerprint endpoint.
 */
import { checkServerFreshness, describeFreshness } from './serverFreshness.mjs';

const baseUrl = process.argv[2] ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const result = await checkServerFreshness(baseUrl);
const line = describeFreshness(result);

if (result.status === 'fresh' || result.status === 'unreachable') {
  console.log(`✓ ${line}`);
  process.exit(0);
}

console.error(`\n✗ ${line}\n`);
process.exit(1);
