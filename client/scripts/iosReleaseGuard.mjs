#!/usr/bin/env node
/**
 * Production iOS build guard.
 *
 * Vite bakes every VITE_* value into the bundle at build time, and a plain
 * `npm run build` on a developer machine reads the local `.env` — which points
 * at the dev Supabase project and a localhost game server by design
 * (docs/ops/dev-supabase-project.md). An App Store build made that way talks to
 * dev data and a server that doesn't exist on the phone.
 *
 * `npm run build:ios` runs this twice:
 *
 *   node scripts/iosReleaseGuard.mjs env      before building: resolves exactly
 *       what `vite build --mode ios` will bake (Vite's own loadEnv: .env, .env.local,
 *       .env.ios, .env.ios.local) and refuses anything that isn't production.
 *   node scripts/iosReleaseGuard.mjs bundle   after building, before `cap sync`:
 *       scans dist/ for dev/localhost origins and for any service-role key.
 *
 * Only public values belong in the bundle: Supabase URL + anon key, the game
 * server URL, the PostHog project key and the Sentry DSN. The service-role key
 * must never be in a VITE_* variable.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_SERVER_URL = 'https://racehorse.onrender.com';
export const PRODUCTION_SUPABASE_REF = 'fisfadjqllojdzibcdfx';
export const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
export const DEV_SUPABASE_REF = 'nwodvcmlmailtgjblphu';

const LOCAL_ORIGIN = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i;
/** Dev/test switches that must never be on in a store build. */
const FORBIDDEN_FLAGS = [
  'VITE_E2E_ADMIN_BYPASS',
  'VITE_E2E_ANALYTICS_CAPTURE',
  'VITE_DEBUG_DAILY_FRITZ',
  'VITE_DEBUG_HAND_LIFECYCLE',
  'VITE_DEBUG_BOT_MATCH',
  'VITE_FAIRNESS_LOG',
  // Spectator UI is preview-only and not wired (docs/server-feature-flags.md);
  // the website doesn't set it, and .env/.env.local are read for --mode ios too.
  'VITE_ENABLE_SPECTATOR_MODE',
];

/** Decodes a JWT payload without verifying it. Null if it isn't a JWT. */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Validates the resolved VITE_* environment for an iOS store build.
 * Returns a list of problems; empty means the configuration is acceptable.
 */
export function validateIosReleaseEnv(env) {
  const problems = [];
  const get = (key) => (typeof env[key] === 'string' ? env[key].trim() : '');

  const serverUrl = get('VITE_SERVER_URL').replace(/\/$/, '');
  if (serverUrl !== PRODUCTION_SERVER_URL) {
    problems.push(`VITE_SERVER_URL must be ${PRODUCTION_SERVER_URL} (got ${serverUrl || 'nothing'}).`);
  }

  const supabaseUrl = get('VITE_SUPABASE_URL').replace(/\/$/, '');
  if (supabaseUrl !== PRODUCTION_SUPABASE_URL) {
    problems.push(`VITE_SUPABASE_URL must be the production project ${PRODUCTION_SUPABASE_URL} (got ${supabaseUrl || 'nothing'}).`);
  }

  const anonKey = get('VITE_SUPABASE_ANON_KEY');
  const anon = decodeJwtPayload(anonKey);
  if (!anon) {
    problems.push('VITE_SUPABASE_ANON_KEY is missing or not a Supabase key.');
  } else {
    if (anon.role !== 'anon') problems.push(`VITE_SUPABASE_ANON_KEY must be the anon key (role "${anon.role}" found). Never put the service-role key in the app.`);
    if (anon.ref !== PRODUCTION_SUPABASE_REF) problems.push(`VITE_SUPABASE_ANON_KEY belongs to project "${anon.ref}", not production.`);
  }

  if (!/^phc_[A-Za-z0-9]{10,}$/.test(get('VITE_POSTHOG_KEY'))) {
    problems.push('VITE_POSTHOG_KEY must be the production PostHog project key (phc_…).');
  }
  const posthogHost = get('VITE_POSTHOG_HOST');
  if (posthogHost && !/^https:\/\/[a-z0-9.-]+$/i.test(posthogHost.replace(/\/$/, ''))) {
    problems.push(`VITE_POSTHOG_HOST must be a full https URL or left unset (got ${posthogHost}).`);
  }
  if (!/^https:\/\/[^@\s]+@[^\s]+\.ingest\.[a-z.]*sentry\.io\/\d+$/.test(get('VITE_SENTRY_DSN'))) {
    problems.push('VITE_SENTRY_DSN must be the production Sentry DSN (https://…@….ingest…sentry.io/…).');
  }

  const tournaments = get('VITE_ENABLE_TOURNAMENTS');
  if (tournaments !== 'true' && tournaments !== 'false') {
    problems.push('VITE_ENABLE_TOURNAMENTS must be set explicitly to "false" or "true" for a store build (see docs/ops/ios-release-build.md).');
  }

  for (const flag of FORBIDDEN_FLAGS) {
    const value = get(flag);
    if (value && value !== '0' && value !== 'false') problems.push(`${flag} must not be set in a store build.`);
  }

  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('VITE_')) continue;
    const value = typeof raw === 'string' ? raw : '';
    if (/SERVICE|SECRET|PRIVATE|PASSWORD/i.test(key)) problems.push(`${key}: secrets must never be VITE_* variables (they ship inside the app).`);
    if (value.includes(DEV_SUPABASE_REF)) problems.push(`${key} points at the dev Supabase project.`);
    if (LOCAL_ORIGIN.test(value)) problems.push(`${key} points at a local address (${value}).`);
    const payload = decodeJwtPayload(value);
    if (payload?.role === 'service_role') problems.push(`${key} holds a service-role key.`);
  }

  return [...new Set(problems)];
}

