import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { GatewayIntercept } from './localPostgrestGateway';

/**
 * Loopback-only stand-in for the Supabase Auth endpoints the chaos scripts and the server use
 * (`/auth/v1/admin/users`, `/auth/v1/token`, `/auth/v1/user`), backed by the owned test database.
 * Tokens are `syn.<userId>` — meaningless anywhere else. Never point this at a real project.
 */
export function createSyntheticAuth(databaseUrl: string): GatewayIntercept {
  if (databaseUrl !== 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1') {
    throw new Error('synthetic auth refuses any database but the owned loopback test instance');
  }
  const psql = (query: string) =>
    execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', query], { encoding: 'utf8' }).trim();
  const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return (req, body) => {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/auth/v1/')) return null;
    if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
      const payload = JSON.parse(body || '{}') as { email?: string; user_metadata?: Record<string, unknown> };
      const id = randomUUID();
      psql(`insert into auth.users(id,email,raw_user_meta_data) values (${lit(id)},${lit(String(payload.email))},${lit(JSON.stringify(payload.user_metadata ?? {}))}::jsonb)`);
      return { status: 200, json: { id, email: payload.email } };
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
      const payload = JSON.parse(body || '{}') as { email?: string };
      const id = psql(`select id from auth.users where email=${lit(String(payload.email))}`);
      return id ? { status: 200, json: { access_token: `syn.${id}`, token_type: 'bearer', user: { id } } } : { status: 400, json: { error: 'invalid_grant' } };
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const id = token.startsWith('syn.') ? token.slice(4) : '';
      const exists = id && /^[0-9a-f-]{36}$/i.test(id) && psql(`select count(*) from auth.users where id=${lit(id)}`) === '1';
      return exists ? { status: 200, json: { id, aud: 'authenticated', role: 'authenticated' } } : { status: 401, json: { message: 'invalid token' } };
    }
    const del = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (req.method === 'DELETE' && del) {
      psql(`delete from auth.users where id=${lit(del[1]!)}`);
      return { status: 200, json: {} };
    }
    return { status: 404, json: { message: 'not implemented by the synthetic auth stand-in' } };
  };
}
