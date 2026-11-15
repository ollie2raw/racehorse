// Production build with ONLY the dev-auth gate (auth/e2eDevAuth.ts) forced on, so the Daily Fritz harness can sign in without Supabase.
// A plain DEV build adds debug-ingest code at hand end and would distort the numbers. Used by perfBudgetsTier1.mjs and by hand:
//   VITE_SERVER_URL=http://127.0.0.1:3001 npx vite build -c scripts/perf/vite.perf-daily.config.mjs --outDir dist-perf-daily --emptyOutDir
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile, mergeConfig } from 'vite';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(clientDir, 'vite.config.ts'));
export default mergeConfig(loaded.config, {
  root: clientDir,
  plugins: [{
    name: 'force-e2e-dev-auth',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/auth/e2eDevAuth.ts')) return { code: code.replaceAll('import.meta.env.DEV', 'true').replaceAll('import.meta.env.PROD', 'false'), map: null };
      return null;
    },
  }],
});
