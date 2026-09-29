import { Capacitor } from '@capacitor/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { capacitorAuthStorage } from './capacitorAuthStorage';

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
      // Inside the native shell, localStorage's WebView container is not
      // durable across relaunches — use Capacitor Preferences instead.
      // The plain web build (playracehorse.com) keeps the default storage.
      ...(Capacitor.isNativePlatform() ? { storage: capacitorAuthStorage } : {}),
    },
  });
}

export const supabase: SupabaseClient | null = isSupabaseConfigured ? makeClient() : null;

export function getSupabaseConfigError(): string | null {
  if (isSupabaseConfigured) return null;
  return 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts and stats.';
}
