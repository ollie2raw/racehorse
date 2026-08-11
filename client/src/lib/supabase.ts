import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function makeClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Recovery tokens are consumed manually before BrowserRouter starts.
      detectSessionInUrl: false,
    },
  });
}

export const supabase: SupabaseClient | null = isSupabaseConfigured ? makeClient() : null;

export function getSupabaseConfigError(): string | null {
  if (isSupabaseConfigured) return null;
  return 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts and stats.';
}
