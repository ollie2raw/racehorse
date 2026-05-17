
/** Prevent hung PostgREST/auth calls from blocking HTTP handlers indefinitely. */
export const DEFAULT_SUPABASE_FETCH_TIMEOUT_MS = 15_000;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function getConfig() {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL', process.env.SUPABASE_URL),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY', process.env.SUPABASE_SERVICE_KEY),
  };
}

export function isSupabaseTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  return /timed out|aborted/i.test(error.message);
}

export type SupabaseFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export async function supabaseFetch<T>(path: string, init?: SupabaseFetchOptions): Promise<T> {
  const { supabaseUrl, serviceKey } = getConfig();
  const { timeoutMs = DEFAULT_SUPABASE_FETCH_TIMEOUT_MS, ...requestInit } = init ?? {};
  const url = new URL(path, supabaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(requestInit.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Supabase request timed out after ${timeoutMs}ms: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}
