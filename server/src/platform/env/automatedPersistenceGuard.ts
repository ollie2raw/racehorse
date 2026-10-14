import { ALLOW_PRODUCTION_ENV, assertNotProductionSupabase } from './productionSupabaseGuard';

/** Automated persistence QA never inherits the manual production override. */
export function assertAutomatedPersistenceTarget(
  context: string,
  { env = process.env, urls = [] }: { env?: Record<string, string | undefined>; urls?: string[] } = {},
): void {
  assertNotProductionSupabase(context, { env: { ...env, [ALLOW_PRODUCTION_ENV]: undefined }, argv: [] });
  for (const value of urls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error(`[${context}] automated persistence QA requires a loopback app/API origin backed by dev Supabase.`);
    }
  }
}
