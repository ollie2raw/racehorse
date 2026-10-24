import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('tsx/cjs');
const { assertAutomatedPersistenceTarget } = require('../../server/src/platform/env/automatedPersistenceGuard.ts');
const { assertNotProductionSupabase } = require('../../server/src/platform/env/productionSupabaseGuard.ts');
const { readEnvFile } = require('../../server/src/envFile.ts');
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function assertPersistenceQaSafety(context, urls = [], suppliedEnv) {
  const env = suppliedEnv ?? {
    ...readEnvFile(path.resolve(clientRoot, '.env')),
    ...readEnvFile(path.resolve(clientRoot, '.env.local')),
    ...readEnvFile(path.resolve(clientRoot, '.env.qa.local')),
    ...readEnvFile(path.resolve(clientRoot, '../server/.env')),
    ...process.env,
  };
  assertAutomatedPersistenceTarget(context, { env, urls });
  return env;
}

/** Also guard the actual browser destinations, not only its startup env. */
export async function guardPersistenceQaBrowser(context, env) {
  const devHosts = new Set([env.SUPABASE_URL, env.VITE_SUPABASE_URL].filter(Boolean).map((value) => new URL(value).hostname));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    try {
      assertNotProductionSupabase('browser persistence QA request', { env: { SUPABASE_URL: url.href }, argv: [] });
      if ((['xhr', 'fetch'].includes(request.resourceType()) || (request.method && !['GET', 'HEAD'].includes(request.method()))) && !devHosts.has(url.hostname)) {
        assertAutomatedPersistenceTarget('browser persistence QA request', { env: {}, urls: [url.href] });
      }
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  // BrowserContext routing does not intercept WebSockets.
  await context.routeWebSocket('**/*', (socket) => {
    try {
      const url = new URL(socket.url());
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      assertAutomatedPersistenceTarget('browser persistence QA socket', { env: {}, urls: [url.href] });
      socket.connectToServer();
    } catch {
      socket.close();
    }
  });
}
