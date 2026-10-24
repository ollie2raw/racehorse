/**
 * Starts the owned loopback gateway (PostgREST prefix + synthetic Auth) so the EXISTING chaos scripts
 * (`chaos:multiplayer-restart`, `chaos:ranked-restart`) run unmodified against the owned database:
 *   SUPABASE_URL=http://127.0.0.1:55447 SUPABASE_SERVICE_KEY=<service jwt> VITE_SUPABASE_ANON_KEY=<same>
 * Runs until killed. Loopback/owned-database only.
 */
import { createHmac } from 'node:crypto';
import { startLocalPostgrestGateway } from '../test/support/localPostgrestGateway';
import { createSyntheticAuth } from '../test/support/syntheticAuth';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
const REST_URL = 'http://127.0.0.1:55440';
if (process.env.TERMINAL_R1_TEST_DATABASE_URL !== DB_URL || process.env.TERMINAL_R1_POSTGREST_URL !== REST_URL) {
  throw new Error('Refusing to run: exact owned loopback test database/PostgREST not configured');
}
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const message = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 6 * 3600 })}`;
const jwt = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;

void startLocalPostgrestGateway({
  upstream: REST_URL,
  port: Number(process.env.LOCAL_CHAOS_GATEWAY_PORT ?? 55447),
  intercept: createSyntheticAuth(DB_URL),
}).then((gateway) => {
  process.stdout.write(`${JSON.stringify({ url: gateway.url, serviceKey: jwt })}\n`);
});
