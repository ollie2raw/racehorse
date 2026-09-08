/**
 * Dev-server freshness check — see docs/breakpoints.md "Server isolation" and
 * issue #119.
 *
 * A Vite dev server bakes its plugin/config graph at startup and does NOT pick
 * up changes to postcss.config.js / vite.config.ts / tailwind config / installed
 * deps on HMR. A server left running from before such a change silently serves
 * stale output — e.g. unresolved `@media (--phone)` — and every check run
 * against it is a lie (this cost two false-green reachability matrices and one
 * false-red friendsScreen result).
 *
 * This module computes a fingerprint of exactly those restart-requiring inputs.
 * The Vite plugin (configFingerprintPlugin in vite.config.ts) computes it once
 * at startup and serves it at GET /__server_fingerprint; callers recompute it
 * from disk and compare. Mismatch ⇒ the running server predates a config change
 * ⇒ restart it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose contents, if changed, require a dev-server restart to take effect. */
const RESTART_REQUIRING_FILES = [
  'postcss.config.js',
  'vite.config.ts',
  'tailwind.config.js',
];

/**
 * Content hash of the restart-requiring inputs. `package.json` contributes only
 * its dependency maps (a version bump changes the resolved plugin graph; a
 * script or metadata edit does not).
 */
export function computeConfigFingerprint(baseDir = clientDir) {
  const hash = createHash('sha256');
  for (const rel of RESTART_REQUIRING_FILES) {
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(readFileSync(path.join(baseDir, rel)));
    } catch {
      hash.update('<absent>');
    }
    hash.update('\0');
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(baseDir, 'package.json'), 'utf8'));
    hash.update(JSON.stringify({ d: pkg.dependencies ?? {}, dd: pkg.devDependencies ?? {} }));
  } catch {
    hash.update('<no package.json>');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Current checkout identity — reported for context, never used as a pass/fail input. */
export function readCheckoutIdentity(baseDir = clientDir) {
  const git = (args) =>
    execFileSync('git', args, { cwd: baseDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), sha: git(['rev-parse', '--short', 'HEAD']) };
  } catch {
    return { branch: 'unknown', sha: 'unknown' };
  }
}

/** The full payload the Vite plugin serves and the checkers recompute. */
export function localServerMeta(baseDir = clientDir) {
  return { fingerprint: computeConfigFingerprint(baseDir), ...readCheckoutIdentity(baseDir) };
}

/**
 * Fetch the running server's fingerprint and compare to the working tree.
 * Returns { status: 'fresh' | 'stale' | 'unreachable' | 'no-endpoint', ... }.
 */
export async function checkServerFreshness(baseUrl, baseDir = clientDir) {
  const local = localServerMeta(baseDir);
  let server;
  try {
    const res = await fetch(new URL('/__server_fingerprint', baseUrl), { signal: AbortSignal.timeout(4000) });
    if (res.status === 404) return { status: 'no-endpoint', baseUrl, local };
    if (!res.ok) return { status: 'unreachable', baseUrl, local, detail: `HTTP ${res.status}` };
    server = await res.json();
  } catch (err) {
    return { status: 'unreachable', baseUrl, local, detail: err?.message ?? String(err) };
  }
  const fresh = server.fingerprint === local.fingerprint;
  return { status: fresh ? 'fresh' : 'stale', baseUrl, local, server };
}

/** One-line human summary for logs / abort messages. */
export function describeFreshness(result) {
  const { local, server } = result;
  const at = (m) => (m ? `${m.branch} @ ${m.sha}` : '?');
  switch (result.status) {
    case 'fresh':
      return `dev server at ${result.baseUrl} is fresh (${at(server)}, config ${local.fingerprint})`;
    case 'no-endpoint':
      return `dev server at ${result.baseUrl} has no /__server_fingerprint — it predates issue #119's plugin, or isn't a Vite dev server. Restart 'npm run dev'.`;
    case 'unreachable':
      return `no dev server reachable at ${result.baseUrl} (${result.detail}) — nothing to check`;
    case 'stale':
      return [
        `STALE DEV SERVER at ${result.baseUrl}`,
        `  server config fingerprint: ${server.fingerprint}   (${at(server)})`,
        `  working tree fingerprint:  ${local.fingerprint}   (${at(local)})`,
        server.branch !== local.branch || server.sha !== local.sha
          ? `  → the server is running a DIFFERENT checkout (likely a stale worktree squatting the port).`
          : `  → a restart-requiring config file changed since the server started.`,
        `  Fix: kill that server and restart 'npm run dev' from ${local.branch} @ ${local.sha}.`,
      ].join('\n');
    default:
      return `unknown freshness status: ${result.status}`;
  }
}
