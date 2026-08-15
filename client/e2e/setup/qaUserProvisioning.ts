import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export type EphemeralUser = {
  id: string;
  email: string;
  password: string;
  username: string;
};

type AdminClient = SupabaseClient;

type SupabaseErrorLike = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  cause?: unknown;
  stack?: unknown;
};

export function describeSupabaseError(error: unknown): string {
  if (!error) return 'unknown Supabase error';
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'object') {
    const value = error as SupabaseErrorLike;
    const fields = ['name', 'message', 'status', 'code', 'cause']
      .map((key) => [key, value[key as keyof SupabaseErrorLike]] as const)
      .filter(([, field]) => field != null && field !== '')
      .map(([key, field]) => `${key}=${typeof field === 'string' ? field : JSON.stringify(field)}`);
    if (fields.length > 0) return fields.join(', ');
  }
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for authenticated E2E setup.`);
  return value;
}

export function getSupabaseAdminClient(): AdminClient {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseAnonConfig(): { url: string; anonKey: string } {
  return {
    url: process.env.VITE_SUPABASE_URL?.trim() || requiredEnv('SUPABASE_URL'),
    anonKey: requiredEnv('VITE_SUPABASE_ANON_KEY'),
  };
}

export function getStorageKey(supabaseUrl: string): string {
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (!projectRef) throw new Error('Unable to derive the Supabase project reference.');
  return `sb-${projectRef}-auth-token`;
}

export async function createEphemeralUser(admin: AdminClient = getSupabaseAdminClient()): Promise<EphemeralUser> {
  const id = randomUUID();
  const username = `e2e_${id.replace(/-/g, '').slice(0, 18)}`;
  const email = `e2e-${id}@racehorse-test.invalid`;
  const password = `E2e-${randomUUID()}-Aa9!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, preferred_username: username },
  });
  if (error) throw new Error(`Unable to create ephemeral E2E user: ${error.message}`);
  if (!data.user?.id) throw new Error('Supabase created an E2E user without an ID.');
  return { id: data.user.id, email, password, username };
}

export async function deleteEphemeralUser(
  id: string,
  admin: AdminClient = getSupabaseAdminClient(),
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Refusing to delete a non-UUID E2E user ID.');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(id);
    const details = describeSupabaseError(error);
    if (!error || /not found|does not exist|user not found/i.test(details)) return;
    const status = Number((error as { status?: unknown }).status ?? 0);
    const transient = status >= 500 || status === 429 || /network|fetch|timeout|temporar/i.test(details);
    if (!transient || attempt === 1) {
      throw new Error(`Unable to delete ephemeral E2E user ${id}: ${details}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function signInEphemeralUser(user: EphemeralUser) {
  const { url, anonKey } = getSupabaseAnonConfig();
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Unable to sign in ephemeral E2E user: ${error.message}`);
  if (!data.session) throw new Error('Supabase sign-in returned no session.');
  return { url, session: data.session };
}
