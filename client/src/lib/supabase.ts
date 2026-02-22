import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

declare global {
  // eslint-disable-next-line no-var
  var __SUPABASE__: SupabaseClient | undefined;
}

function makeClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      // IMPORTANT: Daily puzzle reads don't need auth.
      // Turning this off avoids Navigator Lock / multi-instance issues during dev + HMR.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? (globalThis.__SUPABASE__ ?? (globalThis.__SUPABASE__ = makeClient()))
  : null;

export function getSupabaseConfigError(): string | null {
  if (isSupabaseConfigured) return null;
  return "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts and stats.";
}