const JWT_IN_TEXT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/**
 * Local URLs that third-party libraries ship as inert constants, never as a
 * request target in this app: react-router's URL-parsing base, and
 * supabase-js's default GoTrue URL (replaced by the configured project URL).
 * The env step already guarantees no VITE_* value is local.
 */
const INERT_LIBRARY_LOCAL_URLS = new Set(['http://localhost', 'http://localhost:9999']);
const LOCAL_URL_IN_TEXT = /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/gi;

/** Scans built text files. Returns problems; empty means the bundle is clean. */
export function scanBundleText(files) {
  const problems = [];
  let sawProductionServer = false;
  let sawProductionSupabase = false;
  for (const { name, text } of files) {
    if (text.includes(PRODUCTION_SERVER_URL)) sawProductionServer = true;
    if (text.includes(PRODUCTION_SUPABASE_REF)) sawProductionSupabase = true;
    if (text.includes(DEV_SUPABASE_REF)) problems.push(`${name}: contains the dev Supabase project ref.`);
    for (const match of text.matchAll(LOCAL_URL_IN_TEXT)) {
      if (!INERT_LIBRARY_LOCAL_URLS.has(match[0])) problems.push(`${name}: contains a local URL (${match[0]}).`);
    }
    for (const match of text.matchAll(JWT_IN_TEXT)) {
      const payload = decodeJwtPayload(match[0]);
      if (payload?.role === 'service_role') problems.push(`${name}: contains a service-role key.`);
      else if (payload?.role === 'anon' && payload.ref && payload.ref !== PRODUCTION_SUPABASE_REF) {
        problems.push(`${name}: contains an anon key for project "${payload.ref}".`);
      }
    }
  }
  if (!sawProductionServer) problems.push(`bundle never references ${PRODUCTION_SERVER_URL}.`);
  if (!sawProductionSupabase) problems.push('bundle never references the production Supabase project.');
  return [...new Set(problems)];
}

async function listTextFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listTextFiles(full)));
    else if (/\.(?:js|mjs|html|json|css|txt)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const step = process.argv[2];
  let problems;
  if (step === 'env') {
    const { loadEnv } = await import('vite');
    const env = loadEnv('ios', clientDir, 'VITE_');
    problems = validateIosReleaseEnv(env);
    if (!problems.length) {
      console.log(`[ios-guard] env OK: server ${PRODUCTION_SERVER_URL}, Supabase ${PRODUCTION_SUPABASE_REF}, tournaments=${env.VITE_ENABLE_TOURNAMENTS}`);
    }
  } else if (step === 'bundle') {
    const distDir = path.join(clientDir, 'dist');
    const names = await listTextFiles(distDir);
    const files = await Promise.all(
      names.map(async (name) => ({ name: path.relative(clientDir, name), text: await readFile(name, 'utf8') })),
    );
    problems = scanBundleText(files);
    if (!problems.length) console.log(`[ios-guard] bundle OK: ${files.length} files scanned, production origins only, no service-role key`);
  } else {
    console.error('usage: node scripts/iosReleaseGuard.mjs <env|bundle>');
    process.exit(2);
  }
  if (problems.length) {
    console.error(`[ios-guard] REFUSING the iOS build (${step}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Populate client/.env.ios from client/.env.ios.example (see docs/ops/ios-release-build.md).');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
