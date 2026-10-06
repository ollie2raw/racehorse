/**
 * B4 guard (docs/ops/dev-supabase-project.md §7): local dev servers, tests and
 * scripts that create throwaway users refuse to run against the production
 * Supabase project. Local work belongs on the separate dev project.
 *
 * Production's project ref is not a secret (it is in the client bundle and in
 * gen-puzzles.yml), so it is listed here rather than read from the
 * environment: a guard that depends on a local env var being set protects
 * nothing on the machine that forgot to set it.
 *
 * A deliberate production run opts in with `--allow-production` or
 * `RACEHORSE_ALLOW_PRODUCTION_SUPABASE=1` (CI e2e and the manual Daily Fritz
 * soak do, until they get dev-project secrets).
 */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ['fisfadjqllojdzibcdfx'];

export const ALLOW_PRODUCTION_ENV = 'RACEHORSE_ALLOW_PRODUCTION_SUPABASE';
export const ALLOW_PRODUCTION_FLAG = '--allow-production';

const URL_VARS = ['SUPABASE_URL', 'SUPABASE_POOLER_URL', 'VITE_SUPABASE_URL'] as const;
const KEY_VARS = ['SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'] as const;

type Env = Record<string, string | undefined>;

/** `https://<ref>.supabase.co` (or `<ref>.pooler.supabase.com`) → `<ref>`. */
export function supabaseRefFromUrl(value: string): string | null {
  try {
    const host = new URL(value).hostname;
    if (!host.endsWith('.supabase.co') && !host.endsWith('.supabase.com')) return null;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

/**
 * The `ref` claim of a legacy JWT API key. New-style `sb_secret_…` /
 * `sb_publishable_…` keys carry no ref, so they're judged by the URL alone.
 */
export function supabaseRefFromKey(value: string): string | null {
  const payload = value.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { ref?: unknown };
    return typeof claims.ref === 'string' ? claims.ref : null;
  } catch {
    return null;
  }
}

/** Names of the env vars that point at a production project. */
export function findProductionSupabaseVars(env: Env, productionRefs = PRODUCTION_SUPABASE_REFS): string[] {
  const hits: string[] = [];
  for (const name of URL_VARS) {
    const value = env[name]?.trim();
    const ref = value ? supabaseRefFromUrl(value) : null;
    if (ref && productionRefs.includes(ref)) hits.push(name);
  }
  for (const name of KEY_VARS) {
    const value = env[name]?.trim();
    const ref = value ? supabaseRefFromKey(value) : null;
    if (ref && productionRefs.includes(ref)) hits.push(name);
  }
  return hits;
}

export function productionSupabaseAllowed(env: Env, argv: readonly string[]): boolean {
  const flag = env[ALLOW_PRODUCTION_ENV]?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || argv.includes(ALLOW_PRODUCTION_FLAG);
}

export function assertNotProductionSupabase(
  context: string,
  { env = process.env as Env, argv = process.argv }: { env?: Env; argv?: readonly string[] } = {},
): void {
  const hits = findProductionSupabaseVars(env);
  if (hits.length === 0 || productionSupabaseAllowed(env, argv)) return;
  throw new Error(
    `[${context}] refusing to run against the PRODUCTION Supabase project (${hits.join(', ')}). ` +
      'Point your env at the dev project (docs/ops/dev-supabase-project.md). ' +
      `If production is deliberate, pass ${ALLOW_PRODUCTION_FLAG} or set ${ALLOW_PRODUCTION_ENV}=1.`,
  );
}

/**
 * True for the deployed server: Render sets RENDER=true on every service,
 * Vercel sets VERCEL=1, and both run with NODE_ENV=production. Any one is
 * enough, so the dev-server guard can never fire in production.
 */
export function isHostedProduction(env: Env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.RENDER) || Boolean(env.VERCEL);
}
